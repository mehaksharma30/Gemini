import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface RatingResponse {
  success: boolean;
  data: {
    ratingId?: string;
    rating: 'helpful' | 'not_helpful' | null;
    conversationId?: string;
    raterId?: string;
    ratedUserId?: string;
  };
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ChatRatingService {
  private apiUrl = `${environment.apiUrl}/chat/ratings`;

  constructor(private http: HttpClient) {}

  rateUser(
    conversationId: string,
    ratedUserId: string,
    rating: 'helpful' | 'not_helpful'
  ): Observable<RatingResponse> {
    return this.http.post<RatingResponse>(this.apiUrl, {
      conversationId,
      ratedUserId,
      rating,
    });
  }

  getRatingStatus(conversationId: string, ratedUserId: string): Observable<RatingResponse> {
    return this.http.get<RatingResponse>(`${this.apiUrl}/status`, {
      params: { conversationId, ratedUserId },
    });
  }

  deleteRating(conversationId: string): Observable<RatingResponse> {
    return this.http.delete<RatingResponse>(`${this.apiUrl}/${conversationId}`);
  }
}
