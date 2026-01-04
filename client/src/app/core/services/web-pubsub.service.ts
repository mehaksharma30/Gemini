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
          console.log('[Web PubSub] Group message received:', e);
          
          // Handle different message formats
          let message: any;
          if (typeof e.message.data === 'string') {
            try {
              message = JSON.parse(e.message.data);
            } catch {
              // If not JSON, treat as raw data
              message = { type: 'audio', data: e.message.data };
            }
          } else {
            message = e.message.data;
          }
          
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
              } catch (error) {
                console.error('[Web PubSub] Error decoding base64 audio:', error);
                return;
              }
            } else if (message.data instanceof ArrayBuffer) {
              audioData = message.data;
            } else {
              console.warn('[Web PubSub] Unknown audio data format:', typeof message.data);
              return;
            }

            this.audioMessageSubject.next({
              type: 'audio',
              data: audioData,
              senderId: message.senderId || 'unknown',
              timestamp: message.timestamp || new Date().toISOString(),
            });
          } else if (message.type === 'control') {
            this.controlMessageSubject.next({
              type: 'control',
              senderId: message.senderId || 'unknown',
              timestamp: message.timestamp || new Date().toISOString(),
              action: message.action,
            });
          }
        } catch (error) {
          console.error('[Web PubSub] Error processing message:', error);
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

