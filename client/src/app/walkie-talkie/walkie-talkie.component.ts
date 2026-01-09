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
  
  // Silence detection
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private silenceCheckInterval?: any;
  private lastSoundTime: number = 0;
  private readonly SILENCE_THRESHOLD = 0.01; // Audio level threshold
  private readonly SILENCE_DURATION = 1000; // 1 second of silence

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
    this.cleanupSilenceDetection();
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

    // Poll every 800ms for faster updates
    this.pollSubscription = interval(800).subscribe(() => {
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
        // Filter out messages we already have
        const existingMessageIds = new Set(this.messages.map(m => m.messageId));
        const newMessages = response.messages.filter(m => !existingMessageIds.has(m.messageId));

        if (newMessages.length > 0) {
          // Add new messages
          this.messages = [...this.messages, ...newMessages];

          // Update last message timestamp
          const lastMessage = newMessages[newMessages.length - 1];
          this.lastMessageTimestamp = lastMessage.createdAt;

          // Scroll to bottom when new messages arrive
          setTimeout(() => this.scrollToBottom(), 100);

          // Auto-play new messages from the other user
          for (const msg of newMessages) {
            if (msg.toUserId === this.currentUserId) {
              // This message is for us, auto-play it (don't await - let it play in background)
              this.playAudio(msg.audioUrl).catch(err => {
                console.error('[WalkieTalkie] Auto-play error:', err);
              });
            }
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

      // ENHANCED: Try M4A/MP4 first (watchOS compatible), then fallback
      const options: MediaRecorderOptions = {};
      
      // Priority: M4A/MP4 > WAV > WebM (for watchOS compatibility)
      const supportedFormats = [
        'audio/mp4',           // M4A (watchOS compatible) - preferred
        'audio/m4a',           // M4A alternative
        'audio/wav',           // WAV (watchOS compatible)
        'audio/webm;codecs=opus', // WebM (needs conversion)
        'audio/webm',          // WebM fallback
      ];

      let selectedFormat = 'audio/webm;codecs=opus'; // Default fallback
      for (const format of supportedFormats) {
        if (MediaRecorder.isTypeSupported(format)) {
          selectedFormat = format;
          break;
        }
      }

      options.mimeType = selectedFormat;

      console.log('[WalkieTalkie] 🎤 RECORDING FORMAT SELECTION:', {
        selectedFormat: selectedFormat,
        isM4A: selectedFormat.includes('mp4') || selectedFormat.includes('m4a'),
        isWAV: selectedFormat.includes('wav'),
        isWebM: selectedFormat.includes('webm'),
        isWatchOSCompatible: selectedFormat.includes('mp4') || selectedFormat.includes('m4a') || selectedFormat.includes('wav'),
        supportedFormats: supportedFormats.map(f => ({
          format: f,
          supported: MediaRecorder.isTypeSupported(f),
        })),
        warning: selectedFormat.includes('webm') ? '⚠️ Will be converted to M4A on server' : '✅ Direct watchOS compatible',
      });

      this.mediaRecorder = new MediaRecorder(stream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.recordingDuration = Date.now() - this.recordingStartTime;
        const recordedMimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.audioChunks, { type: recordedMimeType });
        
        // ENHANCED LOGGING: Track what was recorded
        console.log('[WalkieTalkie] 🛑 RECORDING STOPPED:', {
          durationMs: this.recordingDuration,
          recordedFormat: recordedMimeType,
          blobSizeBytes: audioBlob.size,
          blobType: audioBlob.type,
          isM4A: recordedMimeType.includes('mp4') || recordedMimeType.includes('m4a'),
          isWebM: recordedMimeType.includes('webm'),
          isWAV: recordedMimeType.includes('wav'),
          isWatchOSCompatible: recordedMimeType.includes('mp4') || recordedMimeType.includes('m4a') || recordedMimeType.includes('wav'),
          willNeedConversion: recordedMimeType.includes('webm'),
          timestamp: new Date().toISOString(),
        });

        this.sendAudioMessage(audioBlob);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        this.recordingStream = undefined;
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.lastSoundTime = Date.now();
      
      // Start silence detection
      this.startSilenceDetection(stream);
      
      console.log('[WalkieTalkie] ▶️ Recording started with format:', options.mimeType);
    } catch (error: any) {
      console.error('[WalkieTalkie] Error starting recording:', error);
      this.toastService.show('Failed to access microphone', 'error');
    }
  }

  /**
   * Start silence detection to auto-stop after 1 second of silence
   */
  private startSilenceDetection(stream: MediaStream): void {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.lastSoundTime = Date.now();

      // Check for silence every 100ms
      this.silenceCheckInterval = setInterval(() => {
        if (!this.isRecording || !this.analyser) {
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        
        // Calculate average audio level
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const normalizedLevel = average / 255;

        // If audio level is above threshold, update last sound time
        if (normalizedLevel > this.SILENCE_THRESHOLD) {
          this.lastSoundTime = Date.now();
        }

        // If silence duration exceeded, auto-stop
        const silenceDuration = Date.now() - this.lastSoundTime;
        if (silenceDuration >= this.SILENCE_DURATION && this.isRecording) {
          console.log('[WalkieTalkie] 🔇 Silence detected, auto-stopping recording');
          this.stopRecording();
        }
      }, 100);
    } catch (error: any) {
      console.error('[WalkieTalkie] Error setting up silence detection:', error);
      // Continue recording even if silence detection fails
    }
  }

  /**
   * Cleanup silence detection
   */
  private cleanupSilenceDetection(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = undefined;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = undefined;
    }
    this.analyser = undefined;
  }

  /**
   * Stop recording and send
   */
  stopRecording(): void {
    // Cleanup silence detection first
    this.cleanupSilenceDetection();

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

      // ENHANCED LOGGING: Track what's being sent to server
      console.log('[WalkieTalkie] 📤 SENDING TO SERVER:', {
        fromUserId: this.currentUserId,
        toUserId: this.selectedContactId,
        fileName: audioFile.name,
        fileExtension: extension,
        fileMimeType: audioBlob.type,
        fileSizeBytes: audioBlob.size,
        isM4A: extension === 'm4a' || audioBlob.type.includes('mp4') || audioBlob.type.includes('m4a'),
        isWebM: extension === 'webm' || audioBlob.type.includes('webm'),
        isWAV: extension === 'wav' || audioBlob.type.includes('wav'),
        isWatchOSCompatible: extension === 'm4a' || extension === 'wav' || extension === 'mp3',
        willNeedServerConversion: extension === 'webm',
        threadId: this.threadId,
        clientTimestamp,
        timestamp: new Date().toISOString(),
      });

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
        // ENHANCED LOGGING: Track server response
        console.log('[WalkieTalkie] ✅ SERVER RESPONSE RECEIVED:', {
          messageId: response.messageId,
          threadId: response.threadId,
          audioUrl: response.audioUrl,
          createdAt: response.createdAt,
          serverConfirmedFormat: response.audioUrl.includes('.m4a') ? 'M4A' : 
                                 response.audioUrl.includes('.webm') ? 'WebM' : 
                                 response.audioUrl.includes('.wav') ? 'WAV' : 'Unknown',
          timestamp: new Date().toISOString(),
        });

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

        // Scroll to bottom after sending
        setTimeout(() => this.scrollToBottom(), 100);

        // Start polling if not already polling
        if (!this.pollSubscription) {
          this.startPolling();
        }

        this.toastService.show('Message sent!', 'success');
        console.log('[WalkieTalkie] ✅ Audio message sent successfully');
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
  async playAudio(audioUrl: string): Promise<void> {
    // Stop current audio if playing
    this.cleanupAudioPlayer();

    // Extract messageId from audioUrl
    // audioUrl can be either "/api/wt/audio/msg_..." or just "msg_..."
    let messageId: string;
    if (audioUrl.startsWith('/api/wt/audio/')) {
      messageId = audioUrl.replace('/api/wt/audio/', '');
    } else if (audioUrl.includes('/')) {
      messageId = audioUrl.split('/').pop() || audioUrl;
    } else {
      messageId = audioUrl;
    }

    if (!messageId) {
      console.error('[WalkieTalkie] Invalid audio URL:', audioUrl);
      return;
    }

    try {
      const token = this.authService.getToken();
      if (!token) {
        this.toastService.show('Not authenticated', 'error');
        return;
      }

      // Fetch audio with auth token
      const fullUrl = this.walkieTalkieService.getAudioUrl(messageId);
      console.log('[WalkieTalkie] Fetching audio from:', fullUrl, 'messageId:', messageId);

      const response = await fetch(fullUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
      }

      // Get audio blob
      const audioBlob = await response.blob();
      console.log('[WalkieTalkie] Audio blob received:', {
        size: audioBlob.size,
        type: audioBlob.type,
      });

      if (audioBlob.size === 0) {
        throw new Error('Received empty audio file');
      }

      // Create object URL from blob
      const blobUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio();
      
      // CRITICAL FIX: Explicitly set src and wait for audio to load
      audio.src = blobUrl;
      audio.load(); // Force audio to load the blob URL

      // Wait for audio to be ready before playing
      await new Promise<void>((resolve, reject) => {
        const onCanPlay = () => {
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('error', onError);
          resolve();
        };

        const onError = (error: Event) => {
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('error', onError);
          reject(new Error('Audio failed to load'));
        };

        // If already ready, resolve immediately
        if (audio.readyState >= 2) { // HAVE_CURRENT_DATA
          resolve();
        } else {
          audio.addEventListener('canplay', onCanPlay);
          audio.addEventListener('error', onError);
          
          // Timeout after 5 seconds
          setTimeout(() => {
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            reject(new Error('Audio load timeout'));
          }, 5000);
        }
      });

      audio.onended = () => {
        URL.revokeObjectURL(blobUrl);
        this.cleanupAudioPlayer();
      };

      audio.onerror = (error) => {
        console.error('[WalkieTalkie] Error playing audio:', error);
        console.error('[WalkieTalkie] Audio error details:', {
          code: audio.error?.code,
          message: audio.error?.message,
        });
        URL.revokeObjectURL(blobUrl);
        this.toastService.show('Failed to play audio', 'error');
        this.cleanupAudioPlayer();
      };

      this.currentAudioPlayer = audio;
      await audio.play();
      console.log('[WalkieTalkie] Audio playback started');
    } catch (error: any) {
      console.error('[WalkieTalkie] Error loading/playing audio:', error);
      this.toastService.show(
        error.message || 'Failed to play audio',
        'error'
      );
      this.cleanupAudioPlayer();
    }
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

  /**
   * Scroll to bottom of messages
   */
  scrollToBottom(): void {
    const container = document.querySelector('.messages-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  /**
   * Check if audio is currently playing
   */
  isAudioPlaying(): boolean {
    return this.currentAudioPlayer !== null && !this.currentAudioPlayer.paused;
  }
}
