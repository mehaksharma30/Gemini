import { Injectable, inject } from '@angular/core';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';
import { DirectMessage } from '../models/dm.model';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class ChatSocketService {
  private socket: Socket | null = null;
  private messageSubject = new Subject<DirectMessage>();
  private connectedSubject = new BehaviorSubject<boolean>(false);
  private authService = inject(AuthService);

  public connected$ = this.connectedSubject.asObservable();
  public messages$ = this.messageSubject.asObservable();

  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    const token = this.authService.getToken();
    if (!token) {
      console.error('No auth token available for socket connection');
      return;
    }

    // CRITICAL: Extract base URL from apiUrl (remove /api if present)
    // Socket.IO connects to the base server URL, not /api
    const baseUrl = environment.apiUrl.replace(/\/api\/?$/, '');
    
    // CRITICAL: Explicitly configure Socket.IO to use /socket.io path
    // This ensures it doesn't conflict with /voice-gateway WebSocket endpoint
    this.socket = io(baseUrl, {
      // CRITICAL: Explicit path for Socket.IO (must match server configuration)
      path: '/socket.io',
      // CRITICAL: Use websocket transport (with polling fallback for compatibility)
      transports: ['websocket', 'polling'],
      // CRITICAL: Authentication token
      auth: {
        token,
      },
      // CRITICAL: Enable reconnection with exponential backoff
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      // CRITICAL: Timeout for connection attempts
      timeout: 20000,
      // CRITICAL: Force new connection (don't reuse existing)
      forceNew: false,
      // CRITICAL: Enable upgrade (websocket preferred, fallback to polling)
      upgrade: true,
      // CRITICAL: Don't use withCredentials unless backend requires cookies
      // (Bearer token auth doesn't need cookies)
    });

    console.log(`[ChatSocket] Connecting to Socket.IO at: ${baseUrl}/socket.io`);

    this.socket.on('connect', () => {
      console.log('[ChatSocket] ✅ Socket.IO connected');
      console.log(`[ChatSocket] Socket ID: ${this.socket?.id}`);
      console.log(`[ChatSocket] Transport: ${this.socket?.io.engine.transport.name}`);
      this.connectedSubject.next(true);
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log(`[ChatSocket] Socket.IO disconnected: ${reason}`);
      this.connectedSubject.next(false);
    });

    this.socket.on('connect_error', (error: Error) => {
      console.error('[ChatSocket] ❌ Socket.IO connection error:', error.message);
      this.connectedSubject.next(false);
    });

    this.socket.on('dm:message', (message: DirectMessage) => {
      console.log('[ChatSocket] Received DM:', message);
      this.messageSubject.next(message);
    });

    this.socket.on('dm:error', (error: { message: string }) => {
      console.error('[ChatSocket] Socket DM error:', error);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connectedSubject.next(false);
    }
  }

  sendMessage(conversationId: string, receiverId: string, content: string): void {
    if (!this.socket?.connected) {
      console.error('Socket not connected');
      return;
    }

    this.socket.emit('dm:send', {
      conversationId,
      receiverId,
      content,
    });
  }

  markAsRead(conversationId: string): void {
    if (!this.socket?.connected) {
      return;
    }

    this.socket.emit('dm:mark-read', { conversationId });
  }
}
