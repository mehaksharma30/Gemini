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
  private captureStarted: boolean = false; // Track capture state
  
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
  
  // Diagnostic logging interval
  private micStatsLogInterval: any = null;
  private lastPacketsSentCount: number = 0;
  
  // Capture callback instrumentation
  private captureFrameCount: number = 0; // Track frames processed for heartbeat
  private monitorGain: GainNode | null = null; // Store monitorGain for cleanup

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
      // CRITICAL: Sort user IDs to ensure both users generate the SAME callId
      // This is essential for both users to join the same room
      const sortedUserIds = [userId, targetUserId].sort();
      this.callId = sortedUserIds.join('-');
      console.log('[Audio Communication] 🔄 Initializing for group:', this.callId);
      console.log('[Audio Communication] 📊 User IDs: userId=', userId, ', targetUserId=', targetUserId, ', sorted=', sortedUserIds);

      // CRITICAL: Ensure mic is UNMUTED before connecting
      // This prevents "micMuted=true" from blocking audio transmission
      await this.voiceGatewayService.setMicMuted(false);
      console.log('[Audio Communication] 🔧 Mic state set to UNMUTED before connection');

      // Connect to Voice Gateway with comprehensive error handling
      console.log(`[Audio Communication] 🔌 Connecting to Voice Gateway: callId="${this.callId}", userId="${userId}"`);
      try {
        await this.voiceGatewayService.connect(this.callId, userId);
        console.log(`[Audio Communication] ✅ Connect() call completed`);
      } catch (connectError: any) {
        console.error(`[Audio Communication] ❌ Connect() failed:`, connectError);
        throw new Error(`Voice Gateway connection failed: ${connectError.message || connectError}`);
      }
      
      // Wait for connection to be established with better error reporting
      let connected = false;
      let lastError: string = '';
      for (let i = 0; i < 50; i++) { // Wait up to 5 seconds
        if (this.voiceGatewayService.isConnected()) {
          connected = true;
          console.log(`[Audio Communication] ✅ Voice Gateway connected after ${i * 100}ms`);
          break;
        }
        // Check for connection errors
        const ws = (this.voiceGatewayService as any).ws;
        if (ws) {
          const readyState = ws.readyState;
          if (readyState === WebSocket.CLOSED || readyState === WebSocket.CLOSING) {
            lastError = `WebSocket closed (readyState=${readyState})`;
            console.error(`[Audio Communication] ⚠️ WebSocket state: ${readyState} (CLOSED=3, CLOSING=2)`);
          } else if (readyState === WebSocket.CONNECTING) {
            // Still connecting, wait a bit more
            if (i % 10 === 0) {
              console.log(`[Audio Communication] ⏳ Still connecting... (attempt ${i + 1}/50)`);
            }
          }
        } else {
          if (i % 10 === 0) {
            console.warn(`[Audio Communication] ⚠️ WebSocket not created yet (attempt ${i + 1}/50)`);
          }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (!connected) {
        const errorMsg = lastError || 'Connection timeout after 5 seconds';
        console.error(`[Audio Communication] ❌ Connection failed: ${errorMsg}`);
        console.error(`[Audio Communication] ❌ CallId: "${this.callId}", UserId: "${userId}"`);
        const gatewayUrl = (this.voiceGatewayService as any).GATEWAY_URL || 'unknown';
        console.error(`[Audio Communication] ❌ Voice Gateway URL: ${gatewayUrl}`);
        throw new Error(`Failed to establish Voice Gateway connection: ${errorMsg}. Check console for details.`);
      }
      
      // CRITICAL: Verify we're in the right room by waiting for room_status message
      console.log('[Audio Communication] ⏳ Waiting for room status confirmation...');
      await new Promise(resolve => setTimeout(resolve, 500)); // Give server time to send room_status

      // CRITICAL: Create new audio context if null or closed (don't reuse closed context)
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        console.log(`[Audio Communication] Audio context created: ${this.audioContext.sampleRate}Hz, state: ${this.audioContext.state}`);
      }

      // Resume if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Reset accumulator
      this.txAcc = new Float32Array(0);
      this.seqCounter = 0;
      this.captureStarted = false; // Reset capture state

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
   * Start recording and sending audio - IDEMPOTENT
   * Guarantees capture pipeline is wired correctly
   */
  async startRecording(): Promise<void> {
    try {
      if (this.currentState.isRecording && this.captureStarted) {
        console.log('[Audio Communication] Already recording and capture started');
        return;
      }

      if (!this.callId) {
        throw new Error('Not initialized. Call initialize() first.');
      }

      // Wait for connection
      if (!this.voiceGatewayService.isConnected()) {
        console.log('[Audio Communication] Waiting for Voice Gateway connection...');
        let connected = false;
        for (let i = 0; i < 30; i++) {
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

      // CRITICAL: Ensure audio context is ready
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        console.log(`[Audio Communication] Audio context recreated: ${this.audioContext.sampleRate}Hz`);
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // CRITICAL: Clean up any existing capture pipeline before starting new one
      if (this.audioProcessor) {
        this.audioProcessor.disconnect();
        this.audioProcessor.onaudioprocess = null;
        this.audioProcessor = null;
      }
      if (this.audioSource) {
        this.audioSource.disconnect();
        this.audioSource = null;
      }
      if (this.monitorGain) {
        this.monitorGain.disconnect();
        this.monitorGain = null;
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }
      this.micTrack = null;
      this.captureStarted = false;
      this.captureFrameCount = 0;

      console.log('[Audio Communication] Requesting microphone access...');
      
      // Get user media
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

      // Store mic track
      this.micTrack = this.mediaStream.getAudioTracks()[0] || null;
      if (!this.micTrack) {
        throw new Error('No audio track found in media stream');
      }
      
      console.log(`[Audio Communication] 🎤 Mic track: enabled=${this.micTrack.enabled}, readyState=${this.micTrack.readyState}, label=${this.micTrack.label}`);
      
      // CRITICAL: Wire capture pipeline - idempotent startCaptureAndSend()
      this.startCaptureAndSend();

      this.currentState.isRecording = true;
      this.captureStarted = true;
      this.stateSubject.next({ ...this.currentState });

      // Start diagnostic logging
      this.startMicStatsLogging();

      console.log('[Audio Communication] ✅ Recording started, capture pipeline active');
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
        this.audioProcessor.onaudioprocess = null;
        this.audioProcessor = null;
      }
      if (this.audioSource) {
        this.audioSource.disconnect();
        this.audioSource = null;
      }
      if (this.monitorGain) {
        this.monitorGain.disconnect();
        this.monitorGain = null;
      }

      // Stop tracks
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }
      this.micTrack = null;
      this.captureStarted = false; // Reset capture state
      this.captureFrameCount = 0; // Reset frame counter

      // Clear accumulator
      this.txAcc = new Float32Array(0);

      // Stop diagnostic logging
      this.stopMicStatsLogging();

      this.currentState.isRecording = false;
      this.stateSubject.next({ ...this.currentState });

      console.log('[Audio Communication] Recording stopped, capture pipeline cleared');
    } catch (error: any) {
      console.error('[Audio Communication] Stop recording error:', error);
      this.errorSubject.next(error.message || 'Failed to stop recording');
    }
  }

  /**
   * IDEMPOTENT: Wire getUserMedia -> processor -> sendAudioPacket
   * Guaranteed to be called right after mic access is granted
   * CRITICAL: ScriptProcessorNode MUST be connected to an output (destination) or onaudioprocess never fires
   */
  private startCaptureAndSend(): void {
    if (!this.mediaStream || !this.audioContext || this.audioContext.state === 'closed') {
      console.error('[Audio Communication] Cannot start capture: missing stream or invalid context');
      return;
    }

    // CRITICAL: Ensure captureStarted is false before starting
    if (this.captureStarted) {
      console.warn('[Audio Communication] ⚠️ Capture already started, cleaning up first');
      // Clean up existing nodes
      if (this.audioProcessor) {
        this.audioProcessor.disconnect();
        this.audioProcessor.onaudioprocess = null;
        this.audioProcessor = null;
      }
      if (this.audioSource) {
        this.audioSource.disconnect();
        this.audioSource = null;
      }
      if (this.monitorGain) {
        this.monitorGain.disconnect();
        this.monitorGain = null;
      }
      this.captureStarted = false;
    }

    // Create audio source and processor
    this.audioSource = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
    
    const inputSampleRate = this.audioContext.sampleRate;
    console.log(`[Audio Communication] Capture pipeline: sampleRate=${inputSampleRate}Hz, target=${SAMPLE_RATE}Hz`);
    console.log(`[Audio Communication] AudioContext state: ${this.audioContext.state}`);
    
    // CRITICAL: Create monitorGain and connect to destination (gain=0 prevents echo but keeps graph alive)
    // ScriptProcessorNode MUST have an output connection or onaudioprocess never fires
    this.monitorGain = this.audioContext.createGain();
    this.monitorGain.gain.value = 0; // Silent output (prevents echo)
    this.monitorGain.connect(this.audioContext.destination); // CRITICAL: Connect to destination to keep graph alive
    
    // Reset frame counter
    this.captureFrameCount = 0;
    
    // CRITICAL: Wire onaudioprocess handler - this is where packets are sent
    this.audioProcessor.onaudioprocess = (e) => {
      // INSTRUMENTATION: Heartbeat every 50 frames
      this.captureFrameCount++;
      if (this.captureFrameCount % 50 === 0) {
        console.log(`[CAPTURE] frames=${this.captureFrameCount}, audioCtx.state=${this.audioContext?.state || 'null'}, micTrack.enabled=${this.micTrack?.enabled ?? 'null'}, isMuted=${this.currentState.isMuted}`);
      }
      
      if (!this.voiceGatewayService.isConnected()) {
        if (this.captureFrameCount % 50 === 0) {
          console.warn(`[CAPTURE] Voice Gateway not connected, skipping frame ${this.captureFrameCount}`);
        }
        return;
      }
      
      // Soft mute gate
      if (this.currentState.isMuted) {
        if (this.captureFrameCount % 50 === 0) {
          console.log(`[CAPTURE] Muted, skipping frame ${this.captureFrameCount}`);
        }
        return;
      }

      const inputData = e.inputBuffer.getChannelData(0);
      
      let processedData: Float32Array;
      if (inputSampleRate !== SAMPLE_RATE) {
        const inputCopy = new Float32Array(inputData.length);
        inputCopy.set(inputData);
        processedData = downsampleTo16k(inputCopy, inputSampleRate);
      } else {
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
        const frame = this.txAcc.slice(0, SAMPLES_PER_FRAME);
        this.txAcc = this.txAcc.slice(SAMPLES_PER_FRAME);

        // Convert Float32 to Int16
        const pcm16 = new Int16Array(SAMPLES_PER_FRAME);
        for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
          const sample = Math.max(-1, Math.min(1, frame[i]));
          pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }

        // CRITICAL: Send packet - this increments packetsSentCount
        try {
          if (this.voiceGatewayService.isConnected()) {
            this.voiceGatewayService.sendAudioPacket(pcm16);
          }
        } catch (error: any) {
          if (!error.message?.includes('not connected') && !error.message?.includes('disconnected')) {
            console.error('[Audio Communication] Error sending audio:', error);
          }
        }
      }
    };

    // CRITICAL: Connect pipeline - processor -> monitorGain -> destination
    // This ensures onaudioprocess fires (ScriptProcessorNode needs output connection)
    this.audioSource.connect(this.audioProcessor);
    this.audioProcessor.connect(this.monitorGain);
    // monitorGain already connected to destination above (gain=0 prevents echo)
    
    console.log('[Audio Communication] ✅ Capture pipeline wired: source -> processor -> monitorGain(gain=0) -> destination');
    console.log('[Audio Communication] ✅ onaudioprocess handler attached, capture will start on next audio frame');
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
      
      // DIAGNOSTIC: Log mute state with comprehensive details
      console.log(`[Audio Communication] 🎤🎤🎤 Microphone ${this.currentState.isMuted ? 'MUTED' : 'UNMUTED'} 🎤🎤🎤`);
      console.log(`[Audio Communication] 📊 Mute state AFTER toggle: micMuted=${this.currentState.isMuted}, audioCtx.state=${this.audioContext?.state || 'null'}, micTrack.enabled=${this.micTrack?.enabled ?? 'null'}, micTrack.readyState=${this.micTrack?.readyState || 'null'}, micTrack.muted=${this.micTrack?.muted ?? 'null'}`);
      
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
      // CRITICAL: Use setMicMuted() instead of toggleMicMute() to avoid double-toggle
      await this.voiceGatewayService.setMicMuted(this.currentState.isMuted);
      
      // CRITICAL: Verify the state was actually set
      const gatewayMuteState = this.voiceGatewayService.getMicMutedState();
      console.log(`[Audio Communication] 📊 Verification: local isMuted=${this.currentState.isMuted}, gateway isMicMuted=${gatewayMuteState}, match=${this.currentState.isMuted === gatewayMuteState}`);
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
      
      await this.voiceGatewayService.disconnect();
      
      // CRITICAL: On end-call, set audioContext to null (don't close it)
      // On next init, a fresh context will be created cleanly
      if (endCall) {
        console.log('[Audio Communication] End call: setting audioContext to null (will create fresh on next init)');
        this.audioContext = null;
      } else {
        // For non-end-call cleanup, keep context but suspend if needed
        if (this.audioContext && this.audioContext.state !== 'closed') {
          await this.audioContext.suspend();
          console.log('[Audio Communication] Audio context suspended (not end call)');
        }
      }
      
      this.stopMicStatsLogging();
      
      this.callId = '';
      this.userId = '';
      this.targetUserId = '';
      this.txAcc = new Float32Array(0);
      this.seqCounter = 0;
      this.captureStarted = false;
      this.captureFrameCount = 0;
      
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
  
  /**
   * Start diagnostic logging for mic state (once per second)
   */
  private startMicStatsLogging(): void {
    // Clear any existing interval
    if (this.micStatsLogInterval) {
      clearInterval(this.micStatsLogInterval);
      this.micStatsLogInterval = null;
    }
    
    // Initialize last count (read before any reset happens)
    this.lastPacketsSentCount = this.voiceGatewayService.getPacketsSentCount();
    
    // Start logging interval (once per second)
    // Note: This runs independently from VoiceGatewayService.logStats(), so we track the difference ourselves
    // The packetsSentCount in VoiceGatewayService is reset in getCurrentStats() (called in logStats()),
    // so we need to read it and calculate the difference before it gets reset
    this.micStatsLogInterval = setInterval(() => {
      // Read current count (this may be reset by VoiceGatewayService.logStats() if it runs first)
      const currentPacketsSent = this.voiceGatewayService.getPacketsSentCount();
      
      // Calculate packets sent in the last second
      // If currentPacketsSent < lastPacketsSentCount, it means the counter was reset, so use currentPacketsSent
      const packetsSentPerSec = currentPacketsSent < this.lastPacketsSentCount 
        ? currentPacketsSent 
        : currentPacketsSent - this.lastPacketsSentCount;
      
      this.lastPacketsSentCount = currentPacketsSent;
      
      // Log: micTrack.enabled, isMuted, voiceGateway.isMicMuted, packetsSent/sec
      console.log(`[Audio Communication] 🎤 Mic Stats: micTrack.enabled=${this.micTrack?.enabled ?? 'null'}, isMuted=${this.currentState.isMuted}, voiceGateway.isMicMuted=${this.voiceGatewayService.getMicMutedState()}, packetsSent/sec=${packetsSentPerSec}`);
    }, 1000);
  }
  
  /**
   * Stop diagnostic logging for mic state
   */
  private stopMicStatsLogging(): void {
    if (this.micStatsLogInterval) {
      clearInterval(this.micStatsLogInterval);
      this.micStatsLogInterval = null;
    }
    this.lastPacketsSentCount = 0;
  }
}

