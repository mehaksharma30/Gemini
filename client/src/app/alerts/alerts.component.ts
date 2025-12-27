import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AlertsService, Alert } from '../core/services/alerts.service';
import { ToastService } from '../core/services/toast.service';

@Component({
  selector: 'app-alerts',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="alerts-container">
      <div class="container">
        <h1>Emergency Alerts</h1>

        <div class="alerts-list" *ngIf="alerts.length > 0">
          <div *ngFor="let alert of alerts" class="alert-card" [class.acked]="alert.status === 'ACKED'">
            <div class="alert-header">
              <div class="alert-avatar">{{ getInitials(alert.fromUsername) }}</div>
              <div class="alert-info">
                <h3>{{ alert.fromUsername }} needs support</h3>
                <span class="alert-time">{{ getTimeAgo(alert.createdAt) }}</span>
              </div>
              <span class="status-badge" [class.sent]="alert.status === 'SENT'" [class.acked]="alert.status === 'ACKED'">
                {{ alert.status }}
              </span>
            </div>
            <div class="alert-actions" *ngIf="alert.status === 'SENT'">
              <button class="ack-btn" (click)="acknowledgeAlert(alert.id)" [disabled]="isAcknowledging">
                Acknowledge
              </button>
              <button class="chat-btn" (click)="openChat(alert.fromUserId)">
                Open Chat
              </button>
            </div>
            <div class="alert-actions" *ngIf="alert.status === 'ACKED'">
              <button class="chat-btn" (click)="openChat(alert.fromUserId)">
                Open Chat
              </button>
            </div>
          </div>
        </div>

        <div class="empty-state" *ngIf="alerts.length === 0 && !isLoading">
          <p>No emergency alerts</p>
          <p class="hint">You'll see alerts here when someone needs your support.</p>
        </div>

        <div class="loading" *ngIf="isLoading">
          <p>Loading alerts...</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .alerts-container {
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
    .alerts-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .alert-card {
      background: var(--card-gradient);
      border: 1px solid var(--border-color);
      padding: 1.5rem;
      border-radius: 16px;
      box-shadow: 0 10px 40px var(--shadow-lg);
      transition: all 0.3s ease;
    }
    .alert-card:hover {
      border-color: var(--teal-accent);
    }
    .alert-card.acked {
      opacity: 0.7;
    }
    .alert-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .alert-avatar {
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
    .alert-info {
      flex: 1;
    }
    .alert-info h3 {
      margin: 0 0 0.25rem 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary);
    }
    .alert-time {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
    .status-badge {
      padding: 0.35rem 0.75rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-badge.sent {
      background: rgba(239, 68, 68, 0.15);
      color: var(--error-color);
      border: 1px solid var(--error-color);
    }
    .status-badge.acked {
      background: rgba(52, 211, 153, 0.15);
      color: #34d399;
      border: 1px solid #34d399;
    }
    .alert-actions {
      display: flex;
      gap: 0.75rem;
    }
    .ack-btn,
    .chat-btn {
      padding: 0.65rem 1.25rem;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      border: none;
    }
    .ack-btn {
      background: var(--button-gradient);
      color: var(--light-gray);
      box-shadow: 0 2px 8px rgba(118, 171, 174, 0.3);
    }
    .ack-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(118, 171, 174, 0.4);
      background: var(--button-hover);
    }
    .ack-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .chat-btn {
      background: transparent;
      color: var(--text-primary);
      border: 2px solid var(--border-color);
    }
    .chat-btn:hover {
      border-color: var(--teal-accent);
      background: rgba(118, 171, 174, 0.1);
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
  `]
})
export class AlertsComponent implements OnInit {
  private alertsService = inject(AlertsService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  alerts: Alert[] = [];
  isLoading = false;
  isAcknowledging = false;

  ngOnInit(): void {
    this.loadAlerts();
  }

  loadAlerts(): void {
    this.isLoading = true;

    this.alertsService.getAlertsInbox().subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.success && response.data) {
          this.alerts = response.data;
        } else {
          this.alerts = [];
        }
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Error loading alerts:', err);
        this.toastService.show('Failed to load alerts. Please try again.', 'error');
      },
    });
  }

  acknowledgeAlert(alertId: string): void {
    if (this.isAcknowledging) return;

    this.isAcknowledging = true;

    this.alertsService.acknowledgeAlert(alertId).subscribe({
      next: (response) => {
        this.isAcknowledging = false;
        if (response.success) {
          this.toastService.show('Alert acknowledged.', 'success');
          // Update local state
          const alert = this.alerts.find(a => a.id === alertId);
          if (alert) {
            alert.status = 'ACKED';
          }
        }
      },
      error: (err) => {
        this.isAcknowledging = false;
        console.error('Error acknowledging alert:', err);
        this.toastService.show('Failed to acknowledge alert. Please try again.', 'error');
      },
    });
  }

  openChat(userId: string): void {
    this.router.navigate(['/messages', userId]);
  }

  getInitials(username: string): string {
    if (!username) return '?';
    const parts = username.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return username.substring(0, 2).toUpperCase();
  }

  getTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}



