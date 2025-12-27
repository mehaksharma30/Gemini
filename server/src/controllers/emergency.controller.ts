import { Request, Response } from 'express';
import mongoose from 'mongoose';
import EmergencyContacts from '../models/EmergencyContacts';
import User from '../models/User';

export const getEmergencyContacts = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const emergencyContacts = await EmergencyContacts.findOne({ ownerUserId: userObjectId });

    if (!emergencyContacts || emergencyContacts.contactUserIds.length === 0) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const users = await User.find({
      _id: { $in: emergencyContacts.contactUserIds },
    }).select('_id username email');

    const userList = users.map(user => ({
      id: user._id.toString(),
      username: user.username,
      email: user.email,
    }));

    return res.json({
      success: true,
      data: userList,
    });
  } catch (error: any) {
    console.error('Get emergency contacts error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch emergency contacts' });
  }
};

export const addEmergencyContact = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { contactUserId } = req.body;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    if (!contactUserId || !mongoose.Types.ObjectId.isValid(contactUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid contact user ID' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const contactUserObjectId = new mongoose.Types.ObjectId(contactUserId);

    if (userObjectId.toString() === contactUserObjectId.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot add yourself as an emergency contact' });
    }

    const contactUser = await User.findById(contactUserObjectId);
    if (!contactUser) {
      return res.status(404).json({ success: false, message: 'Contact user not found' });
    }

    let emergencyContacts = await EmergencyContacts.findOne({ ownerUserId: userObjectId });

    if (!emergencyContacts) {
      emergencyContacts = await EmergencyContacts.create({
        ownerUserId: userObjectId,
        contactUserIds: [contactUserObjectId],
      });
    } else {
      if (emergencyContacts.contactUserIds.some(id => id.toString() === contactUserObjectId.toString())) {
        return res.status(400).json({ success: false, message: 'User is already in your emergency contacts' });
      }

      if (emergencyContacts.contactUserIds.length >= 3) {
        return res.status(400).json({ 
          success: false, 
          message: 'Maximum 3 emergency contacts allowed. Please remove one to add a new contact.' 
        });
      }

      emergencyContacts.contactUserIds.push(contactUserObjectId);
      await emergencyContacts.save();
    }

    const users = await User.find({
      _id: { $in: emergencyContacts.contactUserIds },
    }).select('_id username email');

    const userList = users.map(user => ({
      id: user._id.toString(),
      username: user.username,
      email: user.email,
    }));

    return res.json({
      success: true,
      data: userList,
      message: 'Emergency contact added successfully',
    });
  } catch (error: any) {
    console.error('Add emergency contact error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to add emergency contact' });
  }
};

export const removeEmergencyContact = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { contactUserId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    if (!contactUserId || !mongoose.Types.ObjectId.isValid(contactUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid contact user ID' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const contactUserObjectId = new mongoose.Types.ObjectId(contactUserId);

    const emergencyContacts = await EmergencyContacts.findOne({ ownerUserId: userObjectId });

    if (!emergencyContacts) {
      return res.json({
        success: true,
        data: [],
        message: 'No emergency contacts found',
      });
    }

    emergencyContacts.contactUserIds = emergencyContacts.contactUserIds.filter(
      id => id.toString() !== contactUserObjectId.toString()
    );

    await emergencyContacts.save();

    const users = await User.find({
      _id: { $in: emergencyContacts.contactUserIds },
    }).select('_id username email');

    const userList = users.map(user => ({
      id: user._id.toString(),
      username: user.username,
      email: user.email,
    }));

    return res.json({
      success: true,
      data: userList,
      message: 'Emergency contact removed successfully',
    });
  } catch (error: any) {
    console.error('Remove emergency contact error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to remove emergency contact' });
  }
};
