import { Component, signal, computed } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { filter } from 'rxjs/operators';
import { AuthService } from './core/services/auth.service';
import { NavbarComponent } from './layout/navbar/navbar.component';
import { ToastComponent } from './core/components/toast/toast.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CommonModule, NavbarComponent, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  title = 'MindMemos';
  currentPath = signal<string>('');

  showNavbar = computed(() => {
    const isAuth = this.authService.isAuthenticated();
    const path = this.currentPath();
    return isAuth && !path.includes('/login') && !path.includes('/register');
  });

  constructor(
    private authService: AuthService,
    private router: Router
  ) {

    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.currentPath.set(event.url);
      });

    this.currentPath.set(this.router.url);
  }
}
