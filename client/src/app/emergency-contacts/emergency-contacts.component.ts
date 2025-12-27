import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EmergencyService, EmergencyContactUser } from '../core/services/emergency.service';
import { ToastService } from '../core/services/toast.service';
import { RemoveContactModalComponent } from './remove-contact-modal.component';

@Component({
  selector: 'app-emergency-contacts',
  standalone: true,
  imports: [CommonModule, RemoveContactModalComponent],
  template: `
    <div class="emergency-container">
      <div class="container">
        <h1>Emergency Contacts</h1>
        
        <div class="contacts-list" *ngIf="contacts.length > 0">
          <div *ngFor="let contact of contacts" class="contact-item">
            <div class="contact-info">
              <div class="contact-avatar">{{ getInitials(contact.username) }}</div>
              <div class="contact-details">
                <h3>{{ contact.username }}</h3>
              </div>
            </div>
            <button 
              class="remove-btn" 
              (click)="removeContact(contact.id)"
              [disabled]="isRemoving"
            >
              Remove
            </button>
          </div>
        </div>

        <div class="empty-state" *ngIf="contacts.length === 0 && !isLoading">
          <p>No emergency contacts added yet.</p>
          <p class="hint">Mark someone "Helpful" in chat to add them as an emergency contact.</p>
        </div>

        <div class="loading" *ngIf="isLoading">
          <p>Loading...</p>
        </div>

        <p class="status success" *ngIf="statusMessage && statusMessage.type === 'success'">
          {{ statusMessage.text }}
        </p>
        <p class="status error" *ngIf="statusMessage && statusMessage.type === 'error'">
          {{ statusMessage.text }}
        </p>
      </div>

      <app-remove-contact-modal
        [isOpen]="showRemoveModal"
        [username]="removeModalUsername"
        (confirmed)="onRemoveModalConfirmed($event)"
        (closed)="showRemoveModal = false"
      />
    </div>
  `,
  styles: [`
    .emergency-container {
      padding: 20px;
      background: var(--bg-gradient);
      color: var(--text-primary);
      min-height: 100vh;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    h1 {
      margin-bottom: 1.5rem;
      color: var(--text-primary);
    }
    .contacts-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .contact-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--card-gradient);
      border: 1px solid var(--border-color);
      padding: 1.5rem;
      border-radius: 16px;
      box-shadow: 0 10px 40px var(--shadow-lg);
    }
    .contact-info {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .contact-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--primary-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      font-size: 1.1rem;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .contact-details h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary);
    }
    .remove-btn {
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 2px solid var(--error-color);
      background: transparent;
      color: var(--error-color);
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .remove-btn:hover:not(:disabled) {
      background: var(--error-color);
      color: white;
    }
    .remove-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      background: var(--card-gradient);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      color: var(--text-secondary);
    }
    .empty-state p {
      margin: 0.5rem 0;
    }
    .empty-state .hint {
      font-size: 0.9rem;
      color: var(--text-muted);
      margin-top: 1rem;
    }
    .loading {
      text-align: center;
      padding: 2rem;
      color: var(--text-secondary);
    }
    .status {
      margin-top: 1rem;
      font-weight: 500;
      padding: 1rem;
      border-radius: 10px;
    }
    .status.success {
      color: #34d399;
      background: rgba(52, 211, 153, 0.1);
      border: 1px solid #34d399;
    }
    .status.error {
      color: var(--error-color);
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid var(--error-color);
    }
  `]
})
export class EmergencyContactsComponent implements OnInit {
  private emergencyService = inject(EmergencyService);
  private toastService = inject(ToastService);

  contacts: EmergencyContactUser[] = [];
  isLoading = false;
  isRemoving = false;
  statusMessage: { type: 'success' | 'error'; text: string } | null = null;
  showRemoveModal = false;
  removeModalUsername = '';
  pendingRemoveContactId = '';

  ngOnInit(): void {
    this.loadEmergencyContacts();
  }

  loadEmergencyContacts(): void {
    this.isLoading = true;
    this.statusMessage = null;

    this.emergencyService.getEmergencyContacts().subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.success && response.data) {
          this.contacts = response.data;
        } else {
          this.contacts = [];
        }
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Error loading emergency contacts:', err);
        this.statusMessage = {
          type: 'error',
          text: err.error?.message || 'Failed to load emergency contacts',
        };
      },
    });
  }

  removeContact(contactUserId: string): void {
    if (this.isRemoving) return;

    const contact = this.contacts.find(c => c.id === contactUserId);
    if (!contact) return;

    this.pendingRemoveContactId = contactUserId;
    this.removeModalUsername = contact.username;
    this.showRemoveModal = true;
  }

  onRemoveModalConfirmed(confirmed: boolean): void {
    this.showRemoveModal = false;

    if (!confirmed) {
      this.pendingRemoveContactId = '';
      return;
    }

    if (!this.pendingRemoveContactId) return;

    this.isRemoving = true;
    this.statusMessage = null;

    this.emergencyService.removeEmergencyContact(this.pendingRemoveContactId).subscribe({
      next: (response) => {
        this.isRemoving = false;
        if (response.success && response.data) {
          this.contacts = response.data;
          this.toastService.show('Removed from Emergency Contacts.', 'success');
        } else {
          this.toastService.show('Could not remove. Please try again.', 'error');
        }
        this.pendingRemoveContactId = '';
      },
      error: (err) => {
        this.isRemoving = false;
        console.error('Failed to remove emergency contact:', err);
        this.toastService.show('Could not remove. Please try again.', 'error');
        this.pendingRemoveContactId = '';
      },
    });
  }

  getInitials(username: string): string {
    if (!username) return '?';
    const parts = username.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return username.substring(0, 2).toUpperCase();
  }
}
