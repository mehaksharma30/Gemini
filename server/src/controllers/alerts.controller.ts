import { Request, Response } from 'express';
import mongoose from 'mongoose';
import PanicAlert from '../models/PanicAlert';
import User from '../models/User';

export const getAlertsInbox = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const alerts = await PanicAlert.find({ toUserId: userObjectId })
      .populate('fromUserId', 'username')
      .populate('incidentId', 'mode message createdAt')
      .sort({ createdAt: -1 });

    const alertsList = alerts.map(alert => {
      const fromUser = alert.fromUserId as any;
      const incident = alert.incidentId as any;

      return {
        id: alert._id.toString(),
        incidentId: incident?._id?.toString() || '',
        fromUserId: fromUser?._id?.toString() || '',
        fromUsername: fromUser?.username || 'Unknown',
        status: alert.status,
        createdAt: alert.createdAt,
        mode: incident?.mode || 'UNKNOWN',
        message: incident?.message || undefined,
      };
    });

    return res.json({
      success: true,
      data: alertsList,
    });
  } catch (error: any) {
    console.error('Get alerts inbox error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch alerts' });
  }
};

export const acknowledgeAlert = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { alertId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    if (!alertId || !mongoose.Types.ObjectId.isValid(alertId)) {
      return res.status(400).json({ success: false, message: 'Invalid alert ID' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const alertObjectId = new mongoose.Types.ObjectId(alertId);

    const alert = await PanicAlert.findOne({
      _id: alertObjectId,
      toUserId: userObjectId,
    });

    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found or not authorized' });
    }

    alert.status = 'ACKED';
    await alert.save();

    return res.json({
      success: true,
      data: {
        id: alert._id.toString(),
        status: alert.status,
        incidentId: alert.incidentId.toString(),
        fromUserId: alert.fromUserId.toString(),
        toUserId: alert.toUserId.toString(),
      },
    });
  } catch (error: any) {
    console.error('Acknowledge alert error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to acknowledge alert' });
  }
};



