export interface WalkieTalkieMessage {
  role: 'user' | 'assistant';
  text: string;
  audioUrl?: string;
  createdAt: string;
}

export interface WalkieTalkieThread {
  threadId: string;
  messages: WalkieTalkieMessage[];
}

export interface WalkieTalkieResponse {
  threadId: string;
  transcript: string;
  responseText: string;
  ttsAudioUrl?: string;
}

export interface EmergencyResponse {
  success: boolean;
  transcript: string;
  responseText: string;
  notificationsSent: number;
  incidentId: string;
}

