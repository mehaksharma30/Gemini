import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// Voice Gateway Constants
const SAMPLE_RATE = 16000;
const SAMPLES_PER_FRAME = 320; // 20ms at 16kHz
const FRAME_DURATION_MS = 20;
const PAYLOAD_SIZE = 640; // SAMPLES_PER_FRAME * 2 (Int16 = 2 bytes)
const PACKET_SIZE_OLD = 12 + PAYLOAD_SIZE; // Old format: header (12) + payload (640) = 652 bytes
const PACKET_SIZE = 12 + 24 + PAYLOAD_SIZE; // New format: seq (4) + timestamp (8) + senderId (24) + payload (640) = 676 bytes
const SENDER_ID_SIZE = 24; // Fixed 24 bytes for senderId

// Jitter buffer settings - Optimized for smooth WhatsApp-like calls
// Reduced buffer sizes for lower latency while maintaining smooth playback
const MIN_BUFFER_PACKETS = 10; // ~200ms buffer before starting playback (reduced from 25 for lower latency)
const MAX_BUFFER_PACKETS = 30; // ~600ms max buffer (reduced from 50)
const LOW_BUFFER_THRESHOLD = 5; // Pause scheduling if buffer drops below this (reduced from 12 for faster recovery)

// Voice Gateway WebSocket URL (from environment)
const GATEWAY_URL = environment.voiceGatewayUrl;

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
  
  // Reconnection state
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 20; // Increased from 10 to 20 for better reliability
  private reconnectDelay: number = 1000; // Start with 1 second
  private reconnectTimeout: any = null;
  private isReconnecting: boolean = false;
  private shouldReconnect: boolean = true;
  
  // Connection health monitoring
  private lastMessageTime: number = 0;
  private healthCheckInterval: any = null;
  
  // Audio context for playback
  private audioContext: AudioContext | null = null;
  private playbackGain: GainNode | null = null; // Dedicated gain node for remote audio playback (speaker mute/unmute)
  
  // Mute states
  // CRITICAL: Default to UNMUTED to ensure audio is sent by default
  private isMicMuted: boolean = false;
  private isSpeakerMuted: boolean = false;
  
  // Jitter buffer for playback
  private jitterBuffer: Map<number, { timestamp: number; payload: ArrayBuffer }> = new Map();
  private nextPlaybackSeq: number | null = null;
  private isPlaying: boolean = false; // True when playback has started
  private isSchedulingPaused: boolean = false; // True when scheduling is paused due to low buffer (but playback state intact)
  private nextPlayTime: number | null = null;
  private scheduledSources: Set<AudioBufferSourceNode> = new Set();
  private playbackSchedulerInterval: any = null;
  
  // Stats for logging (once per second)
  private packetsRecvCount: number = 0;
  private packetsSentCount: number = 0;
  private packetsPlayedCount: number = 0;
  private lastLogTime: number = 0;
  private statsLogInterval: any = null;
  
  // Singleton connection guard
  private activeCallId: string | null = null;
  private activeUserId: string | null = null;
  private onmessageHandlerAttached: boolean = false;
  private currentWs: WebSocket | null = null; // Track current WS to prevent duplicate handlers
  private scheduleAnimationFrame: number | null = null; // Track RAF for cleanup

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
   * CRITICAL: Clean up WebSocket connection completely
   * This prevents duplicate connections and handlers
   */
  private cleanupWs(): void {
    console.log('[Voice Gateway] 🧹 Cleaning up WebSocket connection...');
    
    // Remove all handlers first
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
      } catch (e) {
        // Ignore errors when removing handlers
      }
      
      // Close connection if still open
      if (this.ws.readyState !== WebSocket.CLOSED && this.ws.readyState !== WebSocket.CLOSING) {
        try {
          this.ws.close(1000, 'Cleanup');
        } catch (e) {
          // Ignore close errors
        }
      }
      
      this.ws = null;
    }
    
    // Reset handler tracking
    this.onmessageHandlerAttached = false;
    this.currentWs = null;
    this.activeCallId = null;
    this.activeUserId = null;
  }

  /**
   * Connect to Voice Gateway WebSocket
   * @param callId - Call ID (room identifier)
   * @param userId - User ID
   */
  async connect(callId: string, userId: string): Promise<void> {
    // CRITICAL: Clean up any existing connection FIRST to prevent duplicates
    this.cleanupWs();
    
    // CRITICAL: Singleton connection guard - ensure only ONE WebSocket per callId
    // If already connected to the same call, return early
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.activeCallId === callId && this.activeUserId === userId) {
      console.log(`[Voice Gateway] ⚠️ Already connected to call ${callId} as ${userId}, skipping duplicate connection`);
      console.log(`[Voice Gateway] Active connection: callId=${this.activeCallId}, userId=${this.activeUserId}, readyState=${this.ws.readyState}`);
      return;
    }

    // Clean up intervals and animation frames to prevent duplicates
    if (this.playbackSchedulerInterval) {
      clearInterval(this.playbackSchedulerInterval);
      this.playbackSchedulerInterval = null;
    }
    if (this.scheduleAnimationFrame) {
      cancelAnimationFrame(this.scheduleAnimationFrame);
      this.scheduleAnimationFrame = null;
    }
    if (this.statsLogInterval) {
      clearInterval(this.statsLogInterval);
      this.statsLogInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Cancel any pending reconnection
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.callId = callId;
    this.userId = userId;
    this.activeCallId = callId;
    this.activeUserId = userId;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    
    // Reset packet counters
    this.packetsSentCount = 0;
    this.packetsRecvCount = 0;
    this.packetsPlayedCount = 0;
    
    // CRITICAL: Ensure mic is UNMUTED by default when connecting
    // This prevents "micMuted=true" from blocking audio transmission
    this.isMicMuted = false;
    console.log(`[Voice Gateway] 🔧 Mic state reset to UNMUTED on connect (callId: ${callId}, userId: ${userId})`);

    return this.attemptConnection();
  }

  /**
   * Attempt WebSocket connection with retry logic
   */
  private attemptConnection(): Promise<void> {
    return new Promise((resolve, reject) => {

      try {
        // Build WebSocket URL
        const baseUrl = GATEWAY_URL;
        // CRITICAL: Normalize callId (trim whitespace) to prevent mismatches
        const normalizedCallId = this.callId.trim();
        const normalizedUserId = this.userId.trim();
        // CRITICAL: Use encodeURIComponent to handle special characters in callId/userId
        const encodedCallId = encodeURIComponent(normalizedCallId);
        const encodedUserId = encodeURIComponent(normalizedUserId);
        const url = `${baseUrl}/?callId=${encodedCallId}&userId=${encodedUserId}`;
        
        console.log(`[Voice Gateway] 🔌 Connecting to: ${url}`);
        console.log(`[Voice Gateway] 📊 Connection params: callId="${normalizedCallId}" (length=${normalizedCallId.length}, encoded length=${encodedCallId.length}), userId="${normalizedUserId}" (length=${normalizedUserId.length}, encoded length=${encodedUserId.length})`);
        console.log(`[Voice Gateway] 🔍 Full URL breakdown: baseUrl="${baseUrl}", callId="${normalizedCallId}", userId="${normalizedUserId}"`);
        
        // CRITICAL: Verify callId and userId are not empty
        if (!normalizedCallId || normalizedCallId.length === 0) {
          console.error('[Voice Gateway] ❌ ERROR: callId is empty!');
          reject(new Error('callId is empty'));
          return;
        }
        if (!normalizedUserId || normalizedUserId.length === 0) {
          console.error('[Voice Gateway] ❌ ERROR: userId is empty!');
          reject(new Error('userId is empty'));
          return;
        }
        console.log(`[Voice Gateway] Attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts}`);
        
        // CRITICAL: Clear any existing WS and reset handler flag BEFORE creating new one
        if (this.ws) {
          this.ws.onopen = null;
          this.ws.onmessage = null;
          this.ws.onerror = null;
          this.ws.onclose = null;
          if (this.ws.readyState !== WebSocket.CLOSED && this.ws.readyState !== WebSocket.CLOSING) {
            this.ws.close();
          }
          this.ws = null;
        }
        this.onmessageHandlerAttached = false;
        this.currentWs = null;
        
        // Create new WebSocket connection
        console.log(`[Voice Gateway] 🔌 Creating new WebSocket connection: ${url}`);
        this.ws = new WebSocket(url);
        
        // CRITICAL: Set binaryType to 'arraybuffer' to avoid Blob overhead and simplify handling
        this.ws.binaryType = 'arraybuffer';
        
        this.currentWs = this.ws; // Track current WS
        
        // INSTRUMENTATION: Log WebSocket readyState at creation
        console.log(`[Voice Gateway] WebSocket created, readyState=${this.ws.readyState} (CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3)`);
        
        const connectionStartTime = Date.now();

        // CRITICAL: Use direct assignment (ws.onopen = handler), NOT addEventListener
        this.ws.onopen = () => {
          const connectionTime = Date.now() - connectionStartTime;
          // INSTRUMENTATION: Log WebSocket readyState at connect
          console.log(`[Voice Gateway] ✅ Connected successfully (${connectionTime}ms), readyState=${this.ws?.readyState} (OPEN=1)`);
          
          // Reset reconnection state
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          this.isReconnecting = false;
          
          this.connectedSubject.next(true);
          
          // Initialize audio context for playback
          // CRITICAL: Do NOT close existing context, only create if null or closed
          if (!this.audioContext || this.audioContext.state === 'closed') {
            if (this.audioContext && this.audioContext.state === 'closed') {
              console.warn('[Voice Gateway] Audio context was closed, creating new one');
            }
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            
            console.log(`[Voice Gateway] Audio context created: ${this.audioContext.sampleRate}Hz, state: ${this.audioContext.state}`);
            
            if (this.audioContext.state === 'suspended') {
              this.audioContext.resume().then(() => {
                console.log('[Voice Gateway] Audio context resumed, state:', this.audioContext!.state);
              }).catch(err => {
                console.error('[Voice Gateway] Failed to resume audio context:', err);
              });
            }
            
            this.playbackGain = this.audioContext.createGain();
            this.playbackGain.gain.value = 1.0;
            this.playbackGain.connect(this.audioContext.destination);
          }
          
          // Start stats logging interval
          if (this.statsLogInterval) {
            clearInterval(this.statsLogInterval);
            this.statsLogInterval = null;
          }
          this.lastLogTime = Date.now();
          this.statsLogInterval = setInterval(() => {
            this.logStats();
          }, 1000);
          
          // Start connection health monitoring
          this.lastMessageTime = Date.now();
          if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
          }
          this.healthCheckInterval = setInterval(() => {
            this.checkConnectionHealth();
          }, 5000); // Check every 5 seconds
          
          resolve();
        };

        // CRITICAL: Attach onmessage handler ONLY if not already attached to THIS WebSocket
        if (this.onmessageHandlerAttached && this.currentWs === this.ws) {
          console.error('[Voice Gateway] ❌ ERROR: onmessage handler already attached to current WebSocket!');
          reject(new Error('Handler already attached'));
          return;
        }
        
        // Reset flag when attaching to new WS
        if (this.currentWs !== this.ws) {
          this.onmessageHandlerAttached = false;
        }
        
        console.log(`[Voice Gateway] 📨 Attaching onmessage handler to WebSocket (readyState=${this.ws.readyState})`);
        this.onmessageHandlerAttached = true;
        
        // CRITICAL: Attach handler first, then verify
        this.ws.onmessage = async (event) => {
          // CRITICAL: Update last message time for health monitoring
          this.lastMessageTime = Date.now();
          
          // CRITICAL: Log EVERY message received to diagnose why recv/sec=0
          // INSTRUMENTATION: Log WebSocket state when message arrives
          const wsState = this.ws?.readyState ?? 'null';
          const currentWsState = this.currentWs?.readyState ?? 'null';
          const wsMatch = this.ws === this.currentWs;
          
          // INSTRUMENTATION: Determine event.data type BEFORE logging
          const dataConstructor = event.data?.constructor?.name || 'unknown';
          const dataType = event.data instanceof ArrayBuffer ? 'ArrayBuffer' :
                          event.data instanceof Blob ? 'Blob' :
                          typeof event.data === 'string' ? 'string' :
                          typeof event.data;
          
          // CRITICAL: Only log first few messages and occasionally to avoid spam
          // This prevents the duplicate onmessage spam you were seeing
          const shouldLog = this.packetsRecvCount < 5 || this.packetsRecvCount % 100 === 0;
          
          if (shouldLog && (dataType === 'Blob' || dataType === 'ArrayBuffer' || (event.data && typeof event.data !== 'string'))) {
            const size = event.data instanceof Blob ? event.data.size : 
                        event.data instanceof ArrayBuffer ? event.data.byteLength :
                        (event.data as any)?.byteLength || (event.data as any)?.length || 'unknown';
            console.log(`[Voice Gateway] 📨 Binary packet #${this.packetsRecvCount + 1}, size=${size}, type=${dataType}`);
          }
          
          // CRITICAL: Verify this is still the current WS (prevent stale handler)
          // BUT: Only block if ws is null and currentWs exists (definite stale handler)
          if (!this.ws && this.currentWs) {
            console.warn('[Voice Gateway] ⚠️ Received message on stale WebSocket (ws=null but currentWs exists), ignoring');
            return;
          }
          
          // If ws exists but doesn't match currentWs, log but still process (might be race condition)
          if (this.ws && this.currentWs && this.ws !== this.currentWs) {
            console.warn(`[Voice Gateway] ⚠️ WebSocket mismatch detected: ws.readyState=${this.ws.readyState}, currentWs.readyState=${this.currentWs.readyState}`);
            // Still process the message - don't block on mismatch
          }
          
          if (typeof event.data === 'string') {
            // Text message (connection confirmation or room status) - log and handle
            console.log(`[Voice Gateway] RX: string message, constructor=${dataConstructor}, length=${event.data.length}`);
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'connected') {
                console.log(`[Voice Gateway] ✅ Connected to call: ${msg.callId} as ${msg.userId}`);
                console.log(`[Voice Gateway] 📊 Connection verified: callId=${msg.callId}, userId=${msg.userId}, localCallId=${this.callId}, localUserId=${this.userId}`);
                // CRITICAL: Verify callId matches
                if (msg.callId !== this.callId) {
                  console.error(`[Voice Gateway] ⚠️ WARNING: Server callId (${msg.callId}) doesn't match local callId (${this.callId})!`);
                }
                if (msg.userId !== this.userId) {
                  console.error(`[Voice Gateway] ⚠️ WARNING: Server userId (${msg.userId}) doesn't match local userId (${this.userId})!`);
                }
              } else if (msg.type === 'room_status') {
                console.log(`[Voice Gateway] 📊 Room status: callId=${msg.callId}, roomSize=${msg.roomSize}, participants: [${msg.participants?.join(', ') || 'none'}], ready=${msg.ready || false}`);
                // CRITICAL: Verify we're in the right room
                if (msg.roomSize < 2) {
                  console.warn(`[Voice Gateway] ⚠️ WARNING: Room has only ${msg.roomSize} participant(s) - waiting for second user to join...`);
                  console.warn(`[Voice Gateway] ⚠️ Expected callId format: <userId1>-<userId2> (sorted user IDs)`);
                  console.warn(`[Voice Gateway] ⚠️ Current callId: "${msg.callId}", Local callId: "${this.callId}"`);
                } else {
                  console.log(`[Voice Gateway] ✅✅✅ Room has ${msg.roomSize} participants - ready for audio relay!`);
                  if (msg.ready) {
                    console.log(`[Voice Gateway] 🎉 Call is ready - both users connected!`);
                  }
                }
              } else {
                console.log('[Voice Gateway] Received text message:', msg);
              }
            } catch (e) {
              console.log('[Voice Gateway] Received text message (not JSON):', event.data);
            }
            return;
          }
          
          // Handle binary data (audio packets)
          // CRITICAL: Since we set binaryType='arraybuffer', event.data should always be ArrayBuffer
          let arrayBuffer: ArrayBuffer | null = null;
          let byteLength: number = 0;
          
          try {
            if (event.data instanceof ArrayBuffer) {
              // This is the expected case (binaryType='arraybuffer')
              arrayBuffer = event.data;
              byteLength = arrayBuffer.byteLength;
              // Only log first few packets to avoid spam
              if (this.packetsRecvCount === 0) {
                console.log(`[Voice Gateway] RX: ArrayBuffer received (binaryType='arraybuffer'), byteLength=${byteLength}`);
              }
            } else if (event.data instanceof Blob) {
              // Fallback: Convert Blob to ArrayBuffer (shouldn't happen with binaryType='arraybuffer')
              console.warn(`[Voice Gateway] ⚠️ Received Blob instead of ArrayBuffer (binaryType may not be set correctly)`);
              const blobSize = event.data.size;
              arrayBuffer = await event.data.arrayBuffer();
              if (arrayBuffer) {
                byteLength = arrayBuffer.byteLength;
                console.log(`[Voice Gateway] RX: Converted Blob to ArrayBuffer, Blob.size=${blobSize}, ArrayBuffer.byteLength=${byteLength}`);
              }
            } else if (event.data && typeof event.data === 'object') {
              // Node.js ws library sends Buffer or Uint8Array
              const data = event.data as any;
              
              // Helper function to convert SharedArrayBuffer to ArrayBuffer
              const toArrayBuffer = (buf: ArrayBuffer | SharedArrayBuffer): ArrayBuffer => {
                if (buf instanceof SharedArrayBuffer) {
                  // Copy SharedArrayBuffer to ArrayBuffer
                  const uint8 = new Uint8Array(buf);
                  const newBuf = new ArrayBuffer(uint8.length);
                  new Uint8Array(newBuf).set(uint8);
                  return newBuf;
                }
                return buf;
              };
              
              // Check if it has a buffer property (Uint8Array, Buffer, etc.)
              if (data.buffer && (data.buffer instanceof ArrayBuffer || data.buffer instanceof SharedArrayBuffer)) {
                // Use the underlying ArrayBuffer (convert SharedArrayBuffer if needed)
                const byteOffset = data.byteOffset || 0;
                const dataByteLength = data.byteLength || data.length;
                const underlyingBuffer = toArrayBuffer(data.buffer);
                arrayBuffer = underlyingBuffer.slice(byteOffset, byteOffset + dataByteLength);
                if (arrayBuffer) {
                  byteLength = arrayBuffer.byteLength;
                }
              } else if (data instanceof Uint8Array) {
                // Create new ArrayBuffer from Uint8Array (handle SharedArrayBuffer)
                const underlyingBuffer = toArrayBuffer(data.buffer);
                arrayBuffer = underlyingBuffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                if (arrayBuffer) {
                  byteLength = arrayBuffer.byteLength;
                }
              } else if (typeof data.length === 'number') {
                // Try to convert Buffer-like object
                const uint8 = new Uint8Array(data.length);
                for (let i = 0; i < data.length; i++) {
                  uint8[i] = data[i];
                }
                arrayBuffer = uint8.buffer;
                if (arrayBuffer) {
                  byteLength = arrayBuffer.byteLength;
                }
              } else {
                console.warn(`[Voice Gateway] RX: Unknown binary data type, constructor=${data?.constructor?.name}, keys:`, Object.keys(data || {}));
                return;
              }
            } else {
              console.warn(`[Voice Gateway] RX: Received non-binary, non-string data, type=${typeof event.data}, constructor=${event.data?.constructor?.name}`);
              return;
            }
            
            if (arrayBuffer && byteLength > 0) {
              // CRITICAL: Check if this is the test binary packet (seq=999999)
              const testSeq = new DataView(arrayBuffer).getUint32(0, true);
              if (testSeq === 999999) {
                console.log(`[Voice Gateway] ✅✅✅ TEST BINARY PACKET RECEIVED! This proves binary transmission works! byteLength=${byteLength}`);
                // Don't process test packet, just acknowledge receipt
                return;
              }
              
              // INSTRUMENTATION: Increment packetsRecvCount for ANY binary data (even before parsing)
              // This ensures recv/sec reflects reality of what arrives at client
              this.packetsRecvCount++;
              
              // INSTRUMENTATION: Log byteLength of incoming binary
              if (this.packetsRecvCount <= 10) {
                console.log(`[Voice Gateway] RX: packet #${this.packetsRecvCount}, byteLength=${byteLength}, constructor=${dataConstructor}, type=${dataType}`);
              }
              
              // Check if binary payload matches expected size
              const isOldFormat = byteLength === PACKET_SIZE_OLD; // 652 bytes
              const isNewFormat = byteLength === PACKET_SIZE; // 676 bytes
              
              if (!isOldFormat && !isNewFormat) {
                // Log unexpected size (but still count it in packetsRecvCount)
                if (this.packetsRecvCount <= 10) {
                  console.warn(`[Voice Gateway] RX: Unexpected packet size: ${byteLength} bytes (expected ${PACKET_SIZE_OLD} or ${PACKET_SIZE})`);
                }
                // Still try to process it (handleAudioPacket will validate)
              }
              
              this.handleAudioPacket(arrayBuffer);
            } else {
              console.warn('[Voice Gateway] Failed to convert message to ArrayBuffer or byteLength is 0');
            }
          } catch (error: any) {
            console.error('[Voice Gateway] Error handling binary message:', error, 'data type:', event.data?.constructor?.name);
          }
        };
        
        // CRITICAL: Verify handler is attached AFTER assignment (use setTimeout to check after assignment completes)
        setTimeout(() => {
          if (!this.ws || !this.ws.onmessage) {
            console.error('[Voice Gateway] ❌ ERROR: onmessage handler is null after assignment! WebSocket readyState:', this.ws?.readyState);
          } else {
            console.log('[Voice Gateway] ✅ onmessage handler successfully attached and verified (readyState:', this.ws.readyState, ')');
          }
        }, 0);

        this.ws.onerror = (error: Event) => {
          console.error(`[Voice Gateway] ❌ WebSocket error:`, error);
          this.connectedSubject.next(false);
          if (!this.isReconnecting) {
            reject(new Error('WebSocket connection failed'));
          }
        };
        
        this.ws.onclose = (event: CloseEvent) => {
          const connectionDuration = Date.now() - connectionStartTime;
          console.log(`[Voice Gateway] 🔌 WebSocket CLOSED (code: ${event.code}, reason: ${event.reason || 'none'}, duration: ${connectionDuration}ms, wasClean: ${event.wasClean})`);
          
          this.connectedSubject.next(false);
          this.cleanupPlayback();
          
          // CRITICAL: Remove handlers and reset flag
          if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onerror = null;
            this.ws.onclose = null;
          }
          this.onmessageHandlerAttached = false;
          if (this.ws === this.currentWs) {
            this.currentWs = null;
          }
          
          // Clear active connection tracking
          if (this.activeCallId === this.callId && this.activeUserId === this.userId) {
            this.activeCallId = null;
            this.activeUserId = null;
          }
          
          // CRITICAL: Attempt reconnection for ANY unexpected close (not just non-clean closes)
          // This ensures we reconnect even if the connection drops due to network issues
          // Only skip reconnection if it was a clean close (code 1000) AND we're not in an active call
          const isCleanClose = event.code === 1000 && event.wasClean;
          const isActiveCall = this.callId && this.userId; // If we have callId/userId, we're in a call
          
          if (this.shouldReconnect && (!isCleanClose || isActiveCall)) {
            console.log(`[Voice Gateway] 🔄 Scheduling reconnection (code: ${event.code}, wasClean: ${event.wasClean}, isActiveCall: ${isActiveCall})`);
            this.scheduleReconnect();
          } else {
            console.log(`[Voice Gateway] ⏹️ Not reconnecting (clean close and not in active call)`);
          }
        };
      } catch (error: any) {
        console.error('[Voice Gateway] Connection error:', error);
        this.connectedSubject.next(false);
        reject(error);
        
        // Schedule reconnection on error
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      }
    });
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.isReconnecting || !this.shouldReconnect) {
      console.log(`[Voice Gateway] ⏹️ Reconnection skipped (isReconnecting: ${this.isReconnecting}, shouldReconnect: ${this.shouldReconnect})`);
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[Voice Gateway] ❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping.`);
      this.shouldReconnect = false;
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`[Voice Gateway] 🔄 Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms (callId: ${this.callId}, userId: ${this.userId})`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.isReconnecting = false;
      if (this.callId && this.userId && this.shouldReconnect) {
        console.log(`[Voice Gateway] 🔄 Reconnecting... (attempt ${this.reconnectAttempts}, callId: ${this.callId}, userId: ${this.userId})`);
        this.attemptConnection().then(() => {
          console.log(`[Voice Gateway] ✅ Reconnection successful (attempt ${this.reconnectAttempts})`);
          this.reconnectAttempts = 0; // Reset on success
        }).catch(error => {
          console.error('[Voice Gateway] Reconnection attempt failed:', error);
          // Will schedule another reconnection via onclose handler or health check
          this.isReconnecting = false;
          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
        });
      } else {
        console.log(`[Voice Gateway] ⏹️ Reconnection cancelled (callId: ${this.callId}, userId: ${this.userId}, shouldReconnect: ${this.shouldReconnect})`);
        this.isReconnecting = false;
      }
    }, delay);
  }

  /**
   * Disconnect from Voice Gateway
   */
  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isReconnecting = false;
    
    this.cleanupPlayback();
    
    // CRITICAL: Use cleanupWs() to ensure complete cleanup
    this.cleanupWs();
    
    // CRITICAL: Do NOT close audioContext on disconnect - set to null for next init
    this.audioContext = null;
    this.playbackGain = null;
    
    this.connectedSubject.next(false);
    console.log('[Voice Gateway] Disconnected');
  }

  private seqCounter: number = 0;

  /**
   * Send audio packet (PCM16, 20ms frame)
   * @param pcm16Data - Int16Array of 320 samples (640 bytes)
   */
  sendAudioPacket(pcm16Data: Int16Array): void {
    // INSTRUMENTATION: Log reason for early return
    if (this.isMicMuted) {
      // Only log first few times to avoid spam
      if (this.packetsSentCount === 0 || (this.packetsSentCount < 5 && this.packetsSentCount % 10 === 0)) {
        console.log(`[Voice Gateway] sendAudioPacket() early return: micMuted=true`);
      }
      return;
    }
    
    if (!this.ws) {
      if (this.packetsSentCount === 0 || (this.packetsSentCount < 5 && this.packetsSentCount % 10 === 0)) {
        console.log(`[Voice Gateway] sendAudioPacket() early return: ws is null`);
      }
      return;
    }
    
    // INSTRUMENTATION: Log WebSocket readyState before send
    if (this.ws.readyState !== WebSocket.OPEN) {
      if (this.packetsSentCount === 0 || (this.packetsSentCount < 5 && this.packetsSentCount % 10 === 0)) {
        console.log(`[Voice Gateway] sendAudioPacket() early return: ws.readyState=${this.ws.readyState} (not OPEN=1)`);
      }
      return;
    }

    if (pcm16Data.length !== SAMPLES_PER_FRAME) {
      console.warn(`[Voice Gateway] sendAudioPacket() early return: Invalid packet size: ${pcm16Data.length} (expected ${SAMPLES_PER_FRAME})`);
      return;
    }

    try {
      // Create packet: seq (4 bytes) + timestamp (8 bytes) + senderId (24 bytes) + payload (640 bytes)
      const packet = new ArrayBuffer(PACKET_SIZE);
      const view = new DataView(packet);
      const timestamp = Date.now();
      const seq = this.seqCounter++;

      view.setUint32(0, seq, true); // seq (little-endian)
      view.setBigUint64(4, BigInt(timestamp), true); // timestamp (little-endian)
      
      // Add senderId (24 bytes, UTF-8 encoded, padded/truncated)
      const senderIdStr = this.userId.padEnd(SENDER_ID_SIZE, '\0').slice(0, SENDER_ID_SIZE);
      const senderIdBytes = new TextEncoder().encode(senderIdStr);
      new Uint8Array(packet, 12, SENDER_ID_SIZE).set(senderIdBytes.slice(0, SENDER_ID_SIZE));
      
      // Copy PCM payload (starts at offset 36: 12 + 24)
      const pcmBytes = new Uint8Array(pcm16Data.buffer);
      new Uint8Array(packet, 36).set(pcmBytes);

      // Send packet as binary
      this.ws.send(packet);
      this.packetsSentCount++;
      
      // INSTRUMENTATION: Log first few successful sends
      if (this.packetsSentCount <= 3) {
        console.log(`[Voice Gateway] ✅ sendAudioPacket() SUCCESS: seq=${seq}, ws.readyState=${this.ws.readyState}, packetsSentCount=${this.packetsSentCount}`);
      }
    } catch (error: any) {
      console.error('[Voice Gateway] Error sending audio packet:', error);
    }
  }
  
  /**
   * Set microphone mute state (SOFT MUTE - boolean gate only)
   * IMPORTANT: Only sets boolean to stop sending packets. Does NOT stop tracks or touch audioCtx lifecycle.
   * @param muted - true to mute, false to unmute
   */
  async setMicMuted(muted: boolean): Promise<void> {
    this.isMicMuted = muted;
    
    // Log mute state
    console.log(`[Voice Gateway] MicMuted=${this.isMicMuted}`);
    console.log(`[Voice Gateway] audioCtx.state=${this.audioContext?.state || 'null'}, micMuted=${this.isMicMuted}`);
    
    // On unmute, ALWAYS ensure audio context is running
    if (!this.isMicMuted && this.audioContext) {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        console.log('[Voice Gateway] audioCtx.state=', this.audioContext.state);
      } else if (this.audioContext.state === 'closed') {
        console.error('[Voice Gateway] WARNING: Audio context is closed on unmute! This should not happen.');
      }
    }
  }
  
  /**
   * Toggle speaker mute (SOFT MUTE - never detaches audio pipeline)
   * IMPORTANT: 
   * - Only sets playbackGain.gain.value to 0/1
   * - Does NOT touch WebSocket, audioCtx lifecycle, or rxQueue
   * - Playback scheduler continues even when muted
   */
  async toggleSpeakerMute(): Promise<void> {
    this.isSpeakerMuted = !this.isSpeakerMuted;
    
    // SOFT MUTE: Only adjust gain - do NOT touch WebSocket or audioCtx lifecycle
    if (this.playbackGain) {
      this.playbackGain.gain.value = this.isSpeakerMuted ? 0 : 1;
    }
    
    // Log mute state with stats
    const stats = this.getCurrentStats();
    console.log(`[Voice Gateway] SpeakerMuted=${this.isSpeakerMuted}`);
    console.log(`[Voice Gateway] audioCtx.state=${this.audioContext?.state || 'null'}, speakerMuted=${this.isSpeakerMuted}, playbackGain.gain.value=${this.playbackGain?.gain.value ?? 'null'}`);
    console.log(`[Voice Gateway] packetsRecv/sec=${stats.packetsRecvPerSec}, bufferDepth=${stats.bufferDepth}`);
    
    // On unmute, ALWAYS ensure audio context is running
    if (!this.isSpeakerMuted && this.audioContext) {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        console.log('[Voice Gateway] audioCtx.state=', this.audioContext.state);
      } else if (this.audioContext.state === 'closed') {
        console.error('[Voice Gateway] WARNING: Audio context is closed on unmute! This should not happen.');
      }
      // Ensure playback continues if buffer is healthy (do not clear rxQueue)
      this.ensurePlaybackLoop();
    }
  }
  
  /**
   * Get current stats for logging
   */
  private getCurrentStats(): { packetsSentPerSec: number; packetsRecvPerSec: number; packetsPlayedPerSec: number; bufferDepth: number } {
    const packetsSentPerSec = this.packetsSentCount;
    const packetsRecvPerSec = this.packetsRecvCount;
    const packetsPlayedPerSec = this.packetsPlayedCount;
    
    // Reset counters for next second
    this.packetsSentCount = 0;
    this.packetsRecvCount = 0;
    this.packetsPlayedCount = 0;
    
    return {
      packetsSentPerSec,
      packetsRecvPerSec,
      packetsPlayedPerSec,
      bufferDepth: this.jitterBuffer.size,
    };
  }
  
  /**
   * Get current packets sent count (for diagnostic logging)
   * Note: This returns the current count. The count is reset in getCurrentStats() which is called in logStats().
   * For accurate per-second calculation, track the difference between calls.
   */
  getPacketsSentCount(): number {
    return this.packetsSentCount;
  }
  
  /**
   * Get current mic mute state (for diagnostic logging)
   */
  getMicMutedState(): boolean {
    return this.isMicMuted;
  }
  
  /**
   * Ensure playback loop continues (called after unmute)
   * IMPORTANT: 
   * - Do NOT clear rxQueue on mute - keep buffer intact
   * - Do NOT reset nextPlayTime on mute/unmute
   * - Only resume scheduling if it was paused
   */
  private ensurePlaybackLoop(): void {
    if (!this.audioContext || !this.playbackGain) {
      return;
    }
    
    // If we have packets and playback hasn't started, initialize it
    if (!this.isPlaying && this.jitterBuffer.size >= MIN_BUFFER_PACKETS) {
      const seqs = Array.from(this.jitterBuffer.keys()).sort((a, b) => a - b);
      if (this.nextPlaybackSeq === null) {
        this.nextPlaybackSeq = seqs[0];
        this.nextPlayTime = this.audioContext.currentTime + 0.30;
      }
      this.isPlaying = true;
      this.isSchedulingPaused = false;
      console.log(`[Voice Gateway] Starting playback after unmute from seq ${this.nextPlaybackSeq} (buffer: ${this.jitterBuffer.size} packets)`);
      
      // Start scheduler if not running
      if (!this.playbackSchedulerInterval) {
        this.playbackSchedulerInterval = setInterval(() => {
          this.scheduleNextPacket();
        }, FRAME_DURATION_MS);
      }
    } else if (this.isPlaying && this.isSchedulingPaused && this.jitterBuffer.size >= LOW_BUFFER_THRESHOLD) {
      // Resume scheduling if it was paused (but don't reset state)
      this.isSchedulingPaused = false;
      console.log(`[Voice Gateway] Resuming scheduling after unmute (buffer: ${this.jitterBuffer.size} packets)`);
    }
  }
  
  /**
   * Check if mic is muted
   */
  isMicMutedState(): boolean {
    return this.isMicMuted;
  }
  
  /**
   * Check if speaker is muted
   */
  isSpeakerMutedState(): boolean {
    return this.isSpeakerMuted;
  }

  /**
   * Handle incoming audio packet
   */
  private handleAudioPacket(data: ArrayBuffer): void {
    if (!data) {
      console.warn('[Voice Gateway] Received null/undefined packet');
      return;
    }
    
    // Support both old format (652 bytes) and new format (676 bytes with senderId)
    const isOldFormat = data.byteLength === PACKET_SIZE_OLD;
    const isNewFormat = data.byteLength === PACKET_SIZE;
    
    if (!isOldFormat && !isNewFormat) {
      console.warn(`[Voice Gateway] Invalid packet size: ${data.byteLength} (expected ${PACKET_SIZE_OLD} or ${PACKET_SIZE})`);
      return;
    }

    try {
      const view = new DataView(data);
      const seq = view.getUint32(0, true); // Little-endian
      const timestampMs = Number(view.getBigUint64(4, true)); // Little-endian
      
      // Extract senderId if new format, or use empty string for old format
      let senderId = '';
      let payloadOffset = 12;
      
      if (isNewFormat) {
        // Extract senderId (24 bytes, UTF-8)
        const senderIdBytes = new Uint8Array(data, 12, SENDER_ID_SIZE);
        senderId = new TextDecoder('utf-8').decode(senderIdBytes).replace(/\0/g, ''); // Remove null padding
        
        // CRITICAL: Ignore packets from self to prevent loopback/echo
        if (senderId && senderId === this.userId) {
          // Log first few self-packets for debugging
          if (this.packetsRecvCount < 5) {
            console.warn(`[Voice Gateway] ⚠️ Ignoring self packet (senderId=${senderId}, localUserId=${this.userId})`);
          }
          return;
        }
        
        payloadOffset = 36; // 12 + 24
      }
      
      const payload = data.slice(payloadOffset); // 640 bytes

      // Add to jitter buffer
      this.jitterBuffer.set(seq, { timestamp: timestampMs, payload });
      this.packetsRecvCount++;

      // Log first few packets for debugging
      if (this.packetsRecvCount <= 5) {
        console.log(`[Voice Gateway] Received packet #${this.packetsRecvCount}, seq=${seq}, bufferDepth=${this.jitterBuffer.size}`);
      }

      // Process jitter buffer
      this.processJitterBuffer();
    } catch (error: any) {
      console.error('[Voice Gateway] Error parsing audio packet:', error);
    }
  }

  /**
   * Process jitter buffer and play audio
   * IMPORTANT: 
   * - NEVER hard-stop/restart playback on low buffer
   * - On low buffer, just pause scheduling but keep nextPlayTime and playback state intact
   * - Playback continues even when speaker is muted (playbackGain.gain.value=0 makes it silent)
   */
  private processJitterBuffer(): void {
    if (!this.audioContext) return;

    // Check if we should start playback (first time only)
    if (!this.isPlaying) {
      if (this.jitterBuffer.size >= MIN_BUFFER_PACKETS) {
        // Initialize playback with optimized delay for smooth start
        const seqs = Array.from(this.jitterBuffer.keys()).sort((a, b) => a - b);
        this.nextPlaybackSeq = seqs[0];
        // Reduced initial delay from 300ms to 150ms for faster call start (WhatsApp-like)
        this.nextPlayTime = this.audioContext.currentTime + 0.15;
        this.isPlaying = true;
        this.isSchedulingPaused = false;
        console.log(`[Voice Gateway] 🎵 Starting playback from seq ${this.nextPlaybackSeq} (buffer: ${this.jitterBuffer.size} packets, initialDelay=150ms, speakerMuted=${this.isSpeakerMuted})`);
        
        // CRITICAL: Start continuous playback scheduler using requestAnimationFrame
        // This provides smooth, continuous scheduling instead of interval-based
        // IMPORTANT: Scheduler continues even when muted - playbackGain controls silence
        // CRITICAL: Clear any existing scheduler first to prevent duplicates
        if (this.playbackSchedulerInterval) {
          clearInterval(this.playbackSchedulerInterval);
          this.playbackSchedulerInterval = null;
        }
        if (this.scheduleAnimationFrame) {
          cancelAnimationFrame(this.scheduleAnimationFrame);
          this.scheduleAnimationFrame = null;
        }
        
        // Start the continuous scheduling loop
        this.startSchedulingLoop();
      } else {
        return; // Wait for more packets
      }
    }

    // Check if we should pause scheduling due to low buffer (but keep playback state intact)
    // NEVER set isPlaying=false or reset nextPlayTime/nextPlaybackSeq
    // CRITICAL: Only pause if buffer is critically low (below threshold) AND we're actively playing
    if (this.isPlaying && this.jitterBuffer.size < LOW_BUFFER_THRESHOLD) {
      if (!this.isSchedulingPaused) {
        // Pause scheduling but keep all state intact
        this.isSchedulingPaused = true;
        console.warn(`[Voice Gateway] ⚠️ Scheduling paused (low buffer: ${this.jitterBuffer.size} < ${LOW_BUFFER_THRESHOLD} packets) - waiting for more packets`);
      }
      return; // Don't schedule new packets, but don't reset anything
    }
    
    // Check if we should resume scheduling if buffer refilled
    // Do NOT reset nextPlayTime or nextPlaybackSeq - continue from where we left off
    if (this.isPlaying && this.isSchedulingPaused && this.jitterBuffer.size >= LOW_BUFFER_THRESHOLD) {
      this.isSchedulingPaused = false;
      // Find the next available seq >= nextPlaybackSeq (don't reset to start)
      const seqs = Array.from(this.jitterBuffer.keys()).sort((a, b) => a - b);
      if (this.nextPlaybackSeq !== null) {
        const nextSeq = seqs.find(seq => seq >= this.nextPlaybackSeq!);
        if (nextSeq !== undefined) {
          this.nextPlaybackSeq = nextSeq;
        }
        // If nextPlayTime is too far in the past, adjust it forward slightly
        const now = this.audioContext.currentTime;
        if (this.nextPlayTime! < now - 0.1) {
          this.nextPlayTime = now + 0.05; // Small forward adjustment
        }
      }
      console.log(`[Voice Gateway] Scheduling resumed from seq ${this.nextPlaybackSeq} (buffer: ${this.jitterBuffer.size} packets, speakerMuted=${this.isSpeakerMuted})`);
    }

    // Limit buffer size (remove oldest if too large)
    if (this.jitterBuffer.size > MAX_BUFFER_PACKETS) {
      const seqs = Array.from(this.jitterBuffer.keys()).sort((a, b) => a - b);
      const toRemove = seqs.slice(0, seqs.length - MAX_BUFFER_PACKETS);
      toRemove.forEach(seq => this.jitterBuffer.delete(seq));
    }
  }

  /**
   * CRITICAL: Start continuous playback scheduling loop using requestAnimationFrame
   * This replaces the broken setInterval approach and ensures continuous scheduling
   */
  private startSchedulingLoop(): void {
    if (this.scheduleAnimationFrame) {
      cancelAnimationFrame(this.scheduleAnimationFrame);
    }
    
    const scheduleLoop = () => {
      try {
        // Only schedule if conditions are met
        if (!this.audioContext || !this.isPlaying || this.isSchedulingPaused || this.nextPlaybackSeq === null || !this.playbackGain) {
          this.scheduleAnimationFrame = requestAnimationFrame(scheduleLoop);
          return;
        }

        const ctx = this.audioContext;
        const now = ctx.currentTime;
        const LOOKAHEAD = 0.25; // Schedule up to 250ms ahead (like WhatsApp)
        
        // CRITICAL: If we fell behind (nextPlayTime is in the past), snap forward
        // This fixes the negative scheduledAheadMs issue
        if (this.nextPlayTime! < now - 0.1) {
          console.warn(`[Voice Gateway] ⚠️ Scheduler fell behind, snapping forward: nextPlayTime=${this.nextPlayTime}, currentTime=${now}, diff=${(now - this.nextPlayTime!) * 1000}ms`);
          this.nextPlayTime = now + 0.02; // Small headroom (20ms)
        }
        
        // Schedule as many packets as we can within the lookahead window
        let scheduled = 0;
        while (this.jitterBuffer.has(this.nextPlaybackSeq) && this.nextPlayTime! < now + LOOKAHEAD) {
          const packet = this.jitterBuffer.get(this.nextPlaybackSeq);
          if (!packet) break;
          
          this.jitterBuffer.delete(this.nextPlaybackSeq);
          
          // Schedule this packet
          const scheduledTime = Math.max(this.nextPlayTime!, now + 0.005); // At least 5ms in future
          this.scheduleAudioChunk(packet.payload, scheduledTime);
          
          // Advance sequence and time
          this.nextPlaybackSeq++;
          
          // CRITICAL: Calculate exact frame duration based on sample rate
          // Frame is 320 samples at 16kHz = 0.02 seconds
          const frameDuration = SAMPLES_PER_FRAME / SAMPLE_RATE; // 320 / 16000 = 0.02
          this.nextPlayTime = scheduledTime + frameDuration;
          
          scheduled++;
          
          // Safety: don't schedule more than 50 packets in one frame (1 second of audio)
          if (scheduled >= 50) break;
        }
        
        // Continue the loop
        this.scheduleAnimationFrame = requestAnimationFrame(scheduleLoop);
      } catch (error: any) {
        console.error('[Voice Gateway] ❌ Scheduler loop crashed:', error);
        // If scheduler crashes, audio will never play - this matches your symptom
        // Reset state and try to recover
        this.isPlaying = false;
        this.isSchedulingPaused = false;
        this.scheduleAnimationFrame = null;
      }
    };
    
    // Start the loop
    this.scheduleAnimationFrame = requestAnimationFrame(scheduleLoop);
    console.log('[Voice Gateway] ✅ Started continuous playback scheduler (requestAnimationFrame)');
  }

  /**
   * Schedule audio chunk for continuous playback
   * @param pcmData - PCM16 audio data (640 bytes)
   * @param scheduledTime - AudioContext time to start playback (in seconds)
   */
  private scheduleAudioChunk(pcmData: ArrayBuffer, scheduledTime: number): void {
    if (!this.audioContext || !this.isPlaying || !this.playbackGain) {
      return;
    }

    try {
      // Convert Int16 PCM to Float32
      // CRITICAL: pcmData should be 640 bytes (320 samples * 2 bytes)
      if (pcmData.byteLength !== PAYLOAD_SIZE) {
        console.warn(`[Voice Gateway] Invalid payload size: ${pcmData.byteLength} bytes (expected ${PAYLOAD_SIZE})`);
        return;
      }
      
      const int16Array = new Int16Array(pcmData);
      const float32Array = new Float32Array(int16Array.length);
      
      // CRITICAL: Convert Int16 (-32768 to 32767) to Float32 (-1.0 to 1.0)
      // Use consistent divisor: 32768 (0x8000) for all values
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }
      
      // CRITICAL: Verify we have the right number of samples
      if (int16Array.length !== SAMPLES_PER_FRAME) {
        console.warn(`[Voice Gateway] Invalid sample count: ${int16Array.length} (expected ${SAMPLES_PER_FRAME})`);
        return;
      }

      // CRITICAL: Upsample from 16kHz to AudioContext sample rate (usually 48kHz)
      // If we don't upsample, audio will play at wrong speed (3x too fast if 48kHz)
      const bufferSampleRate = this.audioContext.sampleRate;
      
      // CRITICAL: Always create a new Float32Array to ensure ArrayBuffer backing (not SharedArrayBuffer)
      // This fixes TypeScript error: Float32Array<ArrayBufferLike> not assignable to Float32Array<ArrayBuffer>
      let finalAudioData: Float32Array;
      
      if (bufferSampleRate !== SAMPLE_RATE) {
        // Upsample from 16kHz to target rate
        const ratio = bufferSampleRate / SAMPLE_RATE;
        const outputLength = Math.floor(float32Array.length * ratio);
        finalAudioData = new Float32Array(outputLength);
        
        // Simple linear interpolation upsampling
        for (let i = 0; i < outputLength; i++) {
          const srcIndex = i / ratio;
          const srcIndexFloor = Math.floor(srcIndex);
          const srcIndexCeil = Math.min(srcIndexFloor + 1, float32Array.length - 1);
          const fraction = srcIndex - srcIndexFloor;
          
          if (srcIndexFloor === srcIndexCeil) {
            finalAudioData[i] = float32Array[srcIndexFloor];
          } else {
            // Linear interpolation
            finalAudioData[i] = float32Array[srcIndexFloor] * (1 - fraction) + float32Array[srcIndexCeil] * fraction;
          }
        }
        
        if (this.packetsRecvCount <= 5) {
          console.log(`[Voice Gateway] Upsampled audio: ${SAMPLE_RATE}Hz -> ${bufferSampleRate}Hz (${float32Array.length} -> ${finalAudioData.length} samples)`);
        }
      } else {
        // CRITICAL: Create new Float32Array to ensure ArrayBuffer backing (not SharedArrayBuffer)
        // Copy data from potentially SharedArrayBuffer-backed array to ArrayBuffer-backed array
        finalAudioData = new Float32Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
          finalAudioData[i] = float32Array[i];
        }
      }
      
      // Create audio buffer with AudioContext sample rate
      const buffer = this.audioContext.createBuffer(1, finalAudioData.length, bufferSampleRate);
      // CRITICAL: Type assertion to ensure TypeScript knows this is ArrayBuffer-backed
      // We've already ensured finalAudioData is a new Float32Array, so it's guaranteed to be ArrayBuffer-backed
      buffer.copyToChannel(finalAudioData as Float32Array<ArrayBuffer>, 0);

      // Create source and schedule
      // All playback sources connect to playbackGain ONLY (not directly to destination)
      // playbackGain controls speaker mute/unmute (gain.value = 0/1)
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.playbackGain!);
      
      // CRITICAL: Use the provided scheduledTime (not nextPlayTime which may have advanced)
      // Ensure scheduledTime is at least 5ms in the future
      const actualStartTime = Math.max(scheduledTime, this.audioContext.currentTime + 0.005);
      source.start(actualStartTime);

      // Track scheduled source for cleanup
      this.scheduledSources.add(source);
      this.packetsPlayedCount++; // CRITICAL: Increment when scheduled, not when ended
      
      // Log first few scheduled packets for debugging
      if (this.packetsPlayedCount <= 5) {
        console.log(`[Voice Gateway] ✅ Scheduled packet #${this.packetsPlayedCount} for playback at t=${actualStartTime.toFixed(3)}s (currentTime=${this.audioContext.currentTime.toFixed(3)}s)`);
      }

      // Clean up when source ends
      source.onended = () => {
        this.scheduledSources.delete(source);
      };
    } catch (error: any) {
      console.error('[Voice Gateway] Error scheduling audio:', error);
    }
  }

  /**
   * Check connection health and reconnect if needed
   */
  private checkConnectionHealth(): void {
    if (!this.ws || !this.callId || !this.userId) {
      return;
    }
    
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    const wsState = this.ws.readyState;
    
    // If WebSocket is not open, try to reconnect
    if (wsState !== WebSocket.OPEN) {
      console.warn(`[Voice Gateway] ⚠️ Connection health check failed: WebSocket state is ${wsState} (expected OPEN=1)`);
      if (this.shouldReconnect && !this.isReconnecting) {
        console.log(`[Voice Gateway] 🔄 Triggering reconnection due to unhealthy connection state`);
        this.scheduleReconnect();
      }
      return;
    }
    
    // If we haven't received any messages in 20 seconds, the connection might be dead
    // (Note: ping/pong is handled automatically by the browser, but we check for actual data)
    if (timeSinceLastMessage > 20000 && this.lastMessageTime > 0) {
      console.warn(`[Voice Gateway] ⚠️ Connection health check: No messages received in ${timeSinceLastMessage}ms`);
      // Don't reconnect immediately - might just be a quiet period
      // But log it for debugging
    }
  }
  
  /**
   * Cleanup playback state
   */
  private cleanupPlayback(): void {
    // Stop scheduler (both interval and animation frame)
    if (this.playbackSchedulerInterval) {
      clearInterval(this.playbackSchedulerInterval);
      this.playbackSchedulerInterval = null;
    }
    if (this.scheduleAnimationFrame) {
      cancelAnimationFrame(this.scheduleAnimationFrame);
      this.scheduleAnimationFrame = null;
    }
    
    // Stop stats logging
    if (this.statsLogInterval) {
      clearInterval(this.statsLogInterval);
      this.statsLogInterval = null;
    }
    
    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
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
    this.isSchedulingPaused = false;
    this.nextPlaybackSeq = null;
    this.nextPlayTime = null;
    this.packetsRecvCount = 0;
    
    // DO NOT close audioContext - it should remain open for reuse
    // The audioContext is managed separately and should only be closed on explicit endCall
  }
  
  /**
   * Close audio context (only call on explicit END CALL or page unload)
   * This is the ONLY place where audioContext.close() should be called.
   */
  async closeAudioContext(): Promise<void> {
    // CRITICAL: Only close if explicitly called (end call)
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
        console.log('[Voice Gateway] Audio context closed (end call)');
      } catch (error: any) {
        console.error('[Voice Gateway] Error closing audio context:', error);
      }
    }
    this.audioContext = null;
    this.playbackGain = null;
  }
  
  /**
   * Log consolidated stats once per second
   */
  private logStats(): void {
    const now = Date.now();
    if (now - this.lastLogTime < 1000) {
      return; // Rate limit: log once per second
    }
    this.lastLogTime = now;
    
    const audioCtxState = this.audioContext ? this.audioContext.state : 'null';
    
    // Calculate scheduledAheadMs (how far ahead we're scheduling)
    // CRITICAL: This should be positive (scheduling ahead) or small negative (caught up)
    let scheduledAheadMs = 0;
    if (this.audioContext && this.nextPlayTime !== null) {
      const aheadSeconds = this.nextPlayTime - this.audioContext.currentTime;
      scheduledAheadMs = Math.round(aheadSeconds * 1000);
      
      // Warn if scheduledAheadMs is very negative (scheduler is broken)
      if (scheduledAheadMs < -100) {
        console.error(`[Voice Gateway] ❌ CRITICAL: scheduledAheadMs is ${scheduledAheadMs}ms (very negative - scheduler is broken!)`);
        console.error(`[Voice Gateway] ❌ nextPlayTime=${this.nextPlayTime}, currentTime=${this.audioContext.currentTime}, diff=${(this.audioContext.currentTime - this.nextPlayTime) * 1000}ms`);
      }
    }
    
    // DIAGNOSTIC: Comprehensive stats logging
    const stats = this.getCurrentStats();
    console.log(`[Voice Gateway] 📊 Stats: sent/sec=${stats.packetsSentPerSec}, recv/sec=${stats.packetsRecvPerSec}, played/sec=${stats.packetsPlayedPerSec}, bufferDepth=${this.jitterBuffer.size}, scheduledAheadMs=${scheduledAheadMs}, playing=${this.isPlaying}, schedulingPaused=${this.isSchedulingPaused}, audioCtx.state=${audioCtxState}, micMuted=${this.isMicMuted}, speakerMuted=${this.isSpeakerMuted}, nextPlaybackSeq=${this.nextPlaybackSeq}`);
    
    // CRITICAL: Warn if played/sec is 0 but buffer is full (scheduler not working)
    if (stats.packetsPlayedPerSec === 0 && this.jitterBuffer.size >= MIN_BUFFER_PACKETS && this.isPlaying) {
      console.error(`[Voice Gateway] ❌ CRITICAL: played/sec=0 but buffer is full (${this.jitterBuffer.size} packets) - scheduler is NOT scheduling audio!`);
    }
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

