import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, Observable } from 'rxjs';
import { WebPubSubClient } from '@azure/web-pubsub-client';

export interface CallSignal {
  type: 'incoming_call' | 'call_accept' | 'call_decline' | 'call_busy' | 'call_cancelled' | 'call_end' | 'webrtc_offer' | 'webrtc_answer' | 'webrtc_ice';
  callId?: string;
  fromUserId?: string;
  fromName?: string;
  toUserId?: string;
  mode?: 'single' | 'broadcast';
  sdp?: any;
  candidate?: any;
  reason?: string;
}

export interface IncomingCall {
  callId: string;
  fromUserId: string;
  fromName: string;
  mode: 'single' | 'broadcast';
}

import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class PanicCallService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiBaseUrl;
  
  private client: WebPubSubClient | null = null;
  private userId: string = '';
  private connectedSubject = new Subject<boolean>();
  private incomingCallSubject = new Subject<IncomingCall>();
  private callSignalSubject = new Subject<CallSignal>();
  
  public connected$ = this.connectedSubject.asObservable();
  public incomingCall$ = this.incomingCallSubject.asObservable();
  public callSignal$ = this.callSignalSubject.asObservable();
  
  private isConnected = false;
  private privateGroup: string = '';

  /**
   * Connect to Web PubSub using negotiate endpoint
   */
  async connect(userId: string): Promise<void> {
    try {
      this.userId = userId;
      this.privateGroup = `user:${userId}`;
      
      // Get client access URL from backend
      const response = await this.http.get<{ success: boolean; url: string; userId: string }>(
        `${this.apiUrl}/api/webpubsub/negotiate`
      ).toPromise();
      
      if (!response || !response.success || !response.url) {
        throw new Error('Failed to get Web PubSub connection URL');
      }
      
      // Create Web PubSub client
      this.client = new WebPubSubClient({
        getClientAccessUrl: async () => response.url,
      });
      
      // Set up event handlers
      this.client.on('connected', () => {
        console.log('[PanicCall] Connected to Web PubSub');
        this.isConnected = true;
        this.connectedSubject.next(true);
        
        // Join private group
        this.client?.joinGroup(this.privateGroup);
      });
      
      this.client.on('disconnected', () => {
        console.log('[PanicCall] Disconnected from Web PubSub');
        this.isConnected = false;
        this.connectedSubject.next(false);
      });
      
      this.client.on('group-message', (e) => {
        this.handleGroupMessage(e);
      });
      
      // Start connection
      await this.client.start();
      
      console.log('[PanicCall] Connection initiated');
    } catch (error: any) {
      console.error('[PanicCall] Connection error:', error);
      this.isConnected = false;
      this.connectedSubject.next(false);
      throw error;
    }
  }

  /**
   * Disconnect from Web PubSub
   */
  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        // Leave private group
        if (this.privateGroup) {
          await this.client.leaveGroup(this.privateGroup);
        }
        await this.client.stop();
        this.client = null;
      }
      this.isConnected = false;
      this.connectedSubject.next(false);
      console.log('[PanicCall] Disconnected');
    } catch (error) {
      console.error('[PanicCall] Disconnect error:', error);
    }
  }

  /**
   * Check if connected
   */
  isConnectedToPubSub(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Send incoming call notification to a specific user
   */
  async sendIncomingCall(callId: string, calleeId: string, callerName: string, mode: 'single' | 'broadcast'): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error('Not connected to Web PubSub');
    }
    
    const calleeGroup = `user:${calleeId}`;
    const message: CallSignal = {
      type: 'incoming_call',
      callId,
      fromUserId: this.userId,
      fromName: callerName,
      mode,
    };
    
    await this.client.sendToGroup(calleeGroup, message, 'json');
    console.log('[PanicCall] Sent incoming call to', calleeGroup);
  }

  /**
   * Send incoming call to all emergency contacts (broadcast)
   */
  async sendBroadcastCall(callId: string, contactIds: string[], callerName: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error('Not connected to Web PubSub');
    }
    
    const message: CallSignal = {
      type: 'incoming_call',
      callId,
      fromUserId: this.userId,
      fromName: callerName,
      mode: 'broadcast',
    };
    
    // Send to all contact private groups
    for (const contactId of contactIds) {
      const contactGroup = `user:${contactId}`;
      await this.client.sendToGroup(contactGroup, message, 'json');
      console.log('[PanicCall] Sent broadcast call to', contactGroup);
    }
  }

  /**
   * Join a call group
   */
  async joinCallGroup(callId: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error('Not connected to Web PubSub');
    }
    
    const callGroup = `call:${callId}`;
    await this.client.joinGroup(callGroup);
    console.log('[PanicCall] Joined call group:', callGroup);
  }

  /**
   * Leave a call group
   */
  async leaveCallGroup(callId: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    
    const callGroup = `call:${callId}`;
    await this.client.leaveGroup(callGroup);
    console.log('[PanicCall] Left call group:', callGroup);
  }

  /**
   * Send call accept signal
   */
  async sendCallAccept(callId: string, callerId: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error('Not connected to Web PubSub');
    }
    
    const callGroup = `call:${callId}`;
    const message: CallSignal = {
      type: 'call_accept',
      callId,
      toUserId: callerId,
      fromUserId: this.userId,
    };
    
    await this.client.sendToGroup(callGroup, message, 'json');
    console.log('[PanicCall] Sent call accept');
  }

  /**
   * Send call decline signal
   */
  async sendCallDecline(callId: string, callerId: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    
    const callerGroup = `user:${callerId}`;
    const message: CallSignal = {
      type: 'call_decline',
      callId,
      fromUserId: this.userId,
    };
    
    await this.client.sendToGroup(callerGroup, message, 'json');
    console.log('[PanicCall] Sent call decline');
  }

  /**
   * Send call cancelled signal (for broadcast - when first contact accepts)
   */
  async sendCallCancelled(callId: string, contactIds: string[]): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    
    const message: CallSignal = {
      type: 'call_cancelled',
      callId,
    };
    
    // Send to all contact private groups
    for (const contactId of contactIds) {
      const contactGroup = `user:${contactId}`;
      await this.client.sendToGroup(contactGroup, message, 'json');
    }
    console.log('[PanicCall] Sent call cancelled to', contactIds.length, 'contacts');
  }

  /**
   * Send call end signal
   */
  async sendCallEnd(callId: string, reason?: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    
    const callGroup = `call:${callId}`;
    const message: CallSignal = {
      type: 'call_end',
      callId,
      reason,
    };
    
    await this.client.sendToGroup(callGroup, message, 'json');
    console.log('[PanicCall] Sent call end');
  }

  /**
   * Send WebRTC offer
   */
  async sendWebRTCOffer(callId: string, sdp: any): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error('Not connected to Web PubSub');
    }
    
    const callGroup = `call:${callId}`;
    const message: CallSignal = {
      type: 'webrtc_offer',
      callId,
      sdp,
      fromUserId: this.userId,
    };
    
    await this.client.sendToGroup(callGroup, message, 'json');
    console.log('[PanicCall] Sent WebRTC offer');
  }

  /**
   * Send WebRTC answer
   */
  async sendWebRTCAnswer(callId: string, sdp: any): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error('Not connected to Web PubSub');
    }
    
    const callGroup = `call:${callId}`;
    const message: CallSignal = {
      type: 'webrtc_answer',
      callId,
      sdp,
      fromUserId: this.userId,
    };
    
    await this.client.sendToGroup(callGroup, message, 'json');
    console.log('[PanicCall] Sent WebRTC answer');
  }

  /**
   * Send WebRTC ICE candidate
   */
  async sendWebRTCICE(callId: string, candidate: any): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }
    
    const callGroup = `call:${callId}`;
    const message: CallSignal = {
      type: 'webrtc_ice',
      callId,
      candidate,
      fromUserId: this.userId,
    };
    
    await this.client.sendToGroup(callGroup, message, 'json');
  }

  /**
   * Handle group messages
   */
  private handleGroupMessage(e: any): void {
    try {
      const message = e.message.data as CallSignal;
      
      if (!message || !message.type) {
        return;
      }
      
      console.log('[PanicCall] Received message:', message.type);
      
      // Handle incoming call (sent to private group)
      if (message.type === 'incoming_call') {
        this.incomingCallSubject.next({
          callId: message.callId!,
          fromUserId: message.fromUserId!,
          fromName: message.fromName || 'Unknown',
          mode: message.mode || 'single',
        });
      } else {
        // Forward other signals to call signal subject
        this.callSignalSubject.next(message);
      }
    } catch (error) {
      console.error('[PanicCall] Error handling group message:', error);
    }
  }
}

