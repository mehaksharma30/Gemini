import { Request, Response } from 'express';
import mongoose from 'mongoose';
import PanicIncident from '../models/PanicIncident';
import PanicAlert from '../models/PanicAlert';
import EmergencyContacts from '../models/EmergencyContacts';
import User from '../models/User';
import { sendEmergencyEmail } from '../services/emailService';

export const triggerPanic = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const { mode, message, targetUserId } = req.body;

    if (!mode || !['AI', 'CONTACT', 'GROUP'].includes(mode)) {
      return res.status(400).json({ success: false, message: 'Invalid mode. Must be AI, CONTACT, or GROUP' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Load emergency contacts
    const emergencyContacts = await EmergencyContacts.findOne({ ownerUserId: userObjectId });
    const contactUserIds = emergencyContacts?.contactUserIds || [];

    // Handle AI mode
    if (mode === 'AI') {
      const incident = await PanicIncident.create({
        ownerUserId: userObjectId,
        mode: 'AI',
        message: message?.trim() || undefined,
        targetUserIds: [],
        status: 'OPEN',
      });

      return res.json({
        success: true,
        data: {
          incidentId: incident._id.toString(),
          mode: 'AI',
          replyText: "I'm here with you. Let's breathe together—inhale... hold... exhale... You're not alone, and this feeling will pass. What would help you feel a bit better right now?",
        },
      });
    }

    // Handle CONTACT mode
    if (mode === 'CONTACT') {
      if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res.status(400).json({ success: false, message: 'targetUserId is required for CONTACT mode' });
      }

      if (contactUserIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No emergency contacts found. Add contacts by marking someone Helpful in chat.',
        });
      }

      const targetUserObjectId = new mongoose.Types.ObjectId(targetUserId);

      if (userObjectId.toString() === targetUserObjectId.toString()) {
        return res.status(400).json({ success: false, message: 'Cannot send alert to yourself' });
      }

      // Verify target is in emergency contacts
      const isInContacts = contactUserIds.some(id => id.toString() === targetUserObjectId.toString());
      if (!isInContacts) {
        return res.status(400).json({ success: false, message: 'Target user is not in your emergency contacts' });
      }

      // Create incident
      const incident = await PanicIncident.create({
        ownerUserId: userObjectId,
        mode: 'CONTACT',
        message: message?.trim() || undefined,
        targetUserIds: [targetUserObjectId],
        status: 'OPEN',
      });

      // Create alert
      const alert = await PanicAlert.create({
        incidentId: incident._id,
        fromUserId: userObjectId,
        toUserId: targetUserObjectId,
        status: 'SENT',
        emailSent: false,
      });

      // Get receiver user email and send email
      const receiverUser = await User.findById(targetUserObjectId).select('email username');
      let emailSent = false;
      let emailError: string | undefined;

      if (receiverUser && receiverUser.email) {
        const senderUser = await User.findById(userObjectId).select('username');
        const emailResult = await sendEmergencyEmail({
          toEmail: receiverUser.email,
          senderUsername: senderUser?.username || 'Someone',
          senderUserId: userId,
          incidentId: incident._id.toString(),
        });

        emailSent = emailResult.success;
        emailError = emailResult.error;

        // Update alert with email status
        alert.emailSent = emailSent;
        if (emailError) {
          alert.emailError = emailError;
        }
        await alert.save();
      }

      return res.json({
        success: true,
        data: {
          incidentId: incident._id.toString(),
          mode: 'CONTACT',
          alertSent: true,
          emailSent,
        },
      });
    }

    // Handle GROUP mode
    if (mode === 'GROUP') {
      if (contactUserIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No emergency contacts found. Add contacts by marking someone Helpful in chat.',
        });
      }

      // Create incident
      const incident = await PanicIncident.create({
        ownerUserId: userObjectId,
        mode: 'GROUP',
        message: message?.trim() || undefined,
        targetUserIds: contactUserIds,
        status: 'OPEN',
      });

      // Get sender username
      const senderUser = await User.findById(userObjectId).select('username');
      const senderUsername = senderUser?.username || 'Someone';

      // Create alerts and send emails for each contact
      let alertSentCount = 0;
      let emailSentCount = 0;

      for (const contactUserId of contactUserIds) {
        if (userObjectId.toString() === contactUserId.toString()) {
          continue; // Skip self
        }

        const alert = await PanicAlert.create({
          incidentId: incident._id,
          fromUserId: userObjectId,
          toUserId: contactUserId,
          status: 'SENT',
          emailSent: false,
        });

        alertSentCount++;

        // Get receiver email and send email
        const receiverUser = await User.findById(contactUserId).select('email username');
        if (receiverUser && receiverUser.email) {
          const emailResult = await sendEmergencyEmail({
            toEmail: receiverUser.email,
            senderUsername,
            senderUserId: userId,
            incidentId: incident._id.toString(),
          });

          if (emailResult.success) {
            emailSentCount++;
          }

          // Update alert with email status
          alert.emailSent = emailResult.success;
          if (emailResult.error) {
            alert.emailError = emailResult.error;
          }
          await alert.save();
        }
      }

      return res.json({
        success: true,
        data: {
          incidentId: incident._id.toString(),
          mode: 'GROUP',
          alertSentCount,
          emailSentCount,
        },
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid mode' });
  } catch (error: any) {
    console.error('Trigger panic error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to trigger panic mode' });
  }
};

export const getIncident = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { incidentId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    if (!incidentId || !mongoose.Types.ObjectId.isValid(incidentId)) {
      return res.status(400).json({ success: false, message: 'Invalid incident ID' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const incidentObjectId = new mongoose.Types.ObjectId(incidentId);

    const incident = await PanicIncident.findById(incidentObjectId);

    if (!incident) {
      return res.status(404).json({ success: false, message: 'Incident not found' });
    }

    // Check if user is owner or target
    const isOwner = incident.ownerUserId.toString() === userObjectId.toString();
    const isTarget = incident.targetUserIds.some(id => id.toString() === userObjectId.toString());

    if (!isOwner && !isTarget) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this incident' });
    }

    return res.json({
      success: true,
      data: incident,
    });
  } catch (error: any) {
    console.error('Get incident error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch incident' });
  }
};



