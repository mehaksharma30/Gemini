import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface EmergencyContactUser {
  id: string;
  username: string;
  email: string;
}

export interface EmergencyContactsResponse {
  success: boolean;
  data: EmergencyContactUser[];
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class EmergencyService {
  private apiUrl = `${environment.apiUrl}/emergency`;

  constructor(private http: HttpClient) {}

  getEmergencyContacts(): Observable<EmergencyContactsResponse> {
    return this.http.get<EmergencyContactsResponse>(`${this.apiUrl}/contacts`);
  }

  addEmergencyContact(contactUserId: string): Observable<EmergencyContactsResponse> {
    return this.http.post<EmergencyContactsResponse>(`${this.apiUrl}/contacts/add`, {
      contactUserId,
    });
  }

  removeEmergencyContact(contactUserId: string): Observable<EmergencyContactsResponse> {
    return this.http.delete<EmergencyContactsResponse>(`${this.apiUrl}/contacts/${contactUserId}`);
  }
}
