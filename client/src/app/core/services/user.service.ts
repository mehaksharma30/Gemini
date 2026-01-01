import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse, Post } from '../models/post.model';
import { environment } from '../../../environments/environment';

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  tokens: number;
  xp: number;
  level: number;
  badge: 'none' | 'silver' | 'gold' | 'diamond';
  createdAt: string;
  postCount: number;
}

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private apiUrl = `${environment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

  getUserProfile(userId: string): Observable<{ success: boolean; data: UserProfile }> {
    return this.http.get<{ success: boolean; data: UserProfile }>(`${this.apiUrl}/${userId}`);
  }

  getUserPosts(userId: string, page = 1, limit = 20): Observable<ApiResponse<Post[]>> {
    return this.http.get<ApiResponse<Post[]>>(`${this.apiUrl}/${userId}/posts?page=${page}&limit=${limit}`);
  }
}
