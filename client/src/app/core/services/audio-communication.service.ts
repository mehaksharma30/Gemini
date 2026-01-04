import { Injectable, inject } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { WebPubSubService, AudioMessage } from './web-pubsub.service';
import { AuthService } from './auth.service';

export interface AudioStreamState {
  isRecording: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  isConnected: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class AudioCommunicationService {
  private webPubSubService = inject(WebPubSubService);
  private authService = inject(AuthService);
  
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private audioProcessor: ScriptProcessorNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  
  private remoteAudioContext: AudioContext | null = null;
  private remoteAudioSource: AudioBufferSourceNode | HTMLAudioElement | null = null;
  
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

  private groupId: string = '';

  constructor() {
    // Subscribe to Web PubSub audio messages
    this.webPubSubService.audioMessages$.subscribe((message) => {
      this.handleRemoteAudio(message);
    });

    // Subscribe to control messages
    this.webPubSubService.controlMessages$.subscribe((message) => {
      this.handleControlMessage(message);
    });

    // Subscribe to Web PubSub connection status
    this.webPubSubService.connected$.subscribe(connected => {
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
      // Create group ID (sorted to ensure consistency)
      this.groupId = [userId, targetUserId].sort().join('-');
      console.log('[Audio Communication] Initializing for group:', this.groupId);

      // Connect to Web PubSub
      await this.webPubSubService.connect(targetUserId);
      
      // Wait for connection to be established
      let connected = false;
      const connectionCheck = setInterval(() => {
        if (this.webPubSubService.isConnected()) {
          connected = true;
          clearInterval(connectionCheck);
        }
      }, 100);

      // Wait up to 5 seconds for connection
      let attempts = 0;
      while (!connected && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (!connected) {
        throw new Error('Failed to establish Web PubSub connection');
      }

      // Ensure we're in the group - explicitly join
      const currentUser = this.authService?.currentUser();
      if (currentUser && currentUser.id) {
        // Group should already be joined via token, but explicitly join to ensure
        try {
          // The group is already joined in webPubSubService.connect(), but verify
          console.log('[Audio Communication] Connection established, group:', this.groupId);
          console.log('[Audio Communication] User IDs:', { userId, targetUserId });
          console.log('[Audio Communication] Group ID (sorted):', this.groupId);
        } catch (error) {
          console.error('[Audio Communication] Error verifying group membership:', error);
        }
      }

      // Initialize audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.remoteAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Resume audio context if suspended (required by some browsers)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      if (this.remoteAudioContext.state === 'suspended') {
        await this.remoteAudioContext.resume();
      }

      // Update connection state
      this.currentState.isConnected = true;
      this.stateSubject.next({ ...this.currentState });

      console.log('[Audio Communication] ✅ Initialized successfully for group:', this.groupId);
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

      if (!this.groupId) {
        throw new Error('Not initialized. Call initialize() first.');
      }

      // Wait for connection to be ready
      if (!this.webPubSubService.isConnected()) {
        console.log('[Audio Communication] Waiting for Web PubSub connection...');
        let connected = false;
        for (let i = 0; i < 30; i++) { // Wait up to 3 seconds
          if (this.webPubSubService.isConnected()) {
            connected = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (!connected) {
          throw new Error('Web PubSub not connected. Please try again.');
        }
      }
      
      console.log('[Audio Communication] ✅ Web PubSub connection verified');

      console.log('[Audio Communication] Requesting microphone access...');
      
      // Get user media (microphone)
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      
      console.log('[Audio Communication] Microphone access granted');

      // Use Web Audio API to capture PCM audio for real-time streaming
      const source = this.audioContext!.createMediaStreamSource(this.mediaStream);
      const processor = this.audioContext!.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = async (e) => {
        if (!this.currentState.isRecording || this.currentState.isMuted) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Convert Float32Array to Int16Array (PCM format)
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Clamp and convert to 16-bit PCM
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Send PCM audio data via Web PubSub
        try {
          if (!this.webPubSubService.isConnected()) {
            // Silently skip if not connected (might be during cleanup)
            return;
          }
          await this.webPubSubService.sendAudio(this.groupId, pcmData.buffer);
        } catch (error: any) {
          // Only log if it's not a disconnection error (expected during cleanup)
          if (!error.message?.includes('not connected') && !error.message?.includes('disconnected')) {
            console.error('[Audio Communication] Error sending audio:', error);
          }
          // Don't throw - just return, so recording can continue
        }
      };

      source.connect(processor);
      processor.connect(this.audioContext!.destination);
      
      // Store processor for cleanup
      (this as any).audioProcessor = processor;
      (this as any).audioSource = source;

      this.currentState.isRecording = true;
      this.stateSubject.next({ ...this.currentState });

      // Send control message
      try {
        if (this.webPubSubService.isConnected()) {
          await this.webPubSubService.sendControl(this.groupId, 'start');
        }
      } catch (error: any) {
        console.warn('[Audio Communication] Error sending start control:', error);
      }

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

      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }

      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }

      this.currentState.isRecording = false;
      this.stateSubject.next({ ...this.currentState });

      // Send control message (ignore errors during cleanup)
      try {
        if (this.webPubSubService.isConnected()) {
          await this.webPubSubService.sendControl(this.groupId, 'stop');
        }
      } catch (error: any) {
        // Ignore errors during cleanup
        if (!error.message?.includes('not connected')) {
          console.error('[Audio Communication] Error sending stop control:', error);
        }
      }

      console.log('[Audio Communication] Recording stopped');
    } catch (error: any) {
      console.error('[Audio Communication] Stop recording error:', error);
      this.errorSubject.next(error.message || 'Failed to stop recording');
    }
  }

  private audioQueue: ArrayBuffer[] = [];
  private isProcessingQueue = false;
  private currentSource: AudioBufferSourceNode | null = null;

  /**
   * Handle remote audio data (PCM format)
   */
  private async handleRemoteAudio(message: AudioMessage): Promise<void> {
    try {
      if (!message.data || !this.remoteAudioContext) {
        console.warn('[Audio Communication] Missing data or context', {
          hasData: !!message.data,
          hasContext: !!this.remoteAudioContext,
          dataSize: message.data?.byteLength
        });
        return;
      }

      // Log occasionally to verify audio is being received
      const shouldLog = Math.random() < 0.1; // Log 10% of audio chunks
      if (shouldLog) {
        console.log('[Audio Communication] Received audio chunk:', {
          size: message.data.byteLength,
          senderId: message.senderId,
          queueLength: this.audioQueue.length
        });
      }

      // Add to queue for smooth playback
      this.audioQueue.push(message.data);
      
      // Process queue if not already processing
      if (!this.isProcessingQueue) {
        this.processAudioQueue();
      }
    } catch (error: any) {
      console.error('[Audio Communication] Error handling remote audio:', error);
    }
  }

  /**
   * Process audio queue for smooth continuous playback
   */
  private async processAudioQueue(): Promise<void> {
    if (this.isProcessingQueue || !this.remoteAudioContext) {
      return;
    }

    this.isProcessingQueue = true;
    
    // Log when starting to process
    if (this.audioQueue.length > 0) {
      console.log('[Audio Communication] Processing audio queue, items:', this.audioQueue.length);
    }

    while (this.audioQueue.length > 0) {
      const audioData = this.audioQueue.shift();
      if (!audioData) continue;

      try {
        // Convert Int16Array PCM to Float32Array for Web Audio API
        const pcmData = new Int16Array(audioData);
        const floatData = new Float32Array(pcmData.length);
        
        // Convert 16-bit PCM to float32 (-1.0 to 1.0)
        for (let i = 0; i < pcmData.length; i++) {
          const sample = pcmData[i];
          floatData[i] = sample < 0 ? sample / 0x8000 : sample / 0x7FFF;
        }

        // Create audio buffer (16kHz, mono)
        const sampleRate = 16000;
        const audioBuffer = this.remoteAudioContext.createBuffer(1, floatData.length, sampleRate);
        audioBuffer.copyToChannel(floatData, 0);

        // Calculate start time
        let startTime = 0;
        if (this.currentSource) {
          // Schedule next buffer to start when current ends
          const currentTime = this.remoteAudioContext.currentTime;
          const bufferDuration = audioBuffer.duration;
          startTime = currentTime + bufferDuration;
        }

        // Create source and gain node
        const source = this.remoteAudioContext.createBufferSource();
        const gainNode = this.remoteAudioContext.createGain();
        
        source.buffer = audioBuffer;
        gainNode.gain.value = this.currentState.volume;
        
        source.connect(gainNode);
        gainNode.connect(this.remoteAudioContext.destination);
        
        source.onended = () => {
          this.currentSource = null;
          // Process next item in queue if available
          if (this.audioQueue.length > 0) {
            this.processAudioQueue();
          } else {
            this.currentState.isPlaying = false;
            this.stateSubject.next({ ...this.currentState });
          }
        };

        if (!this.currentSource) {
          this.currentState.isPlaying = true;
          this.stateSubject.next({ ...this.currentState });
          console.log('[Audio Communication] Started playing remote audio');
        }

        source.start(startTime);
        this.currentSource = source;
      } catch (error: any) {
        console.error('[Audio Communication] Error processing audio chunk:', error);
        console.error('[Audio Communication] Error details:', {
          errorMessage: error.message,
          audioDataSize: audioData.byteLength,
          hasContext: !!this.remoteAudioContext,
          contextState: this.remoteAudioContext?.state
        });
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Handle control messages
   */
  private handleControlMessage(message: AudioMessage): void {
    console.log('[Audio Communication] Control message received:', message.action);
    // Handle control actions (mute, unmute, etc.)
  }

  /**
   * Mute/unmute microphone
   */
  async toggleMute(): Promise<void> {
    try {
      if (this.mediaStream) {
        const audioTracks = this.mediaStream.getAudioTracks();
        audioTracks.forEach(track => {
          track.enabled = this.currentState.isMuted;
        });
        
        this.currentState.isMuted = !this.currentState.isMuted;
        this.stateSubject.next({ ...this.currentState });

        // Send control message
        try {
          if (this.webPubSubService.isConnected()) {
            await this.webPubSubService.sendControl(
              this.groupId,
              this.currentState.isMuted ? 'mute' : 'unmute'
            );
          }
        } catch (error: any) {
          console.warn('[Audio Communication] Error sending mute control:', error);
        }
      }
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
      
      // Stop current audio source if playing
      if (this.currentSource) {
        try {
          this.currentSource.stop();
        } catch (error) {
          // Source may have already ended
        }
        this.currentSource = null;
      }
      
      // Clear audio queue
      this.audioQueue = [];
      this.isProcessingQueue = false;

      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = null;
      }

      if (this.remoteAudioContext) {
        await this.remoteAudioContext.close();
        this.remoteAudioContext = null;
      }

      await this.webPubSubService.disconnect();
      
      this.groupId = '';
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

