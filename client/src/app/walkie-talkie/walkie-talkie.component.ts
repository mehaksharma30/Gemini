import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, interval } from 'rxjs';
import { WalkieTalkieService } from '../core/services/walkie-talkie.service';
import { ToastService } from '../core/services/toast.service';
import { AuthService } from '../core/services/auth.service';
import {
  WalkieTalkieMessage,
  WalkieTalkieResponse,
  EmergencyResponse,
} from '../core/models/walkie-talkie.model';

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

  threadId: string | null = null;
  messages: WalkieTalkieMessage[] = [];
  textInput: string = '';
  isRecording: boolean = false;
  isSending: boolean = false;
  isEmergencySending: boolean = false;

  private pollSubscription?: Subscription;
  private mediaRecorder?: MediaRecorder;
  private audioChunks: Blob[] = [];

  ngOnInit(): void {
    console.log('[WalkieTalkie] Component initialized');
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.stopRecording();
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
      this.loadThread();
    });

    console.log('[WalkieTalkie] Started polling for thread:', this.threadId);
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollSubscription) {
      this.pollSubscription.unsubscribe();
      this.pollSubscription = undefined;
    }
  }

  /**
   * Load thread messages
   */
  async loadThread(): Promise<void> {
    if (!this.threadId) {
      return;
    }

    try {
      const thread = await this.walkieTalkieService.getThread(this.threadId).toPromise();
      if (thread) {
        this.messages = thread.messages;
      }
    } catch (error: any) {
      console.error('[WalkieTalkie] Error loading thread:', error);
      // Don't show error toast for polling - just log it
    }
  }

  /**
   * Send text message
   */
  async sendTextMessage(): Promise<void> {
    if (!this.textInput.trim()) {
      return;
    }

    if (this.isSending) {
      return;
    }

    this.isSending = true;
    const text = this.textInput.trim();
    this.textInput = '';

    try {
      const response: WalkieTalkieResponse = await this.walkieTalkieService
        .sendTextMessage(text, this.threadId || undefined)
        .toPromise() as WalkieTalkieResponse;

      this.threadId = response.threadId;

      // Update messages
      this.messages.push({
        role: 'user',
        text: response.transcript,
        createdAt: new Date().toISOString(),
      });

      this.messages.push({
        role: 'assistant',
        text: response.responseText,
        audioUrl: response.ttsAudioUrl,
        createdAt: new Date().toISOString(),
      });

      // Start polling if not already polling
      if (!this.pollSubscription) {
        this.startPolling();
      }

      // Play TTS audio if available
      if (response.ttsAudioUrl) {
        this.playAudio(response.ttsAudioUrl);
      }

      console.log('[WalkieTalkie] Message sent successfully');
    } catch (error: any) {
      console.error('[WalkieTalkie] Error sending message:', error);
      this.toastService.show(
        error.error?.error || 'Failed to send message',
        'error'
      );
      this.textInput = text; // Restore text on error
    } finally {
      this.isSending = false;
    }
  }

  /**
   * Start recording audio
   */
  async startRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.sendAudioMessage(audioBlob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
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
  }

  /**
   * Send audio message
   */
  async sendAudioMessage(audioBlob: Blob): Promise<void> {
    if (this.isSending) {
      return;
    }

    this.isSending = true;

    try {
      // Convert Blob to File
      const audioFile = new File([audioBlob], 'audio.webm', { type: 'audio/webm' });

      const response: WalkieTalkieResponse = await this.walkieTalkieService
        .sendAudioMessage(audioFile, this.threadId || undefined)
        .toPromise() as WalkieTalkieResponse;

      this.threadId = response.threadId;

      // Update messages
      this.messages.push({
        role: 'user',
        text: response.transcript,
        createdAt: new Date().toISOString(),
      });

      this.messages.push({
        role: 'assistant',
        text: response.responseText,
        audioUrl: response.ttsAudioUrl,
        createdAt: new Date().toISOString(),
      });

      // Start polling if not already polling
      if (!this.pollSubscription) {
        this.startPolling();
      }

      // Play TTS audio if available
      if (response.ttsAudioUrl) {
        this.playAudio(response.ttsAudioUrl);
      }

      console.log('[WalkieTalkie] Audio message sent successfully');
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
   * Send emergency message
   */
  async sendEmergency(): Promise<void> {
    if (this.isEmergencySending || this.isRecording) {
      return;
    }

    try {
      // Start recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.isEmergencySending = true;
      this.isRecording = true;

      // Record for 5-10 seconds
      this.mediaRecorder.start();
      
      setTimeout(() => {
        this.mediaRecorder?.stop();
        this.isRecording = false;

        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], 'emergency.webm', { type: 'audio/webm' });

        this.walkieTalkieService.sendEmergency(audioFile).subscribe({
          next: (response: EmergencyResponse) => {
            this.isEmergencySending = false;
            this.toastService.show(
              `Emergency sent! ${response.notificationsSent} contact(s) notified.`,
              'success'
            );

            // Add emergency message to display
            this.messages.push({
              role: 'assistant',
              text: response.responseText,
              createdAt: new Date().toISOString(),
            });
          },
          error: (error: any) => {
            this.isEmergencySending = false;
            console.error('[WalkieTalkie] Emergency error:', error);
            this.toastService.show(
              error.error?.error || 'Failed to send emergency',
              'error'
            );
          },
        });

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      }, 7000); // Record for 7 seconds

      console.log('[WalkieTalkie] Emergency recording started');
    } catch (error: any) {
      this.isEmergencySending = false;
      this.isRecording = false;
      console.error('[WalkieTalkie] Error starting emergency recording:', error);
      this.toastService.show('Failed to access microphone', 'error');
    }
  }

  /**
   * Play audio from URL
   */
  playAudio(url: string): void {
    const audio = new Audio(url);
    audio.play().catch((error) => {
      console.error('[WalkieTalkie] Error playing audio:', error);
    });
  }

  /**
   * Format timestamp for display
   */
  formatTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

