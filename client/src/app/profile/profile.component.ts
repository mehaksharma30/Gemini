import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="profile-container">
      <div class="container">
        <h1>Profile</h1>
        
        <div class="profile-section">
          <h2>Settings</h2>
          <div class="profile-links">
            <a routerLink="/emergency-contacts" class="profile-link">
              <span class="link-icon">📞</span>
              <span class="link-text">Emergency Contacts</span>
              <span class="link-arrow">→</span>
            </a>
          </div>
        </div>

        <p class="profile-note">User profile will be displayed here.</p>
      </div>
    </div>
  `,
  styles: [`
    .profile-container {
      padding: 20px;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 { 
      color: var(--text-primary);
      margin-bottom: 2rem;
    }
    .profile-section {
      background: var(--card-gradient);
      border: 1px solid var(--c-accent);
      border-radius: 16px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    .profile-section h2 {
      color: var(--text-primary);
      font-size: 1.25rem;
      margin: 0 0 1rem 0;
      font-weight: 600;
    }
    .profile-links {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .profile-link {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem;
      background: var(--bg-secondary);
      border: 1px solid var(--c-accent);
      border-radius: 12px;
      text-decoration: none;
      color: var(--c-accent);
      transition: all 0.3s ease;
    }
    .profile-link:hover {
      border-color: var(--c-accent);
      background: var(--c-accent);
      color: var(--c-bg-1);
      transform: translateX(4px);
    }
    .link-icon {
      font-size: 1.5rem;
    }
    .link-text {
      flex: 1;
      font-weight: 500;
    }
    .link-arrow {
      color: var(--text-secondary);
      font-size: 1.25rem;
    }
    .profile-note { 
      color: var(--text-secondary);
      font-style: italic;
    }
  `]
})
export class ProfileComponent {}
