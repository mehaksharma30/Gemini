import mongoose, { Document, Schema } from 'mongoose';

export interface IPanicIncident extends Document {
  ownerUserId: mongoose.Types.ObjectId;
  mode: 'AI' | 'CONTACT' | 'GROUP';
  message?: string;
  targetUserIds: mongoose.Types.ObjectId[];
  status: 'OPEN' | 'CLOSED';
  createdAt: Date;
  updatedAt: Date;
}

const panicIncidentSchema = new Schema<IPanicIncident>(
  {
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner user ID is required'],
    },
    mode: {
      type: String,
      enum: ['AI', 'CONTACT', 'GROUP'],
      required: [true, 'Mode is required'],
    },
    message: {
      type: String,
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters'],
    },
    targetUserIds: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    status: {
      type: String,
      enum: ['OPEN', 'CLOSED'],
      default: 'OPEN',
    },
  },
  {
    timestamps: true,
  }
);

panicIncidentSchema.index({ ownerUserId: 1, createdAt: -1 });
panicIncidentSchema.index({ targetUserIds: 1 });

const PanicIncident = mongoose.model<IPanicIncident>('PanicIncident', panicIncidentSchema);

export default PanicIncident;






