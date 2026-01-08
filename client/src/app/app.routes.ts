import { Routes } from '@angular/router';
import { VoiceGatewayComponent } from './voice-gateway/voice-gateway.component';
import { authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/feed',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.component').then(m => m.LoginComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'register',
    loadComponent: () => import('./auth/register/register.component').then(m => m.RegisterComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'feed',
    loadComponent: () => import('./posts/feed/feed.component').then(m => m.FeedComponent),
    canActivate: [authGuard],
  },
  {
    path: 'posts/create',
    loadComponent: () => import('./posts/create/create.component').then(m => m.CreateComponent),
    canActivate: [authGuard],
  },
  {
    path: 'posts/:id',
    loadComponent: () => import('./posts/detail/detail.component').then(m => m.DetailComponent),
    canActivate: [authGuard],
  },
  {
    path: 'posts/:id/edit',
    loadComponent: () => import('./posts/edit/edit.component').then(m => m.EditComponent),
    canActivate: [authGuard],
  },
  {
    path: 'search',
    loadComponent: () => import('./posts/search/search.component').then(m => m.SearchComponent),
    canActivate: [authGuard],
  },
  {
    path: 'profile',
    loadComponent: () => import('./profile/profile.component').then(m => m.ProfileComponent),
    canActivate: [authGuard],
  },
  {
    path: 'users/:userId',
    loadComponent: () => import('./user-profile/user-profile.component').then(m => m.UserProfileComponent),
    canActivate: [authGuard],
  },
  {
    path: 'messages',
    loadComponent: () => import('./messages/messages.component').then(m => m.MessagesComponent),
    canActivate: [authGuard],
  },
  {
    path: 'messages/:userId',
    loadComponent: () => import('./messages/messages.component').then(m => m.MessagesComponent),
    canActivate: [authGuard],
  },
  {
    path: 'creative',
    loadComponent: () => import('./creative/guided-journaling/guided-journaling.component').then(m => m.GuidedJournalingComponent),
    canActivate: [authGuard],
  },
  {
    path: 'emergency-contacts',
    loadComponent: () => import('./emergency-contacts/emergency-contacts.component').then(m => m.EmergencyContactsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'panic',
    loadComponent: () => import('./panic/panic.component').then(m => m.PanicComponent),
    canActivate: [authGuard],
  },
  {
    path: 'alerts',
    loadComponent: () => import('./alerts/alerts.component').then(m => m.AlertsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'voice-gateway',
    component: VoiceGatewayComponent,
    canActivate: [authGuard],
  },
  {
    path: 'walkie-talkie',
    loadComponent: () => import('./walkie-talkie/walkie-talkie.component').then(m => m.WalkieTalkieComponent),
    canActivate: [authGuard],
  },
  {
    path: '**',
    redirectTo: '/feed',
  },
];
