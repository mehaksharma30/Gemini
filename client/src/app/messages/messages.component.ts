import { Component, OnInit, OnDestroy, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DMService } from '../core/services/dm.service';
import { ChatSocketService } from '../core/services/chat-socket.service';
import { AuthService } from '../core/services/auth.service';
import { ChatRatingService } from '../core/services/chat-rating.service';
import { EmergencyService } from '../core/services/emergency.service';
import { ToastService } from '../core/services/toast.service';
import { EmergencyContactModalComponent } from './emergency-contact-modal.component';
import { DirectMessage, ConversationListItem } from '../core/models/dm.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-messages',
  standalone: true,
  imports: [CommonModule, FormsModule, EmergencyContactModalComponent],
  template: `
    <div class="messages-container">
      
      <aside class="conversations-sidebar">
        <div class="sidebar-header">
          <h2>Messages</h2>
        </div>

        <div class="conversations-list">
          <div 
            *ngFor="let conv of conversations"
            class="conversation-item"
            [class.active]="selectedConversationId === conv.conversationId"
            (click)="selectConversation(conv)"
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
      </aside>

      
      <main class="chat-main">
        <div *ngIf="!selectedConversation" class="no-conversation-selected">
          <svg class="empty-icon" viewBox="0 0 24 24">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
          <h3>Select a conversation</h3>
          <p>Choose a conversation from the list to start messaging</p>
        </div>

        <div *ngIf="selectedConversation" class="chat-active">
          
          <header class="chat-header">
            <div class="chat-avatar">{{ getInitials(selectedConversation.otherParticipant.username) }}</div>
            <div class="chat-user-info">
              <h3>{{ selectedConversation.otherParticipant.username }}</h3>
            </div>
          </header>

          
          <div class="rating-bar">
            <span class="rating-prompt">Was this person helpful?</span>
            <div class="rating-buttons">
              <button
                *ngIf="currentRating !== 'helpful'"
                class="rating-btn helpful"
                [disabled]="currentRating !== null"
                (click)="rateHelpful()"
              >
                👍 Helpful
              </button>
              <button
                *ngIf="currentRating === 'helpful'"
                class="rating-btn helpful undo"
                (click)="undoHelpful()"
              >
                👍 Helpful ✓
              </button>
              <button
                *ngIf="currentRating !== 'helpful'"
                class="rating-btn not-helpful"
                [class.selected]="currentRating === 'not_helpful'"
                [disabled]="currentRating !== null"
                (click)="rateNotHelpful()"
              >
                👎 Not helpful
              </button>
            </div>
            <span class="rating-feedback" *ngIf="ratingFeedback">{{ ratingFeedback }}</span>
          </div>

          
          <div class="messages-area" #messagesContainer>
            <div class="messages-list">
              <div 
                *ngFor="let message of messages"
                class="message-wrapper"
                [class.own]="message.senderId === currentUserId"
                [class.other]="message.senderId !== currentUserId"
              >
                <div class="message-bubble">
                  <p class="message-content">{{ message.content }}</p>
                  <span class="message-time">{{ getMessageTime(message.createdAt) }}</span>
                </div>
              </div>

              <div class="no-messages" *ngIf="messages.length === 0">
                <p>No messages yet. Say hello! 👋</p>
              </div>
            </div>
          </div>

          
          <footer class="chat-input-area">
            <textarea
              [(ngModel)]="messageContent"
              placeholder="Type a message..."
              class="message-input"
              rows="1"
              maxlength="2000"
              (keydown.enter)="onEnter($event)"
            ></textarea>
            <button 
              class="send-btn"
              (click)="sendMessage()"
              [disabled]="!messageContent.trim() || isSending"
            >
              <svg class="icon" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </footer>
        </div>
      </main>

      <app-emergency-contact-modal
        [isOpen]="showEmergencyModal"
        [username]="emergencyModalUsername"
        (confirmed)="onEmergencyModalConfirmed($event)"
        (closed)="showEmergencyModal = false"
      />
    </div>
  `,
  styles: [`
    .messages-container {
      display: grid;
      grid-template-columns: 350px 1fr;
      height: calc(100vh - 60px);
      background: var(--bg-gradient);
    }

    .conversations-sidebar {
      background: var(--card-gradient);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .sidebar-header {
      padding: 1.5rem;
      border-bottom: 1px solid var(--border-color);
    }

    .sidebar-header h2 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);
    }

    .conversations-list {
      flex: 1;
      overflow-y: auto;
    }

    .conversation-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem 1.5rem;
      cursor: pointer;
      border-bottom: 1px solid var(--border-color);
      transition: background 0.2s;
      position: relative;
    }

    .conversation-item:hover {
      background: var(--bg-tertiary);
    }

    .conversation-item.active {
      background: rgba(118, 171, 174, 0.2);
      border-left: 3px solid var(--teal-accent);
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
      position: absolute;
      top: 50%;
      right: 1rem;
      transform: translateY(-50%);
      background: var(--tiger-orange);
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

    .chat-main {
      display: flex;
      flex-direction: column;
      background: var(--bg-gradient);
      overflow: hidden;
    }

    .no-conversation-selected {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      color: var(--text-secondary);
    }

    .empty-icon {
      width: 80px;
      height: 80px;
      fill: var(--text-muted);
      opacity: 0.3;
    }

    .no-conversation-selected h3 {
      margin: 0;
      color: var(--text-primary);
    }

    .chat-active {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .chat-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem 1.5rem;
      background: var(--card-gradient);
      border-bottom: 1px solid var(--border-color);
    }

    .chat-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--primary-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      font-size: 1rem;
      text-transform: uppercase;
    }

    .chat-user-info h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .rating-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1.5rem;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
    }

    .rating-prompt {
      font-size: 0.9rem;
      color: var(--text-secondary);
      font-weight: 500;
    }

    .rating-buttons {
      display: flex;
      gap: 0.75rem;
    }

    .rating-btn {
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .rating-btn:hover:not(:disabled) {
      border-color: var(--teal-accent);
      background: rgba(118, 171, 174, 0.2);
      transform: translateY(-1px);
    }

    .rating-btn.helpful.selected {
      background: rgba(132, 169, 140, 0.2);
      border-color: var(--success-color);
      color: var(--success-color);
    }

    .rating-btn.not-helpful.selected {
      background: rgba(192, 85, 85, 0.1);
      border-color: var(--error-color);
      color: var(--error-color);
    }

    .rating-btn:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }

    .rating-btn.undo {
      background: rgba(132, 169, 140, 0.2);
      border-color: var(--success-color);
      color: var(--success-color);
      cursor: pointer;
    }

    .rating-btn.undo:hover {
      background: rgba(132, 169, 140, 0.3);
      transform: translateY(-1px);
    }

    .rating-feedback {
      font-size: 0.85rem;
      color: var(--success-color);
      font-weight: 500;
    }

    .messages-area {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
      background: var(--bg-gradient);
    }

    .messages-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .message-wrapper {
      display: flex;
    }

    .message-wrapper.own {
      justify-content: flex-end;
    }

    .message-wrapper.other {
      justify-content: flex-start;
    }

    .message-bubble {
      max-width: 70%;
      padding: 0.75rem 1rem;
      border-radius: 16px;
      position: relative;
    }

    .message-wrapper.own .message-bubble {
      background: var(--button-gradient);
      color: var(--light-gray);
      border-bottom-right-radius: 4px;
      box-shadow: 0 2px 8px rgba(118, 171, 174, 0.2);
    }

    .message-wrapper.other .message-bubble {
      background: var(--card-gradient);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
      border-bottom-left-radius: 4px;
    }

    .message-content {
      margin: 0 0 0.25rem 0;
      word-wrap: break-word;
      white-space: pre-wrap;
      line-height: 1.5;
    }

    .message-time {
      font-size: 0.7rem;
      opacity: 0.8;
    }

    .message-wrapper.own .message-time {
      color: rgba(255, 255, 255, 0.9);
    }

    .message-wrapper.other .message-time {
      color: var(--text-secondary);
    }

    .no-messages {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-secondary);
    }

    .chat-input-area {
      display: flex;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
      background: var(--card-gradient);
      border-top: 1px solid var(--border-color);
    }

    .message-input {
      flex: 1;
      padding: 0.75rem 1rem;
      border: 1px solid var(--border-color);
      border-radius: 24px;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 0.95rem;
      resize: none;
      max-height: 120px;
      transition: border-color 0.2s;
    }

    .message-input:focus {
      outline: none;
      border-color: var(--teal-accent);
      box-shadow: 0 0 0 3px rgba(118, 171, 174, 0.1);
    }

    .send-btn {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: none;
      background: var(--button-gradient);
      color: var(--light-gray);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(118, 171, 174, 0.3);
    }

    .send-btn:hover:not(:disabled) {
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(118, 171, 174, 0.4);
      background: var(--button-hover);
    }

    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .send-btn .icon {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }

    .spinner {
      width: 30px;
      height: 30px;
      border: 3px solid var(--border-color);
      border-top-color: var(--teal-accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 768px) {
      .messages-container {
        grid-template-columns: 1fr;
      }

      .conversations-sidebar {
        display: none;
      }

      .conversations-sidebar.mobile-show {
        display: flex;
      }

      .message-bubble {
        max-width: 85%;
      }
    }
  `]
})
export class MessagesComponent implements OnInit, OnDestroy {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dmService = inject(DMService);
  private socketService = inject(ChatSocketService);
  private authService = inject(AuthService);
  private ratingService = inject(ChatRatingService);
  private emergencyService = inject(EmergencyService);
  private toastService = inject(ToastService);

  conversations: ConversationListItem[] = [];
  messages: DirectMessage[] = [];
  selectedConversation: ConversationListItem | null = null;
  selectedConversationId = '';
  messageContent = '';
  isSending = false;
  currentRating: 'helpful' | 'not_helpful' | null = null;
  ratingFeedback = '';
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

    const targetUserId = this.route.snapshot.paramMap.get('userId');
    if (targetUserId) {
      this.openConversationWithUser(targetUserId);
    }

    // Check for conversationId in query params (from widget)
    const conversationId = this.route.snapshot.queryParams['conversationId'];
    if (conversationId) {
      const conv = this.conversations.find(c => c.conversationId === conversationId);
      if (conv) {
        this.selectConversation(conv);
      }
    }
  }

  ngOnDestroy(): void {
    this.messageSubscription?.unsubscribe();
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

  openConversationWithUser(userId: string): void {
    this.dmService.getOrCreateConversation(userId).subscribe({
      next: (response) => {
        const conv: ConversationListItem = {
          conversationId: response.data.conversationId,
          otherParticipant: response.data.otherParticipant,
          unreadCount: 0,
        };

        const exists = this.conversations.find(c => c.conversationId === conv.conversationId);
        if (!exists) {
          this.conversations.unshift(conv);
        }

        this.selectConversation(exists || conv);
      },
      error: (err) => {
        console.error('Failed to open conversation:', err);
      },
    });
  }

  selectConversation(conv: ConversationListItem): void {
    this.selectedConversation = conv;
    this.selectedConversationId = conv.conversationId;
    this.currentRating = null;
    this.ratingFeedback = '';

    this.loadMessages(conv.conversationId);
    this.loadRatingStatus(conv.conversationId, conv.otherParticipant.id);

    this.socketService.markAsRead(conv.conversationId);

    conv.unreadCount = 0;
  }

  loadMessages(conversationId: string): void {
    this.dmService.getMessages(conversationId).subscribe({
      next: (response) => {
        this.messages = response.data;
        setTimeout(() => this.scrollToBottom(), 100);
      },
      error: (err) => {
        console.error('Failed to load messages:', err);
      },
    });
  }

  sendMessage(): void {
    if (!this.messageContent.trim() || this.isSending || !this.selectedConversation) {
      return;
    }

    this.isSending = true;

    this.socketService.sendMessage(
      this.selectedConversation.conversationId,
      this.selectedConversation.otherParticipant.id,
      this.messageContent.trim()
    );

    this.messageContent = '';
    this.isSending = false;
  }

  handleIncomingMessage(message: DirectMessage): void {

    if (message.conversationId === this.selectedConversationId) {

      const exists = this.messages.find(m => m._id === message._id);
      if (!exists) {
        this.messages.push(message);
        setTimeout(() => this.scrollToBottom(), 100);
      }
    }

    const conv = this.conversations.find(c => c.conversationId === message.conversationId);
    if (conv) {
      conv.lastMessage = message.content.substring(0, 100);
      conv.lastMessageAt = message.createdAt;

      if (message.conversationId !== this.selectedConversationId && message.senderId !== this.currentUserId) {
        conv.unreadCount += 1;
      }

      this.conversations = [
        conv,
        ...this.conversations.filter(c => c.conversationId !== conv.conversationId)
      ];
    }
  }

  scrollToBottom(): void {
    try {
      const element = this.messagesContainer?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    } catch (err) {
      console.error('Scroll error:', err);
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

  getMessageTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  onEnter(event: Event): void {
    const keyEvent = event as KeyboardEvent;
    if (!keyEvent.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  loadRatingStatus(conversationId: string, ratedUserId: string): void {
    this.ratingService.getRatingStatus(conversationId, ratedUserId).subscribe({
      next: (response) => {
        this.currentRating = response.data.rating;
      },
      error: (err) => {
        console.error('Failed to load rating status:', err);
      },
    });
  }

  rateHelpful(): void {
    if (!this.selectedConversation || this.currentRating) return;

    // Always perform the helpful action first
    this.ratingService.rateUser(
      this.selectedConversation.conversationId,
      this.selectedConversation.otherParticipant.id,
      'helpful'
    ).subscribe({
      next: () => {
        this.currentRating = 'helpful';
        this.ratingFeedback = `Thanks! You helped ${this.selectedConversation!.otherParticipant.username} grow their MindMemos level 🌟`;
        setTimeout(() => this.ratingFeedback = '', 5000);

        // Show modal AFTER helpful action succeeds
        this.emergencyModalUsername = this.selectedConversation!.otherParticipant.username;
        this.showEmergencyModal = true;
      },
      error: (err) => {
        console.error('Failed to submit rating:', err);
        this.ratingFeedback = 'Failed to submit rating';
      },
    });
  }

  onEmergencyModalConfirmed(confirmed: boolean): void {
    this.showEmergencyModal = false;

    if (confirmed && this.selectedConversation) {
      this.addToEmergencyContacts(this.selectedConversation.otherParticipant.id);
    }
  }

  undoHelpful(): void {
    if (!this.selectedConversation || this.currentRating !== 'helpful') return;

    this.ratingService.deleteRating(this.selectedConversation.conversationId).subscribe({
      next: () => {
        this.currentRating = null;
        this.ratingFeedback = 'Helpful rating removed';
        setTimeout(() => this.ratingFeedback = '', 3000);
      },
      error: (err) => {
        console.error('Failed to remove rating:', err);
        this.ratingFeedback = 'Failed to remove rating';
      },
    });
  }

  addToEmergencyContacts(contactUserId: string): void {
    this.emergencyService.addEmergencyContact(contactUserId).subscribe({
      next: (response) => {
        if (response.success) {
          this.toastService.show('Added to Emergency Contacts.', 'success');
        } else {
          this.toastService.show(response.message || 'Failed to add emergency contact', 'error');
        }
      },
      error: (err) => {
        console.error('Failed to add emergency contact:', err);
        const errorMessage = err.error?.message || 'Failed to add emergency contact';
        
        if (errorMessage.includes('Maximum 3') || errorMessage.includes('limit')) {
          this.toastService.show('You can only have 3 emergency contacts. Remove one to add another.', 'error');
        } else if (errorMessage.includes('already')) {
          this.toastService.show('This user is already in your emergency contacts.', 'error');
        } else {
          this.toastService.show(errorMessage, 'error');
        }
      },
    });
  }

  rateNotHelpful(): void {
    if (!this.selectedConversation || this.currentRating) return;

    this.ratingService.rateUser(
      this.selectedConversation.conversationId,
      this.selectedConversation.otherParticipant.id,
      'not_helpful'
    ).subscribe({
      next: () => {
        this.currentRating = 'not_helpful';
        this.ratingFeedback = 'Thanks for your feedback';
        setTimeout(() => this.ratingFeedback = '', 5000);
      },
      error: (err) => {
        console.error('Failed to submit rating:', err);
        this.ratingFeedback = 'Failed to submit rating';
      },
    });
  }
}
