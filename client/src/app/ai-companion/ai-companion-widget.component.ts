import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AIChatService, RecommendedPost } from '../core/services/ai-chat.service';

interface ChatMessage {
  from: 'user' | 'ai';
  text: string;
  recommendations?: RecommendedPost[];
}

@Component({
  selector: 'app-ai-companion-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    
    <button *ngIf="!isOpen" class="ai-fab" (click)="toggleOpen()" title="AI Companion">
      <svg class="icon" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <span class="ai-label">AI</span>
    </button>

    
    <div *ngIf="isOpen" class="ai-panel">
      
      <header class="ai-header">
        <div class="ai-title">
          <svg class="icon" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <div>
            <h3>MindMemos AI Companion</h3>
            <p class="ai-subtitle">Peer support assistant</p>
          </div>
        </div>
        <button class="close-btn" (click)="toggleOpen()">
          <svg viewBox="0 0 24 24">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </header>

      
      <div class="ai-disclaimer">
        ⚠️ Not a substitute for professional mental health care
      </div>

      
      <div class="ai-messages" #messagesContainer>
        <div class="welcome-message" *ngIf="messages.length === 0">
          <p>👋 Hi! I'm your AI companion. I can help you:</p>
          <ul>
            <li>Process your feelings</li>
            <li>Find similar experiences from others</li>
            <li>Suggest coping strategies</li>
          </ul>
          <p><strong>Try asking:</strong> "I'm feeling anxious about exams"</p>
        </div>

        <div *ngFor="let msg of messages" class="ai-message" [class.user]="msg.from === 'user'" [class.ai]="msg.from === 'ai'">
          <div class="message-bubble">
            <p class="message-text">{{ msg.text }}</p>
          </div>

          
          <div *ngIf="msg.from === 'ai' && msg.recommendations && msg.recommendations.length > 0" class="ai-recommendations">
            <p class="rec-header">💡 Similar experiences from the community:</p>
            <div class="rec-list">
              <div *ngFor="let rec of msg.recommendations" class="rec-item" (click)="goToProfile(rec.authorId)">
                <div class="rec-content">
                  <strong>{{ rec.authorName }}</strong>
                  <span class="rec-title">{{ rec.title }}</span>
                </div>
                <div class="rec-tags" *ngIf="rec.tags.length > 0">
                  <span *ngFor="let tag of rec.tags.slice(0, 3)" class="tag">#{{ tag }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        
        <div *ngIf="isTyping" class="ai-message ai">
          <div class="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>

      
      <footer class="ai-input-area">
        <textarea
          [(ngModel)]="userInput"
          placeholder="Ask me anything..."
          class="ai-input"
          rows="2"
          maxlength="500"
          (keydown.enter)="onEnter($event)"
          [disabled]="isTyping"
        ></textarea>
        <button 
          class="send-btn"
          (click)="sendMessage()"
          [disabled]="!userInput.trim() || isTyping"
        >
          <svg viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </footer>
    </div>
  `,
  styles: [`
    .ai-fab {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
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

    .ai-fab:hover {
      background: var(--c-accent);
      color: var(--c-bg-1);
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(0, 255, 136, 0.5);
    }

    .ai-fab .icon {
      width: 28px;
      height: 28px;
      fill: currentColor;
    }

    .ai-label {
      font-size: 0.7rem;
      font-weight: 700;
    }

    .ai-panel {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      width: 380px;
      max-height: 70vh;
      background: var(--card-gradient);
      border-radius: 16px;
      box-shadow: 0 8px 32px var(--shadow-lg);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 1001;
      border: 1px solid var(--border-color);
      backdrop-filter: blur(10px);
    }

    .ai-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 1rem 1.25rem;
      background: var(--primary-gradient);
      color: var(--light-gray);
    }

    .ai-title {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }

    .ai-title .icon {
      width: 32px;
      height: 32px;
      fill: currentColor;
      flex-shrink: 0;
    }

    .ai-title h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }

    .ai-subtitle {
      margin: 0;
      font-size: 0.8rem;
      opacity: 0.9;
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

    .ai-disclaimer {
      padding: 0.75rem 1.25rem;
      background: var(--warning-bg);
      color: var(--warning-text);
      font-size: 0.85rem;
      text-align: center;
      border-bottom: 1px solid var(--warning-border);
    }

    .ai-messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 1.25rem;
      background: var(--bg-gradient);
    }

    .welcome-message {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .welcome-message p {
      margin: 0 0 0.75rem 0;
    }

    .welcome-message ul {
      margin: 0 0 1rem 0;
      padding-left: 1.5rem;
    }

    .welcome-message li {
      margin-bottom: 0.25rem;
    }

    .ai-message {
      margin-bottom: 1rem;
    }

    .message-bubble {
      padding: 0.75rem 1rem;
      border-radius: 16px;
      max-width: 85%;
    }

    .ai-message.user .message-bubble {
      background: var(--c-bg-1);
      border: 2px solid var(--c-accent);
      color: var(--c-accent);
      margin-left: auto;
      border-bottom-right-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 255, 136, 0.2);
    }

    .ai-message.ai .message-bubble {
      background: var(--c-bg-1);
      color: var(--text-primary);
      border: 1px solid var(--c-accent);
      border-bottom-left-radius: 4px;
    }

    .message-text {
      margin: 0;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .typing-indicator {
      display: flex;
      gap: 0.3rem;
      padding: 0.75rem 1rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      width: fit-content;
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

    .ai-recommendations {
      margin-top: 0.75rem;
      padding: 0.75rem;
      background: rgba(0, 255, 136, 0.1);
      border-radius: 12px;
      border: 1px solid var(--c-accent);
    }

    .rec-header {
      margin: 0 0 0.5rem 0;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .rec-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .rec-item {
      padding: 0.75rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .rec-item:hover {
      border-color: var(--c-accent);
      transform: translateX(4px);
      background: rgba(0, 255, 136, 0.1);
    }

    .rec-content {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-bottom: 0.5rem;
    }

    .rec-content strong {
      color: var(--text-primary);
      font-size: 0.9rem;
    }

    .rec-title {
      color: var(--text-secondary);
      font-size: 0.85rem;
    }

    .rec-tags {
      display: flex;
      gap: 0.35rem;
      flex-wrap: wrap;
    }

    .tag {
      background: var(--c-bg-1);
      color: var(--c-accent);
      padding: 0.2rem 0.5rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
      border: 1px solid var(--c-accent);
    }

    .ai-input-area {
      display: flex;
      gap: 0.75rem;
      padding: 1rem 1.25rem;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-color);
    }

    .ai-input {
      flex: 1;
      padding: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 0.9rem;
      resize: none;
      transition: border-color 0.2s;
    }

    .ai-input:focus {
      outline: none;
      border-color: var(--c-accent);
      box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.1);
    }

    .ai-input:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .send-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 2px solid var(--c-accent);
      background: var(--c-bg-1);
      color: var(--c-accent);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
      flex-shrink: 0;
      align-self: flex-end;
      box-shadow: 0 2px 8px rgba(0, 255, 136, 0.2);
    }

    .send-btn:hover:not(:disabled) {
      background: var(--c-accent);
      color: var(--c-bg-1);
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(0, 255, 136, 0.4);
    }

    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .send-btn svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }

    @media (max-width: 768px) {
      .ai-panel {
        width: calc(100vw - 2rem);
        max-width: 380px;
      }
    }

    @media (max-width: 480px) {
      .ai-panel {
        bottom: 0;
        right: 0;
        left: 0;
        width: 100%;
        max-width: 100%;
        border-radius: 16px 16px 0 0;
        max-height: 80vh;
      }

      .ai-fab {
        bottom: 1rem;
        right: 1rem;
        width: 56px;
        height: 56px;
      }
    }
  `]
})
export class AiCompanionWidgetComponent {
  private aiChatService = inject(AIChatService);
  private router = inject(Router);

  isOpen = false;
  messages: ChatMessage[] = [];
  userInput = '';
  isTyping = false;

  toggleOpen(): void {
    this.isOpen = !this.isOpen;
  }

  sendMessage(): void {
    if (!this.userInput.trim() || this.isTyping) {
      return;
    }

    const question = this.userInput.trim();

    this.messages.push({
      from: 'user',
      text: question,
    });

    this.userInput = '';
    this.isTyping = true;

    setTimeout(() => this.scrollToBottom(), 100);

    this.aiChatService.ask(question).subscribe({
      next: (response) => {
        this.isTyping = false;

        if (response.success) {
          this.messages.push({
            from: 'ai',
            text: response.answer,
            recommendations: response.recommendations,
          });
        } else {
          this.messages.push({
            from: 'ai',
            text: response.message || response.error || 'Sorry, I encountered an error. Please try again.',
          });
        }

        setTimeout(() => this.scrollToBottom(), 100);
      },
      error: (err) => {
        this.isTyping = false;

        let errorMessage = 'Sorry, I\'m having trouble connecting right now.';
        if (err.error?.message?.includes('Ollama')) {
          errorMessage = 'AI companion is currently offline. The Ollama service may not be running.';
        }

        this.messages.push({
          from: 'ai',
          text: errorMessage,
        });

        setTimeout(() => this.scrollToBottom(), 100);
      },
    });
  }

  goToProfile(authorId: string): void {
    this.router.navigate(['/users', authorId]);
    this.toggleOpen();
  }

  onEnter(event: Event): void {
    const keyEvent = event as KeyboardEvent;
    if (!keyEvent.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToBottom(): void {

    const messagesArea = document.querySelector('.ai-messages');
    if (messagesArea) {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }
  }
}
