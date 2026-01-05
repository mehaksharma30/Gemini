import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface TriggerPanicRequest {
  mode: 'AI' | 'CONTACT' | 'GROUP';
  message?: string;
  targetUserId?: string;
}

export interface TriggerPanicResponse {
  success: boolean;
  data: {
    incidentId: string;
    mode: 'AI' | 'CONTACT' | 'GROUP';
    replyText?: string;
    alertSent?: boolean;
    emailSent?: boolean;
    alertSentCount?: number;
    emailSentCount?: number;
  };
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class PanicService {
  private apiUrl = `${environment.apiUrl}/panic`;

  constructor(private http: HttpClient) {}

  triggerPanic(request: TriggerPanicRequest): Observable<TriggerPanicResponse> {
    return this.http.post<TriggerPanicResponse>(`${this.apiUrl}/trigger`, request);
  }
}





