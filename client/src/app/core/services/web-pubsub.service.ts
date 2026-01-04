import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { WebPubSubClient } from '@azure/web-pubsub-client';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export interface WebPubSubTokenResponse {
  success: boolean;
  data: {
    url: string;
    token: string;
    hubName: string;
  };
}

export interface AudioMessage {
  type: 'audio' | 'control';
  data?: ArrayBuffer;
  senderId: string;
  timestamp: string;
  action?: 'start' | 'stop' | 'mute' | 'unmute';
}

@Injectable({
  providedIn: 'root',
})
export class WebPubSubService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private client: WebPubSubClient | null = null;
  private connectedSubject = new BehaviorSubject<boolean>(false);
  private audioMessageSubject = new Subject<AudioMessage>();
  private controlMessageSubject = new Subject<AudioMessage>();

  public connected$ = this.connectedSubject.asObservable();
  public audioMessages$ = this.audioMessageSubject.asObservable();
  public controlMessages$ = this.controlMessageSubject.asObservable();

  /**
   * Get Web PubSub client access token from backend
   */
  private getToken(targetUserId?: string): Observable<WebPubSubTokenResponse> {
    const url = `${environment.apiUrl}/webpubsub/token`;
    return this.http.post<WebPubSubTokenResponse>(url, { targetUserId });
  }

  /**
   * Connect to Web PubSub for a specific conversation
   * @param targetUserId - The other user's ID in the conversation
   * @returns Promise that resolves when connected
   */
  async connect(targetUserId?: string): Promise<void> {
    try {
      console.log('[Web PubSub] Starting connection...', { targetUserId });
      
      // Get token from backend
      const tokenResponse = await this.getToken(targetUserId).toPromise();
      
      if (!tokenResponse || !tokenResponse.success) {
        console.error('[Web PubSub] Token request failed:', tokenResponse);
        throw new Error('Failed to get Web PubSub token from backend. Check: 1) Backend is running, 2) You are logged in, 3) /api/webpubsub/token endpoint exists');
      }

      const { url, hubName } = tokenResponse.data;
      console.log('[Web PubSub] Token received, hubName:', hubName);
      console.log('[Web PubSub] URL (first 50 chars):', url.substring(0, 50) + '...');

      // Create Web PubSub client
      this.client = new WebPubSubClient({
        getClientAccessUrl: async () => url,
      });
      
      console.log('[Web PubSub] Client created, setting up event handlers...');

      // Set up event handlers
      this.client.on('connected', () => {
        console.log('[Web PubSub] Connected');
        this.connectedSubject.next(true);
      });

      this.client.on('disconnected', () => {
        console.log('[Web PubSub] Disconnected');
        this.connectedSubject.next(false);
      });

      this.client.on('server-message', (e) => {
        console.log('[Web PubSub] Server message:', e);
      });

      // Handle group messages (audio data)
      this.client.on('group-message', (e) => {
        try {
          // Log first 10 messages to debug format, then occasionally
          const messageCount = (this as any).__messageCount = ((this as any).__messageCount || 0) + 1;
          const shouldLog = messageCount <= 10 || Math.random() < 0.01; // Log first 10, then 1%
          
          if (shouldLog) {
            console.log('[Web PubSub] 🔍 Group message #' + messageCount + ':', {
              dataType: typeof e.message.data,
              hasData: !!e.message.data,
              dataIsString: typeof e.message.data === 'string',
              dataIsObject: typeof e.message.data === 'object',
              messageKeys: e.message.data && typeof e.message.data === 'object' ? Object.keys(e.message.data) : 'N/A',
              rawDataPreview: typeof e.message.data === 'string' ? e.message.data.substring(0, 200) : (e.message.data ? 'object/arraybuffer' : 'null/undefined'),
              fullMessage: e.message
            });
          }
          
          // Handle different message formats
          let message: any;
          
          // Web PubSub sends data as JSON string or object depending on how it was sent
          if (typeof e.message.data === 'string') {
            try {
              message = JSON.parse(e.message.data);
              if (shouldLog) {
                console.log('[Web PubSub] ✅ Parsed JSON string, message:', message);
              }
            } catch (parseError) {
              // If not JSON, might be base64 audio directly
              if (shouldLog) {
                console.log('[Web PubSub] Data is string but not JSON, treating as base64 audio, length:', e.message.data.length);
              }
              message = { type: 'audio', data: e.message.data };
            }
          } else if (e.message.data && typeof e.message.data === 'object') {
            // Already an object - use directly
            message = e.message.data;
            if (shouldLog) {
              console.log('[Web PubSub] ✅ Message is already object:', message);
            }
          } else {
            if (shouldLog) {
              console.warn('[Web PubSub] ❌ Unexpected message format:', {
                dataType: typeof e.message.data,
                data: e.message.data,
                fullEvent: e
              });
            }
            return;
          }
          
          if (shouldLog) {
            console.log('[Web PubSub] 📦 Parsed message:', {
              type: message.type,
              hasData: !!message.data,
              dataType: typeof message.data,
              dataLength: typeof message.data === 'string' ? message.data.length : (message.data?.byteLength || 'N/A'),
              senderId: message.senderId,
              allKeys: Object.keys(message)
            });
          }
          
          // Check if it's an audio message
          if (message.type === 'audio' && message.data) {
            // Convert base64 to ArrayBuffer if needed
            let audioData: ArrayBuffer;
            if (typeof message.data === 'string') {
              try {
                const binaryString = atob(message.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                audioData = bytes.buffer;
                
                if (shouldLog) {
                  console.log('[Web PubSub] ✅ Decoded audio data, size:', audioData.byteLength, 'bytes');
                }
              } catch (error) {
                console.error('[Web PubSub] ❌ Error decoding base64 audio:', error);
                return;
              }
            } else if (message.data instanceof ArrayBuffer) {
              audioData = message.data;
            } else {
              if (shouldLog) {
                console.warn('[Web PubSub] ❌ Unknown audio data format:', typeof message.data, message.data);
              }
              return;
            }

            // Don't play our own audio back
            const currentUser = this.authService.currentUser();
            if (currentUser && message.senderId === currentUser.id) {
              if (shouldLog) {
                console.log('[Web PubSub] ⏭️ Ignoring own audio message from:', message.senderId);
              }
              return;
            }

            // Emit audio message
            this.audioMessageSubject.next({
              type: 'audio',
              data: audioData,
              senderId: message.senderId || 'unknown',
              timestamp: message.timestamp || new Date().toISOString(),
            });
            
            if (shouldLog || messageCount % 50 === 0) {
              console.log('[Web PubSub] 🔊 Audio message emitted to subscribers, sender:', message.senderId, 'size:', audioData.byteLength);
            }
          } else if (message.type === 'control') {
            this.controlMessageSubject.next({
              type: 'control',
              senderId: message.senderId || 'unknown',
              timestamp: message.timestamp || new Date().toISOString(),
              action: message.action,
            });
            if (shouldLog) {
              console.log('[Web PubSub] 🎛️ Control message processed:', message.action);
            }
          } else {
            if (shouldLog) {
              console.log('[Web PubSub] ⚠️ Message type not audio or control:', {
                type: message.type || 'unknown',
                keys: Object.keys(message),
                fullMessage: message
              });
            }
          }
        } catch (error) {
          console.error('[Web PubSub] ❌ Error processing message:', error);
        }
      });

      // Start the client
      console.log('[Web PubSub] Starting client...');
      await this.client.start();
      console.log('[Web PubSub] Client start() called, waiting for connection event...');
      
      // Wait for connection to be established
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);
        
        this.client!.on('connected', () => {
          clearTimeout(timeout);
          console.log('[Web PubSub] Connected event received');
          resolve();
        });
      });
      
      // Join group if targetUserId is provided
      if (targetUserId) {
        const currentUser = this.authService.currentUser();
        if (currentUser && currentUser.id) {
          const groupId = [currentUser.id, targetUserId].sort().join('-');
          try {
            await this.client.joinGroup(groupId);
            console.log(`[Web PubSub] Successfully joined group: ${groupId}`);
          } catch (error) {
            console.error(`[Web PubSub] Error joining group ${groupId}:`, error);
            // Continue anyway - might already be in group via token
          }
        }
      }
    } catch (error: any) {
      console.error('[Web PubSub] Connection error:', error);
      console.error('[Web PubSub] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      this.connectedSubject.next(false);
      throw error;
    }
  }

  /**
   * Disconnect from Web PubSub
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
      this.connectedSubject.next(false);
      console.log('[Web PubSub] Disconnected');
    }
  }

  /**
   * Send audio data to a group
   * @param groupId - Group ID (conversation ID)
   * @param audioData - Audio data as ArrayBuffer
   */
  async sendAudio(groupId: string, audioData: ArrayBuffer): Promise<void> {
    if (!this.client) {
      throw new Error('Web PubSub client not connected');
    }

    if (!this.isConnected()) {
      throw new Error('Web PubSub client not connected');
    }

    try {
      // Convert ArrayBuffer to base64 for transmission
      // Use chunked conversion for large arrays to avoid stack overflow
      const bytes = new Uint8Array(audioData);
      let binaryString = '';
      const chunkSize = 8192;
      
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.slice(i, i + chunkSize);
        binaryString += String.fromCharCode.apply(null, Array.from(chunk));
      }
      
      const base64 = btoa(binaryString);

      const currentUser = this.authService.currentUser();
      const message = {
        type: 'audio',
        data: base64, // Send as base64 string
        senderId: currentUser?.id || '',
        timestamp: new Date().toISOString(),
      };

      await this.client.sendToGroup(groupId, message, 'json');
      
      // Log occasionally to avoid spam
      if (Math.random() < 0.01) { // Log 1% of messages
        console.log(`[Web PubSub] Sent audio to group ${groupId}, size: ${audioData.byteLength} bytes`);
      }
    } catch (error: any) {
      console.error('[Web PubSub] Error sending audio:', error);
      console.error('[Web PubSub] Error details:', {
        message: error.message,
        groupId,
        audioSize: audioData.byteLength,
        isConnected: this.isConnected()
      });
      throw error;
    }
  }

  /**
   * Send control message (start, stop, mute, unmute)
   * @param groupId - Group ID (conversation ID)
   * @param action - Control action
   */
  async sendControl(groupId: string, action: 'start' | 'stop' | 'mute' | 'unmute'): Promise<void> {
    if (!this.client) {
      throw new Error('Web PubSub client not connected');
    }

    try {
      const currentUser = this.authService.currentUser();
      const message: AudioMessage = {
        type: 'control',
        senderId: currentUser?.id || '',
        timestamp: new Date().toISOString(),
        action,
      };

      await this.client.sendToGroup(groupId, message, 'json');
    } catch (error) {
      console.error('[Web PubSub] Error sending control:', error);
      throw error;
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.client !== null && this.connectedSubject.value;
  }
}

