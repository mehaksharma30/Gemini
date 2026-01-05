import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../core/components/modal/modal.component';

@Component({
  selector: 'app-emergency-contact-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      title="Add to Emergency Contacts?"
      (close)="onClose()"
    >
      <p>Do you want to add <strong>{{ username }}</strong> to your Emergency Contacts for panic situations? (Max 3)</p>
      
      <div footer class="modal-actions">
        <button class="btn-secondary" (click)="onNo()">No</button>
        <button class="btn-primary" (click)="onYes()">Yes, add</button>
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

    .btn-primary,
    .btn-secondary {
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
    }

    .btn-primary {
      background: var(--button-gradient);
      color: var(--light-gray);
      box-shadow: 0 2px 8px rgba(118, 171, 174, 0.3);
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(118, 171, 174, 0.4);
      background: var(--button-hover);
    }

    .btn-secondary {
      background: transparent;
      color: var(--text-primary);
      border: 1px solid var(--border-color);
    }

    .btn-secondary:hover {
      background: var(--bg-tertiary);
    }
  `]
})
export class EmergencyContactModalComponent {
  @Input() isOpen = false;
  @Input() username = '';
  @Output() confirmed = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();

  onYes(): void {
    this.confirmed.emit(true);
    this.isOpen = false;
  }

  onNo(): void {
    this.confirmed.emit(false);
    this.isOpen = false;
  }

  onClose(): void {
    this.closed.emit();
    this.isOpen = false;
  }
}






