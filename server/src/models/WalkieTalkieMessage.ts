import mongoose, { Document, Schema } from 'mongoose';

export interface IWalkieTalkieMessage extends Document {
  threadId: string;
  userId: mongoose.Types.ObjectId;
  role: 'user' | 'assistant';
  text: string;
  audioUrl?: string; // URL to audio file (for TTS responses or uploaded audio)
  createdAt: Date;
}

const walkieTalkieMessageSchema = new Schema<IWalkieTalkieMessage>(
  {
    threadId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    audioUrl: {
      type: String,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false, // We only use createdAt
  }
);

// Index for efficient thread queries
walkieTalkieMessageSchema.index({ threadId: 1, createdAt: -1 });
// Index for user queries
walkieTalkieMessageSchema.index({ userId: 1, createdAt: -1 });

const WalkieTalkieMessage = mongoose.model<IWalkieTalkieMessage>(
  'WalkieTalkieMessage',
  walkieTalkieMessageSchema
);

export default WalkieTalkieMessage;

