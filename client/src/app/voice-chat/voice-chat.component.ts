import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AudioCommunicationService, AudioStreamState } from '../core/services/audio-communication.service';
import { AuthService } from '../core/services/auth.service';
import { UserService } from '../core/services/user.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-voice-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './voice-chat.component.html',
  styleUrls: ['./voice-chat.component.css']
})
export class VoiceChatComponent implements OnInit, OnDestroy {
  private audioService = inject(AudioCommunicationService);
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private destroy$ = new Subject<void>();

  state: AudioStreamState = {
    isRecording: false,
    isPlaying: false,
    isMuted: false,
    volume: 1.0
  };

  targetUserId: string = '';
  targetUserName: string = '';
  isInitialized: boolean = false;
  isConnecting: boolean = false;
  errorMessage: string = '';
  connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';

  ngOnInit(): void {
    // Subscribe to state changes
    this.audioService.state$
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.state = state;
      });

    // Subscribe to errors
    this.audioService.errors$
      .pipe(takeUntil(this.destroy$))
      .subscribe(error => {
        this.errorMessage = error;
        console.error('[Voice Chat] Error:', error);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cleanup();
  }

  /**
   * Initialize voice chat with target user
   */
  async initializeChat(): Promise<void> {
    if (!this.targetUserId) {
      this.errorMessage = 'Please enter a user ID';
      return;
    }

    try {
      this.isConnecting = true;
      this.connectionStatus = 'connecting';
      this.errorMessage = '';

      const currentUser = this.authService.currentUser();
      if (!currentUser || !currentUser.id) {
        throw new Error('Not authenticated');
      }

      // Get target user info
      try {
        const user = await this.userService.getUserById(this.targetUserId).toPromise();
        this.targetUserName = user?.username || 'Unknown User';
      } catch {
        this.targetUserName = 'User ' + this.targetUserId;
      }

      // Initialize audio communication
      await this.audioService.initialize(currentUser.id, this.targetUserId);
      
      this.isInitialized = true;
      this.connectionStatus = 'connected';
      this.errorMessage = '';
    } catch (error: any) {
      console.error('[Voice Chat] Initialization error:', error);
      this.errorMessage = error.message || 'Failed to initialize voice chat';
      this.connectionStatus = 'disconnected';
      this.isInitialized = false;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Start recording and sending audio
   */
  async startRecording(): Promise<void> {
    try {
      if (!this.isInitialized) {
        this.errorMessage = 'Please initialize chat first';
        return;
      }

      await this.audioService.startRecording();
      this.errorMessage = '';
    } catch (error: any) {
      console.error('[Voice Chat] Start recording error:', error);
      this.errorMessage = error.message || 'Failed to start recording';
    }
  }

  /**
   * Stop recording
   */
  async stopRecording(): Promise<void> {
    try {
      await this.audioService.stopRecording();
    } catch (error: any) {
      console.error('[Voice Chat] Stop recording error:', error);
      this.errorMessage = error.message || 'Failed to stop recording';
    }
  }

  /**
   * Toggle mute
   */
  async toggleMute(): Promise<void> {
    try {
      await this.audioService.toggleMute();
    } catch (error: any) {
      console.error('[Voice Chat] Toggle mute error:', error);
      this.errorMessage = error.message || 'Failed to toggle mute';
    }
  }

  /**
   * Set volume
   */
  setVolume(volume: number): void {
    this.audioService.setVolume(volume);
  }

  /**
   * Cleanup and disconnect
   */
  async cleanup(): Promise<void> {
    try {
      await this.audioService.cleanup();
      this.isInitialized = false;
      this.connectionStatus = 'disconnected';
      this.targetUserId = '';
      this.targetUserName = '';
    } catch (error) {
      console.error('[Voice Chat] Cleanup error:', error);
    }
  }

  /**
   * Disconnect and reset
   */
  async disconnect(): Promise<void> {
    await this.cleanup();
  }
}

