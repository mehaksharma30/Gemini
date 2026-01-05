import { Injectable, inject } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { VoiceGatewayService } from './voice-gateway.service';
import { AuthService } from './auth.service';

export interface AudioStreamState {
  isRecording: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  isConnected: boolean;
}

// Voice Gateway Constants
const SAMPLE_RATE = 16000;
const SAMPLES_PER_FRAME = 320; // 20ms at 16kHz
const PAYLOAD_SIZE = 640; // SAMPLES_PER_FRAME * 2 (Int16 = 2 bytes)

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

@Injectable({
  providedIn: 'root',
})
export class AudioCommunicationService {
  private voiceGatewayService = inject(VoiceGatewayService);
  private authService = inject(AuthService);
  
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private micTrack: MediaStreamTrack | null = null; // Store mic track for soft mute
  
  private stateSubject = new Subject<AudioStreamState>();
  private errorSubject = new Subject<string>();
  
  public state$ = this.stateSubject.asObservable();
  public errors$ = this.errorSubject.asObservable();
  
  private currentState: AudioStreamState = {
    isRecording: false,
    isPlaying: false,
    isMuted: false,
    volume: 1.0,
    isConnected: false,
  };

  private callId: string = '';
  private userId: string = '';
  private targetUserId: string = '';
  private seqCounter: number = 0;
  private txAcc: Float32Array = new Float32Array(0); // Transmit accumulator

  constructor() {
    // Subscribe to Voice Gateway connection status
    this.voiceGatewayService.connected$.subscribe(connected => {
      this.currentState.isConnected = connected;
      this.stateSubject.next({ ...this.currentState });
      if (!connected) {
        // Stop recording if disconnected, but do NOT close audio context
        // When using Voice Gateway, the gateway's audio context should remain open
        this.stopRecording().catch(console.error);
      }
    });
  }

  /**
   * Initialize audio communication for a conversation
   * @param userId - Current user ID
   * @param targetUserId - Target user ID
   */
  async initialize(userId: string, targetUserId: string): Promise<void> {
    try {
      this.userId = userId;
      this.targetUserId = targetUserId;
      
      // Create call ID (sorted to ensure consistency)
      this.callId = [userId, targetUserId].sort().join('-');
      console.log('[Audio Communication] Initializing for call:', this.callId);

      // Connect to Voice Gateway
      await this.voiceGatewayService.connect(this.callId, userId);
      
      // Wait for connection to be established
      let connected = false;
      for (let i = 0; i < 50; i++) { // Wait up to 5 seconds
        if (this.voiceGatewayService.isConnected()) {
          connected = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (!connected) {
        throw new Error('Failed to establish Voice Gateway connection');
      }

      // Initialize audio context (use from Voice Gateway or create new)
      this.audioContext = this.voiceGatewayService.getAudioContext() || 
        new (window.AudioContext || (window as any).webkitAudioContext)();

      // Resume audio context if suspended (required by some browsers)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Reset accumulator
      this.txAcc = new Float32Array(0);
      this.seqCounter = 0;

      // Update connection state
      this.currentState.isConnected = true;
      this.stateSubject.next({ ...this.currentState });

      console.log('[Audio Communication] ✅ Initialized successfully for call:', this.callId);
    } catch (error: any) {
      console.error('[Audio Communication] Initialization error:', error);
      this.errorSubject.next(error.message || 'Failed to initialize audio communication');
      throw error;
    }
  }

  /**
   * Start recording and sending audio
   */
  async startRecording(): Promise<void> {
    try {
      if (this.currentState.isRecording) {
        console.log('[Audio Communication] Already recording');
        return;
      }

      if (!this.callId) {
        throw new Error('Not initialized. Call initialize() first.');
      }

      // Wait for connection to be ready
      if (!this.voiceGatewayService.isConnected()) {
        console.log('[Audio Communication] Waiting for Voice Gateway connection...');
        let connected = false;
        for (let i = 0; i < 30; i++) { // Wait up to 3 seconds
          if (this.voiceGatewayService.isConnected()) {
            connected = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (!connected) {
          throw new Error('Voice Gateway not connected. Please try again.');
        }
      }
      
      console.log('[Audio Communication] ✅ Voice Gateway connection verified');

      console.log('[Audio Communication] Requesting microphone access...');
      
      // Get user media (microphone)
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      
      console.log('[Audio Communication] Microphone access granted');

      // Store mic track for soft mute (enable/disable, never stop)
      this.micTrack = this.mediaStream.getAudioTracks()[0] || null;
      if (!this.micTrack) {
        throw new Error('No audio track found in media stream');
      }
      
      // Use Web Audio API to capture PCM audio for real-time streaming
      this.audioSource = this.audioContext!.createMediaStreamSource(this.mediaStream);
      this.audioProcessor = this.audioContext!.createScriptProcessor(4096, 1, 1);
      
      const inputSampleRate = this.audioContext!.sampleRate;
      
      // Create monitorGain for mic monitoring (fixed at 0, never reused for playback)
      const monitorGain = this.audioContext!.createGain();
      monitorGain.gain.value = 0; // Always silent for monitoring
      
      this.audioProcessor.onaudioprocess = (e) => {
        // SOFT MUTE: Keep onaudioprocess running, but gate sending via boolean check
        // Do NOT return early - keep processing pipeline active
        if (!this.voiceGatewayService.isConnected()) {
          return; // Only skip if not connected
        }
        
        // If muted, still process but don't send (soft gate)
        if (this.currentState.isMuted) {
          return; // Soft gate: process continues but no sending
        }

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Downsample if needed
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
        
        // Append to accumulator
        const newAcc = new Float32Array(this.txAcc.length + processedData.length);
        newAcc.set(this.txAcc, 0);
        newAcc.set(processedData, this.txAcc.length);
        this.txAcc = newAcc;

        // Process complete frames (320 samples each)
        while (this.txAcc.length >= SAMPLES_PER_FRAME) {
          // Extract exactly 320 samples
          const frame = this.txAcc.slice(0, SAMPLES_PER_FRAME);
          this.txAcc = this.txAcc.slice(SAMPLES_PER_FRAME);

          // Convert Float32 to Int16
          const pcm16 = new Int16Array(SAMPLES_PER_FRAME);
          for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
            const sample = Math.max(-1, Math.min(1, frame[i]));
            pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          }

          // Send packet via Voice Gateway
          try {
            if (this.voiceGatewayService.isConnected()) {
              this.voiceGatewayService.sendAudioPacket(pcm16);
            }
          } catch (error: any) {
            // Only log if it's not a disconnection error (expected during cleanup)
            if (!error.message?.includes('not connected') && !error.message?.includes('disconnected')) {
              console.error('[Audio Communication] Error sending audio:', error);
            }
          }
        }
      };

      // Connect processor to monitorGain (fixed at 0, never reused for playback)
      // DO NOT connect to audioContext.destination (causes echo)
      this.audioSource.connect(this.audioProcessor);
      this.audioProcessor.connect(monitorGain);
      monitorGain.connect(this.audioContext!.destination);

      this.currentState.isRecording = true;
      this.stateSubject.next({ ...this.currentState });

      console.log('[Audio Communication] Recording started');
    } catch (error: any) {
      console.error('[Audio Communication] Start recording error:', error);
      this.errorSubject.next(error.message || 'Failed to start recording');
      throw error;
    }
  }

  /**
   * Stop recording
   */
  async stopRecording(): Promise<void> {
    try {
      if (!this.currentState.isRecording) {
        return;
      }

      // Disconnect Web Audio API nodes
      if (this.audioProcessor) {
        this.audioProcessor.disconnect();
        this.audioProcessor = null;
      }
      if (this.audioSource) {
        this.audioSource.disconnect();
        this.audioSource = null;
      }

      // SOFT CLEANUP: Only stop tracks on explicit stopRecording (not on mute)
      // For mute, we use track.enabled = false instead
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }
      this.micTrack = null;

      // Clear accumulator
      this.txAcc = new Float32Array(0);

      this.currentState.isRecording = false;
      this.stateSubject.next({ ...this.currentState });

      console.log('[Audio Communication] Recording stopped');
    } catch (error: any) {
      console.error('[Audio Communication] Stop recording error:', error);
      this.errorSubject.next(error.message || 'Failed to stop recording');
    }
  }

  // Note: Remote audio playback is handled by VoiceGatewayService (jitter buffer)

  /**
   * Mute/unmute microphone (SOFT MUTE - never detaches audio pipeline)
   * IMPORTANT: 
   * - Do NOT call track.stop(), stream.getTracks().stop(), processor.disconnect(), ws.close(), cleanup()
   * - Use micTrack.enabled = !micMuted for soft mute
   * - Keep onaudioprocess running (boolean gate prevents ws.send only)
   */
  async toggleMute(): Promise<void> {
    try {
      this.currentState.isMuted = !this.currentState.isMuted;
      this.stateSubject.next({ ...this.currentState });
      
      // SOFT MUTE: Use track.enabled (never stop track)
      if (this.micTrack) {
        this.micTrack.enabled = !this.currentState.isMuted;
      }
      
      // Log mute state
      console.log(`[Audio Communication] Microphone ${this.currentState.isMuted ? 'muted' : 'unmuted'}`);
      console.log(`[Audio Communication] micMuted=${this.currentState.isMuted}, audioCtx.state=${this.audioContext?.state || 'null'}, micTrack.enabled=${this.micTrack?.enabled ?? 'null'}`);
      
      // On unmute, ALWAYS ensure audio context is running
      if (!this.currentState.isMuted && this.audioContext) {
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
          console.log('[Audio Communication] audioCtx.state=', this.audioContext.state);
        } else if (this.audioContext.state === 'closed') {
          console.warn('[Audio Communication] Audio context was closed, cannot resume. This should not happen.');
        }
      }
      
      // Also update Voice Gateway mic mute state (for boolean gate in sendAudioPacket)
      await this.voiceGatewayService.toggleMicMute();
    } catch (error: any) {
      console.error('[Audio Communication] Toggle mute error:', error);
      this.errorSubject.next(error.message || 'Failed to toggle mute');
    }
  }

  /**
   * Set volume
   */
  setVolume(volume: number): void {
    this.currentState.volume = Math.max(0, Math.min(1, volume));
    this.stateSubject.next({ ...this.currentState });
  }

  /**
   * Cleanup and disconnect
   * IMPORTANT: When using Voice Gateway, do NOT close/suspend the gateway's audio context.
   * Only suspend our own recording audio context for non-terminal actions.
   * AudioContext should only be closed on explicit END CALL or page unload.
   */
  async cleanup(endCall: boolean = false): Promise<void> {
    try {
      await this.stopRecording();
      
      // Disconnect from Voice Gateway
      await this.voiceGatewayService.disconnect();
      
      if (this.audioContext) {
        // Only close audio context on explicit END CALL
        // For mute/unmute or temporary cleanup, use suspend() instead
        if (endCall) {
          await this.audioContext.close();
          console.log('[Audio Communication] Audio context closed (end call)');
        } else {
          // Suspend instead of close for non-terminal actions
          if (this.audioContext.state !== 'closed') {
            await this.audioContext.suspend();
            console.log('[Audio Communication] Audio context suspended (not end call)');
          }
        }
        this.audioContext = null;
      }
      
      this.callId = '';
      this.userId = '';
      this.targetUserId = '';
      this.txAcc = new Float32Array(0);
      this.seqCounter = 0;
      
      this.currentState = {
        isRecording: false,
        isPlaying: false,
        isMuted: false,
        volume: 1.0,
        isConnected: false,
      };
      this.stateSubject.next({ ...this.currentState });

      console.log('[Audio Communication] Cleaned up');
    } catch (error) {
      console.error('[Audio Communication] Cleanup error:', error);
    }
  }

  /**
   * Get current state
   */
  getState(): AudioStreamState {
    return { ...this.currentState };
  }
}

