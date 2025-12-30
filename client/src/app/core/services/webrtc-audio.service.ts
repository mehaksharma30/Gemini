import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface WebRTCState {
  isConnected: boolean;
  isMuted: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

@Injectable({
  providedIn: 'root',
})
export class WebRTCAudioService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private remoteAudioElement: HTMLAudioElement | null = null;
  
  private stateSubject = new Subject<WebRTCState>();
  private errorSubject = new Subject<string>();
  
  public state$ = this.stateSubject.asObservable();
  public errors$ = this.errorSubject.asObservable();
  
  private currentState: WebRTCState = {
    isConnected: false,
    isMuted: false,
    localStream: null,
    remoteStream: null,
  };

  // Queue for ICE candidates received before remote description is set
  private iceCandidateQueue: RTCIceCandidate[] = [];

  /**
   * Initialize WebRTC peer connection
   */
  async initialize(callId: string, isCaller: boolean): Promise<void> {
    try {
      // Create peer connection with STUN servers
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      });
      
      // Set up ICE candidate handler
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.iceCandidateSubject) {
          this.iceCandidateSubject.next(event.candidate);
          console.log('[WebRTC] ICE candidate generated');
        }
      };
      
      // Set up connection state handler
      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection?.connectionState;
        console.log('[WebRTC] Connection state:', state);
        
        if (state === 'connected') {
          this.currentState.isConnected = true;
          this.updateState();
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          this.currentState.isConnected = false;
          this.updateState();
        }
      };
      
      // Set up remote stream handler
      this.peerConnection.ontrack = (event) => {
        console.log('[WebRTC] Remote track received');
        if (event.streams && event.streams[0]) {
          this.remoteStream = event.streams[0];
          this.playRemoteAudio(this.remoteStream);
          this.updateState();
        }
      };
      
      // Get local media stream
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      
      // Add local tracks to peer connection
      this.localStream.getTracks().forEach(track => {
        if (this.peerConnection) {
          this.peerConnection.addTrack(track, this.localStream!);
        }
      });
      
      this.currentState.localStream = this.localStream;
      this.updateState();
      
      console.log('[WebRTC] Initialized, isCaller:', isCaller);
    } catch (error: any) {
      console.error('[WebRTC] Initialization error:', error);
      this.errorSubject.next(error.message || 'Failed to initialize WebRTC');
      throw error;
    }
  }

  /**
   * Create and send offer (caller)
   */
  async createOffer(): Promise<any> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }
    
    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      console.log('[WebRTC] Offer created');
      return offer;
    } catch (error: any) {
      console.error('[WebRTC] Error creating offer:', error);
      this.errorSubject.next(error.message || 'Failed to create offer');
      throw error;
    }
  }

  /**
   * Handle incoming offer (callee)
   */
  async handleOffer(offer: any): Promise<any> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }
    
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      console.log('[WebRTC] Remote description set (offer)');
      
      // Process any queued ICE candidates
      await this.processIceCandidateQueue();
      
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      console.log('[WebRTC] Answer created');
      return answer;
    } catch (error: any) {
      console.error('[WebRTC] Error handling offer:', error);
      this.errorSubject.next(error.message || 'Failed to handle offer');
      throw error;
    }
  }

  /**
   * Handle incoming answer (caller)
   */
  async handleAnswer(answer: any): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }
    
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('[WebRTC] Remote description set (answer)');
      
      // Process any queued ICE candidates
      await this.processIceCandidateQueue();
      
      console.log('[WebRTC] Answer handled');
    } catch (error: any) {
      console.error('[WebRTC] Error handling answer:', error);
      this.errorSubject.next(error.message || 'Failed to handle answer');
      throw error;
    }
  }

  /**
   * Add ICE candidate
   * Queues candidates if remote description is not set yet
   */
  async addICECandidate(candidate: any): Promise<void> {
    if (!this.peerConnection) {
      return;
    }
    
    try {
      const iceCandidate = new RTCIceCandidate(candidate);
      
      // Check if remote description is set
      if (this.peerConnection.remoteDescription) {
        // Remote description is set, add candidate immediately
        await this.peerConnection.addIceCandidate(iceCandidate);
        console.log('[WebRTC] ICE candidate added');
      } else {
        // Remote description not set yet, queue the candidate
        this.iceCandidateQueue.push(iceCandidate);
        console.log('[WebRTC] ICE candidate queued (remote description not set yet). Queue size:', this.iceCandidateQueue.length);
      }
    } catch (error: any) {
      // If it's not the "remote description null" error, log it
      if (!error.message?.includes('remote description') && !error.message?.includes('null')) {
        console.error('[WebRTC] Error adding ICE candidate:', error);
      }
    }
  }

  /**
   * Process queued ICE candidates after remote description is set
   */
  private async processIceCandidateQueue(): Promise<void> {
    if (!this.peerConnection || this.iceCandidateQueue.length === 0) {
      return;
    }

    console.log('[WebRTC] Processing queued ICE candidates:', this.iceCandidateQueue.length);
    
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      if (candidate) {
        try {
          await this.peerConnection!.addIceCandidate(candidate);
          console.log('[WebRTC] Queued ICE candidate added');
        } catch (error: any) {
          console.error('[WebRTC] Error adding queued ICE candidate:', error);
        }
      }
    }
  }

  private iceCandidateSubject: Subject<RTCIceCandidate> | null = null;

  /**
   * Get ICE candidates (for sending via signaling)
   */
  getICECandidates(): Observable<RTCIceCandidate> {
    if (!this.iceCandidateSubject) {
      this.iceCandidateSubject = new Subject<RTCIceCandidate>();
    }
    return this.iceCandidateSubject.asObservable();
  }

  /**
   * Toggle mute
   */
  toggleMute(): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      this.currentState.isMuted = !this.currentState.isMuted;
      this.updateState();
      console.log('[WebRTC] Muted:', this.currentState.isMuted);
    }
  }

  /**
   * Check if muted
   */
  isMuted(): boolean {
    return this.currentState.isMuted;
  }

  /**
   * Play remote audio stream
   */
  private playRemoteAudio(stream: MediaStream): void {
    // Clean up existing audio element
    if (this.remoteAudioElement) {
      this.remoteAudioElement.pause();
      this.remoteAudioElement.srcObject = null;
    }
    
    // Create new audio element
    this.remoteAudioElement = new Audio();
    this.remoteAudioElement.srcObject = stream;
    this.remoteAudioElement.autoplay = true;
    this.remoteAudioElement.play().catch(error => {
      console.error('[WebRTC] Error playing remote audio:', error);
    });
    
    this.currentState.remoteStream = stream;
    console.log('[WebRTC] Remote audio playing');
  }

  /**
   * Get current state
   */
  getState(): WebRTCState {
    return { ...this.currentState };
  }

  /**
   * Update state and notify subscribers
   */
  private updateState(): void {
    this.stateSubject.next({ ...this.currentState });
  }

  /**
   * Cleanup and close connection
   */
  async cleanup(): Promise<void> {
    try {
      // Stop local stream
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }
      
      // Stop remote audio
      if (this.remoteAudioElement) {
        this.remoteAudioElement.pause();
        this.remoteAudioElement.srcObject = null;
        this.remoteAudioElement = null;
      }
      
      // Close peer connection
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
      
      // Clean up ICE candidate subject
      if (this.iceCandidateSubject) {
        this.iceCandidateSubject.complete();
        this.iceCandidateSubject = null;
      }
      
      // Clear ICE candidate queue
      this.iceCandidateQueue = [];
      
      this.currentState = {
        isConnected: false,
        isMuted: false,
        localStream: null,
        remoteStream: null,
      };
      
      this.updateState();
      console.log('[WebRTC] Cleaned up');
    } catch (error) {
      console.error('[WebRTC] Cleanup error:', error);
    }
  }
}

