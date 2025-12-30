import { Request, Response } from 'express';
import webPubSubService from '../services/webPubSub.service';

/**
 * Negotiate Web PubSub connection - returns client access URL
 * GET /api/pubsub/negotiate
 * Returns: { url: string, userId: string }
 */
export const negotiate = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const userId = req.user.userId;

    if (!webPubSubService.isAvailable()) {
      return res.status(503).json({
        success: false,
        message: 'Web PubSub service not configured. Check environment variables.',
      });
    }

    // Generate token for the user (no target user needed for negotiation)
    const { url } = await webPubSubService.generateClientAccessToken(userId);

    return res.json({
      success: true,
      url,
      userId,
    });
  } catch (error: any) {
    console.error('[Web PubSub Controller] Error negotiating:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to negotiate connection',
    });
  }
};

/**
 * Generate Web PubSub client access token
 * POST /api/webpubsub/token
 * Body: { userId: string, targetUserId?: string }
 */
export const generateToken = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { targetUserId } = req.body;
    const userId = req.user.userId;

    if (!webPubSubService.isAvailable()) {
      return res.status(503).json({
        success: false,
        message: 'Web PubSub service not configured. Install packages: npm install @azure/web-pubsub@^1.2.0 @azure/web-pubsub-express@^1.0.0, then restart server.',
      });
    }

    const { url, token } = await webPubSubService.generateClientAccessToken(
      userId,
      targetUserId
    );

    return res.json({
      success: true,
      data: {
        url,
        token,
        hubName: webPubSubService.getHubName(),
      },
    });
  } catch (error: any) {
    console.error('[Web PubSub Controller] Error generating token:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate token',
    });
  }
};

/**
 * Send message to a group (conversation)
 * POST /api/webpubsub/send
 * Body: { groupId: string, message: any }
 */
export const sendToGroup = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { groupId, message } = req.body;

    if (!groupId || !message) {
      return res.status(400).json({
        success: false,
        message: 'groupId and message are required',
      });
    }

    if (!webPubSubService.isAvailable()) {
      return res.status(503).json({
        success: false,
        message: 'Web PubSub service not configured. Install packages: npm install @azure/web-pubsub@^1.2.0 @azure/web-pubsub-express@^1.0.0, then restart server.',
      });
    }

    await webPubSubService.sendToGroup(groupId, {
      ...message,
      senderId: req.user.userId,
      timestamp: new Date().toISOString(),
    });

    return res.json({
      success: true,
      message: 'Message sent to group',
    });
  } catch (error: any) {
    console.error('[Web PubSub Controller] Error sending to group:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to send message',
    });
  }
};

/**
 * Health check for Web PubSub service
 * GET /api/webpubsub/health
 */
export const healthCheck = async (req: Request, res: Response) => {
  try {
    const isAvailable = webPubSubService.isAvailable();
    return res.json({
      success: true,
      data: {
        available: isAvailable,
        hubName: webPubSubService.getHubName(),
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Health check failed',
    });
  }
};

