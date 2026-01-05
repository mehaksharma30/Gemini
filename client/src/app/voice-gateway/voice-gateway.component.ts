import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/services/auth.service';

// Voice Gateway Client
// PCM16 mono 16kHz, 20ms frames (320 samples, 640 bytes payload)

const SAMPLE_RATE = 16000;
const SAMPLES_PER_FRAME = 320; // 20ms at 16kHz
const FRAME_DURATION_MS = 20;
const PAYLOAD_SIZE = 640; // SAMPLES_PER_FRAME * 2 (Int16 = 2 bytes)
const PACKET_SIZE = 12 + PAYLOAD_SIZE; // header (12) + payload (640)

// Jitter buffer settings
const MIN_BUFFER_PACKETS = 10; // ~200ms buffer before starting playback
const MAX_BUFFER_PACKETS = 30; // ~600ms max buffer
const LOW_BUFFER_THRESHOLD = 6; // Pause if buffer drops below this

// Downsample audio to 16kHz using linear interpolation
function downsampleTo16k(inputFloat32: Float32Array, inputRate: number): Float32Array {
  if (inputRate === SAMPLE_RATE) {
    // Create a new Float32Array to ensure it's backed by ArrayBuffer (not SharedArrayBuffer)
    // Copy the data to a new ArrayBuffer-backed Float32Array
    const result = new Float32Array(inputFloat32.length);
    result.set(inputFloat32);
    return result;
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

@Component({
  selector: 'app-voice-gateway',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="voice-gateway-container">
      <h1>🎤 Voice Gateway Test</h1>
      
      <div class="section">
        <h2>Connection</h2>
        <div class="form-group">
          <label for="callId">Call ID:</label>
          <input type="text" id="callId" [(ngModel)]="callId" placeholder="e.g., test-call-1">
        </div>
        <div class="form-group">
          <label for="userId">User ID:</label>
          <input type="text" id="userId" [(ngModel)]="userId" placeholder="e.g., userA">
        </div>
        <div class="button-group">
          <button [class]="'btn-primary'" (click)="connect()" [disabled]="isConnected">Connect</button>
          <button [class]="'btn-danger'" (click)="disconnect()" [disabled]="!isConnected">Disconnect</button>
        </div>
      </div>
      
      <div class="section">
        <h2>Audio Controls</h2>
        <div class="button-group">
          <button [class]="'btn-success'" (click)="startMic()" [disabled]="!isConnected || isMicActive">Start Mic</button>
          <button [class]="'btn-danger'" (click)="stopMic()" [disabled]="!isMicActive">Stop Mic</button>
          <button [class]="'btn-warning'" (click)="toggleMicMute()" [disabled]="!isMicActive">
            Mic: {{ isMicMuted ? 'Muted' : 'Unmuted' }}
          </button>
          <button [class]="'btn-warning'" (click)="toggleSpeakerMute()" [disabled]="!isConnected">
            Speaker: {{ isSpeakerMuted ? 'Muted' : 'Unmuted' }}
          </button>
        </div>
      </div>
      
      <div class="section">
        <h2>Status</h2>
        <div class="status">
          <div class="status-item">
            <span class="status-label">WebSocket:</span>
            <span [class]="'status-value ' + (isConnected ? 'success' : 'error')">
              {{ isConnected ? 'Connected' : 'Disconnected' }}
            </span>
          </div>
          <div class="status-item">
            <span class="status-label">Audio Context:</span>
            <span [class]="'status-value ' + (audioContext ? 'success' : '')">
              {{ audioContext ? audioContext.sampleRate + 'Hz' : 'Not initialized' }}
            </span>
          </div>
          <div class="status-item">
            <span class="status-label">Microphone:</span>
            <span [class]="'status-value ' + (isMicActive ? (isMicMuted ? 'error' : 'success') : '')">
              {{ isMicActive ? (isMicMuted ? 'Muted' : 'Active') : 'Stopped' }}
            </span>
          </div>
          <div class="status-item">
            <span class="status-label">Packets Sent/sec:</span>
            <span class="status-value">{{ packetsSentLastSecond }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Packets Recv/sec:</span>
            <span class="status-value">{{ packetsRecvLastSecond }}</span>
          </div>
          <div class="status-item">
            <span class="status-label">Jitter Buffer:</span>
            <span class="status-value">{{ jitterBuffer.size }} packets</span>
          </div>
        </div>
      </div>
      
      <div class="section">
        <h2>Logs</h2>
        <div class="log" #logContainer></div>
      </div>
    </div>
  `,
  styles: [`
    .voice-gateway-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      min-height: 100vh;
    }
    
    h1 {
      color: #4a9eff;
      margin-bottom: 20px;
    }
    
    .section {
      background: #2a2a2a;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
    
    .section h2 {
      color: #6bb6ff;
      margin-bottom: 15px;
      font-size: 18px;
    }
    
    .form-group {
      margin-bottom: 15px;
    }
    
    label {
      display: block;
      margin-bottom: 5px;
      color: #b0b0b0;
      font-size: 14px;
    }
    
    input[type="text"] {
      width: 100%;
      padding: 10px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #e0e0e0;
      font-size: 14px;
    }
    
    input[type="text"]:focus {
      outline: none;
      border-color: #4a9eff;
    }
    
    .button-group {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 15px;
    }
    
    button {
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
      font-weight: 500;
    }
    
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .btn-primary {
      background: #4a9eff;
      color: white;
    }
    
    .btn-primary:hover:not(:disabled) {
      background: #3a8eef;
    }
    
    .btn-success {
      background: #4caf50;
      color: white;
    }
    
    .btn-success:hover:not(:disabled) {
      background: #45a049;
    }
    
    .btn-danger {
      background: #f44336;
      color: white;
    }
    
    .btn-danger:hover:not(:disabled) {
      background: #da190b;
    }
    
    .btn-warning {
      background: #ff9800;
      color: white;
    }
    
    .btn-warning:hover:not(:disabled) {
      background: #e68900;
    }
    
    .status {
      margin-top: 15px;
      padding: 10px;
      background: #1a1a1a;
      border-radius: 4px;
      font-size: 13px;
      font-family: 'Courier New', monospace;
    }
    
    .status-item {
      margin-bottom: 5px;
    }
    
    .status-label {
      color: #888;
      display: inline-block;
      width: 150px;
    }
    
    .status-value {
      color: #4a9eff;
    }
    
    .status-value.error {
      color: #f44336;
    }
    
    .status-value.success {
      color: #4caf50;
    }
    
    .log {
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 10px;
      max-height: 300px;
      overflow-y: auto;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #888;
    }
    
    .log-entry {
      margin-bottom: 3px;
    }
    
    .log-entry.error {
      color: #f44336;
    }
    
    .log-entry.success {
      color: #4caf50;
    }
    
    .log-entry.info {
      color: #4a9eff;
    }
  `]
})
export class VoiceGatewayComponent implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  
  // Connection state
  callId: string = 'test-call-1';
  userId: string = '';
  ws: WebSocket | null = null;
  isConnected: boolean = false;
  
  // Audio state
  audioContext: AudioContext | null = null;
  mediaStream: MediaStream | null = null;
  scriptProcessor: ScriptProcessorNode | null = null;
  audioSource: MediaStreamAudioSourceNode | null = null;
  isMicActive: boolean = false;
  isMicMuted: boolean = false;
  isSpeakerMuted: boolean = false;
  seqCounter: number = 0;
  
  // Playback state
  jitterBuffer = new Map<number, { timestamp: number; payload: ArrayBuffer }>();
  playbackGainNode: GainNode | null = null;
  nextPlaybackSeq: number | null = null;
  isPlaying: boolean = false;
  nextPlayTime: number | null = null;
  scheduledSources = new Set<AudioBufferSourceNode>();
  playbackSchedulerInterval: any = null;
  
  // Stats
  packetsSent: number = 0;
  packetsRecv: number = 0;
  packetsSentLastSecond: number = 0;
  packetsRecvLastSecond: number = 0;
  micCallbackCount: number = 0;
  micCallbackCountLastSecond: number = 0;
  
  private statsInterval: any = null;
  private logContainer: HTMLElement | null = null;

  ngOnInit() {
    // Get current user ID
    const currentUser = this.authService.currentUser();
    if (currentUser?.id) {
      this.userId = currentUser.id;
    } else {
      this.userId = 'user-' + Math.random().toString(36).substr(2, 9);
    }
    
    // Start stats update interval
    this.statsInterval = setInterval(() => {
      this.packetsSentLastSecond = 0;
      this.packetsRecvLastSecond = 0;
      this.micCallbackCountLastSecond = this.micCallbackCount;
      this.micCallbackCount = 0;
      this.cdr.detectChanges();
    }, 1000);
    
    this.log('Voice Gateway Client ready');
  }

  ngOnDestroy() {
    this.disconnect();
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
  }

  log(message: string, type: 'info' | 'error' | 'success' = 'info') {
    if (!this.logContainer) {
      this.logContainer = document.querySelector('.log') as HTMLElement;
    }
    if (this.logContainer) {
      const entry = document.createElement('div');
      entry.className = `log-entry ${type}`;
      entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
      this.logContainer.appendChild(entry);
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
    console.log(`[Voice Client] ${message}`);
  }

  async connect() {
    if (!this.callId || !this.userId) {
      this.log('Please enter Call ID and User ID', 'error');
      return;
    }

    try {
      const url = `ws://localhost:8080/?callId=${encodeURIComponent(this.callId)}&userId=${encodeURIComponent(this.userId)}`;
      this.log(`Connecting to ${url}...`);
      
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.log('WebSocket connected', 'success');
        this.isConnected = true;
        this.cdr.detectChanges();
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'connected') {
              this.log(`Connected to call: ${msg.callId} as ${msg.userId}`, 'success');
            }
          } catch (e) {
            this.log(`Received text message: ${event.data}`);
          }
        } else {
          if (event.data instanceof Blob) {
            event.data.arrayBuffer().then(buffer => {
              this.handleAudioPacket(buffer);
            }).catch(error => {
              console.error('[Voice Client] Error converting Blob to ArrayBuffer:', error);
            });
          } else if (event.data instanceof ArrayBuffer) {
            this.handleAudioPacket(event.data);
          }
        }
      };

      this.ws.onerror = (error) => {
        this.log(`WebSocket error: ${(error as any).message || 'Unknown error'}`, 'error');
        this.cleanup();
      };

      this.ws.onclose = (event) => {
        this.log(`WebSocket disconnected (code: ${event.code})`, 'error');
        this.cleanup();
      };
    } catch (error: any) {
      this.log(`Connection error: ${error.message}`, 'error');
    }
  }

  disconnect() {
    this.stopMic();
    
    if (this.playbackSchedulerInterval) {
      clearInterval(this.playbackSchedulerInterval);
      this.playbackSchedulerInterval = null;
    }
    
    if (this.scheduledSources.size > 0) {
      this.scheduledSources.forEach(source => {
        try {
          source.stop();
        } catch (e) {}
      });
      this.scheduledSources.clear();
    }
    
    if (this.playbackGainNode) {
      try {
        this.playbackGainNode.disconnect();
      } catch (e) {}
      this.playbackGainNode = null;
    }
    
    this.jitterBuffer.clear();
    this.isPlaying = false;
    this.nextPlaybackSeq = null;
    this.nextPlayTime = null;
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
    this.cdr.detectChanges();
    this.log('Disconnected and cleaned up', 'info');
  }

  private cleanup() {
    this.stopMic();
    
    if (this.playbackSchedulerInterval) {
      clearInterval(this.playbackSchedulerInterval);
      this.playbackSchedulerInterval = null;
    }
    
    if (this.scheduledSources.size > 0) {
      this.scheduledSources.forEach(source => {
        try {
          source.stop();
        } catch (e) {}
      });
      this.scheduledSources.clear();
    }
    
    if (this.playbackGainNode) {
      try {
        this.playbackGainNode.disconnect();
      } catch (e) {}
      this.playbackGainNode = null;
    }
    
    this.jitterBuffer.clear();
    this.isPlaying = false;
    this.nextPlaybackSeq = null;
    this.nextPlayTime = null;
    this.isConnected = false;
    this.cdr.detectChanges();
  }

  handleAudioPacket(data: ArrayBuffer) {
    if (!data || data.byteLength !== PACKET_SIZE) {
      this.log(`Invalid packet size: ${data?.byteLength || 'undefined'} (expected ${PACKET_SIZE})`, 'error');
      return;
    }

    try {
      const view = new DataView(data);
      const seq = view.getUint32(0, true);
      const timestampMs = Number(view.getBigUint64(4, true));
      const payload = data.slice(12);

      this.packetsRecv++;
      this.packetsRecvLastSecond++;

      this.jitterBuffer.set(seq, { timestamp: timestampMs, payload });
      this.processJitterBuffer();
    } catch (error: any) {
      console.error('[Voice Client] Error parsing audio packet:', error);
    }
  }

  processJitterBuffer() {
    if (!this.audioContext) return;

    if (!this.isPlaying) {
      if (this.jitterBuffer.size >= MIN_BUFFER_PACKETS) {
        const seqs = Array.from(this.jitterBuffer.keys()).sort((a, b) => a - b);
        this.nextPlaybackSeq = seqs[0];
        this.nextPlayTime = this.audioContext.currentTime + 0.20;
        this.isPlaying = true;
        this.log(`Starting playback from seq ${this.nextPlaybackSeq} (buffer: ${this.jitterBuffer.size} packets)`);
        
        if (!this.playbackSchedulerInterval) {
          this.playbackSchedulerInterval = setInterval(() => {
            this.scheduleNextPacket();
          }, 20);
        }
      } else {
        return;
      }
    }

    if (this.isPlaying && this.jitterBuffer.size < LOW_BUFFER_THRESHOLD) {
      if (this.playbackSchedulerInterval) {
        clearInterval(this.playbackSchedulerInterval);
        this.playbackSchedulerInterval = null;
      }
      
      this.scheduledSources.forEach(source => {
        try {
          source.stop();
        } catch (e) {}
      });
      this.scheduledSources.clear();
      this.isPlaying = false;
      this.nextPlaybackSeq = null;
      this.nextPlayTime = null;
      this.log('Playback paused (low buffer)', 'error');
      return;
    }

    if (this.jitterBuffer.size > MAX_BUFFER_PACKETS) {
      const seqs = Array.from(this.jitterBuffer.keys()).sort((a, b) => a - b);
      const toRemove = seqs.slice(0, seqs.length - MAX_BUFFER_PACKETS);
      toRemove.forEach(seq => this.jitterBuffer.delete(seq));
    }
  }

  scheduleNextPacket() {
    if (!this.isPlaying || !this.audioContext || this.jitterBuffer.size < LOW_BUFFER_THRESHOLD) {
      return;
    }

    if (this.jitterBuffer.has(this.nextPlaybackSeq!)) {
      const packet = this.jitterBuffer.get(this.nextPlaybackSeq!)!;
      this.jitterBuffer.delete(this.nextPlaybackSeq!);
      
      this.scheduleAudioChunk(packet.payload);
      this.nextPlaybackSeq!++;
    } else {
      const seqs = Array.from(this.jitterBuffer.keys()).sort((a, b) => a - b);
      if (seqs.length > 0) {
        this.nextPlaybackSeq = seqs[0];
      } else if (this.jitterBuffer.size < LOW_BUFFER_THRESHOLD) {
        if (this.playbackSchedulerInterval) {
          clearInterval(this.playbackSchedulerInterval);
          this.playbackSchedulerInterval = null;
        }
        this.scheduledSources.forEach(source => {
          try {
            source.stop();
          } catch (e) {}
        });
        this.scheduledSources.clear();
        this.isPlaying = false;
        this.nextPlaybackSeq = null;
        this.nextPlayTime = null;
      }
    }
  }

  scheduleAudioChunk(pcmData: ArrayBuffer) {
    if (!this.audioContext || this.isSpeakerMuted || !this.isPlaying) {
      return;
    }

    try {
      const int16Array = new Int16Array(pcmData);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
      }

      const buffer = this.audioContext.createBuffer(1, float32Array.length, SAMPLE_RATE);
      buffer.copyToChannel(float32Array, 0);

      if (!this.playbackGainNode) {
        this.playbackGainNode = this.audioContext.createGain();
        this.playbackGainNode.connect(this.audioContext.destination);
      }

      const now = this.audioContext.currentTime;
      if (this.nextPlayTime! < now) {
        this.nextPlayTime = now + 0.05;
      }

      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.playbackGainNode);
      source.start(this.nextPlayTime!);

      this.scheduledSources.add(source);
      this.nextPlayTime! += 0.02;

      source.onended = () => {
        this.scheduledSources.delete(source);
      };
    } catch (error: any) {
      this.log(`Error scheduling audio: ${error.message}`, 'error');
    }
  }

  async startMic() {
    if (this.isMicActive) {
      this.log('Microphone already active', 'error');
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('WebSocket not connected', 'error');
      return;
    }

    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.log(`Audio context initialized: ${this.audioContext.sampleRate}Hz`);
        
        if (this.audioContext.sampleRate !== SAMPLE_RATE) {
          this.log(`Warning: Sample rate mismatch. Input: ${this.audioContext.sampleRate}Hz, Target: ${SAMPLE_RATE}Hz. Will downsample.`, 'error');
        }
        
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.log('Microphone access granted', 'success');

      this.audioSource = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

      const inputSampleRate = this.audioContext.sampleRate;
      let txAcc = new Float32Array(0);

      this.scriptProcessor.onaudioprocess = (e) => {
        this.micCallbackCount++;
        
        if (this.isMicMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Copy to new Float32Array to ensure ArrayBuffer backing (not SharedArrayBuffer)
        let processedData: Float32Array;
        if (inputSampleRate !== SAMPLE_RATE) {
          // Create a copy first to ensure ArrayBuffer backing
          const inputCopy = new Float32Array(inputData.length);
          inputCopy.set(inputData);
          processedData = downsampleTo16k(inputCopy, inputSampleRate);
        } else {
          // Create a copy to ensure ArrayBuffer backing
          processedData = new Float32Array(inputData.length);
          processedData.set(inputData);
        }
        
        const newAcc = new Float32Array(txAcc.length + processedData.length);
        newAcc.set(txAcc, 0);
        newAcc.set(processedData, txAcc.length);
        txAcc = newAcc;

        while (txAcc.length >= SAMPLES_PER_FRAME) {
          const frame = txAcc.slice(0, SAMPLES_PER_FRAME);
          txAcc = txAcc.slice(SAMPLES_PER_FRAME);

          const pcm16 = new Int16Array(SAMPLES_PER_FRAME);
          for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
            const sample = Math.max(-1, Math.min(1, frame[i]));
            pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          }

          const packet = new ArrayBuffer(PACKET_SIZE);
          const view = new DataView(packet);
          const timestamp = Date.now();

          view.setUint32(0, this.seqCounter, true);
          view.setBigUint64(4, BigInt(timestamp), true);
          
          const pcmBytes = new Uint8Array(pcm16.buffer);
          new Uint8Array(packet, 12).set(pcmBytes);

          try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(packet);
              this.packetsSent++;
              this.packetsSentLastSecond++;
              this.seqCounter++;
            }
          } catch (error) {
            console.error('[Voice Client] Error sending packet:', error);
            break;
          }
        }
      };

      const zeroGain = this.audioContext.createGain();
      zeroGain.gain.value = 0;
      this.audioSource.connect(this.scriptProcessor);
      this.scriptProcessor.connect(zeroGain);
      zeroGain.connect(this.audioContext.destination);

      this.isMicActive = true;
      this.cdr.detectChanges();
      this.log('Microphone started', 'success');
    } catch (error: any) {
      this.log(`Failed to start microphone: ${error.message}`, 'error');
    }
  }

  stopMic() {
    if (!this.isMicActive) {
      return;
    }

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    this.isMicActive = false;
    this.isMicMuted = false;
    this.micCallbackCount = 0;
    this.micCallbackCountLastSecond = 0;
    this.cdr.detectChanges();
    this.log('Microphone stopped');
  }

  toggleMicMute() {
    this.isMicMuted = !this.isMicMuted;
    this.cdr.detectChanges();
    this.log(`Microphone ${this.isMicMuted ? 'muted' : 'unmuted'}`);
  }

  toggleSpeakerMute() {
    this.isSpeakerMuted = !this.isSpeakerMuted;
    
    if (this.playbackGainNode) {
      this.playbackGainNode.gain.value = this.isSpeakerMuted ? 0 : 1;
    }
    
    this.cdr.detectChanges();
    this.log(`Speaker ${this.isSpeakerMuted ? 'muted' : 'unmuted'}`);
  }
}

