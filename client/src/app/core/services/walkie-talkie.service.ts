import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  WalkieTalkieThread,
  SendMessageResponse,
  PollMessagesResponse,
} from '../models/walkie-talkie.model';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root',
})
export class WalkieTalkieService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private apiUrl = environment.apiUrl;

  /**
   * Send an audio message from one user to another
   * @param fromUserId Sender user ID
   * @param toUserId Receiver user ID
   * @param audioFile Audio file to upload
   * @param threadId Optional thread ID (will be generated if not provided)
   * @param clientTimestamp Optional client-side timestamp
   * @returns Observable<SendMessageResponse>
   */
  sendMessage(
    fromUserId: string,
    toUserId: string,
    audioFile: File,
    threadId?: string,
    clientTimestamp?: number
  ): Observable<SendMessageResponse> {
    const token = this.authService.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const formData = new FormData();
    formData.append('fromUserId', fromUserId);
    formData.append('toUserId', toUserId);
    formData.append('audio', audioFile, audioFile.name);
    
    if (threadId) {
      formData.append('threadId', threadId);
    }
    
    if (clientTimestamp !== undefined) {
      formData.append('clientTimestamp', clientTimestamp.toString());
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      // Don't set Content-Type - let browser set it with boundary for multipart/form-data
    });

    return this.http.post<SendMessageResponse>(
      `${this.apiUrl}/wt/send`,
      formData,
      { headers }
    );
  }

  /**
   * Get thread between two users (all messages)
   * @param userA First user ID
   * @param userB Second user ID
   * @returns Observable<WalkieTalkieThread>
   */
  getThread(userA: string, userB: string): Observable<WalkieTalkieThread> {
    const token = this.authService.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
    });

    return this.http.get<WalkieTalkieThread>(
      `${this.apiUrl}/wt/thread?userA=${userA}&userB=${userB}`,
      { headers }
    );
  }

  /**
   * Poll for new messages in a thread
   * @param threadId Thread ID
   * @param after Optional timestamp or messageId to get messages after
   * @returns Observable<PollMessagesResponse>
   */
  pollMessages(threadId: string, after?: string): Observable<PollMessagesResponse> {
    const token = this.authService.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
    });

    let url = `${this.apiUrl}/wt/poll?threadId=${threadId}`;
    if (after) {
      url += `&after=${encodeURIComponent(after)}`;
    }

    return this.http.get<PollMessagesResponse>(url, { headers });
  }

  /**
   * Get audio URL for a message
   * @param messageId Message ID
   * @returns Audio URL
   */
  getAudioUrl(messageId: string): string {
    const token = this.authService.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    
    // Return the API endpoint URL - the browser will use the auth token from the request
    return `${this.apiUrl}/wt/audio/${messageId}`;
  }
}
