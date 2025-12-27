import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Alert {
  id: string;
  incidentId: string;
  fromUserId: string;
  fromUsername: string;
  status: 'SENT' | 'ACKED';
  createdAt: string;
  mode: 'AI' | 'CONTACT' | 'GROUP';
  message?: string;
}

export interface AlertsInboxResponse {
  success: boolean;
  data: Alert[];
}

export interface AcknowledgeAlertResponse {
  success: boolean;
  data: {
    id: string;
    status: 'SENT' | 'ACKED';
    incidentId: string;
    fromUserId: string;
    toUserId: string;
  };
}

@Injectable({
  providedIn: 'root',
})
export class AlertsService {
  private apiUrl = 'http://localhost:3000/api/alerts';

  constructor(private http: HttpClient) {}

  getAlertsInbox(): Observable<AlertsInboxResponse> {
    return this.http.get<AlertsInboxResponse>(`${this.apiUrl}/inbox`);
  }

  acknowledgeAlert(alertId: string): Observable<AcknowledgeAlertResponse> {
    return this.http.post<AcknowledgeAlertResponse>(`${this.apiUrl}/${alertId}/ack`, {});
  }
}



