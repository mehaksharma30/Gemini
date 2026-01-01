import mongoose, { Document, Schema } from 'mongoose';

export interface IChatRoom extends Document {
  name: string;
  slug: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const chatRoomSchema = new Schema<IChatRoom>(
  {
    name: {
      type: String,
      required: [true, 'Room name is required'],
      trim: true,
      maxlength: [100, 'Room name cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      required: [true, 'Room slug is required'],
      unique: true,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
  },
  {
    timestamps: true,
  }
);

chatRoomSchema.index({ slug: 1 });

const ChatRoom = mongoose.model<IChatRoom>('ChatRoom', chatRoomSchema);

export default ChatRoom;

