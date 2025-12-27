import { Request, Response } from 'express';
import mongoose from 'mongoose';
import ChatRating from '../models/ChatRating';
import Conversation from '../models/Conversation';
import { addXpToUser } from '../services/xpService';

export const createRating = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { conversationId, ratedUserId, rating } = req.body;

    if (!rating || !['helpful', 'not_helpful'].includes(rating)) {
      return res.status(400).json({ success: false, message: 'Invalid rating value' });
    }

    if (!mongoose.Types.ObjectId.isValid(conversationId) || !mongoose.Types.ObjectId.isValid(ratedUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid IDs' });
    }

    const raterId = new mongoose.Types.ObjectId(req.user.userId);
    const ratedUserObjectId = new mongoose.Types.ObjectId(ratedUserId);
    const conversationObjectId = new mongoose.Types.ObjectId(conversationId);

    if (raterId.toString() === ratedUserObjectId.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot rate yourself' });
    }

    const conversation = await Conversation.findById(conversationObjectId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const participantIds = conversation.participants.map(id => id.toString());
    if (!participantIds.includes(raterId.toString()) || !participantIds.includes(ratedUserObjectId.toString())) {
      return res.status(403).json({ success: false, message: 'Not authorized to rate this conversation' });
    }

    const existingRating = await ChatRating.findOne({
      conversationId: conversationObjectId,
      raterId,
      ratedUserId: ratedUserObjectId,
    });

    if (existingRating) {

      return res.json({
        success: true,
        data: {
          ratingId: existingRating._id,
          rating: existingRating.rating,
          conversationId: existingRating.conversationId,
          raterId: existingRating.raterId,
          ratedUserId: existingRating.ratedUserId,
        },
        message: 'Rating already submitted',
      });
    }

    const newRating = await ChatRating.create({
      conversationId: conversationObjectId,
      raterId,
      ratedUserId: ratedUserObjectId,
      rating,
    });

    if (rating === 'helpful') {
      await addXpToUser(ratedUserId, 10);
    }

    return res.status(201).json({
      success: true,
      data: {
        ratingId: newRating._id,
        rating: newRating.rating,
        conversationId: newRating.conversationId,
        raterId: newRating.raterId,
        ratedUserId: newRating.ratedUserId,
      },
      message: 'Rating submitted successfully',
    });
  } catch (error: any) {
    console.error('Create rating error:', error);

    if (error.code === 11000) {

      return res.status(400).json({ success: false, message: 'Rating already submitted' });
    }

    return res.status(500).json({ success: false, message: error.message || 'Failed to submit rating' });
  }
};

export const getRatingStatus = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { conversationId, ratedUserId } = req.query;

    if (!conversationId || !ratedUserId) {
      return res.status(400).json({ success: false, message: 'conversationId and ratedUserId are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(conversationId as string) || !mongoose.Types.ObjectId.isValid(ratedUserId as string)) {
      return res.status(400).json({ success: false, message: 'Invalid IDs' });
    }

    const raterId = new mongoose.Types.ObjectId(req.user.userId);

    const existingRating = await ChatRating.findOne({
      conversationId: new mongoose.Types.ObjectId(conversationId as string),
      raterId,
      ratedUserId: new mongoose.Types.ObjectId(ratedUserId as string),
    });

    return res.json({
      success: true,
      data: {
        rating: existingRating ? existingRating.rating : null,
      },
    });
  } catch (error: any) {
    console.error('Get rating status error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch rating status' });
  }
};

export const deleteRating = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { conversationId } = req.params;

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    const raterId = new mongoose.Types.ObjectId(req.user.userId);
    const conversationObjectId = new mongoose.Types.ObjectId(conversationId);

    const existingRating = await ChatRating.findOne({
      conversationId: conversationObjectId,
      raterId,
    });

    if (!existingRating) {
      return res.status(404).json({ success: false, message: 'Rating not found' });
    }

    // If it was a helpful rating, we should consider removing XP, but for now we'll just delete the rating
    // Note: XP removal is not implemented as it might have cascading effects
    await ChatRating.deleteOne({ _id: existingRating._id });

    return res.json({
      success: true,
      data: {
        rating: null,
      },
      message: 'Rating removed successfully',
    });
  } catch (error: any) {
    console.error('Delete rating error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to delete rating' });
  }
};
