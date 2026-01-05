import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Conversation from '../models/Conversation';
import DirectMessage from '../models/DirectMessage';
import User from '../models/User';

export const getConversations = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.userId);

    const conversations = await Conversation.find({
      participants: userId,
    })
      .sort({ lastMessageAt: -1 })
      .lean();

    const conversationsWithDetails = await Promise.all(
      conversations.map(async (conv) => {
        const otherParticipantId = conv.participants.find(
          (id) => id.toString() !== userId.toString()
        );

        const otherUser = await User.findById(otherParticipantId).select('username email');

        const unreadCount = await DirectMessage.countDocuments({
          conversationId: conv._id,
          receiverId: userId,
          isRead: false,
        });

        return {
          conversationId: conv._id.toString(),
          otherParticipant: {
            id: otherUser?._id ? (otherUser._id as mongoose.Types.ObjectId).toString() : '',
            username: otherUser?.username || 'Unknown User',
          },
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt,
          unreadCount,
        };
      })
    );

    return res.json({
      success: true,
      data: conversationsWithDetails,
    });
  } catch (error: any) {
    console.error('Get conversations error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch conversations' });
  }
};

export const getOrCreateConversation = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { userId: otherUserId } = req.params;
    const currentUserId = new mongoose.Types.ObjectId(req.user.userId);
    const otherUserObjectId = new mongoose.Types.ObjectId(otherUserId);

    if (currentUserId.toString() === otherUserObjectId.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot message yourself' });
    }

    const otherUser = await User.findById(otherUserObjectId);
    if (!otherUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let conversation = await Conversation.findOne({
      participants: { $all: [currentUserId, otherUserObjectId] },
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [currentUserId, otherUserObjectId],
      });
    }

    return res.json({
      success: true,
      data: {
        conversationId: conversation._id.toString(),
        otherParticipant: {
          id: (otherUser._id as mongoose.Types.ObjectId).toString(),
          username: otherUser.username,
        },
      },
    });
  } catch (error: any) {
    console.error('Get or create conversation error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to get conversation' });
  }
};

export const getMessages = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { conversationId } = req.params;
    const userId = new mongoose.Types.ObjectId(req.user.userId);

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const isParticipant = conversation.participants.some((id) => id.toString() === userId.toString());
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this conversation' });
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const messages = await DirectMessage.find({ conversationId })
      .sort({ createdAt: 1 })
      .limit(limit);

    return res.json({
      success: true,
      data: messages,
    });
  } catch (error: any) {
    console.error('Get messages error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch messages' });
  }
};

export const createMessage = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { conversationId, receiverId, content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Message content is required' });
    }

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    const senderId = new mongoose.Types.ObjectId(req.user.userId);
    const receiverObjectId = new mongoose.Types.ObjectId(receiverId);

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const isParticipant = conversation.participants.some((id) => id.toString() === senderId.toString());
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Not authorized to send messages in this conversation' });
    }

    const message = await DirectMessage.create({
      conversationId,
      senderId,
      receiverId: receiverObjectId,
      content: content.trim(),
    });

    conversation.lastMessage = content.trim().substring(0, 100);
    conversation.lastMessageAt = new Date();
    await conversation.save();

    return res.status(201).json({
      success: true,
      data: message,
      message: 'Message sent successfully',
    });
  } catch (error: any) {
    console.error('Create message error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to send message' });
  }
};
