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

    // Use apiBaseUrl directly (already doesn't include /api)
    const baseUrl = environment.apiBaseUrl;
    this.socket = io(baseUrl, {
      auth: {
        token,
      },
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      console.log('Socket.IO connected');
      this.connectedSubject.next(true);
    });

    this.socket.on('disconnect', () => {
      console.log('Socket.IO disconnected');
      this.connectedSubject.next(false);
    });

    this.socket.on('dm:message', (message: DirectMessage) => {
      console.log('Received DM:', message);
      this.messageSubject.next(message);
    });

    this.socket.on('dm:error', (error: { message: string }) => {
      console.error('Socket DM error:', error);
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
