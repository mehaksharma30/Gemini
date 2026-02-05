import mongoose, { Document, Schema } from 'mongoose';

export interface IEmergencyContacts extends Document {
  ownerUserId: mongoose.Types.ObjectId;
  contactUserIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const emergencyContactsSchema = new Schema<IEmergencyContacts>(
  {
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner user ID is required'],
      unique: true,
    },
    contactUserIds: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
      validate: {
        validator: function (contactUserIds: mongoose.Types.ObjectId[]) {
          return contactUserIds.length <= 3;
        },
        message: 'Maximum 3 contacts allowed',
      },
    },
  },
  {
    timestamps: true,
  }
);

// ownerUserId already has unique: true in schema (creates unique index); no extra index needed

const EmergencyContacts = mongoose.model<IEmergencyContacts>('EmergencyContacts', emergencyContactsSchema);

export default EmergencyContacts;

