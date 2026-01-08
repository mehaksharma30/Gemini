import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, interval } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  WalkieTalkieResponse,
  WalkieTalkieThread,
  EmergencyResponse,
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
   * Send a text message to walkie-talkie API
   */
  sendTextMessage(text: string, threadId?: string): Observable<WalkieTalkieResponse> {
    const token = this.authService.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    });

    const body: any = { text };
    if (threadId) {
      body.threadId = threadId;
    }

    return this.http.post<WalkieTalkieResponse>(
      `${this.apiUrl}/wt/message`,
      body,
      { headers }
    );
  }

  /**
   * Send an audio file to walkie-talkie API
   */
  sendAudioMessage(audioFile: File, threadId?: string): Observable<WalkieTalkieResponse> {
    const token = this.authService.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const formData = new FormData();
    formData.append('audio', audioFile);
    if (threadId) {
      formData.append('threadId', threadId);
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      // Don't set Content-Type - let browser set it with boundary for multipart/form-data
    });

    return this.http.post<WalkieTalkieResponse>(
      `${this.apiUrl}/wt/message`,
      formData,
      { headers }
    );
  }

  /**
   * Send an emergency audio clip
   */
  sendEmergency(audioFile: File): Observable<EmergencyResponse> {
    const token = this.authService.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const formData = new FormData();
    formData.append('audio', audioFile);

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
    });

    return this.http.post<EmergencyResponse>(
      `${this.apiUrl}/wt/emergency`,
      formData,
      { headers }
    );
  }

  /**
   * Get thread messages
   */
  getThread(threadId: string): Observable<WalkieTalkieThread> {
    const token = this.authService.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
    });

    return this.http.get<WalkieTalkieThread>(
      `${this.apiUrl}/wt/thread/${threadId}`,
      { headers }
    );
  }

  /**
   * Poll thread messages every 1-2 seconds
   */
  pollThread(threadId: string, intervalMs: number = 1500): Observable<WalkieTalkieThread> {
    return interval(intervalMs).pipe(
      switchMap(() => this.getThread(threadId))
    );
  }
}

