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
export class AudioCommunicationService {
  private voiceGatewayService = inject(VoiceGatewayService);
  private authService = inject(AuthService);
  
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  
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
        // Stop recording if disconnected
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

      // Use Web Audio API to capture PCM audio for real-time streaming
      this.audioSource = this.audioContext!.createMediaStreamSource(this.mediaStream);
      this.audioProcessor = this.audioContext!.createScriptProcessor(4096, 1, 1);
      
      const inputSampleRate = this.audioContext!.sampleRate;
      
      this.audioProcessor.onaudioprocess = (e) => {
        // Only block if mic is muted or WebSocket is not open
        if (this.currentState.isMuted || !this.voiceGatewayService.isConnected()) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Downsample if needed
        let processedData = inputData;
        if (inputSampleRate !== SAMPLE_RATE) {
          processedData = downsampleTo16k(inputData, inputSampleRate);
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

      // Connect processor to zero-gain node to prevent feedback/echo
      // DO NOT connect to audioContext.destination (causes echo)
      const zeroGain = this.audioContext!.createGain();
      zeroGain.gain.value = 0; // Silent output
      this.audioSource.connect(this.audioProcessor);
      this.audioProcessor.connect(zeroGain);
      zeroGain.connect(this.audioContext!.destination);

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

      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }

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
   * Mute/unmute microphone
   */
  async toggleMute(): Promise<void> {
    try {
      this.currentState.isMuted = !this.currentState.isMuted;
      this.stateSubject.next({ ...this.currentState });
      console.log(`[Audio Communication] Microphone ${this.currentState.isMuted ? 'muted' : 'unmuted'}`);
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
   */
  async cleanup(): Promise<void> {
    try {
      await this.stopRecording();
      
      // Disconnect from Voice Gateway
      await this.voiceGatewayService.disconnect();
      
      if (this.audioContext) {
        await this.audioContext.close();
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

