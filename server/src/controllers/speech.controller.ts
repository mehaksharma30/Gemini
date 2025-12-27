import { Request, Response } from 'express';
import https from 'https';

/**
 * Get Azure Speech token for frontend
 * This endpoint generates a time-limited token from Azure Speech Service
 */
export const getSpeechToken = async (req: Request, res: Response) => {
  try {
    console.log('[Speech Token] Request received');
    
    if (!req.user) {
      console.warn('[Speech Token] Unauthorized - no user in request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const subscriptionKey = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION || 'eastus';

    console.log('[Speech Token] Config check - Key exists:', !!subscriptionKey, 'Region:', region);

    if (!subscriptionKey) {
      console.error('[Speech Token] Azure Speech key not configured');
      return res.status(503).json({ 
        error: 'Azure Speech not configured',
        available: false 
      });
    }

    // Request token from Azure Speech Service
    const tokenUrl = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
    
    return new Promise<void>((resolve) => {
      const options = {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': subscriptionKey,
          'Content-Length': '0',
        },
      };

      const httpsReq = https.request(tokenUrl, options, (azureResponse) => {
        let token = '';

        azureResponse.on('data', (chunk) => {
          token += chunk.toString();
        });

        azureResponse.on('end', () => {
          if (azureResponse.statusCode === 200 && token) {
            console.log('[Speech Token] Token generated successfully');
            res.status(200).json({
              token,
              region,
              expiresIn: 600, // Azure tokens expire in ~10 minutes
            });
            resolve();
          } else {
            console.error('[Speech Token] Azure returned status:', azureResponse.statusCode);
            res.status(500).json({
              error: 'Failed to get Azure Speech token',
              statusCode: azureResponse.statusCode,
            });
            resolve();
          }
        });
      });

      httpsReq.on('error', (error) => {
        console.error('[Speech Token] Request error:', error);
        res.status(500).json({
          error: 'Failed to request Azure Speech token',
          details: error.message,
        });
        resolve();
      });

      httpsReq.end();
    });
  } catch (error: any) {
    console.error('[Speech Token] Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to get speech token',
    });
  }
};

