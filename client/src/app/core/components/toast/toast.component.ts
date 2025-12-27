import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container">
      <div
        *ngFor="let toast of toasts"
        class="toast"
        [class.success]="toast.type === 'success'"
        [class.error]="toast.type === 'error'"
        [class.info]="toast.type === 'info'"
        (click)="removeToast(toast.id)"
      >
        <span class="toast-message">{{ toast.message }}</span>
        <button class="toast-close" (click)="removeToast(toast.id)">×</button>
      </div>
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10001;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      max-width: 400px;
    }

    .toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.25rem;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      border: 1px solid;
      cursor: pointer;
      animation: slideInRight 0.3s ease;
      min-width: 300px;
    }

    @keyframes slideInRight {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    .toast.success {
      background: rgba(52, 211, 153, 0.15);
      border-color: #34d399;
      color: #34d399;
    }

    .toast.error {
      background: rgba(239, 68, 68, 0.15);
      border-color: var(--error-color);
      color: var(--error-color);
    }

    .toast.info {
      background: rgba(118, 171, 174, 0.15);
      border-color: var(--teal-accent);
      color: var(--teal-accent);
    }

    .toast-message {
      flex: 1;
      font-size: 0.9rem;
      font-weight: 500;
      line-height: 1.4;
    }

    .toast-close {
      background: none;
      border: none;
      color: currentColor;
      font-size: 1.5rem;
      line-height: 1;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.7;
      transition: opacity 0.2s;
      flex-shrink: 0;
    }

    .toast-close:hover {
      opacity: 1;
    }

    @media (max-width: 480px) {
      .toast-container {
        right: 10px;
        left: 10px;
        max-width: none;
      }

      .toast {
        min-width: auto;
      }
    }
  `]
})
export class ToastComponent implements OnInit, OnDestroy {
  private toastService = inject(ToastService);
  private subscription?: Subscription;
  toasts: Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }> = [];

  ngOnInit(): void {
    this.subscription = this.toastService.toasts$.subscribe(toasts => {
      this.toasts = toasts;
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  removeToast(id: string): void {
    this.toastService.remove(id);
  }
}



