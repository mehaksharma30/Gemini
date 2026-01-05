import mongoose, { Document, Schema } from 'mongoose';

export interface IPanicAlert extends Document {
  incidentId: mongoose.Types.ObjectId;
  fromUserId: mongoose.Types.ObjectId;
  toUserId: mongoose.Types.ObjectId;
  status: 'SENT' | 'ACKED';
  emailSent: boolean;
  emailError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const panicAlertSchema = new Schema<IPanicAlert>(
  {
    incidentId: {
      type: Schema.Types.ObjectId,
      ref: 'PanicIncident',
      required: [true, 'Incident ID is required'],
    },
    fromUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'From user ID is required'],
    },
    toUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'To user ID is required'],
    },
    status: {
      type: String,
      enum: ['SENT', 'ACKED'],
      default: 'SENT',
    },
    emailSent: {
      type: Boolean,
      default: false,
    },
    emailError: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

panicAlertSchema.index({ toUserId: 1, createdAt: -1 });
panicAlertSchema.index({ incidentId: 1 });
panicAlertSchema.index({ fromUserId: 1, toUserId: 1 });

const PanicAlert = mongoose.model<IPanicAlert>('PanicAlert', panicAlertSchema);

export default PanicAlert;





