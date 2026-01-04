import dotenv from 'dotenv';

dotenv.config();

// Try to import Web PubSub SDK, but don't fail if not installed
let WebPubSubServiceClient: any = null;
try {
  const webPubSubModule = require('@azure/web-pubsub');
  WebPubSubServiceClient = webPubSubModule.WebPubSubServiceClient;
} catch (error) {
  console.warn('[Web PubSub] @azure/web-pubsub package not installed. Web PubSub features will be disabled.');
  console.warn('[Web PubSub] Install with: npm install @azure/web-pubsub @azure/web-pubsub-express');
}

/**
 * Azure Web PubSub Service for real-time 2-way audio communication
 */
class WebPubSubService {
  private serviceClient: any = null;
  private endpoint: string;
  private accessKey: string;
  private hubName: string;

  constructor() {
    this.endpoint = process.env.AZURE_WEB_PUBSUB_ENDPOINT || '';
    this.accessKey = process.env.AZURE_WEB_PUBSUB_ACCESS_KEY || '';
    this.hubName = process.env.AZURE_WEB_PUBSUB_HUB_NAME || 'panic';

    if (!WebPubSubServiceClient) {
      console.warn('[Web PubSub] SDK not available. Install packages to enable Web PubSub features.');
      return;
    }

    if (this.endpoint && this.accessKey) {
      try {
        // Build connection string: Endpoint=https://...;AccessKey=...
        const connectionString = `Endpoint=${this.endpoint};AccessKey=${this.accessKey};Version=1.0;`;
        
        this.serviceClient = new WebPubSubServiceClient(connectionString);
        console.log('[Web PubSub] Service client initialized successfully');
        console.log('[Web PubSub] Endpoint:', this.endpoint);
        console.log('[Web PubSub] Hub name:', this.hubName);
      } catch (error: any) {
        console.error('[Web PubSub] Failed to initialize service client:', error);
        console.error('[Web PubSub] Error details:', error.message);
      }
    } else {
      console.warn('[Web PubSub] Missing configuration. Endpoint or Access Key not set.');
      console.warn('[Web PubSub] Endpoint:', this.endpoint || 'NOT SET');
      console.warn('[Web PubSub] Access Key:', this.accessKey ? 'SET (hidden)' : 'NOT SET');
    }
  }

  /**
   * Generate client access token for Web PubSub connection
   * @param userId - User ID requesting the token
   * @param targetUserId - Target user ID for the conversation (optional)
   * @returns Client access URL with token
   */
  async generateClientAccessToken(
    userId: string,
    targetUserId?: string
  ): Promise<{ url: string; token: string }> {
    if (!this.serviceClient) {
      throw new Error('Web PubSub service client not initialized');
    }

    try {
      // Generate token with user ID and optional roles
      const roles = ['webpubsub.joinLeaveGroup', 'webpubsub.sendToGroup'];
      
      // If targetUserId is provided, add group permissions for that conversation
      const groups: string[] = [];
      if (targetUserId) {
        // Create a unique group ID for the conversation (sorted to ensure consistency)
        const groupId = [userId, targetUserId].sort().join('-');
        groups.push(groupId);
      }

      // Generate token with 60 minutes expiration (default)
      // Note: getClientAccessToken returns a ClientAccessToken object
      const token = await this.serviceClient.getClientAccessToken({
        userId: userId,
        roles: roles,
        groups: groups,
        expirationTimeInMinutes: 60,
      });

      const url = token.url;

      console.log(`[Web PubSub] Generated token for user ${userId}, groups: ${groups.join(', ')}`);

      return {
        url: url,
        token: url.split('access_token=')[1]?.split('&')[0] || '',
      };
    } catch (error: any) {
      console.error('[Web PubSub] Error generating token:', error);
      throw new Error(`Failed to generate client access token: ${error.message}`);
    }
  }

  /**
   * Send message to a specific group (conversation)
   * @param groupId - Group ID (conversation ID)
   * @param message - Message payload
   */
  async sendToGroup(groupId: string, message: any): Promise<void> {
    if (!this.serviceClient) {
      throw new Error('Web PubSub service client not initialized');
    }

    try {
      // Correct API: sendToGroup(hubName, groupId, content, options)
      await this.serviceClient.sendToGroup(this.hubName, groupId, JSON.stringify(message), {
        contentType: 'application/json',
      });
      console.log(`[Web PubSub] Sent message to group ${groupId} in hub ${this.hubName}`);
    } catch (error: any) {
      console.error(`[Web PubSub] Error sending to group ${groupId}:`, error);
      throw error;
    }
  }

  /**
   * Broadcast message to all connected clients
   * @param message - Message payload
   */
  async broadcast(message: any): Promise<void> {
    if (!this.serviceClient) {
      throw new Error('Web PubSub service client not initialized');
    }

    try {
      await this.serviceClient.sendToAll(this.hubName, JSON.stringify(message), {
        contentType: 'application/json',
      });
      console.log('[Web PubSub] Broadcast message sent');
    } catch (error: any) {
      console.error('[Web PubSub] Error broadcasting:', error);
      throw error;
    }
  }

  /**
   * Check if Web PubSub is configured and available
   */
  isAvailable(): boolean {
    return this.serviceClient !== null && this.endpoint !== '' && this.accessKey !== '';
  }

  /**
   * Get the hub name
   */
  getHubName(): string {
    return this.hubName;
  }
}

// Export singleton instance
export const webPubSubService = new WebPubSubService();
export default webPubSubService;

