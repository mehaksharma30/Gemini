import { Component, inject, OnInit, ViewChild, ElementRef, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EmergencyService, EmergencyContactUser } from '../core/services/emergency.service';
import { PanicService } from '../core/services/panic.service';
import { ToastService } from '../core/services/toast.service';
import { AIPanicService, ChatMessage } from '../core/services/ai-panic.service';
import { VoiceChatService } from '../core/services/voice-chat.service';

@Component({
  selector: 'app-panic',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="panic-container">
      <div class="container">
        <h1>Panic Mode</h1>
        <p class="subtitle">Choose how you want support right now.</p>

        <div class="panic-form">
          <label>
            What are you feeling? (optional)
            <textarea
              [(ngModel)]="message"
              placeholder="Share what's on your mind..."
              rows="4"
              class="message-input"
            ></textarea>
          </label>

          <div class="mode-buttons">
            <button
              class="mode-btn ai-mode"
              (click)="triggerAI()"
              [disabled]="isTriggering"
            >
              <span class="icon">🤖</span>
              <span>Talk to AI</span>
            </button>

            <button
              class="mode-btn contact-mode"
              (click)="showContactSelection = !showContactSelection"
              [disabled]="isTriggering || contacts.length === 0"
            >
              <span class="icon">📞</span>
              <span>Alert One Contact</span>
            </button>

            <button
              class="mode-btn group-mode"
              (click)="triggerGroup()"
              [disabled]="isTriggering || contacts.length === 0"
            >
              <span class="icon">👥</span>
              <span>Alert All Contacts</span>
            </button>
          </div>

          <div class="contact-selection" *ngIf="showContactSelection && contacts.length > 0">
            <h3>Select a contact:</h3>
            <div class="contacts-list">
              <label
                *ngFor="let contact of contacts"
                class="contact-option"
                [class.selected]="selectedContactId === contact.id"
              >
                <input
                  type="radio"
                  [value]="contact.id"
                  [(ngModel)]="selectedContactId"
                  name="contact"
                />
                <span class="contact-avatar">{{ getInitials(contact.username) }}</span>
                <span class="contact-name">{{ contact.username }}</span>
              </label>
            </div>
            <button
              class="send-alert-btn"
              (click)="triggerContact()"
              [disabled]="!selectedContactId || isTriggering"
            >
              Send Alert
            </button>
          </div>

          <div class="ai-chat-panel" *ngIf="showAIChat">
            <div class="chat-header">
              <h3>AI Support Chat</h3>
              <div class="chat-header-actions">
                <button
                  class="voice-toggle-btn"
                  [class.active]="isVoiceMode"
                  (click)="toggleVoiceMode()"
                  [disabled]="isAILoading"
                  title="{{ isVoiceMode ? 'Stop Voice Chat (Click to stop)' : 'Start Voice Chat (Click to talk)' }}"
                >
                  <span *ngIf="!isVoiceMode" class="mic-icon">🎤</span>
                  <span *ngIf="isVoiceMode" class="pulse recording-icon">🔴</span>
                </button>
                <button class="close-chat-btn" (click)="closeAIChat()">×</button>
              </div>
            </div>
            <div class="chat-messages" #chatMessages>
              <div
                *ngFor="let msg of chatHistory"
                class="chat-message"
                [class.user]="msg.role === 'user'"
                [class.assistant]="msg.role === 'assistant'"
              >
                <div class="message-bubble">
                  <p>{{ msg.content }}</p>
                </div>
              </div>
              <div class="chat-message assistant" *ngIf="isAILoading && !isVoiceMode">
                <div class="message-bubble">
                  <div class="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            </div>
            <div class="chat-input-area">
              <button
                class="voice-record-btn"
                [class.active]="isVoiceMode"
                (click)="toggleVoiceMode()"
                [disabled]="isAILoading"
                title="{{ isVoiceMode ? 'Stop Voice Chat' : 'Start Voice Chat' }}"
              >
                <span *ngIf="!isVoiceMode">🎤 Voice</span>
                <span *ngIf="isVoiceMode" class="pulse">🔴 Recording...</span>
              </button>
              <textarea
                [(ngModel)]="chatInput"
                placeholder="Type your message..."
                rows="2"
                class="chat-input"
                (keydown.enter)="onChatEnter($event)"
                [disabled]="isAILoading || isVoiceMode"
              ></textarea>
              <button
                class="send-chat-btn"
                (click)="sendChatMessage()"
                [disabled]="!chatInput.trim() || isAILoading || isVoiceMode"
              >
                <svg viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2 10l15 2-15 2z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .panic-container {
      padding: 20px;
      background: var(--bg-gradient);
      color: var(--text-primary);
      min-height: 100vh;
    }
    .container {
      max-width: 700px;
      margin: 0 auto;
    }
    h1 {
      margin-bottom: 0.5rem;
      color: var(--text-primary);
    }
    .subtitle {
      color: var(--text-secondary);
      margin-bottom: 2rem;
    }
    .panic-form {
      background: var(--card-gradient);
      border: 1px solid var(--border-color);
      padding: 2rem;
      border-radius: 16px;
      box-shadow: 0 10px 40px var(--shadow-lg);
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      font-weight: 500;
    }
    .message-input {
      padding: 1rem;
      border-radius: 10px;
      border: 2px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 1rem;
      resize: vertical;
      transition: border-color 0.3s;
    }
    .message-input:focus {
      outline: none;
      border-color: var(--teal-accent);
      box-shadow: 0 0 0 3px rgba(118, 171, 174, 0.1);
    }
    .mode-buttons {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .mode-btn {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.25rem 1.5rem;
      border-radius: 12px;
      border: 2px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 1.1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .mode-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .mode-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .mode-btn.ai-mode:hover:not(:disabled) {
      border-color: var(--teal-accent);
      background: rgba(118, 171, 174, 0.1);
    }
    .mode-btn.contact-mode:hover:not(:disabled) {
      border-color: #3b82f6;
      background: rgba(59, 130, 246, 0.1);
    }
    .mode-btn.group-mode:hover:not(:disabled) {
      border-color: #8b5cf6;
      background: rgba(139, 92, 246, 0.1);
    }
    .icon {
      font-size: 1.5rem;
    }
    .contact-selection {
      margin-top: 1.5rem;
      padding: 1.5rem;
      background: var(--bg-tertiary);
      border-radius: 12px;
      border: 1px solid var(--border-color);
    }
    .contact-selection h3 {
      margin: 0 0 1rem 0;
      font-size: 1rem;
      color: var(--text-primary);
    }
    .contacts-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .contact-option {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      border-radius: 8px;
      border: 2px solid var(--border-color);
      background: var(--bg-secondary);
      cursor: pointer;
      transition: all 0.2s;
    }
    .contact-option:hover {
      border-color: var(--teal-accent);
      background: rgba(118, 171, 174, 0.1);
    }
    .contact-option.selected {
      border-color: var(--teal-accent);
      background: rgba(118, 171, 174, 0.2);
    }
    .contact-option input[type="radio"] {
      margin: 0;
    }
    .contact-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--primary-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      font-size: 0.9rem;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .contact-name {
      flex: 1;
      font-weight: 500;
      color: var(--text-primary);
    }
    .send-alert-btn {
      width: 100%;
      padding: 0.85rem;
      border-radius: 8px;
      border: none;
      background: var(--button-gradient);
      color: var(--light-gray);
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 2px 8px rgba(118, 171, 174, 0.3);
    }
    .send-alert-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(118, 171, 174, 0.4);
      background: var(--button-hover);
    }
    .send-alert-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .ai-response {
      margin-top: 1.5rem;
    }
    .response-card {
      padding: 1.5rem;
      background: rgba(118, 171, 174, 0.1);
      border: 1px solid var(--teal-accent);
      border-radius: 12px;
      color: var(--text-primary);
      line-height: 1.6;
    }
    .response-card p {
      margin: 0;
    }
    .ai-chat-panel {
      margin-top: 1.5rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      height: 500px;
      overflow: hidden;
    }
    .chat-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border-color);
      background: var(--card-gradient);
    }
    .chat-header h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary);
    }
    .chat-header-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .voice-toggle-btn {
      background: var(--button-gradient);
      border: 2px solid var(--teal-accent);
      border-radius: 50%;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.3s;
      font-size: 1.5rem;
      box-shadow: 0 2px 8px rgba(118, 171, 174, 0.3);
      position: relative;
    }
    .voice-toggle-btn:hover:not(:disabled) {
      transform: scale(1.1);
      border-color: var(--teal-accent);
      background: var(--button-hover);
      box-shadow: 0 4px 12px rgba(118, 171, 174, 0.5);
    }
    .voice-toggle-btn.active {
      border-color: var(--tiger-orange);
      background: rgba(255, 87, 34, 0.2);
      box-shadow: 0 0 20px rgba(255, 87, 34, 0.6);
    }
    .voice-toggle-btn.active::before {
      content: '';
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 2px solid var(--tiger-orange);
      animation: ripple 1.5s infinite;
    }
    .voice-toggle-btn .pulse {
      animation: pulse 1.5s infinite;
      font-size: 1.2rem;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.1); }
    }
    @keyframes ripple {
      0% { transform: scale(1); opacity: 1; }
      100% { transform: scale(1.5); opacity: 0; }
    }
    .voice-toggle-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .mic-icon, .recording-icon {
      display: block;
      line-height: 1;
    }
    .recording-icon {
      font-size: 1rem;
    }
    .voice-status {
      padding: 0.5rem 1.5rem;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
      font-size: 0.85rem;
    }
    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }
    .status-indicator::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-secondary);
    }
    .close-chat-btn {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 1.5rem;
      line-height: 1;
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: all 0.2s;
    }
    .close-chat-btn:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .chat-message {
      display: flex;
    }
    .chat-message.user {
      justify-content: flex-end;
    }
    .chat-message.assistant {
      justify-content: flex-start;
    }
    .message-bubble {
      max-width: 75%;
      padding: 0.75rem 1rem;
      border-radius: 16px;
      line-height: 1.5;
    }
    .chat-message.user .message-bubble {
      background: var(--button-gradient);
      color: var(--light-gray);
      border-bottom-right-radius: 4px;
    }
    .chat-message.assistant .message-bubble {
      background: var(--card-gradient);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
      border-bottom-left-radius: 4px;
    }
    .message-bubble p {
      margin: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .typing-indicator {
      display: flex;
      gap: 0.3rem;
      padding: 0.5rem 0;
    }
    .typing-indicator span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-secondary);
      animation: typing 1.4s infinite;
    }
    .typing-indicator span:nth-child(2) {
      animation-delay: 0.2s;
    }
    .typing-indicator span:nth-child(3) {
      animation-delay: 0.4s;
    }
    @keyframes typing {
      0%, 60%, 100% { opacity: 0.3; }
      30% { opacity: 1; }
    }
    .chat-input-area {
      display: flex;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border-color);
      background: var(--card-gradient);
      align-items: center;
    }
    .voice-record-btn {
      padding: 0.75rem 1.25rem;
      border-radius: 24px;
      border: 2px solid var(--teal-accent);
      background: var(--button-gradient);
      color: var(--light-gray);
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(118, 171, 174, 0.3);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .voice-record-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(118, 171, 174, 0.5);
      background: var(--button-hover);
    }
    .voice-record-btn.active {
      border-color: var(--tiger-orange);
      background: rgba(255, 87, 34, 0.2);
      color: var(--tiger-orange);
      box-shadow: 0 0 20px rgba(255, 87, 34, 0.6);
      animation: pulse-glow 2s infinite;
    }
    @keyframes pulse-glow {
      0%, 100% { box-shadow: 0 0 20px rgba(255, 87, 34, 0.6); }
      50% { box-shadow: 0 0 30px rgba(255, 87, 34, 0.9); }
    }
    .voice-record-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .chat-input {
      flex: 1;
      padding: 0.75rem 1rem;
      border: 1px solid var(--border-color);
      border-radius: 24px;
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 0.95rem;
      resize: none;
      transition: border-color 0.2s;
    }
    .chat-input:focus {
      outline: none;
      border-color: var(--teal-accent);
      box-shadow: 0 0 0 3px rgba(118, 171, 174, 0.1);
    }
    .chat-input:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .send-chat-btn {
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
    .send-chat-btn:hover:not(:disabled) {
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(118, 171, 174, 0.4);
      background: var(--button-hover);
    }
    .send-chat-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .send-chat-btn svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
  `]
})
export class PanicComponent implements OnInit, OnDestroy {
  @ViewChild('chatMessages') private chatMessages?: ElementRef;

  private emergencyService = inject(EmergencyService);
  private panicService = inject(PanicService);
  private toastService = inject(ToastService);
  private aiPanicService = inject(AIPanicService);
  private voiceChatService = inject(VoiceChatService);

  message = '';
  contacts: EmergencyContactUser[] = [];
  showContactSelection = false;
  selectedContactId = '';
  isTriggering = false;
  showAIChat = false;
  chatHistory: ChatMessage[] = [];
  chatInput = '';
  isAILoading = false;
  isVoiceMode = false;

  ngOnInit(): void {
    this.loadEmergencyContacts();
  }

  loadEmergencyContacts(): void {
    this.emergencyService.getEmergencyContacts().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.contacts = response.data;
        }
      },
      error: (err) => {
        console.error('Error loading emergency contacts:', err);
      },
    });
  }

  triggerAI(): void {
    if (this.isTriggering) return;

    // Open chat panel and initialize conversation
    this.showAIChat = true;
    this.chatHistory = [];
    this.chatInput = '';
    this.isTriggering = false;

    // Request initial AI message
    this.requestInitialAIMessage();
  }

  requestInitialAIMessage(): void {
    this.isAILoading = true;

    this.aiPanicService.sendMessage({
      message: 'Start',
      history: [],
    }).subscribe({
      next: (response) => {
        this.isAILoading = false;
        // Use message field (new format) or reply field (legacy)
        const aiMessage = response.message || response.reply;
        if (response.success && aiMessage) {
          this.chatHistory.push({
            role: 'assistant',
            content: aiMessage,
          });
          setTimeout(() => this.scrollToBottom(), 100);
        } else {
          this.toastService.show(aiMessage || 'Failed to get AI response', 'error');
        }
      },
      error: (err) => {
        this.isAILoading = false;
        console.error('Error getting AI response:', err);
        this.toastService.show(err.error?.message || 'Failed to connect to AI. Please try again.', 'error');
      },
    });
  }

  sendChatMessage(): void {
    if (!this.chatInput.trim() || this.isAILoading) return;

    const userMessage = this.chatInput.trim();
    this.chatInput = '';

    // Add user message to history
    this.chatHistory.push({
      role: 'user',
      content: userMessage,
    });

    setTimeout(() => this.scrollToBottom(), 100);

    // Send to AI
    this.isAILoading = true;

    this.aiPanicService.sendMessage({
      message: userMessage,
      history: this.chatHistory.slice(0, -1), // Exclude the message we just added
    }).subscribe({
      next: (response) => {
        this.isAILoading = false;
        // Use message field (new format) or reply field (legacy)
        const aiMessage = response.message || response.reply;
        if (response.success && aiMessage) {
          this.chatHistory.push({
            role: 'assistant',
            content: aiMessage,
          });
          setTimeout(() => this.scrollToBottom(), 100);
        } else {
          this.toastService.show(aiMessage || 'Failed to get AI response', 'error');
        }
      },
      error: (err) => {
        this.isAILoading = false;
        console.error('Error getting AI response:', err);
        this.toastService.show(err.error?.message || 'Failed to send message. Please try again.', 'error');
      },
    });
  }

  onChatEnter(event: Event): void {
    const keyEvent = event as KeyboardEvent;
    if (!keyEvent.shiftKey) {
      event.preventDefault();
      this.sendChatMessage();
    }
  }

  closeAIChat(): void {
    if (this.isVoiceMode) {
      this.stopVoiceChat();
    }
    this.showAIChat = false;
    this.chatHistory = [];
    this.chatInput = '';
  }

  toggleVoiceMode(): void {
    if (this.isVoiceMode) {
      this.stopVoiceChat();
    } else {
      this.startVoiceChat();
    }
  }

  async startVoiceChat(): Promise<void> {
    try {
      this.isVoiceMode = true;
      const result = await this.voiceChatService.startVoice();
      
      if (result) {
        // Add user text to chat
        this.chatHistory.push({
          role: 'user',
          content: result.userText,
        });
        
        // Add AI response to chat
        this.chatHistory.push({
          role: 'assistant',
          content: result.aiText,
        });
        
        setTimeout(() => this.scrollToBottom(), 100);
      }
      
      this.isVoiceMode = false;
    } catch (error: any) {
      console.error('Error starting voice chat:', error);
      this.toastService.show(error.message || 'Failed to start voice chat', 'error');
      this.isVoiceMode = false;
    }
  }

  stopVoiceChat(): void {
    this.voiceChatService.stop();
    this.isVoiceMode = false;
  }

  ngOnDestroy(): void {
    if (this.isVoiceMode) {
      this.stopVoiceChat();
    }
  }

  scrollToBottom(): void {
    try {
      const element = this.chatMessages?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    } catch (err) {
      console.error('Scroll error:', err);
    }
  }

  triggerContact(): void {
    if (this.isTriggering || !this.selectedContactId) return;

    const contact = this.contacts.find(c => c.id === this.selectedContactId);
    if (!contact) return;

    this.isTriggering = true;

    this.panicService.triggerPanic({
      mode: 'CONTACT',
      message: this.message.trim() || undefined,
      targetUserId: this.selectedContactId,
    }).subscribe({
      next: (response) => {
        this.isTriggering = false;
        if (response.success) {
          this.toastService.show(`Alert sent to ${contact.username}.`, 'success');
          this.showContactSelection = false;
          this.selectedContactId = '';
          this.message = '';
        }
      },
      error: (err) => {
        this.isTriggering = false;
        console.error('Error triggering contact mode:', err);
        this.toastService.show(err.error?.message || 'Failed to send alert. Please try again.', 'error');
      },
    });
  }

  triggerGroup(): void {
    if (this.isTriggering || this.contacts.length === 0) return;

    this.isTriggering = true;

    this.panicService.triggerPanic({
      mode: 'GROUP',
      message: this.message.trim() || undefined,
    }).subscribe({
      next: (response) => {
        this.isTriggering = false;
        if (response.success) {
          this.toastService.show('Alert sent to your emergency contacts.', 'success');
          this.message = '';
        }
      },
      error: (err) => {
        this.isTriggering = false;
        console.error('Error triggering group mode:', err);
        this.toastService.show(err.error?.message || 'Failed to send alerts. Please try again.', 'error');
      },
    });
  }

  getInitials(username: string): string {
    if (!username) return '?';
    const parts = username.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return username.substring(0, 2).toUpperCase();
  }
}

