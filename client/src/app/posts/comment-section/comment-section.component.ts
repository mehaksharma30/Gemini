import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Comment } from '../../core/models/comment.model';
import { CommentService } from '../../core/services/comment.service';
import { AuthService } from '../../core/services/auth.service';
import { ModalComponent } from '../../core/components/modal/modal.component';

@Component({
  selector: 'app-comment-section',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  template: `
    <div class="comment-section">
      <div class="comment-header">
        <h4>Comments ({{ comments.length }})</h4>
      </div>

      
      <div class="comment-input-wrapper">
        <div class="comment-avatar">{{ getUserInitials() }}</div>
        <textarea
          [(ngModel)]="newCommentContent"
          placeholder="Add a supportive comment..."
          class="comment-input"
          rows="2"
          maxlength="1000"
          (keydown.enter)="onEnter($event)"
        ></textarea>
      </div>
      <div class="comment-actions">
        <span class="char-count" [class.warning]="newCommentContent.length > 900">
          {{ newCommentContent.length }}/1000
        </span>
        <button 
          class="comment-submit-btn"
          (click)="submitComment()"
          [disabled]="!newCommentContent.trim() || isSubmitting"
        >
          {{ isSubmitting ? 'Posting...' : 'Comment' }}
        </button>
      </div>

      
      <div class="comments-list" *ngIf="comments.length > 0">
        <div class="comment-item" *ngFor="let comment of comments">
          <div class="comment-avatar-small">{{ getInitials(comment.authorName) }}</div>
          <div class="comment-content-wrapper">
            <div class="comment-meta">
              <span class="comment-author">{{ comment.authorName }}</span>
              <span class="comment-time">{{ getTimeAgo(comment.createdAt) }}</span>
            </div>
            <p class="comment-text">{{ comment.content }}</p>
            <button
              *ngIf="canDeleteComment(comment)"
              class="delete-comment-btn"
              (click)="openDeleteConfirm(comment._id)"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <div class="no-comments" *ngIf="comments.length === 0">
        <p>No comments yet. Be the first to share your thoughts!</p>
      </div>

      <app-modal
        [isOpen]="!!commentIdToDelete"
        title="Delete comment"
        [showFooter]="true"
        (close)="closeDeleteConfirm()"
      >
        <p class="confirm-message">Delete this comment?</p>
        <div footer>
          <button type="button" class="btn-cancel" (click)="closeDeleteConfirm()">Cancel</button>
          <button type="button" class="btn-delete" (click)="confirmDeleteComment()">Delete</button>
        </div>
      </app-modal>
    </div>
  `,
  styles: [`
    .comment-section {
      border-top: 1px solid var(--border-color);
      padding-top: 1rem;
      margin-top: 1rem;
    }

    .comment-header h4 {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 1rem 0;
    }

    .comment-input-wrapper {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .comment-avatar,
    .comment-avatar-small {
      flex-shrink: 0;
      border-radius: 50%;
      background: var(--accent-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      text-transform: uppercase;
    }

    .comment-avatar {
      width: 36px;
      height: 36px;
      font-size: 0.85rem;
    }

    .comment-avatar-small {
      width: 32px;
      height: 32px;
      font-size: 0.8rem;
    }

    .comment-input {
      flex: 1;
      padding: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 0.95rem;
      resize: vertical;
      min-height: 60px;
      transition: border-color 0.2s;
    }

    .comment-input:focus {
      outline: none;
      border-color: var(--forest-green);
    }

    .comment-actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .char-count {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }

    .char-count.warning {
      color: var(--error-color);
    }

    .comment-submit-btn {
      padding: 0.5rem 1.25rem;
      border-radius: 6px;
      border: none;
      background: var(--accent-gradient);
      color: white;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .comment-submit-btn:hover:not(:disabled) {
      opacity: 0.9;
    }

    .comment-submit-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .comments-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .comment-item {
      display: flex;
      gap: 0.75rem;
    }

    .comment-content-wrapper {
      flex: 1;
      min-width: 0;
    }

    .comment-meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }

    .comment-author {
      font-weight: 600;
      font-size: 0.9rem;
      color: var(--text-primary);
    }

    .comment-time {
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .comment-text {
      margin: 0 0 0.5rem 0;
      font-size: 0.95rem;
      color: var(--text-primary);
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }

    .delete-comment-btn {
      padding: 0.25rem 0.5rem;
      border: none;
      background: none;
      color: var(--error-color);
      font-size: 0.85rem;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .delete-comment-btn:hover {
      opacity: 0.7;
      text-decoration: underline;
    }

    .no-comments {
      padding: 2rem 1rem;
      text-align: center;
      color: var(--text-secondary);
      font-size: 0.95rem;
    }

    @media (max-width: 768px) {
      .comment-avatar {
        width: 32px;
        height: 32px;
        font-size: 0.8rem;
      }

      .comment-avatar-small {
        width: 28px;
        height: 28px;
        font-size: 0.75rem;
      }

      .comment-input {
        font-size: 0.9rem;
      }
    }

    .confirm-message { margin: 0; color: var(--text-primary); }
    .btn-cancel, .btn-delete { padding: 0.5rem 1rem; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; }
    .btn-cancel { background: var(--c-bg-1); color: var(--text-primary); border: 1px solid var(--border-color); }
    .btn-delete { background: #dc3545; color: #fff; }
    .btn-delete:hover { background: #c82333; }
  `]
})
export class CommentSectionComponent implements OnInit {
  @Input() postId!: string;
  @Output() commentCountChanged = new EventEmitter<number>();

  private commentService = inject(CommentService);
  private authService = inject(AuthService);

  comments: Comment[] = [];
  newCommentContent = '';
  isSubmitting = false;

  ngOnInit(): void {
    this.loadComments();
  }

  loadComments(): void {
    this.commentService.getCommentsByPost(this.postId).subscribe({
      next: (response) => {
        this.comments = Array.isArray(response.data) ? response.data : [];
        this.commentCountChanged.emit(this.comments.length);
      },
      error: (err) => {
        console.error('Failed to load comments:', err);
      },
    });
  }

  submitComment(): void {
    if (!this.newCommentContent.trim() || this.isSubmitting) return;

    this.isSubmitting = true;

    this.commentService.createComment(this.postId, this.newCommentContent.trim()).subscribe({
      next: (response) => {

        if (!Array.isArray(response.data)) {
          this.comments.push(response.data);
        }
        this.newCommentContent = '';
        this.isSubmitting = false;
        this.commentCountChanged.emit(this.comments.length);
      },
      error: (err) => {
        console.error('Failed to post comment:', err);
        this.isSubmitting = false;
      },
    });
  }

  commentIdToDelete: string | null = null;

  openDeleteConfirm(commentId: string): void {
    this.commentIdToDelete = commentId;
  }

  closeDeleteConfirm(): void {
    this.commentIdToDelete = null;
  }

  confirmDeleteComment(): void {
    if (!this.commentIdToDelete) return;
    const commentId = this.commentIdToDelete;
    this.commentIdToDelete = null;
    this.commentService.deleteComment(commentId).subscribe({
      next: () => {
        this.comments = this.comments.filter((c) => c._id !== commentId);
        this.commentCountChanged.emit(this.comments.length);
      },
      error: (err) => {
        console.error('Failed to delete comment:', err);
        this.commentIdToDelete = commentId;
      },
    });
  }

  canDeleteComment(comment: Comment): boolean {
    const currentUser = this.authService.currentUser();
    return !!currentUser && currentUser.id === comment.authorId;
  }

  getUserInitials(): string {
    const currentUser = this.authService.currentUser();
    return this.getInitials(currentUser?.username || 'User');
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  getTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
  }

  onEnter(event: Event): void {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.ctrlKey || keyEvent.metaKey) {
      event.preventDefault();
      this.submitComment();
    }
  }
}
