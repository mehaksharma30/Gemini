import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, interval } from 'rxjs';
import { WalkieTalkieService } from '../core/services/walkie-talkie.service';
import { ToastService } from '../core/services/toast.service';
import { AuthService } from '../core/services/auth.service';
import { EmergencyService, EmergencyContactUser } from '../core/services/emergency.service';
import { WalkieTalkieMessage, WalkieTalkieThread } from '../core/models/walkie-talkie.model';

@Component({
  selector: 'app-walkie-talkie',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './walkie-talkie.component.html',
  styleUrl: './walkie-talkie.component.css',
})
export class WalkieTalkieComponent implements OnInit, OnDestroy {
  private walkieTalkieService = inject(WalkieTalkieService);
  private toastService = inject(ToastService);
  private authService = inject(AuthService);
  private emergencyService = inject(EmergencyService);

  // User selection
  contacts: EmergencyContactUser[] = [];
  selectedContactId: string | null = null;
  selectedContact: EmergencyContactUser | null = null;
  currentUserId: string | null = null;

  // Thread and messages
  threadId: string | null = null;
  messages: WalkieTalkieMessage[] = [];
  lastMessageTimestamp: string | null = null;

  // Recording state
  isRecording: boolean = false;
  isSending: boolean = false;
  recordingStartTime: number = 0;
  recordingDuration: number = 0;

  // Polling
  private pollSubscription?: Subscription;
  private mediaRecorder?: MediaRecorder;
  private audioChunks: Blob[] = [];
  private recordingStream?: MediaStream;

  // Audio playback (public for template access)
  currentAudioPlayer: HTMLAudioElement | null = null;

  ngOnInit(): void {
    const currentUser = this.authService.currentUser();
    if (currentUser?.id) {
      this.currentUserId = currentUser.id;
    }

    this.loadContacts();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.stopRecording();
    this.cleanupAudioPlayer();
  }

  /**
   * Load emergency contacts (users we can talk to)
   */
  loadContacts(): void {
    this.emergencyService.getEmergencyContacts().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.contacts = response.data;
        }
      },
      error: (err) => {
        console.error('[WalkieTalkie] Error loading contacts:', err);
        this.toastService.show('Failed to load contacts', 'error');
      },
    });
  }

  /**
   * Select a contact to talk to
   */
  selectContact(contactId: string): void {
    const contact = this.contacts.find(c => c.id === contactId);
    if (!contact) {
      return;
    }

    this.selectedContactId = contactId;
    this.selectedContact = contact;
    this.threadId = null;
    this.messages = [];
    this.lastMessageTimestamp = null;

    // Load thread between current user and selected contact
    if (this.currentUserId) {
      this.loadThread();
      this.startPolling();
    }
  }

  /**
   * Load thread between two users
   */
  async loadThread(): Promise<void> {
    if (!this.currentUserId || !this.selectedContactId) {
      return;
    }

    try {
      const thread = await this.walkieTalkieService
        .getThread(this.currentUserId, this.selectedContactId)
        .toPromise();

      if (thread) {
        this.threadId = thread.threadId;
        this.messages = thread.messages;

        // Update last message timestamp
        if (thread.messages.length > 0) {
          const lastMessage = thread.messages[thread.messages.length - 1];
          this.lastMessageTimestamp = lastMessage.createdAt;
        }
      }
    } catch (error: any) {
      console.error('[WalkieTalkie] Error loading thread:', error);
      // Don't show error toast for initial load - just log it
    }
  }

  /**
   * Start polling for new messages
   */
  private startPolling(): void {
    if (!this.threadId) {
      return;
    }

    this.stopPolling();

    // Poll every 1.5 seconds
    this.pollSubscription = interval(1500).subscribe(() => {
      this.pollNewMessages();
    });

    console.log('[WalkieTalkie] Started polling for thread:', this.threadId);
  }

  /**
   * Stop polling (public for template access)
   */
  stopPolling(): void {
    if (this.pollSubscription) {
      this.pollSubscription.unsubscribe();
      this.pollSubscription = undefined;
    }
  }

  /**
   * Poll for new messages
   */
  async pollNewMessages(): Promise<void> {
    if (!this.threadId) {
      return;
    }

    try {
      const after = this.lastMessageTimestamp || undefined;
      const response = await this.walkieTalkieService
        .pollMessages(this.threadId, after)
        .toPromise();

      if (response && response.messages.length > 0) {
        // Add new messages
        this.messages = [...this.messages, ...response.messages];

        // Update last message timestamp
        const lastMessage = response.messages[response.messages.length - 1];
        this.lastMessageTimestamp = lastMessage.createdAt;

        // Auto-play new messages from the other user
        for (const msg of response.messages) {
          if (msg.toUserId === this.currentUserId) {
            // This message is for us, auto-play it
            this.playAudio(msg.audioUrl);
          }
        }
      }
    } catch (error: any) {
      console.error('[WalkieTalkie] Error polling messages:', error);
      // Don't show error toast for polling - just log it
    }
  }

  /**
   * Start recording audio
   */
  async startRecording(): Promise<void> {
    if (!this.currentUserId || !this.selectedContactId) {
      this.toastService.show('Please select a contact first', 'error');
      return;
    }

    if (this.isRecording || this.isSending) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordingStream = stream;

      this.audioChunks = [];
      this.recordingStartTime = Date.now();

      // Try to use WAV format, fallback to webm
      const options: MediaRecorderOptions = {
        mimeType: 'audio/webm;codecs=opus',
      };

      // Check if WAV is supported (usually not, but try)
      if (MediaRecorder.isTypeSupported('audio/wav')) {
        options.mimeType = 'audio/wav';
      }

      this.mediaRecorder = new MediaRecorder(stream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.recordingDuration = Date.now() - this.recordingStartTime;
        const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
        this.sendAudioMessage(audioBlob);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        this.recordingStream = undefined;
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      console.log('[WalkieTalkie] Recording started');
    } catch (error: any) {
      console.error('[WalkieTalkie] Error starting recording:', error);
      this.toastService.show('Failed to access microphone', 'error');
    }
  }

  /**
   * Stop recording and send
   */
  stopRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      console.log('[WalkieTalkie] Recording stopped');
    }

    // Also stop stream if still active
    if (this.recordingStream) {
      this.recordingStream.getTracks().forEach(track => track.stop());
      this.recordingStream = undefined;
    }
  }

  /**
   * Send audio message
   */
  async sendAudioMessage(audioBlob: Blob): Promise<void> {
    if (!this.currentUserId || !this.selectedContactId) {
      return;
    }

    if (this.isSending) {
      return;
    }

    this.isSending = true;

    try {
      // Determine file extension based on mime type
      let extension = 'webm';
      if (audioBlob.type.includes('wav')) {
        extension = 'wav';
      } else if (audioBlob.type.includes('m4a') || audioBlob.type.includes('mp4')) {
        extension = 'm4a';
      }

      // Convert Blob to File
      const audioFile = new File([audioBlob], `audio.${extension}`, { type: audioBlob.type });
      const clientTimestamp = Date.now();

      const response = await this.walkieTalkieService
        .sendMessage(
          this.currentUserId,
          this.selectedContactId!,
          audioFile,
          this.threadId || undefined,
          clientTimestamp
        )
        .toPromise();

      if (response) {
        this.threadId = response.threadId;

        // Add sent message to local messages
        this.messages.push({
          messageId: response.messageId,
          fromUserId: this.currentUserId!,
          toUserId: this.selectedContactId!,
          audioUrl: response.audioUrl,
          createdAt: response.createdAt,
        });

        // Update last message timestamp
        this.lastMessageTimestamp = response.createdAt;

        // Start polling if not already polling
        if (!this.pollSubscription) {
          this.startPolling();
        }

        this.toastService.show('Message sent!', 'success');
        console.log('[WalkieTalkie] Audio message sent successfully');
      }
    } catch (error: any) {
      console.error('[WalkieTalkie] Error sending audio:', error);
      this.toastService.show(
        error.error?.error || 'Failed to send audio message',
        'error'
      );
    } finally {
      this.isSending = false;
    }
  }

  /**
   * Play audio from URL
   */
  playAudio(audioUrl: string): void {
    // Stop current audio if playing
    this.cleanupAudioPlayer();

    // Get full audio URL
    const messageId = audioUrl.split('/').pop();
    if (!messageId) {
      return;
    }

    const fullUrl = this.walkieTalkieService.getAudioUrl(messageId);
    const audio = new Audio(fullUrl);

    // Add auth token to request
    const token = this.authService.getToken();
    if (token) {
      // Note: Audio element doesn't support custom headers directly
      // The server should accept the auth token from cookies or we need to use fetch
      // For now, we'll rely on the server checking the session/cookie
    }

    audio.onended = () => {
      this.cleanupAudioPlayer();
    };

    audio.onerror = (error) => {
      console.error('[WalkieTalkie] Error playing audio:', error);
      this.toastService.show('Failed to play audio', 'error');
      this.cleanupAudioPlayer();
    };

    this.currentAudioPlayer = audio;
    audio.play().catch((error) => {
      console.error('[WalkieTalkie] Error playing audio:', error);
      this.toastService.show('Failed to play audio', 'error');
    });
  }

  /**
   * Cleanup audio player
   */
  private cleanupAudioPlayer(): void {
    if (this.currentAudioPlayer) {
      this.currentAudioPlayer.pause();
      this.currentAudioPlayer.src = '';
      this.currentAudioPlayer = null;
    }
  }

  /**
   * Format timestamp for display
   */
  formatTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Format date for display
   */
  formatDate(isoString: string): string {
    const date = new Date(isoString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString();
    }
  }

  /**
   * Check if message is from current user
   */
  isFromCurrentUser(message: WalkieTalkieMessage): boolean {
    return message.fromUserId === this.currentUserId;
  }

  /**
   * Get recording duration in seconds
   */
  getRecordingDuration(): number {
    if (this.isRecording) {
      return Math.floor((Date.now() - this.recordingStartTime) / 1000);
    }
    return 0;
  }
}
