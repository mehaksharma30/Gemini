import { Component, OnInit, OnDestroy, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DMService } from '../core/services/dm.service';
import { ChatSocketService } from '../core/services/chat-socket.service';
import { AuthService } from '../core/services/auth.service';
import { ChatRatingService } from '../core/services/chat-rating.service';
import { EmergencyService } from '../core/services/emergency.service';
import { ToastService } from '../core/services/toast.service';
import { EmergencyContactModalComponent } from './emergency-contact-modal.component';
import { ConversationListItem, DirectMessage } from '../core/models/dm.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-messages-widget',
  standalone: true,
  imports: [CommonModule, FormsModule, EmergencyContactModalComponent],
  template: `
    <!-- Floating Message Button -->
    <button *ngIf="!isOpen" class="messages-fab" (click)="toggleOpen()" title="Messages">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="messages-label">💬</span>
    </button>

    <!-- Slide-up Message Panel -->
    <div *ngIf="isOpen" class="messages-panel">
      <header class="messages-header">
        <h3>Messages</h3>
        <button class="close-btn" (click)="toggleOpen()">
          <svg viewBox="0 0 24 24">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </header>

      <div class="conversations-list" #conversationsList>
        <div 
          *ngFor="let conv of conversations"
          class="conversation-item"
          [class.active]="selectedConversationId === conv.conversationId"
          (click)="openFullChat(conv)"
        >
          <div class="conv-avatar">{{ getInitials(conv.otherParticipant.username) }}</div>
          <div class="conv-info">
            <div class="conv-header">
              <span class="conv-username">{{ conv.otherParticipant.username }}</span>
              <span class="conv-time" *ngIf="conv.lastMessageAt">{{ getTimeAgo(conv.lastMessageAt) }}</span>
            </div>
            <p class="conv-last-message">{{ conv.lastMessage || 'No messages yet' }}</p>
          </div>
          <span class="unread-badge" *ngIf="conv.unreadCount > 0">{{ conv.unreadCount }}</span>
        </div>

        <div class="empty-conversations" *ngIf="conversations.length === 0">
          <p>No conversations yet</p>
          <small>Start a conversation by visiting someone's profile!</small>
        </div>
      </div>
    </div>

    <app-emergency-contact-modal
      [isOpen]="showEmergencyModal"
      [username]="emergencyModalUsername"
      (confirmed)="onEmergencyModalConfirmed($event)"
      (closed)="showEmergencyModal = false"
    />
  `,
  styles: [`
    .messages-fab {
      position: fixed;
      bottom: 1.5rem;
      left: 1.5rem;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      border: 2px solid var(--c-accent);
      background: var(--c-bg-1);
      color: var(--c-accent);
      box-shadow: 0 4px 16px rgba(0, 255, 136, 0.3);
      cursor: pointer;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      transition: all 0.3s ease;
    }

    .messages-fab:hover {
      background: var(--c-accent);
      color: var(--c-bg-1);
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(0, 255, 136, 0.5);
    }

    .messages-fab .icon {
      width: 28px;
      height: 28px;
      stroke: currentColor;
    }

    .messages-label {
      font-size: 0.7rem;
      font-weight: 700;
    }

    .messages-panel {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 70vh;
      max-height: 600px;
      background: var(--card-gradient);
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -8px 32px var(--shadow-lg);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 1001;
      border: 1px solid var(--border-color);
      animation: slideUp 0.3s ease-out;
    }

    @keyframes slideUp {
      from {
        transform: translateY(100%);
      }
      to {
        transform: translateY(0);
      }
    }

    .messages-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.25rem;
      background: var(--primary-gradient);
      color: var(--c-text);
      border-bottom: 1px solid var(--border-color);
    }

    .messages-header h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }

    .close-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid var(--c-accent);
      background: var(--c-bg-1);
      color: var(--c-accent);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
    }

    .close-btn:hover {
      background: var(--c-accent);
      color: var(--c-bg-1);
      transform: rotate(90deg);
    }

    .close-btn svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }

    .conversations-list {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem;
      background: var(--bg-gradient);
    }

    .conversation-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem;
      cursor: pointer;
      border-radius: 12px;
      transition: background 0.2s;
      margin-bottom: 0.5rem;
    }

    .conversation-item:hover {
      background: var(--bg-tertiary);
    }

    .conversation-item.active {
      background: rgba(0, 255, 136, 0.1);
      border-left: 3px solid var(--c-accent);
    }

    .conv-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--primary-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      font-size: 1.1rem;
      text-transform: uppercase;
      flex-shrink: 0;
    }

    .conv-info {
      flex: 1;
      min-width: 0;
    }

    .conv-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.25rem;
    }

    .conv-username {
      font-weight: 600;
      color: var(--text-primary);
      font-size: 0.95rem;
    }

    .conv-time {
      font-size: 0.75rem;
      color: var(--text-secondary);
    }

    .conv-last-message {
      margin: 0;
      font-size: 0.9rem;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .unread-badge {
      background: var(--c-accent);
      color: white;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
      border-radius: 12px;
      min-width: 20px;
      text-align: center;
    }

    .empty-conversations {
      padding: 3rem 1.5rem;
      text-align: center;
      color: var(--text-secondary);
    }

    .empty-conversations small {
      display: block;
      margin-top: 0.5rem;
      font-size: 0.85rem;
    }

    @media (max-width: 768px) {
      .messages-panel {
        height: 80vh;
        max-height: 80vh;
      }

      .messages-fab {
        bottom: 1rem;
        left: 1rem;
        width: 56px;
        height: 56px;
      }
    }
  `]
})
export class MessagesWidgetComponent implements OnInit, OnDestroy {
  private dmService = inject(DMService);
  private socketService = inject(ChatSocketService);
  private authService = inject(AuthService);
  private ratingService = inject(ChatRatingService);
  private emergencyService = inject(EmergencyService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  @ViewChild('conversationsList') private conversationsList!: ElementRef;

  isOpen = false;
  conversations: ConversationListItem[] = [];
  selectedConversationId = '';
  showEmergencyModal = false;
  emergencyModalUsername = '';

  private messageSubscription?: Subscription;

  get currentUserId(): string {
    return this.authService.currentUser()?.id || '';
  }

  ngOnInit(): void {
    this.socketService.connect();

    this.messageSubscription = this.socketService.messages$.subscribe((message) => {
      this.handleIncomingMessage(message);
    });

    this.loadConversations();
  }

  ngOnDestroy(): void {
    this.messageSubscription?.unsubscribe();
  }

  toggleOpen(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.loadConversations();
    }
  }

  loadConversations(): void {
    this.dmService.getConversations().subscribe({
      next: (response) => {
        this.conversations = response.data;
      },
      error: (err) => {
        console.error('Failed to load conversations:', err);
      },
    });
  }

  openFullChat(conv: ConversationListItem): void {
    // Navigate to full messages page with the conversation
    this.router.navigate(['/messages'], { queryParams: { conversationId: conv.conversationId } });
    this.toggleOpen();
  }

  handleIncomingMessage(message: DirectMessage): void {
    const conv = this.conversations.find(c => c.conversationId === message.conversationId);
    if (conv) {
      conv.lastMessage = message.content.substring(0, 100);
      conv.lastMessageAt = message.createdAt;

      if (message.conversationId !== this.selectedConversationId && message.senderId !== this.currentUserId) {
        conv.unreadCount = (conv.unreadCount || 0) + 1;
      }

      this.conversations = [
        conv,
        ...this.conversations.filter(c => c.conversationId !== conv.conversationId)
      ];
    }
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  getTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  onEmergencyModalConfirmed(confirmed: boolean): void {
    this.showEmergencyModal = false;
    // Emergency contact logic handled in full messages component
  }
}

