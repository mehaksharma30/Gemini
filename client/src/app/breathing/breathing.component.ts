import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../core/services/auth.service';
import { environment } from '../../environments/environment';

type BreathingPhase = 'inhale' | 'hold' | 'exhale';
type BreathingState = 'idle' | 'running' | 'paused' | 'completed';

interface BreathingConfig {
  pattern: string; // e.g., "4-4-6"
  cycles: number;
}

@Component({
  selector: 'app-breathing',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="breathing-container">
      <div class="breathing-content">
        <h1 class="breathing-title">Breathing Exercise</h1>
        
        <div class="breathing-circle-container">
          <div 
            class="breathing-circle"
            [class.inhale]="phase === 'inhale'"
            [class.hold]="phase === 'hold'"
            [class.exhale]="phase === 'exhale'"
            [style.transform]="getCircleScale()"
          ></div>
        </div>
        
        <div class="phase-label">{{ getPhaseLabel() }}</div>
        
        <div class="countdown-number">{{ secondsLeft }}</div>
        
        <div class="cycle-progress">Cycle {{ cycleIndex + 1 }} of {{ config.cycles }}</div>
        
        <div class="controls">
          <button 
            *ngIf="state === 'idle'"
            class="btn-start"
            (click)="start()"
          >
            Start
          </button>
          
          <button 
            *ngIf="state === 'running'"
            class="btn-pause"
            (click)="pause()"
          >
            Pause
          </button>
          
          <button 
            *ngIf="state === 'paused'"
            class="btn-resume"
            (click)="resume()"
          >
            Resume
          </button>
          
          <button 
            *ngIf="state !== 'idle'"
            class="btn-stop"
            (click)="stop()"
          >
            Stop
          </button>
        </div>
        
        <div *ngIf="state === 'completed'" class="completion-message">
          <p>Great job! You've completed the breathing exercise.</p>
          <button class="btn-back" (click)="goBack()">Back to Chat</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .breathing-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-gradient, linear-gradient(135deg, #667eea 0%, #764ba2 100%));
      padding: 20px;
    }
    
    .breathing-content {
      text-align: center;
      max-width: 500px;
      width: 100%;
    }
    
    .breathing-title {
      color: white;
      font-size: 2rem;
      margin-bottom: 2rem;
      font-weight: 600;
    }
    
    .breathing-circle-container {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 3rem 0;
      height: 300px;
    }
    
    .breathing-circle {
      width: 200px;
      height: 200px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.3);
      border: 4px solid rgba(255, 255, 255, 0.6);
      transition: transform 0.1s linear;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .breathing-circle.inhale {
      background: rgba(76, 175, 80, 0.4);
      border-color: rgba(76, 175, 80, 0.8);
    }
    
    .breathing-circle.hold {
      background: rgba(255, 193, 7, 0.4);
      border-color: rgba(255, 193, 7, 0.8);
    }
    
    .breathing-circle.exhale {
      background: rgba(33, 150, 243, 0.4);
      border-color: rgba(33, 150, 243, 0.8);
    }
    
    .phase-label {
      font-size: 2rem;
      font-weight: 600;
      color: white;
      margin-bottom: 1rem;
      text-transform: uppercase;
      letter-spacing: 2px;
    }
    
    .countdown-number {
      font-size: 5rem;
      font-weight: 700;
      color: white;
      margin: 1rem 0;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    }
    
    .cycle-progress {
      font-size: 1.2rem;
      color: rgba(255, 255, 255, 0.9);
      margin-bottom: 2rem;
    }
    
    .controls {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    
    button {
      padding: 0.75rem 2rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    
    .btn-start, .btn-resume {
      background: #4caf50;
      color: white;
    }
    
    .btn-start:hover, .btn-resume:hover {
      background: #45a049;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
    }
    
    .btn-pause {
      background: #ff9800;
      color: white;
    }
    
    .btn-pause:hover {
      background: #f57c00;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(255, 152, 0, 0.4);
    }
    
    .btn-stop {
      background: #f44336;
      color: white;
    }
    
    .btn-stop:hover {
      background: #d32f2f;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(244, 67, 54, 0.4);
    }
    
    .completion-message {
      margin-top: 2rem;
      padding: 1.5rem;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      color: white;
    }
    
    .completion-message p {
      margin: 0 0 1rem 0;
      font-size: 1.1rem;
    }
    
    .btn-back {
      background: white;
      color: #667eea;
    }
    
    .btn-back:hover {
      background: #f5f5f5;
      transform: translateY(-2px);
    }
  `]
})
export class BreathingComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  
  config: BreathingConfig = { pattern: '4-4-6', cycles: 6 };
  phase: BreathingPhase = 'inhale';
  state: BreathingState = 'idle';
  secondsLeft = 0;
  cycleIndex = 0;
  
  private timerInterval: any = null;
  private phaseDurations: { inhale: number; hold: number; exhale: number } = { inhale: 4, hold: 4, exhale: 6 };
  private audioCache: Map<string, HTMLAudioElement> = new Map();
  private currentAudio: HTMLAudioElement | null = null;
  
  ngOnInit(): void {
    // Parse config from route state or query params (priority: history.state > getCurrentNavigation > query params > defaults)
    let state: any = null;
    
    // Priority 1: history.state (works on refresh if navigation used state)
    if (typeof window !== 'undefined' && window.history?.state) {
      state = window.history.state;
    }
    
    // Priority 2: getCurrentNavigation() (works during navigation)
    if (!state) {
      const navigation = this.router.getCurrentNavigation();
      if (navigation?.extras?.state) {
        state = navigation.extras.state;
      }
    }
    
    // Apply state if found
    if (state) {
      if (state.pattern && typeof state.pattern === 'string') {
        this.config.pattern = state.pattern;
      }
      if (state.cycles) {
        const cycles = typeof state.cycles === 'number' ? state.cycles : parseInt(String(state.cycles), 10);
        if (!isNaN(cycles) && cycles >= 1) {
          this.config.cycles = cycles;
        }
      }
    }
    
    // Priority 3: Fallback to query params
    this.route.queryParams.subscribe(params => {
      if (params['pattern'] && typeof params['pattern'] === 'string') {
        this.config.pattern = params['pattern'];
      }
      if (params['cycles']) {
        const cycles = parseInt(String(params['cycles']), 10);
        if (!isNaN(cycles) && cycles >= 1) {
          this.config.cycles = cycles;
        }
      }
    });
    
    // Parse pattern (e.g., "4-4-6" -> inhale: 4, hold: 4, exhale: 6)
    const parts = this.config.pattern.split('-').map(p => parseInt(p, 10));
    if (parts.length === 3 && parts.every(p => !isNaN(p) && p > 0)) {
      this.phaseDurations = {
        inhale: parts[0],
        hold: parts[1],
        exhale: parts[2]
      };
    }
    
    // DO NOT auto-start - user must explicitly press Start button
    // State remains 'idle' until user clicks Start
  }
  
  ngOnDestroy(): void {
    this.stop();
    this.cleanupAudio();
  }
  
  start(): void {
    if (this.state === 'running') return;
    
    this.state = 'running';
    this.cycleIndex = 0;
    this.phase = 'inhale';
    this.secondsLeft = this.phaseDurations.inhale;
    
    this.startTimer();
    this.speakPhase('inhale');
  }
  
  pause(): void {
    if (this.state !== 'running') return;
    
    this.state = 'paused';
    this.stopTimer();
    this.cleanupAudio();
  }
  
  resume(): void {
    if (this.state !== 'paused') return;
    
    this.state = 'running';
    this.startTimer();
    this.speakPhase(this.phase);
  }
  
  stop(): void {
    this.state = 'idle';
    this.stopTimer();
    this.cleanupAudio();
    this.goBack();
  }
  
  private startTimer(): void {
    this.stopTimer();
    
    this.timerInterval = setInterval(() => {
      if (this.state !== 'running') return;
      
      this.secondsLeft--;
      
      if (this.secondsLeft <= 0) {
        this.transitionToNextPhase();
      }
    }, 1000);
  }
  
  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
  
  private transitionToNextPhase(): void {
    // Move to next phase
    if (this.phase === 'inhale') {
      this.phase = 'hold';
      this.secondsLeft = this.phaseDurations.hold;
      this.speakPhase('hold');
    } else if (this.phase === 'hold') {
      this.phase = 'exhale';
      this.secondsLeft = this.phaseDurations.exhale;
      this.speakPhase('exhale');
    } else if (this.phase === 'exhale') {
      // Cycle complete
      this.cycleIndex++;
      
      if (this.cycleIndex >= this.config.cycles) {
        // All cycles complete
        this.state = 'completed';
        this.stopTimer();
        this.speakText('Great job. You have completed the breathing exercise.');
        
        // Auto-return after 3 seconds
        setTimeout(() => {
          if (this.state === 'completed') {
            this.goBack();
          }
        }, 3000);
      } else {
        // Next cycle
        this.phase = 'inhale';
        this.secondsLeft = this.phaseDurations.inhale;
        this.speakPhase('inhale');
        // Optional: speak encouragement
        if (this.cycleIndex % 2 === 0) {
          this.speakText('Good. Keep going.');
        }
      }
    }
  }
  
  getPhaseLabel(): string {
    return this.phase.toUpperCase();
  }
  
  getCircleScale(): string {
    if (this.state !== 'running') return 'scale(1)';
    
    const progress = 1 - (this.secondsLeft / this.phaseDurations[this.phase]);
    
    if (this.phase === 'inhale') {
      // Expand from 1.0 to 1.5
      const scale = 1.0 + (progress * 0.5);
      return `scale(${scale})`;
    } else if (this.phase === 'exhale') {
      // Shrink from 1.5 to 1.0
      const scale = 1.5 - (progress * 0.5);
      return `scale(${scale})`;
    } else {
      // Hold at 1.5
      return 'scale(1.5)';
    }
  }
  
  private async speakPhase(phase: BreathingPhase): Promise<void> {
    const text = phase.charAt(0).toUpperCase() + phase.slice(1);
    await this.speakText(text);
  }
  
  private async speakText(text: string): Promise<void> {
    // Stop any current audio
    this.cleanupAudio();
    
    // Try to use existing TTS endpoint (same as panic chat)
    try {
      const apiUrl = `${environment.apiUrl}/ai/tts`;
      const authToken = this.authService.getToken();
      
      if (!authToken) {
        // Fallback to Web Speech API
        this.speakWithWebSpeech(text);
        return;
      }
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ text, lang: 'en' }),
      });
      
      if (!response.ok) {
        throw new Error(`TTS failed: ${response.status}`);
      }
      
      const audioBlob = await response.blob();
      if (audioBlob.size === 0) {
        throw new Error('Empty audio blob');
      }
      
      const audioUrl = URL.createObjectURL(audioBlob);
      this.currentAudio = new Audio(audioUrl);
      
      this.currentAudio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
      };
      
      this.currentAudio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
      };
      
      await this.currentAudio.play();
    } catch (error) {
      console.warn('[Breathing] TTS endpoint failed, using Web Speech API:', error);
      this.speakWithWebSpeech(text);
    }
  }
  
  private speakWithWebSpeech(text: string): void {
    if (!('speechSynthesis' in window)) {
      console.warn('[Breathing] Web Speech API not available');
      return;
    }
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    window.speechSynthesis.speak(utterance);
  }
  
  private cleanupAudio(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.src = '';
        this.currentAudio = null;
      } catch (error) {
        console.error('[Breathing] Error cleaning up audio:', error);
      }
    }
    
    // Cancel Web Speech
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
  
  goBack(): void {
    this.cleanupAudio();
    this.router.navigate(['/panic']);
  }
}

