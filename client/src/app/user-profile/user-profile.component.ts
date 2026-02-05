import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService, UserProfile } from '../core/services/user.service';
import { Post } from '../core/models/post.model';
import { PostCardComponent } from '../posts/post-card/post-card.component';
import { AuthService } from '../core/services/auth.service';
import { PostService } from '../core/services/post.service';
import { ModalComponent } from '../core/components/modal/modal.component';

@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [CommonModule, PostCardComponent, ModalComponent],
  template: `
    <div class="profile-container">
      <div class="container">
        
        <div class="state loading" *ngIf="loading">
          <div class="spinner"></div>
          <p>Loading profile...</p>
        </div>

        
        <div class="state error" *ngIf="error">{{ error }}</div>

        
        <div *ngIf="!loading && !error && profile">
          
          <div class="profile-header">
            <div class="profile-avatar">{{ getInitials(profile.username) }}</div>
            <div class="profile-info">
              <div class="profile-name-row">
                <h1 class="profile-username">{{ profile.username }}</h1>
                <span *ngIf="profile.badge !== 'none'" class="badge" [class]="profile.badge">
                  {{ getBadgeIcon(profile.badge) }} {{ profile.badge | titlecase }}
                </span>
              </div>
              <div class="profile-xp">
                Level {{ profile.level }} · {{ profile.xp }} XP
              </div>
              <div class="profile-stats">
                <div class="stat">
                  <span class="stat-value">{{ profile.postCount }}</span>
                  <span class="stat-label">Posts</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ profile.tokens }}</span>
                  <span class="stat-label">Tokens</span>
                </div>
              </div>
            </div>
            <div class="profile-actions" *ngIf="!isOwnProfile">
              <button class="message-btn" (click)="openDirectMessage()">
                <svg class="icon" viewBox="0 0 24 24">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                </svg>
                Message
              </button>
            </div>
          </div>

          
          <div class="profile-posts">
            <h2 class="section-title">Posts</h2>

            <div class="state loading" *ngIf="loadingPosts">
              <div class="spinner"></div>
            </div>

            <div class="posts-grid" *ngIf="!loadingPosts && posts.length > 0">
              <app-post-card
                *ngFor="let post of posts"
                [post]="post"
                [currentUserId]="currentUserId"
                (edit)="onEdit(post)"
                (delete)="openDeleteConfirm(post)"
              ></app-post-card>
            </div>

            <div class="empty-posts" *ngIf="!loadingPosts && posts.length === 0">
              <p>No posts yet from {{ profile.username }}</p>
            </div>
          </div>
        </div>
      </div>

      <app-modal
        [isOpen]="!!postToDelete"
        title="Delete post"
        [showFooter]="true"
        (close)="closeDeleteConfirm()"
      >
        <p class="confirm-message">Delete this post permanently?</p>
        <div footer>
          <button type="button" class="btn-cancel" (click)="closeDeleteConfirm()">Cancel</button>
          <button type="button" class="btn-delete" (click)="confirmDelete()">Delete</button>
        </div>
      </app-modal>
    </div>
  `,
  styles: [`
    .profile-container {
      padding: 2rem 1rem;
      background: var(--bg-primary);
      min-height: 100vh;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    .state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-secondary);
    }

    .state.loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid var(--border-color);
      border-top-color: var(--blue-green);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .state.error {
      color: var(--error-color);
      background: rgba(209, 67, 67, 0.1);
      border-radius: 12px;
      padding: 2rem;
    }

    .profile-header {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 2rem;
      margin-bottom: 2rem;
      display: flex;
      align-items: center;
      gap: 2rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .profile-avatar {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      background: var(--primary-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 2.5rem;
      font-weight: 700;
      text-transform: uppercase;
      flex-shrink: 0;
    }

    .profile-info {
      flex: 1;
    }

    .profile-name-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .profile-username {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0;
    }

    .badge {
      padding: 0.35rem 0.75rem;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }

    .badge.silver {
      background: rgba(192, 192, 192, 0.2);
      border: 1px solid #c0c0c0;
      color: #808080;
    }

    .badge.gold {
      background: rgba(255, 215, 0, 0.2);
      border: 1px solid #ffd700;
      color: #d4af37;
    }

    .badge.diamond {
      background: rgba(185, 242, 255, 0.2);
      border: 1px solid #b9f2ff;
      color: #00bcd4;
    }

    .profile-xp {
      font-size: 1rem;
      color: var(--text-secondary);
      font-weight: 500;
      margin: 0.5rem 0 1rem 0;
    }

    .profile-stats {
      display: flex;
      gap: 2rem;
    }

    .stat {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);
    }

    .stat-label {
      font-size: 0.9rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .profile-actions {
      display: flex;
      gap: 0.75rem;
    }

    .message-btn {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      border: none;
      background: var(--accent-gradient);
      color: white;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .message-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .message-btn .icon {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }

    .profile-posts {
      margin-top: 2rem;
    }

    .section-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0 0 1.5rem 0;
    }

    .posts-grid {
      display: flex;
      flex-direction: column;
    }

    .empty-posts {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-secondary);
      background: var(--bg-secondary);
      border-radius: 12px;
      border: 1px solid var(--border-color);
    }

    @media (max-width: 768px) {
      .profile-header {
        flex-direction: column;
        text-align: center;
        padding: 1.5rem;
      }

      .profile-avatar {
        width: 80px;
        height: 80px;
        font-size: 2rem;
      }

      .profile-username {
        font-size: 1.5rem;
      }

      .profile-stats {
        justify-content: center;
      }

      .profile-actions {
        width: 100%;
      }

      .message-btn {
        width: 100%;
        justify-content: center;
      }
    }

    .confirm-message { margin: 0; color: var(--text-primary); }
    .btn-cancel, .btn-delete { padding: 0.5rem 1rem; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; }
    .btn-cancel { background: var(--c-bg-1); color: var(--text-primary); border: 1px solid var(--border-color); }
    .btn-delete { background: #dc3545; color: #fff; }
    .btn-delete:hover { background: #c82333; }
  `]
})
export class UserProfileComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private userService = inject(UserService);
  private authService = inject(AuthService);
  private postService = inject(PostService);

  profile: UserProfile | null = null;
  posts: Post[] = [];
  loading = true;
  loadingPosts = false;
  error: string | null = null;
  userId = '';

  get currentUserId(): string {
    return this.authService.currentUser()?.id || '';
  }

  get isOwnProfile(): boolean {
    return this.currentUserId === this.userId;
  }

  ngOnInit(): void {
    this.userId = this.route.snapshot.paramMap.get('userId') || '';
    if (!this.userId) {
      this.error = 'Invalid user ID';
      this.loading = false;
      return;
    }

    this.loadProfile();
    this.loadPosts();
  }

  loadProfile(): void {
    this.loading = true;
    this.error = null;

    this.userService.getUserProfile(this.userId).subscribe({
      next: (response) => {
        this.profile = response.data;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load profile';
        this.loading = false;
      },
    });
  }

  loadPosts(): void {
    this.loadingPosts = true;

    this.userService.getUserPosts(this.userId).subscribe({
      next: (response) => {
        this.posts = response.data || [];
        this.loadingPosts = false;
      },
      error: (err) => {
        console.error('Failed to load posts:', err);
        this.loadingPosts = false;
      },
    });
  }

  getInitials(username: string): string {
    return username
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  getBadgeIcon(badge: string): string {
    const icons: Record<string, string> = {
      silver: '🥈',
      gold: '🥇',
      diamond: '💎',
    };
    return icons[badge] || '';
  }

  openDirectMessage(): void {
    this.router.navigate(['/messages', this.userId]);
  }

  postToDelete: Post | null = null;

  onEdit(post: Post): void {
    this.router.navigate(['/posts', post._id, 'edit']);
  }

  openDeleteConfirm(post: Post): void {
    this.postToDelete = post;
  }

  closeDeleteConfirm(): void {
    this.postToDelete = null;
  }

  confirmDelete(): void {
    if (!this.postToDelete) return;
    const post = this.postToDelete;
    this.postToDelete = null;
    this.postService.deletePost(post._id).subscribe({
      next: () => {
        this.posts = this.posts.filter((p) => p._id !== post._id);
      },
      error: () => {
        this.postToDelete = post;
      },
    });
  }
}
