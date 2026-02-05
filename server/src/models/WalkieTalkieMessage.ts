import mongoose, { Document, Schema } from 'mongoose';

export interface IWalkieTalkieMessage extends Document {
  messageId: string; // Unique message ID
  threadId: string; // Thread ID between two users
  fromUserId: mongoose.Types.ObjectId; // Sender user ID
  toUserId: mongoose.Types.ObjectId; // Receiver user ID
  audioUrl: string; // URL/path to audio file
  audioPath?: string; // Server file path (optional, for internal use)
  clientTimestamp?: number; // Client-side timestamp when recorded
  createdAt: Date; // Server timestamp
}

const walkieTalkieMessageSchema = new Schema<IWalkieTalkieMessage>(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    threadId: {
      type: String,
      required: true,
      // index via compound below with createdAt
    },
    fromUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      // index via compound below
    },
    toUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      // index via compound below
    },
    audioUrl: {
      type: String,
      required: true,
      trim: true,
    },
    audioPath: {
      type: String,
      trim: true,
    },
    clientTimestamp: {
      type: Number,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      // index via compound below with threadId
    },
  },
  {
    timestamps: false, // We only use createdAt
  }
);

// Compound index for thread + timestamp (single definition; avoid duplicate with index:true on fields)
walkieTalkieMessageSchema.index({ threadId: 1, createdAt: 1 });
// Index for user queries (messages sent to a user)
walkieTalkieMessageSchema.index({ toUserId: 1, createdAt: 1 });
// Index for user queries (messages sent by a user)
walkieTalkieMessageSchema.index({ fromUserId: 1, createdAt: 1 });

const WalkieTalkieMessage = mongoose.model<IWalkieTalkieMessage>(
  'WalkieTalkieMessage',
  walkieTalkieMessageSchema
);

export default WalkieTalkieMessage;

