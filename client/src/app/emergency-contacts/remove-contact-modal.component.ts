import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../core/components/modal/modal.component';

@Component({
  selector: 'app-remove-contact-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      title="Remove emergency contact?"
      (close)="onClose()"
    >
      <p>Are you sure you want to remove <strong>{{ username }}</strong> from your Emergency Contacts?</p>
      
      <div footer class="modal-actions">
        <button class="btn-secondary" (click)="onCancel()">Cancel</button>
        <button class="btn-danger" (click)="onRemove()">Remove</button>
      </div>
    </app-modal>
  `,
  styles: [`
    p {
      margin: 0;
      color: var(--text-primary);
      line-height: 1.6;
    }

    strong {
      color: var(--text-primary);
      font-weight: 600;
    }

    .modal-actions {
      display: flex;
      gap: 0.75rem;
      justify-content: flex-end;
      width: 100%;
    }

    .btn-secondary,
    .btn-danger {
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
    }

    .btn-secondary {
      background: transparent;
      color: var(--text-primary);
      border: 1px solid var(--border-color);
    }

    .btn-secondary:hover {
      background: var(--bg-tertiary);
    }

    .btn-danger {
      background: var(--error-color);
      color: white;
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
    }

    .btn-danger:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
      background: #dc2626;
    }
  `]
})
export class RemoveContactModalComponent {
  @Input() isOpen = false;
  @Input() username = '';
  @Output() confirmed = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();

  onRemove(): void {
    this.confirmed.emit(true);
    this.isOpen = false;
  }

  onCancel(): void {
    this.confirmed.emit(false);
    this.isOpen = false;
  }

  onClose(): void {
    this.closed.emit();
    this.isOpen = false;
  }
}





