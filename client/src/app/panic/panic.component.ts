import { Component, inject, OnInit, ViewChild, ElementRef, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { EmergencyService, EmergencyContactUser } from '../core/services/emergency.service';
import { PanicService } from '../core/services/panic.service';
import { ToastService } from '../core/services/toast.service';
import { AIPanicService, ChatMessage } from '../core/services/ai-panic.service';
import { VoiceChatService } from '../core/services/voice-chat.service';
import { SpeechToTextService } from '../core/services/speech-to-text.service';
import { AuthService } from '../core/services/auth.service';
import { PanicCallService, IncomingCall } from '../core/services/panic-call.service';
import { WebRTCAudioService } from '../core/services/webrtc-audio.service';

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
                <button
                  class="speaker-btn"
                  (click)="playLatestAssistantMessage()"
                  [disabled]="isAILoading || isSpeaking || !hasAssistantMessage()"
                  title="Play latest AI response"
                >
                  <span *ngIf="!isSpeaking">🔊</span>
                  <span *ngIf="isSpeaking" class="pulse">🔊</span>
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
              <button
                class="mic-btn"
                [class.active]="isListening"
                (click)="startSpeechToText()"
                [disabled]="isAILoading || isListening || isVoiceMode"
                title="Speak your message"
              >
                <span *ngIf="!isListening">🎤</span>
                <span *ngIf="isListening" class="pulse">🔴</span>
              </button>
              <div class="listening-indicator" *ngIf="isListening">
                <span>Listening...</span>
              </div>
              <textarea
                [(ngModel)]="chatInput"
                placeholder="Type your message..."
                rows="2"
                class="chat-input"
                (keydown.enter)="onChatEnter($event)"
                [disabled]="isAILoading || isVoiceMode || isListening"
              ></textarea>
              <button
                class="send-chat-btn"
                (click)="sendChatMessage()"
                [disabled]="!chatInput.trim() || isAILoading || isVoiceMode || isListening"
              >
                <svg viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2 10l15 2-15 2z"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Testing Talk Section -->
          <div class="testing-talk-panel">
            <div class="testing-header">
              <h3>Testing Talk</h3>
              <p class="testing-subtitle">Test real-time 2-way audio communication</p>
            </div>
            
            <!-- Quick Test Button -->
            <div class="quick-test-section">
              <button
                class="quick-test-btn"
                [class.connected]="isWebPubSubConnected"
                [class.testing]="isTestingConnection"
                (click)="testWebPubSubConnection()"
                [disabled]="isTestingConnection"
              >
                <span class="btn-icon">{{ isWebPubSubConnected ? '✅' : isTestingConnection ? '🔄' : '🔌' }}</span>
                <span class="btn-text">
                  {{ isTestingConnection ? 'Testing Connection...' : isWebPubSubConnected ? 'Web PubSub Connected!' : 'Test Web PubSub Connection' }}
                </span>
              </button>
              <p class="connection-status-text" [class.connected]="isWebPubSubConnected" [class.error]="webPubSubConnectionError">
                {{ webPubSubConnectionError || (isWebPubSubConnected ? 'Ready to make calls!' : 'Click to test connection') }}
              </p>
            </div>
            
            <div class="testing-controls">
              <div class="testing-input-group">
                <label>
                  Select Contact to Call:
                  <select
                    [(ngModel)]="testSelectedContactId"
                    class="test-contact-select"
                    [disabled]="isInTestCall || contacts.length === 0"
                  >
                    <option value="">-- Select a contact --</option>
                    <option *ngFor="let contact of contacts" [value]="contact.id">
                      {{ contact.username }} ({{ contact.id }})
                    </option>
                  </select>
                </label>
                <p class="testing-hint" *ngIf="contacts.length === 0">
                  No emergency contacts available. Add contacts by marking someone "Helpful" in chat.
                </p>
              </div>

              <!-- Connection Status (Always Visible) -->
              <div class="testing-status">
                <div class="status-item">
                  <span class="status-label">Web PubSub Connection:</span>
                  <span class="status-value" [class.connected]="isWebPubSubConnected" [class.disconnected]="!isWebPubSubConnected">
                    <span class="status-indicator" [class.pulse]="isWebPubSubConnected"></span>
                    {{ isWebPubSubConnected ? '✅ CONNECTED' : '❌ DISCONNECTED' }}
                  </span>
                </div>
                <div class="status-item" *ngIf="webPubSubConnectionError">
                  <span class="status-label">Error:</span>
                  <span class="status-value error">{{ webPubSubConnectionError }}</span>
                </div>
              </div>

              <!-- Call Status (Only when in call) -->
              <div class="testing-status" *ngIf="isInTestCall">
                <div class="status-item">
                  <span class="status-label">Call Status:</span>
                  <span class="status-value" [class.active]="isTestCallConnected">
                    {{ isTestCallConnected ? '✅ CONNECTED' : '📞 CONNECTING...' }}
                  </span>
                </div>
                <div class="status-item">
                  <span class="status-label">Muted:</span>
                  <span class="status-value" [class.active]="isMuted()">
                    {{ isMuted() ? '🔇 YES' : '⚪ NO' }}
                  </span>
                </div>
              </div>

              <div class="testing-buttons">
                <button
                  class="test-btn start-call-btn"
                  (click)="startTestCall()"
                  [disabled]="!testSelectedContactId || isInTestCall || contacts.length === 0 || !isWebPubSubConnected"
                >
                  📞 Start Call
                </button>
                <button
                  class="test-btn alert-all-btn"
                  (click)="startBroadcastCall()"
                  [disabled]="isInTestCall || contacts.length === 0 || !isWebPubSubConnected"
                >
                  📢 Alert All
                </button>
                <button
                  class="test-btn mute-btn"
                  (click)="toggleTestMute()"
                  [disabled]="!isInTestCall"
                >
                  {{ isMuted() ? '🔊 Unmute' : '🔇 Mute' }}
                </button>
                <button
                  class="test-btn end-call-btn"
                  (click)="endTestCall()"
                  [disabled]="!isInTestCall"
                >
                  ❌ End Call
                </button>
              </div>
              
              <!-- Call Status -->
              <div class="call-status" *ngIf="isInTestCall">
                <p class="status-text" [class.calling]="callStatus === 'calling'" [class.connected]="callStatus === 'connected'" [class.declined]="callStatus === 'declined'" [class.no-answer]="callStatus === 'no_answer'">
                  <span *ngIf="callStatus === 'calling'">📞 Calling...</span>
                  <span *ngIf="callStatus === 'connected'">✅ Connected</span>
                  <span *ngIf="callStatus === 'declined'">❌ Declined</span>
                  <span *ngIf="callStatus === 'no_answer'">⏱️ No Answer</span>
                </p>
              </div>

              <div class="testing-info" *ngIf="!isInTestCall">
                <p class="info-text">
                  💡 <strong>How to test:</strong><br>
                  1. Select a contact from your emergency contacts<br>
                  2. Click "Start Call" to begin<br>
                  3. Speak into your microphone<br>
                  4. The selected contact will hear your audio in real-time<br>
                  5. Click "End Call" when done<br><br>
                  <strong>Note:</strong> The other user must also be on the Panic Mode page and start a call to you for 2-way communication.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Incoming Call Modal -->
      <div class="incoming-call-modal" *ngIf="showIncomingCallModal && incomingCall">
        <div class="modal-overlay" (click)="declineIncomingCall()"></div>
        <div class="modal-content">
          <div class="modal-header">
            <h3>Incoming Call</h3>
          </div>
          <div class="modal-body">
            <p class="caller-name">{{ incomingCall.fromName }} is calling you</p>
            <p class="call-mode" *ngIf="incomingCall.mode === 'broadcast'">📢 Broadcast Call</p>
          </div>
          <div class="modal-actions">
            <button class="accept-btn" (click)="acceptIncomingCall()">
              ✅ Accept
            </button>
            <button class="decline-btn" (click)="declineIncomingCall()">
              ❌ Decline
            </button>
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
    .speaker-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 2px solid var(--teal-accent);
      background: var(--button-gradient);
      color: var(--light-gray);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
      flex-shrink: 0;
      font-size: 1.1rem;
      box-shadow: 0 2px 8px rgba(118, 171, 174, 0.3);
      margin-left: 0.5rem;
    }
    .speaker-btn:hover:not(:disabled) {
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(118, 171, 174, 0.4);
      background: var(--button-hover);
    }
    .speaker-btn.active,
    .speaker-btn:active {
      border-color: var(--tiger-orange);
      background: rgba(255, 87, 34, 0.2);
      box-shadow: 0 0 20px rgba(255, 87, 34, 0.6);
    }
    .speaker-btn:disabled {
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
      position: relative;
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
    .mic-btn {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 2px solid var(--teal-accent);
      background: var(--button-gradient);
      color: var(--light-gray);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
      flex-shrink: 0;
      font-size: 1.2rem;
      box-shadow: 0 2px 8px rgba(118, 171, 174, 0.3);
    }
    .mic-btn:hover:not(:disabled) {
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(118, 171, 174, 0.4);
      background: var(--button-hover);
    }
    .mic-btn.active {
      border-color: var(--tiger-orange);
      background: rgba(255, 87, 34, 0.2);
      box-shadow: 0 0 20px rgba(255, 87, 34, 0.6);
      animation: pulse-glow 2s infinite;
    }
    .mic-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .listening-indicator {
      position: absolute;
      top: -30px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--card-gradient);
      border: 1px solid var(--border-color);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      color: var(--text-primary);
      white-space: nowrap;
      z-index: 10;
    }
    .listening-indicator span {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }
    .listening-indicator span::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--tiger-orange);
      animation: pulse 1.5s infinite;
    }
    /* Testing Talk Panel Styles */
    .testing-talk-panel {
      margin-top: 2rem;
      background: var(--card-gradient);
      border: 1px solid var(--border-color);
      padding: 2rem;
      border-radius: 16px;
      box-shadow: 0 10px 40px var(--shadow-lg);
    }
    .quick-test-section {
      margin-bottom: 2rem;
      padding: 1.5rem;
      background: var(--bg-tertiary);
      border-radius: 12px;
      border: 2px solid var(--border-color);
      text-align: center;
    }
    .quick-test-btn {
      width: 100%;
      padding: 1.25rem 2rem;
      border-radius: 12px;
      border: 3px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 1.1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    .quick-test-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
      border-color: var(--teal-accent);
    }
    .quick-test-btn:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
    .quick-test-btn.connected {
      background: rgba(16, 185, 129, 0.2);
      border-color: #10b981;
      color: #10b981;
    }
    .quick-test-btn.testing {
      background: rgba(59, 130, 246, 0.2);
      border-color: #3b82f6;
      color: #3b82f6;
      animation: pulse-glow 2s infinite;
    }
    .btn-icon {
      font-size: 1.5rem;
    }
    .btn-text {
      font-size: 1.1rem;
    }
    .connection-status-text {
      margin: 1rem 0 0 0;
      font-size: 0.95rem;
      color: var(--text-secondary);
      font-weight: 500;
    }
    .connection-status-text.connected {
      color: #10b981;
      font-weight: 600;
    }
    .connection-status-text.error {
      color: #ef4444;
      font-weight: 600;
    }
    @keyframes pulse-glow {
      0%, 100% {
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
      }
      50% {
        box-shadow: 0 4px 20px rgba(59, 130, 246, 0.6);
      }
    }
    .testing-header {
      margin-bottom: 1.5rem;
    }
    .testing-header h3 {
      margin: 0 0 0.5rem 0;
      color: var(--text-primary);
      font-size: 1.5rem;
    }
    .testing-subtitle {
      margin: 0;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    .testing-controls {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .testing-input-group label {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      font-weight: 500;
    }
    .test-contact-select {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      border: 2px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 1rem;
      transition: border-color 0.3s;
      cursor: pointer;
    }
    .test-contact-select:focus {
      outline: none;
      border-color: var(--teal-accent);
      box-shadow: 0 0 0 3px rgba(118, 171, 174, 0.1);
    }
    .test-contact-select:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .testing-hint {
      margin: 0.5rem 0 0 0;
      font-size: 0.85rem;
      color: var(--text-secondary);
      font-style: italic;
    }
    .testing-status {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
      padding: 1rem;
      background: var(--bg-tertiary);
      border-radius: 8px;
      border: 1px solid var(--border-color);
    }
    .status-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .status-label {
      font-weight: 500;
      color: var(--text-secondary);
    }
    .status-value {
      font-weight: 600;
      color: var(--text-primary);
    }
    .status-value.active {
      color: var(--teal-accent);
    }
    .status-value.connected {
      color: #10b981;
      font-weight: 700;
    }
    .status-value.disconnected {
      color: #ef4444;
      font-weight: 700;
    }
    .status-value.error {
      color: #ef4444;
      font-size: 0.85rem;
    }
    .status-indicator {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      margin-right: 0.5rem;
    }
    .status-indicator.pulse {
      animation: pulse-dot 2s infinite;
    }
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .testing-buttons {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .test-btn {
      flex: 1;
      min-width: 120px;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      border: 2px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .test-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .test-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .test-connection-btn {
      background: rgba(59, 130, 246, 0.2);
      border-color: #3b82f6;
      color: #3b82f6;
    }
    .test-connection-btn:hover:not(:disabled) {
      background: rgba(59, 130, 246, 0.3);
    }
    .start-call-btn {
      background: var(--button-gradient);
      color: var(--light-gray);
      border-color: var(--teal-accent);
    }
    .start-call-btn:hover:not(:disabled) {
      background: var(--button-hover);
    }
    .start-call-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .mute-btn {
      border-color: var(--tiger-orange);
    }
    .mute-btn:hover:not(:disabled) {
      background: rgba(255, 87, 34, 0.1);
      border-color: var(--tiger-orange);
    }
    .end-call-btn {
      border-color: #dc2626;
      color: #dc2626;
    }
    .end-call-btn:hover:not(:disabled) {
      background: rgba(220, 38, 38, 0.1);
    }
    .testing-info {
      padding: 1rem;
      background: rgba(118, 171, 174, 0.1);
      border-radius: 8px;
      border: 1px solid var(--teal-accent);
    }
    .info-text {
      margin: 0;
      color: var(--text-primary);
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .info-text strong {
      color: var(--teal-accent);
    }
    .alert-all-btn {
      background: rgba(139, 92, 246, 0.2);
      border-color: #8b5cf6;
      color: #8b5cf6;
    }
    .alert-all-btn:hover:not(:disabled) {
      background: rgba(139, 92, 246, 0.3);
    }
    .call-status {
      margin-top: 1rem;
      padding: 1rem;
      background: var(--bg-tertiary);
      border-radius: 8px;
      text-align: center;
    }
    .status-text {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .status-text.calling {
      color: #3b82f6;
    }
    .status-text.connected {
      color: #10b981;
    }
    .status-text.declined {
      color: #ef4444;
    }
    .status-text.no-answer {
      color: #f59e0b;
    }
    /* Incoming Call Modal */
    .incoming-call-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .modal-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
    }
    .modal-content {
      position: relative;
      background: var(--card-gradient);
      border: 2px solid var(--teal-accent);
      border-radius: 16px;
      padding: 2rem;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      z-index: 1001;
      animation: slideIn 0.3s ease-out;
    }
    @keyframes slideIn {
      from {
        transform: translateY(-20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    .modal-header h3 {
      margin: 0 0 1rem 0;
      color: var(--text-primary);
      font-size: 1.5rem;
    }
    .modal-body {
      margin-bottom: 1.5rem;
    }
    .caller-name {
      font-size: 1.2rem;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 0.5rem 0;
    }
    .call-mode {
      font-size: 0.9rem;
      color: var(--text-secondary);
      margin: 0;
    }
    .modal-actions {
      display: flex;
      gap: 1rem;
    }
    .accept-btn, .decline-btn {
      flex: 1;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      border: none;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .accept-btn {
      background: var(--button-gradient);
      color: var(--light-gray);
    }
    .accept-btn:hover {
      background: var(--button-hover);
      transform: translateY(-2px);
    }
    .decline-btn {
      background: rgba(220, 38, 38, 0.2);
      color: #dc2626;
      border: 2px solid #dc2626;
    }
    .decline-btn:hover {
      background: rgba(220, 38, 38, 0.3);
      transform: translateY(-2px);
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
  private speechToTextService = inject(SpeechToTextService);
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private panicCallService = inject(PanicCallService);
  private webrtcService = inject(WebRTCAudioService);
  private cdr = inject(ChangeDetectorRef);

  message = '';
  contacts: EmergencyContactUser[] = [];
  showContactSelection = false;
  selectedContactId = '';
  isTriggering = false;

  // Testing Talk properties
  testSelectedContactId: string = '';
  isInTestCall: boolean = false;
  isTestCallConnected: boolean = false;
  callStatus: string = ''; // 'idle' | 'calling' | 'connected' | 'declined' | 'no_answer'
  currentCallId: string = '';
  isCaller: boolean = false;
  
  // Incoming call
  incomingCall: IncomingCall | null = null;
  showIncomingCallModal: boolean = false;
  
  // Web PubSub connection status
  isWebPubSubConnected: boolean = false;
  webPubSubConnectionError: string = '';
  isTestingConnection: boolean = false;
  private subscriptions: any[] = [];
  
  // Broadcast call tracking
  private broadcastCallTimeout: any = null;
  private broadcastContactIds: string[] = [];
  showAIChat = false;
  chatHistory: ChatMessage[] = [];
  chatInput = '';
  isAILoading = false;
  isVoiceMode = false;
  conversationId: string | null = null;
  isListening = false; // For STT listening state
  isSpeaking = false; // For TTS playback state
  private currentAudio: HTMLAudioElement | null = null; // Track current audio playback

  ngOnInit(): void {
    this.loadEmergencyContacts();
    this.setupCallSubscriptions();
  }
  
  setupCallSubscriptions(): void {
    // Subscribe to PubSub connection status
    const connSub = this.panicCallService.connected$.subscribe(connected => {
      this.isWebPubSubConnected = connected;
      if (!connected) {
        this.webPubSubConnectionError = 'Disconnected';
      } else {
        this.webPubSubConnectionError = '';
      }
      this.cdr.detectChanges();
    });
    this.subscriptions.push(connSub);
    
    // Subscribe to incoming calls
    const incomingSub = this.panicCallService.incomingCall$.subscribe(call => {
      this.incomingCall = call;
      this.showIncomingCallModal = true;
      this.cdr.detectChanges();
    });
    this.subscriptions.push(incomingSub);
    
    // Subscribe to call signals
    const signalSub = this.panicCallService.callSignal$.subscribe(signal => {
      this.handleCallSignal(signal);
    });
    this.subscriptions.push(signalSub);
    
    // Subscribe to WebRTC state
    const webrtcSub = this.webrtcService.state$.subscribe(state => {
      this.isTestCallConnected = state.isConnected;
      this.cdr.detectChanges();
    });
    this.subscriptions.push(webrtcSub);
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
    this.conversationId = null; // Reset conversationId for new conversation
    this.isTriggering = false;

    // Request initial AI message
    this.requestInitialAIMessage();
  }

  requestInitialAIMessage(): void {
    this.isAILoading = true;

    const payload = {
      message: 'Start',
      history: [],
      conversationId: this.conversationId || undefined,
    };

    console.log('[Panic] Requesting initial AI message:', {
      payload,
      endpoint: 'http://localhost:3000/api/ai/panic-chat',
    });

    this.aiPanicService.sendMessage(payload).subscribe({
      next: (response) => {
        this.isAILoading = false;
        console.log('[Panic] Initial message received:', {
          success: response.success,
          messageLength: response.message?.length || 0,
          conversationId: response.conversationId || 'none',
        });

        // Store conversationId from response
        if (response.conversationId) {
          this.conversationId = response.conversationId;
          console.log('[Panic] Received conversationId:', this.conversationId);
        }
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
        
        // Detailed error logging
        const errorDetails = {
          status: err.status || 'unknown',
          statusText: err.statusText || 'unknown',
          error: err.error || err.message,
          errorBody: err.error ? JSON.stringify(err.error, null, 2) : 'none',
          url: err.url || 'http://localhost:3000/api/ai/panic-chat',
        };
        
        console.error('[Panic] Initial message request failed:', errorDetails);
        
        // Check for auth errors
        if (err.status === 401 || err.status === 403) {
          this.toastService.show('Session expired. Please log in again.', 'error');
        } else {
          const errorMsg = process.env['NODE_ENV'] === 'development'
            ? `Connection failed: ${err.status} ${err.statusText} - ${err.error?.error || err.message}`
            : 'Failed to connect to AI. Please try again.';
          this.toastService.show(errorMsg, 'error');
        }
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

    const payload = {
      message: userMessage,
      history: this.chatHistory.slice(0, -1), // Exclude the message we just added
      conversationId: this.conversationId || undefined,
    };

    console.log('[Panic] Sending chat message:', {
      message: userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : ''),
      historyLength: payload.history.length,
      conversationId: payload.conversationId || 'none',
      endpoint: 'http://localhost:3000/api/ai/panic-chat',
    });

    this.aiPanicService.sendMessage(payload).subscribe({
      next: (response) => {
        this.isAILoading = false;
        console.log('[Panic] Message sent successfully:', {
          success: response.success,
          messageLength: response.message?.length || 0,
          conversationId: response.conversationId || 'none',
        });

        // Store conversationId from response
        if (response.conversationId) {
          this.conversationId = response.conversationId;
          console.log('[Panic] Received conversationId:', this.conversationId);
        }
        // Use message field (new format) or reply field (legacy)
        const aiMessage = response.message || response.reply;
        if (response.success && aiMessage) {
          // Add AI response to chat history (display immediately)
          this.chatHistory.push({
            role: 'assistant',
            content: aiMessage,
          });
          setTimeout(() => this.scrollToBottom(), 100);

          // Automatically play TTS audio using server-side Azure TTS
          // This happens immediately after displaying the message
          this.playTTSAudio(aiMessage).catch((error) => {
            console.error('[Panic] Auto TTS failed:', error);
            // Don't show error toast for auto TTS - it's optional, text is already displayed
          });
        } else {
          this.toastService.show(aiMessage || 'Failed to get AI response', 'error');
        }
      },
      error: (err) => {
        this.isAILoading = false;
        
        // Detailed error logging
        const errorDetails = {
          status: err.status || 'unknown',
          statusText: err.statusText || 'unknown',
          error: err.error || err.message,
          errorBody: err.error ? JSON.stringify(err.error, null, 2) : 'none',
          url: err.url || 'http://localhost:3000/api/ai/panic-chat',
        };
        
        console.error('[Panic] Message send failed:', errorDetails);
        
        // Check for auth errors
        if (err.status === 401 || err.status === 403) {
          this.toastService.show('Session expired. Please log in again.', 'error');
        } else {
          // Show detailed error in dev mode
          const errorMsg = process.env['NODE_ENV'] === 'development' 
            ? `Send failed: ${err.status} ${err.statusText} - ${err.error?.error || err.message}`
            : 'Failed to send message. Please try again.';
          this.toastService.show(errorMsg, 'error');
        }
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
    this.conversationId = null; // Reset conversationId when closing chat
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

  /**
   * Start Speech-to-Text: Listen → Transcribe → Send to AI → Speak response
   */
  async startSpeechToText(): Promise<void> {
    if (this.isListening || this.isAILoading || this.isVoiceMode) {
      return;
    }

    try {
      this.isListening = true;
      console.log('[Panic] Starting STT...');

      // Get last typed message for language detection
      const lastUserMessage = this.chatHistory
        .slice()
        .reverse()
        .find(msg => msg.role === 'user')?.content;

      // Step 1: Transcribe speech to text with auto language detection
      const sttResult = await this.speechToTextService.transcribeOnce(lastUserMessage);
      
      console.log('[Panic] Transcribed text:', sttResult.text);
      console.log('[Panic] Detected language:', sttResult.detectedLang);
      console.log('[Panic] Transcript (first 40 chars):', sttResult.text.substring(0, 40));

      if (!sttResult.text || !sttResult.text.trim()) {
        this.toastService.show('No speech detected. Please try again.', 'error');
        return;
      }

      // Step 2: Add user message to chat history
      const userMessage = sttResult.text.trim();
      this.chatHistory.push({
        role: 'user',
        content: userMessage,
      });
      this.chatInput = ''; // Clear input
      setTimeout(() => this.scrollToBottom(), 100);

      // Step 3: Send to AI with detected language (voice input)
      this.isAILoading = true;
      console.log('[Panic] Sending to AI with detectedLang:', sttResult.detectedLang);

      this.aiPanicService.sendMessage({
        message: userMessage,
        history: this.chatHistory.slice(0, -1), // Exclude the message we just added
        conversationId: this.conversationId || undefined,
        detectedLang: sttResult.detectedLang, // Send detected language for voice input
      }).subscribe({
        next: async (response) => {
          this.isAILoading = false;
          
          // Store conversationId from response
          if (response.conversationId) {
            this.conversationId = response.conversationId;
            console.log('[Panic] Received conversationId:', this.conversationId);
          }

          // Get AI response
          const aiMessage = response.message || response.reply;
          if (response.success && aiMessage) {
            // Add AI response to chat history (display immediately)
            this.chatHistory.push({
              role: 'assistant',
              content: aiMessage,
            });
            setTimeout(() => this.scrollToBottom(), 100);

            // Step 4: Automatically play TTS audio (server-side Azure TTS)
            this.playTTSAudio(aiMessage).catch((error) => {
              console.error('[Panic] Auto TTS failed:', error);
              // Don't show error toast for auto TTS - it's optional
            });
          } else {
            this.toastService.show(aiMessage || 'Failed to get AI response', 'error');
          }
        },
        error: (err) => {
          this.isAILoading = false;
          console.error('[Panic] AI error:', err);
          this.toastService.show(
            err.error?.message || 'Failed to send message. Please try again.',
            'error'
          );
        },
      });
    } catch (error: any) {
      console.error('[Panic] STT error:', error);
      this.toastService.show(
        error.message || 'Failed to transcribe speech. Please try typing instead.',
        'error'
      );
    } finally {
      this.isListening = false;
    }
  }

  /**
   * Play TTS audio for given text using server-side Azure TTS
   * This is called automatically when AI responds
   */
  private async playTTSAudio(text: string): Promise<void> {
    console.log('[Panic] 🎵 playTTSAudio() called with text:', text.substring(0, 50));
    
    if (this.isSpeaking) {
      console.log('[Panic] Already speaking, skipping TTS');
      return;
    }

    // Cleanup any existing audio first
    this.cleanupAudio();

    try {
      this.isSpeaking = true;
      console.log('[Panic] ===== STARTING SERVER-SIDE TTS =====');
      console.log('[Panic] Text to speak:', text.substring(0, 100));

      // Always use English (Hindi support removed)
      const lang = 'en';
      console.log('[Panic] Using English voice (always)');

      // Call TTS endpoint
      const apiUrl = 'http://localhost:3000/api/ai/tts';
      const authToken = this.authService.getToken();
      
      if (!authToken) {
        console.error('[Panic] No auth token found');
        throw new Error('Not authenticated');
      }

      console.log('[Panic] Calling TTS endpoint:', apiUrl);
      console.log('[Panic] Request payload:', { text: text.substring(0, 50) + '...', lang });

      // Fetch audio as blob
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ text, lang }),
      });

      console.log('[Panic] TTS response status:', response.status, response.statusText);
      console.log('[Panic] TTS response headers:', {
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        console.error('[Panic] TTS endpoint error:', errorData);
        throw new Error(errorData.error || `TTS failed: ${response.status}`);
      }

      // Get audio blob
      const audioBlob = await response.blob();
      console.log('[Panic] Received audio blob:', {
        size: audioBlob.size,
        type: audioBlob.type,
        sizeInKB: (audioBlob.size / 1024).toFixed(2) + ' KB',
      });

      if (audioBlob.size === 0) {
        throw new Error('Received empty audio blob from server');
      }

      // Check if blob type is correct
      if (!audioBlob.type || (!audioBlob.type.includes('audio') && !audioBlob.type.includes('mpeg'))) {
        console.warn('[Panic] Unexpected audio blob type:', audioBlob.type);
        // Try to read first bytes to verify it's MP3
        const firstBytes = await audioBlob.slice(0, 3).arrayBuffer();
        const uint8Array = new Uint8Array(firstBytes);
        const isMP3 = uint8Array[0] === 0xFF && (uint8Array[1] === 0xFB || uint8Array[1] === 0xF3);
        console.log('[Panic] MP3 signature check:', isMP3, 'First bytes:', Array.from(uint8Array).map(b => '0x' + b.toString(16)).join(' '));
        
        if (!isMP3 && audioBlob.size < 100) {
          // Might be an error response - read as text
          const text = await audioBlob.text();
          console.error('[Panic] Blob appears to be text, not audio:', text);
          try {
            const errorData = JSON.parse(text);
            throw new Error(errorData.error || errorData.message || 'Server returned error instead of audio');
          } catch {
            throw new Error('Server returned invalid audio data');
          }
        }
      }

      // Create object URL and play
      const audioUrl = URL.createObjectURL(audioBlob);
      console.log('[Panic] Created audio URL:', audioUrl.substring(0, 50) + '...');
      
      // Store audio element to prevent garbage collection
      this.currentAudio = new Audio(audioUrl);
      console.log('[Panic] Created Audio element');

      // Set volume to maximum
      this.currentAudio.volume = 1.0;
      console.log('[Panic] Set audio volume to 1.0');

      // Set up event handlers BEFORE playing
      this.currentAudio.onloadeddata = () => {
        console.log('[Panic] Audio data loaded');
      };

      this.currentAudio.oncanplay = () => {
        console.log('[Panic] Audio can play');
      };

      this.currentAudio.onplay = () => {
        console.log('[Panic] ✅ Audio playback STARTED');
      };

      this.currentAudio.onended = () => {
        console.log('[Panic] ✅ Audio playback ENDED');
        URL.revokeObjectURL(audioUrl);
        this.cleanupAudio();
      };

      this.currentAudio.onerror = (error) => {
        console.error('[Panic] ❌ Audio playback ERROR:', error);
        console.error('[Panic] Audio error details:', {
          code: this.currentAudio?.error?.code,
          message: this.currentAudio?.error?.message,
        });
        URL.revokeObjectURL(audioUrl);
        this.cleanupAudio();
      };

      this.currentAudio.onpause = () => {
        console.log('[Panic] Audio paused');
      };

      // Wait for audio to be ready
      console.log('[Panic] Waiting for audio to be ready...');
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Audio load timeout'));
        }, 10000); // 10 second timeout

        this.currentAudio!.oncanplaythrough = () => {
          clearTimeout(timeout);
          console.log('[Panic] Audio ready to play');
          resolve();
        };

        this.currentAudio!.onerror = (error) => {
          clearTimeout(timeout);
          reject(error);
        };

        // If already can play, resolve immediately
        if (this.currentAudio!.readyState >= 2) { // HAVE_CURRENT_DATA
          clearTimeout(timeout);
          console.log('[Panic] Audio already ready (readyState:', this.currentAudio!.readyState, ')');
          resolve();
        }
      });

      // Play audio (must be in user interaction context)
      console.log('[Panic] Attempting to play audio...');
      console.log('[Panic] Audio readyState:', this.currentAudio!.readyState);
      console.log('[Panic] Audio paused:', this.currentAudio!.paused);
      
      try {
        const playPromise = this.currentAudio!.play();
        
        if (playPromise !== undefined) {
          await playPromise;
          console.log('[Panic] ✅ audio.play() promise resolved - audio should be playing now');
          console.log('[Panic] Audio paused after play:', this.currentAudio!.paused);
          console.log('[Panic] Audio currentTime:', this.currentAudio!.currentTime);
        } else {
          console.log('[Panic] ✅ audio.play() called (no promise returned)');
        }
      } catch (playError: any) {
        console.error('[Panic] ❌ audio.play() failed:', playError);
        console.error('[Panic] Play error name:', playError.name);
        console.error('[Panic] Play error message:', playError.message);
        console.error('[Panic] Audio error code:', this.currentAudio?.error?.code);
        console.error('[Panic] Audio error message:', this.currentAudio?.error?.message);
        
        // Handle autoplay policy error
        if (playError.name === 'NotAllowedError' || playError.name === 'NotSupportedError') {
          console.error('[Panic] Autoplay blocked by browser. User interaction required.');
          // Don't throw - just log, user can click speaker button
          console.warn('[Panic] Audio autoplay blocked. User can click speaker button to play.');
          this.cleanupAudio();
          return; // Exit silently - text is already displayed
        }
        
        throw playError;
      }
    } catch (error: any) {
      console.error('[Panic] ❌ TTS error:', error);
      console.error('[Panic] Error stack:', error.stack);
      this.cleanupAudio();
      throw error; // Re-throw so caller can handle if needed
    }
  }

  /**
   * Check if there's an assistant message to play
   */
  hasAssistantMessage(): boolean {
    return this.chatHistory.some(msg => msg.role === 'assistant');
  }

  /**
   * Play the latest assistant message using server-side TTS
   * (Called when user clicks the speaker button)
   */
  async playLatestAssistantMessage(): Promise<void> {
    if (this.isSpeaking || this.isAILoading) {
      return;
    }

    // Find the latest assistant message
    const latestAssistantMessage = this.chatHistory
      .slice()
      .reverse()
      .find(msg => msg.role === 'assistant');

    if (!latestAssistantMessage || !latestAssistantMessage.content) {
      this.toastService.show('No AI message to play', 'error');
      return;
    }

    const text = latestAssistantMessage.content.trim();
    if (!text) {
      this.toastService.show('AI message is empty', 'error');
      return;
    }

    try {
      await this.playTTSAudio(text);
    } catch (error: any) {
      console.error('[Panic] TTS error:', error);
      this.toastService.show(
        error.message || 'Couldn\'t play audio. Check Azure Speech key/region.',
        'error'
      );
    }
  }

  /**
   * Old implementation - keeping for reference but using playTTSAudio instead
   */
  private async playLatestAssistantMessageOld(): Promise<void> {
    if (this.isSpeaking || this.isAILoading) {
      return;
    }

    // Find the latest assistant message
    const latestAssistantMessage = this.chatHistory
      .slice()
      .reverse()
      .find(msg => msg.role === 'assistant');

    if (!latestAssistantMessage || !latestAssistantMessage.content) {
      this.toastService.show('No AI message to play', 'error');
      return;
    }

    const text = latestAssistantMessage.content.trim();
    if (!text) {
      this.toastService.show('AI message is empty', 'error');
      return;
    }

    try {
      this.isSpeaking = true;
      console.log('[Panic] Playing TTS for text:', text.substring(0, 50) + '...');

      // Detect language from text (simple detection)
      let lang = 'en';
      // Always use English (Hindi support removed)
      lang = 'en';
      console.log('[Panic] Using English voice (always)');

      // Call TTS endpoint
      const apiUrl = 'http://localhost:3000/api/ai/tts';
      const authToken = this.authService.getToken();
      
      if (!authToken) {
        throw new Error('Not authenticated');
      }

      // Fetch audio as blob
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ text, lang }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `TTS failed: ${response.status}`);
      }

      // Get audio blob
      const audioBlob = await response.blob();
      console.log('[Panic] Received audio blob, size:', audioBlob.size, 'type:', audioBlob.type);

      // Create object URL and play
      const audioUrl = URL.createObjectURL(audioBlob);
      this.currentAudio = new Audio(audioUrl);

      // Set up event handlers
      this.currentAudio.onended = () => {
        console.log('[Panic] Audio playback ended');
        this.cleanupAudio();
      };

      this.currentAudio.onerror = (error) => {
        console.error('[Panic] Audio playback error:', error);
        this.toastService.show('Failed to play audio. Check browser audio settings.', 'error');
        this.cleanupAudio();
      };

      // Play audio (must be in click handler context to avoid autoplay block)
      console.log('[Panic] Starting audio playback...');
      await this.currentAudio.play();
      console.log('[Panic] Audio playback started');

    } catch (error: any) {
      console.error('[Panic] TTS error:', error);
      this.toastService.show(
        error.message || 'Couldn\'t play audio. Check Azure Speech key/region.',
        'error'
      );
      this.isSpeaking = false;
      this.cleanupAudio();
    }
  }

  /**
   * Cleanup audio resources
   */
  private cleanupAudio(): void {
    console.log('[Panic] Cleaning up audio...');
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.src = '';
        this.currentAudio = null;
        console.log('[Panic] Audio element cleaned up');
      } catch (error) {
        console.error('[Panic] Error cleaning up audio:', error);
      }
    }
    this.isSpeaking = false;
    console.log('[Panic] isSpeaking set to false');
  }

  ngOnDestroy(): void {
    if (this.isVoiceMode) {
      this.stopVoiceChat();
    }
    if (this.isInTestCall) {
      this.endTestCall();
    }
    this.cleanupAudio();
    
    // Cleanup subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    
    // Disconnect from PubSub
    this.panicCallService.disconnect().catch(console.error);
  }

  async testWebPubSubConnection(): Promise<void> {
    this.isTestingConnection = true;
    this.webPubSubConnectionError = '';
    
    try {
      const currentUser = this.authService.currentUser();
      if (!currentUser || !currentUser.id) {
        this.webPubSubConnectionError = 'You must be logged in';
        this.isWebPubSubConnected = false;
        this.isTestingConnection = false;
        this.toastService.show('❌ You must be logged in to test connection', 'error');
        return;
      }

      console.log('[Testing Talk] Testing Web PubSub connection...');
      console.log('[Testing Talk] Current user ID:', currentUser.id);
      
      await this.panicCallService.connect(currentUser.id);
      
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const isConnected = this.panicCallService.isConnectedToPubSub();
      this.isWebPubSubConnected = isConnected;
      
      if (isConnected) {
        this.webPubSubConnectionError = '';
        this.toastService.show('✅ Web PubSub connection successful!', 'success');
        console.log('[Testing Talk] Web PubSub connection test: SUCCESS');
      } else {
        throw new Error('Connection failed. Check backend and Azure Web PubSub configuration.');
      }
    } catch (error: any) {
      console.error('[Testing Talk] Web PubSub connection test failed:', error);
      this.isWebPubSubConnected = false;
      this.webPubSubConnectionError = error.message || 'Connection test failed. Check console for details.';
      this.toastService.show(`❌ Connection failed: ${this.webPubSubConnectionError}`, 'error');
    } finally {
      this.isTestingConnection = false;
      this.cdr.detectChanges();
    }
  }

  // Testing Talk Methods
  async startTestCall(): Promise<void> {
    if (!this.testSelectedContactId || this.isInTestCall) {
      return;
    }

    try {
      const currentUser = this.authService.currentUser();
      if (!currentUser || !currentUser.id) {
        this.toastService.show('You must be logged in to test calls', 'error');
        return;
      }

      if (!this.isWebPubSubConnected) {
        this.toastService.show('Please connect to Web PubSub first', 'error');
        return;
      }

      // Find the selected contact
      const selectedContact = this.contacts.find(c => c.id === this.testSelectedContactId);
      if (!selectedContact) {
        this.toastService.show('Selected contact not found', 'error');
        return;
      }

      // Generate call ID
      this.currentCallId = `call_${Date.now()}_${currentUser.id}`;
      this.isCaller = true;
      this.callStatus = 'calling';
      this.isInTestCall = true;
      
      // Join call group
      await this.panicCallService.joinCallGroup(this.currentCallId);
      
      // Initialize WebRTC
      await this.webrtcService.initialize(this.currentCallId, true);
      
      // Create and send offer
      const offer = await this.webrtcService.createOffer();
      await this.panicCallService.sendWebRTCOffer(this.currentCallId, offer);
      
      // Send incoming call notification
      await this.panicCallService.sendIncomingCall(
        this.currentCallId,
        this.testSelectedContactId,
        currentUser.username || 'Unknown',
        'single'
      );
      
      // Set up ICE candidate handler
      const iceSub = this.webrtcService.getICECandidates().subscribe(candidate => {
        this.panicCallService.sendWebRTCICE(this.currentCallId, candidate);
      });
      this.subscriptions.push(iceSub);
      
      this.toastService.show(`Calling ${selectedContact.username}...`, 'info');
      console.log('[Testing Talk] Call initiated');
    } catch (error: any) {
      console.error('[Testing Talk] Failed to start call:', error);
      this.toastService.show(error.message || 'Failed to start call', 'error');
      await this.endTestCall();
    }
  }

  async startBroadcastCall(): Promise<void> {
    if (this.isInTestCall || this.contacts.length === 0) {
      return;
    }

    try {
      const currentUser = this.authService.currentUser();
      if (!currentUser || !currentUser.id) {
        this.toastService.show('You must be logged in', 'error');
        return;
      }

      if (!this.isWebPubSubConnected) {
        this.toastService.show('Please connect to Web PubSub first', 'error');
        return;
      }

      // Generate call ID
      this.currentCallId = `call_${Date.now()}_${currentUser.id}`;
      this.isCaller = true;
      this.callStatus = 'calling';
      this.isInTestCall = true;
      this.broadcastContactIds = this.contacts.map(c => c.id);
      
      // Join call group
      await this.panicCallService.joinCallGroup(this.currentCallId);
      
      // Initialize WebRTC
      await this.webrtcService.initialize(this.currentCallId, true);
      
      // Send broadcast call to all contacts
      await this.panicCallService.sendBroadcastCall(
        this.currentCallId,
        this.broadcastContactIds,
        currentUser.username || 'Unknown'
      );
      
      // Set timeout for no answer (20 seconds)
      this.broadcastCallTimeout = setTimeout(() => {
        if (this.callStatus === 'calling') {
          this.callStatus = 'no_answer';
          this.toastService.show('No answer from any contact', 'error');
          this.endTestCall();
        }
      }, 20000);
      
      this.toastService.show(`Calling all ${this.contacts.length} contacts...`, 'info');
      console.log('[Testing Talk] Broadcast call initiated');
    } catch (error: any) {
      console.error('[Testing Talk] Failed to start broadcast call:', error);
      this.toastService.show(error.message || 'Failed to start broadcast call', 'error');
      await this.endTestCall();
    }
  }

  async endTestCall(): Promise<void> {
    if (!this.isInTestCall) {
      return;
    }

    try {
      console.log('[Testing Talk] Ending call...');
      
      // Send call end signal
      if (this.currentCallId) {
        await this.panicCallService.sendCallEnd(this.currentCallId);
        await this.panicCallService.leaveCallGroup(this.currentCallId);
      }
      
      // Cleanup WebRTC
      await this.webrtcService.cleanup();
      
      // Clear broadcast timeout
      if (this.broadcastCallTimeout) {
        clearTimeout(this.broadcastCallTimeout);
        this.broadcastCallTimeout = null;
      }
      
      this.isInTestCall = false;
      this.isTestCallConnected = false;
      this.callStatus = 'idle';
      this.currentCallId = '';
      this.isCaller = false;
      this.broadcastContactIds = [];
      
      this.toastService.show('Call ended', 'info');
      console.log('[Testing Talk] Call ended');
    } catch (error: any) {
      console.error('[Testing Talk] Error ending call:', error);
      this.toastService.show('Error ending call', 'error');
    } finally {
      this.cdr.detectChanges();
    }
  }

  isMuted(): boolean {
    if (!this.isInTestCall) {
      return false;
    }
    return this.webrtcService.isMuted();
  }

  async toggleTestMute(): Promise<void> {
    if (!this.isInTestCall) {
      return;
    }

    try {
      this.webrtcService.toggleMute();
      const muted = this.webrtcService.isMuted();
      this.toastService.show(
        muted ? 'Microphone muted' : 'Microphone unmuted',
        'info'
      );
    } catch (error: any) {
      console.error('[Testing Talk] Error toggling mute:', error);
      this.toastService.show('Error toggling mute', 'error');
    }
  }

  // Handle incoming call
  async acceptIncomingCall(): Promise<void> {
    if (!this.incomingCall) {
      return;
    }

    try {
      const currentUser = this.authService.currentUser();
      if (!currentUser || !currentUser.id) {
        this.toastService.show('You must be logged in', 'error');
        return;
      }

      this.currentCallId = this.incomingCall.callId;
      this.isCaller = false;
      this.callStatus = 'connected';
      this.isInTestCall = true;
      this.showIncomingCallModal = false;
      
      // Join call group
      await this.panicCallService.joinCallGroup(this.currentCallId);
      
      // Send accept signal
      await this.panicCallService.sendCallAccept(this.currentCallId, this.incomingCall.fromUserId);
      
      // Initialize WebRTC (callee)
      await this.webrtcService.initialize(this.currentCallId, false);
      
      // Set up ICE candidate handler
      const iceSub = this.webrtcService.getICECandidates().subscribe(candidate => {
        this.panicCallService.sendWebRTCICE(this.currentCallId, candidate);
      });
      this.subscriptions.push(iceSub);
      
      this.toastService.show(`Connected to ${this.incomingCall.fromName}`, 'success');
      console.log('[Testing Talk] Incoming call accepted');
    } catch (error: any) {
      console.error('[Testing Talk] Error accepting call:', error);
      this.toastService.show(error.message || 'Failed to accept call', 'error');
      this.showIncomingCallModal = false;
      this.incomingCall = null;
    }
  }

  async declineIncomingCall(): Promise<void> {
    if (!this.incomingCall) {
      return;
    }

    try {
      await this.panicCallService.sendCallDecline(this.incomingCall.callId, this.incomingCall.fromUserId);
      this.showIncomingCallModal = false;
      this.incomingCall = null;
      this.toastService.show('Call declined', 'info');
    } catch (error: any) {
      console.error('[Testing Talk] Error declining call:', error);
    }
  }

  // Handle call signals
  private async handleCallSignal(signal: any): Promise<void> {
    if (!this.isInTestCall || signal.callId !== this.currentCallId) {
      return;
    }

    try {
      switch (signal.type) {
        case 'call_accept':
          if (this.isCaller && this.callStatus === 'calling') {
            this.callStatus = 'connected';
            this.isTestCallConnected = true;
            
            // If broadcast, cancel other calls
            if (this.broadcastContactIds.length > 0) {
              await this.panicCallService.sendCallCancelled(this.currentCallId, this.broadcastContactIds);
              if (this.broadcastCallTimeout) {
                clearTimeout(this.broadcastCallTimeout);
                this.broadcastCallTimeout = null;
              }
            }
            
            this.toastService.show('Call connected!', 'success');
          }
          break;
          
        case 'call_decline':
          if (this.isCaller && this.callStatus === 'calling') {
            this.callStatus = 'declined';
            this.toastService.show('Call declined', 'error');
            await this.endTestCall();
          }
          break;
          
        case 'call_cancelled':
          if (!this.isCaller) {
            this.showIncomingCallModal = false;
            this.incomingCall = null;
            this.toastService.show('Call was cancelled', 'info');
          }
          break;
          
        case 'call_end':
          this.toastService.show('Call ended by other party', 'info');
          await this.endTestCall();
          break;
          
        case 'webrtc_offer':
          if (!this.isCaller) {
            const answer = await this.webrtcService.handleOffer(signal.sdp);
            await this.panicCallService.sendWebRTCAnswer(this.currentCallId, answer);
          }
          break;
          
        case 'webrtc_answer':
          if (this.isCaller) {
            await this.webrtcService.handleAnswer(signal.sdp);
          }
          break;
          
        case 'webrtc_ice':
          await this.webrtcService.addICECandidate(signal.candidate);
          break;
      }
    } catch (error: any) {
      console.error('[Testing Talk] Error handling signal:', error);
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

