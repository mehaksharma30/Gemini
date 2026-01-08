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
    
    // Socket.IO configuration - prioritize WebSocket first
    this.socket = io(baseUrl, {
      // CRITICAL: Explicit path for Socket.IO (must match server configuration)
      path: '/socket.io',
      // CRITICAL: Use websocket transport (with polling fallback for compatibility)
      transports: ['websocket', 'polling'],
      // CRITICAL: Authentication token
      auth: {
        token,
      },
      transports: ['websocket', 'polling'], // CRITICAL: Try WebSocket first, fallback to polling
      upgrade: true,
      rememberUpgrade: true, // Remember successful WebSocket upgrade for future connections
      // Azure Web Apps require longer timeouts for WebSocket upgrades
      timeout: 20000, // 20 seconds (default is 20s, but explicit for Azure)
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      forceNew: false,
      // Disable compression to avoid frame header issues on Azure
      // perMessageDeflate is not a valid Socket.IO client option - removed
      // Force WebSocket connection (if available)
      forceBase64: false, // Use binary WebSocket frames (not base64)
    });

    console.log(`[ChatSocket] Connecting to Socket.IO at: ${baseUrl}/socket.io`);

    this.socket.on('connect', () => {
      console.log('[ChatSocket] ✅ Socket.IO connected successfully');
      console.log('[ChatSocket] Transport:', this.socket?.io.engine.transport.name);
      this.connectedSubject.next(true);
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log('[ChatSocket] ⚠️ Socket.IO disconnected:', reason);
      this.connectedSubject.next(false);
    });

    // Handle connection errors (including "Invalid frame header")
    this.socket.on('connect_error', (error: Error) => {
      console.error('[ChatSocket] ❌ Connection error:', error.message);
      console.error('[ChatSocket] Error details:', {
        message: error.message,
        type: error.constructor.name,
        stack: error.stack,
      });
      
      // If it's a frame header error, log Azure-specific guidance
      if (error.message.includes('frame header') || error.message.includes('Invalid')) {
        console.warn('[ChatSocket] ⚠️ This may be an Azure Web Apps WebSocket issue.');
        console.warn('[ChatSocket] ⚠️ Ensure WebSocket is enabled in Azure App Service configuration.');
      }
    });

    // Note: Transport upgrade logging removed - 'upgrade' event not available in Socket.IO client API
    // Transport will automatically upgrade from polling to websocket when available

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
