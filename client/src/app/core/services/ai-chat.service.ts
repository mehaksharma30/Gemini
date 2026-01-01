import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface RecommendedPost {
  postId: string;
  authorId: string;
  authorName: string;
  title: string;
  excerpt: string;
  tags: string[];
}

export interface AIResponse {
  success: boolean;
  answer: string;
  recommendations: RecommendedPost[];
  error?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AIChatService {
  private apiUrl = `${environment.apiBaseUrl}/api/ai`;

  constructor(private http: HttpClient) {}

  ask(question: string): Observable<AIResponse> {
    return this.http.post<AIResponse>(`${this.apiUrl}/chat`, { question });
  }
}
