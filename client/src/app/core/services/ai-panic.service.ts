import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PanicChatRequest {
  message: string;
  history: ChatMessage[];
}

export interface PanicChatResponse {
  success: boolean;
  message: string;
  reply?: string; // Legacy field for backward compatibility
}

@Injectable({
  providedIn: 'root',
})
export class AIPanicService {
  private apiUrl = 'http://localhost:3000/api/ai';

  constructor(private http: HttpClient) {}

  sendMessage(request: PanicChatRequest): Observable<PanicChatResponse> {
    return this.http.post<PanicChatResponse>(`${this.apiUrl}/panic-chat`, request);
  }

  // Helper method for promise-based usage
  async sendMessageAsync(request: PanicChatRequest): Promise<PanicChatResponse> {
    return firstValueFrom(this.sendMessage(request));
  }
}



