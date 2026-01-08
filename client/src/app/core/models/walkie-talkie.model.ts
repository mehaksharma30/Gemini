/**
 * Walkie-Talkie Models (User-to-User Voice Messaging)
 * NO AI - Pure user-to-user communication
 */

export interface WalkieTalkieMessage {
  messageId: string;
  fromUserId: string;
  toUserId: string;
  audioUrl: string;
  createdAt: string; // ISO timestamp
}

export interface WalkieTalkieThread {
  threadId: string;
  messages: WalkieTalkieMessage[];
}

export interface SendMessageResponse {
  threadId: string;
  messageId: string;
  createdAt: string; // ISO timestamp
  audioUrl: string;
}

export interface PollMessagesResponse {
  messages: WalkieTalkieMessage[];
}
