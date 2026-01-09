import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PanicChatRequest {
  message: string;
  history: ChatMessage[];
  conversationId?: string;
  detectedLang?: 'en'; // Optional: detected language from STT (always 'en' - English only)
}

export interface BreathingAction {
  type: 'BREATHING_EXERCISE';
  payload: {
    pattern: string;
    cycles: number;
  };
}

export interface PanicChatResponse {
  success: boolean;
  message: string;
  conversationId?: string;
  reply?: string; // Legacy field for backward compatibility
  action?: BreathingAction; // Optional action (e.g., breathing exercise)
}

@Injectable({
  providedIn: 'root',
})
export class AIPanicService {
  private apiUrl = `${environment.apiUrl}/ai`;

  constructor(private http: HttpClient) {}

  sendMessage(request: PanicChatRequest): Observable<PanicChatResponse> {
    const endpoint = `${this.apiUrl}/panic-chat`;
    const authToken = this.getAuthToken();
    
    // Detailed logging for debugging
    console.log('[AIPanicService] Sending message:', {
      endpoint,
      payload: {
        message: request.message?.substring(0, 50) + (request.message?.length > 50 ? '...' : ''),
        historyLength: request.history?.length || 0,
        conversationId: request.conversationId || 'none',
      },
      authTokenPresent: !!authToken,
      authTokenLength: authToken?.length || 0,
    });

    return this.http.post<PanicChatResponse>(endpoint, request);
  }

  // Helper method for promise-based usage
  async sendMessageAsync(request: PanicChatRequest): Promise<PanicChatResponse> {
    const endpoint = `${this.apiUrl}/panic-chat`;
    const authToken = this.getAuthToken();
    
    // Detailed logging for debugging
    console.log('[AIPanicService] Sending message (async):', {
      endpoint,
      payload: {
        message: request.message?.substring(0, 50) + (request.message?.length > 50 ? '...' : ''),
        historyLength: request.history?.length || 0,
        conversationId: request.conversationId || 'none',
      },
      authTokenPresent: !!authToken,
    });

    try {
      const response = await firstValueFrom(this.sendMessage(request));
      console.log('[AIPanicService] Message sent successfully:', {
        success: response.success,
        messageLength: response.message?.length || 0,
        conversationId: response.conversationId || 'none',
      });
      return response;
    } catch (error: any) {
      console.error('[AIPanicService] Message send failed:', {
        status: error.status || 'unknown',
        statusText: error.statusText || 'unknown',
        error: error.error || error.message,
        errorDetails: error.error ? JSON.stringify(error.error, null, 2) : 'none',
        url: error.url || endpoint,
      });
      throw error;
    }
  }

  private getAuthToken(): string | null {
    // Try to get token from localStorage or sessionStorage
    try {
      return localStorage.getItem('token') || sessionStorage.getItem('token');
    } catch {
      return null;
    }
  }
}



