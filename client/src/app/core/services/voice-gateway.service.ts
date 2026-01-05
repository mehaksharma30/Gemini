import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

// Voice Gateway Constants
const SAMPLE_RATE = 16000;
const SAMPLES_PER_FRAME = 320; // 20ms at 16kHz
const FRAME_DURATION_MS = 20;
const PAYLOAD_SIZE = 640; // SAMPLES_PER_FRAME * 2 (Int16 = 2 bytes)
const PACKET_SIZE = 12 + PAYLOAD_SIZE; // header (12) + payload (640)

// Jitter buffer settings
const MIN_BUFFER_PACKETS = 10; // ~200ms buffer before starting playback
const MAX_BUFFER_PACKETS = 30; // ~600ms max buffer
const LOW_BUFFER_THRESHOLD = 6; // Pause if buffer drops below this

// Voice Gateway WebSocket URL (local development)
const GATEWAY_URL = 'ws://localhost:8080';

// Downsample audio to 16kHz using linear interpolation
function downsampleTo16k(inputFloat32: Float32Array, inputRate: number): Float32Array {
  if (inputRate === SAMPLE_RATE) {
    return inputFloat32;
  }

  const ratio = inputRate / SAMPLE_RATE;
  const outputLength = Math.floor(inputFloat32.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputFloat32.length - 1);
    const fraction = srcIndex - srcIndexFloor;
    
    // Linear interpolation
    output[i] = inputFloat32[srcIndexFloor] * (1 - fraction) + inputFloat32[srcIndexCeil] * fraction;
  }

  return output;
}

@Injectable({
  providedIn: 'root',
})
export class VoiceGatewayService {
  private ws: WebSocket | null = null;
  private callId: string = '';
  private userId: string = '';
  
  // Audio context for playback
  private audioContext: AudioContext | null = null;
  private playbackGainNode: GainNode | null = null;
  
  // Jitter buffer for playback
  private jitterBuffer: Map<number, { timestamp: number; payload: ArrayBuffer }> = new Map();
  private nextPlaybackSeq: number | null = null;
  private isPlaying: boolean = false;
  private nextPlayTime: number | null = null;
  private scheduledSources: Set<AudioBufferSourceNode> = new Set();
  private playbackSchedulerInterval: any = null;

  // Connection state
  private connectedSubject = new BehaviorSubject<boolean>(false);
  public connected$ = this.connectedSubject.asObservable();

  // Audio packet subject (for sending)
  private audioPacketSubject = new BehaviorSubject<ArrayBuffer | null>(null);
  public audioPackets$ = this.audioPacketSubject.asObservable();

  constructor() {
    console.log('[Voice Gateway] Service initialized');
  }

  /**
   * Connect to Voice Gateway WebSocket
   * @param callId - Call ID (room identifier)
   * @param userId - User ID
   */
  async connect(callId: string, userId: string): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[Voice Gateway] Already connected');
      return;
    }

    this.callId = callId;
    this.userId = userId;

    return new Promise((resolve, reject) => {
      try {
        const url = `${GATEWAY_URL}/?callId=${encodeURIComponent(callId)}&userId=${encodeURIComponent(userId)}`;
        console.log('[Voice Gateway] Connecting to:', url);
        
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('[Voice Gateway] Connected');
          this.connectedSubject.next(true);
          
          // Initialize audio context for playback
          if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            if (this.audioContext.state === 'suspended') {
              this.audioContext.resume();
            }
            this.playbackGainNode = this.audioContext.createGain();
            this.playbackGainNode.connect(this.audioContext.destination);
            console.log('[Voice Gateway] Audio context initialized:', this.audioContext.sampleRate, 'Hz');
          }
          
          resolve();
        };

        this.ws.onmessage = async (event) => {
          if (typeof event.data === 'string') {
            // Text message (connection confirmation)
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'connected') {
                console.log(`[Voice Gateway] Connected to call: ${msg.callId} as ${msg.userId}`);
              }
            } catch (e) {
              console.log('[Voice Gateway] Received text message:', event.data);
            }
          } else if (event.data instanceof Blob) {
            // Binary message (audio packet) - convert Blob to ArrayBuffer
            try {
              const arrayBuffer = await event.data.arrayBuffer();
              this.handleAudioPacket(arrayBuffer);
            } catch (error: any) {
              console.error('[Voice Gateway] Error converting Blob to ArrayBuffer:', error);
            }
          } else if (event.data instanceof ArrayBuffer) {
            this.handleAudioPacket(event.data);
          } else {
            console.warn('[Voice Gateway] Received unknown binary data type:', event.data.constructor.name);
          }
        };

        this.ws.onerror = (error: Event) => {
          console.error('[Voice Gateway] WebSocket error:', error);
          this.connectedSubject.next(false);
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = (event: CloseEvent) => {
          console.log(`[Voice Gateway] Disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`);
          this.connectedSubject.next(false);
          this.cleanupPlayback();
        };
      } catch (error: any) {
        console.error('[Voice Gateway] Connection error:', error);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from Voice Gateway
   */
  async disconnect(): Promise<void> {
    this.cleanupPlayback();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
      this.playbackGainNode = null;
    }
    
    this.connectedSubject.next(false);
    console.log('[Voice Gateway] Disconnected');
  }

  private seqCounter: number = 0;

  /**
   * Send audio packet (PCM16, 20ms frame)
   * @param pcm16Data - Int16Array of 320 samples (640 bytes)
   */
  sendAudioPacket(pcm16Data: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (pcm16Data.length !== SAMPLES_PER_FRAME) {
      console.warn(`[Voice Gateway] Invalid packet size: ${pcm16Data.length} (expected ${SAMPLES_PER_FRAME})`);
      return;
    }

    try {
      // Create packet: seq (4 bytes) + timestamp (8 bytes) + payload (640 bytes)
      const packet = new ArrayBuffer(PACKET_SIZE);
      const view = new DataView(packet);
      const timestamp = Date.now();
      const seq = this.seqCounter++;

      view.setUint32(0, seq, true); // seq (little-endian)
      view.setBigUint64(4, BigInt(timestamp), true); // timestamp (little-endian)
      
      // Copy PCM payload
      const pcmBytes = new Uint8Array(pcm16Data.buffer);
      new Uint8Array(packet, 12).set(pcmBytes);

      // Send packet as binary
      this.ws.send(packet);
    } catch (error: any) {
      console.error('[Voice Gateway] Error sending audio packet:', error);
    }
  }

  /**
   * Handle incoming audio packet
   */
  private handleAudioPacket(data: ArrayBuffer): void {
    if (!data || data.byteLength !== PACKET_SIZE) {
      console.warn(`[Voice Gateway] Invalid packet size: ${data?.byteLength || 'undefined'} (expected ${PACKET_SIZE})`);
      return;
    }

    try {
      const view = new DataView(data);
      const seq = view.getUint32(0, true); // Little-endian
      const timestampMs = Number(view.getBigUint64(4, true)); // Little-endian
      const payload = data.slice(12); // 640 bytes

      // Add to jitter buffer
      this.jitterBuffer.set(seq, { timestamp: timestampMs, payload });

      // Process jitter buffer
      this.processJitterBuffer();
    } catch (error: any) {
      console.error('[Voice Gateway] Error parsing audio packet:', error);
    }
  }

  /**
   * Process jitter buffer and play audio
   */
  private processJitterBuffer(): void {
    if (!this.audioContext) return;

    // Check if we should start playback
    if (!this.isPlaying) {
      if (this.jitterBuffer.size >= MIN_BUFFER_PACKETS) {
        // Initialize playback
        const seqs = Array.from(this.jitterBuffer.keys()).sort((a, b) => a - b);
        this.nextPlaybackSeq = seqs[0];
        this.nextPlayTime = this.audioContext.currentTime + 0.20; // 200ms initial delay
        this.isPlaying = true;
        console.log(`[Voice Gateway] Starting playback from seq ${this.nextPlaybackSeq} (buffer: ${this.jitterBuffer.size} packets)`);
        
        // Start periodic scheduler (every 20ms)
        if (!this.playbackSchedulerInterval) {
          this.playbackSchedulerInterval = setInterval(() => {
            this.scheduleNextPacket();
          }, FRAME_DURATION_MS);
        }
      } else {
        return; // Wait for more packets
      }
    }

    // Check if we should pause playback
    if (this.isPlaying && this.jitterBuffer.size < LOW_BUFFER_THRESHOLD) {
      this.cleanupPlayback();
      console.log('[Voice Gateway] Playback paused (low buffer)');
      return;
    }

    // Limit buffer size (remove oldest if too large)
    if (this.jitterBuffer.size > MAX_BUFFER_PACKETS) {
      const seqs = Array.from(this.jitterBuffer.keys()).sort((a, b) => a - b);
      const toRemove = seqs.slice(0, seqs.length - MAX_BUFFER_PACKETS);
      toRemove.forEach(seq => this.jitterBuffer.delete(seq));
    }
  }

  /**
   * Schedule the next packet for playback
   */
  private scheduleNextPacket(): void {
    if (!this.audioContext || !this.isPlaying || this.nextPlaybackSeq === null || !this.playbackGainNode) {
      return;
    }

    const now = this.audioContext.currentTime;
    if (this.nextPlayTime! > now + 0.01) {
      return; // Wait
    }

    // Find next consecutive packet
    while (this.jitterBuffer.has(this.nextPlaybackSeq)) {
      const packet = this.jitterBuffer.get(this.nextPlaybackSeq);
      this.jitterBuffer.delete(this.nextPlaybackSeq);

      this.scheduleAudioChunk(packet!.payload);
      this.nextPlaybackSeq++;

      // Update nextPlayTime for the next packet
      this.nextPlayTime! += (FRAME_DURATION_MS / 1000); // Advance by 20ms
      
      // If we've fallen too far behind, reset nextPlayTime
      if (this.nextPlayTime! < now) {
        this.nextPlayTime = now + 0.05;
      }
    }
  }

  /**
   * Schedule audio chunk for continuous playback
   */
  private scheduleAudioChunk(pcmData: ArrayBuffer): void {
    if (!this.audioContext || !this.isPlaying || !this.playbackGainNode) {
      return;
    }

    try {
      // Convert Int16 PCM to Float32
      const int16Array = new Int16Array(pcmData);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
      }

      // Create audio buffer
      const buffer = this.audioContext.createBuffer(1, float32Array.length, SAMPLE_RATE);
      buffer.copyToChannel(float32Array, 0);

      // Create source and schedule
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.playbackGainNode!);
      source.start(this.nextPlayTime!);

      // Track scheduled source for cleanup
      this.scheduledSources.add(source);

      // Clean up when source ends
      source.onended = () => {
        this.scheduledSources.delete(source);
      };
    } catch (error: any) {
      console.error('[Voice Gateway] Error scheduling audio:', error);
    }
  }

  /**
   * Cleanup playback state
   */
  private cleanupPlayback(): void {
    // Stop scheduler
    if (this.playbackSchedulerInterval) {
      clearInterval(this.playbackSchedulerInterval);
      this.playbackSchedulerInterval = null;
    }
    
    // Stop all scheduled sources
    this.scheduledSources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Already stopped
      }
    });
    this.scheduledSources.clear();
    
    // Clear jitter buffer
    this.jitterBuffer.clear();
    
    // Reset playback state
    this.isPlaying = false;
    this.nextPlaybackSeq = null;
    this.nextPlayTime = null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get audio context (for microphone capture)
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }
}

