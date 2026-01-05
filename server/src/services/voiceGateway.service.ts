import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';

const PING_INTERVAL = 30000; // 30 seconds

// Store rooms: callId -> Set of WebSocket connections
const rooms = new Map<string, Set<WebSocket>>();

// Store connection metadata
const connections = new Map<WebSocket, {
  connId: string;
  userId: string;
  callId: string;
  connectedAt: number;
  packetsRelayed: number;
}>();

/**
 * Initialize Voice Gateway WebSocket server
 * Attaches to the existing HTTP server
 */
export function initializeVoiceGateway(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/voice-gateway',
    perMessageDeflate: false, // Disable compression for lower latency
    clientTracking: true,
    verifyClient: (info: { origin?: string; req: any; secure: boolean }) => {
      // Get allowed origins from environment (same as CORS)
      const allowedOrigins = process.env.FRONTEND_ORIGINS 
        ? process.env.FRONTEND_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
        : [
            'http://localhost:4200',
            'https://purple-moss-01574bd1e.4.azurestaticapps.net'
          ];
      
      // Add legacy FRONTEND_URL if present
      if (process.env.FRONTEND_URL) {
        const legacyUrl = process.env.FRONTEND_URL.trim();
        if (!allowedOrigins.includes(legacyUrl)) {
          allowedOrigins.push(legacyUrl);
        }
      }
      
      // Log connection attempts for debugging (PRODUCTION CRITICAL)
      const pathname = info.req.url?.split('?')[0] || '';
      const origin = info.origin || 'unknown origin';
      const host = info.req.headers.host || 'unknown';
      const userAgent = info.req.headers['user-agent'] || 'unknown';
      const xForwardedFor = info.req.headers['x-forwarded-for'] || 'none';
      const xForwardedProto = info.req.headers['x-forwarded-proto'] || 'none';
      
      console.log(`[Voice Gateway] 🔄 Connection attempt from ${origin}`);
      console.log(`[Voice Gateway] Path: ${pathname}, Full URL: ${info.req.url}`);
      console.log(`[Voice Gateway] Host: ${host}, Secure: ${info.secure}`);
      console.log(`[Voice Gateway] X-Forwarded-For: ${xForwardedFor}, X-Forwarded-Proto: ${xForwardedProto}`);
      console.log(`[Voice Gateway] Upgrade header: ${info.req.headers.upgrade}`);
      console.log(`[Voice Gateway] Connection header: ${info.req.headers.connection}`);
      console.log(`[Voice Gateway] User-Agent: ${userAgent.substring(0, 100)}`);
      
      // Check path
      if (pathname !== '/voice-gateway' && pathname !== '/voice-gateway/') {
        console.warn(`[Voice Gateway] ❌ Rejected connection to invalid path: ${pathname}`);
        return false;
      }
      
      // Verify origin (for production security)
      // In production, origin should match allowed origins
      // In development, allow all origins for easier testing
      const isProduction = process.env.NODE_ENV === 'production';
      if (isProduction && origin !== 'unknown origin' && !allowedOrigins.includes(origin)) {
        console.warn(`[Voice Gateway] ❌ Rejected connection from unauthorized origin: ${origin}`);
        console.warn(`[Voice Gateway] Allowed origins: ${allowedOrigins.join(', ')}`);
        return false;
      }
      
      console.log(`[Voice Gateway] ✅ Accepting connection to ${pathname} from ${origin}`);
      return true;
    }
  });

  console.log('[Voice Gateway] WebSocket server initialized on /voice-gateway');
  
  // Handle WebSocket server errors
  wss.on('error', (error: Error) => {
    console.error('[Voice Gateway] ❌ WebSocket server error:', error);
    console.error('[Voice Gateway] Error stack:', error.stack);
  });
  
  // Log when server is ready
  wss.on('listening', () => {
    console.log('[Voice Gateway] ✅ WebSocket server is listening and ready for connections');
    console.log('[Voice Gateway] Server path: /voice-gateway');
    console.log('[Voice Gateway] Server address:', wss.address());
  });

  wss.on('connection', (ws: WebSocket, req) => {
    // Log connection established
    const connectionTime = Date.now();
    const pathname = req.url?.split('?')[0] || '';
    console.log(`[Voice Gateway] ✅ WebSocket connection established at ${new Date().toISOString()}`);
    console.log(`[Voice Gateway] Connection path: ${pathname}`);
    console.log(`[Voice Gateway] Full request URL: ${req.url}`);
    console.log(`[Voice Gateway] Request headers:`, JSON.stringify(req.headers, null, 2));
    
    // Parse query parameters from URL
    let callId: string | null = null;
    let userId: string | null = null;
    
    try {
      // Try using URL constructor first
      const host = req.headers.host || 'localhost';
      const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const url = new URL(req.url || '', `${protocol}://${host}`);
      callId = url.searchParams.get('callId');
      userId = url.searchParams.get('userId');
      
      console.log(`[Voice Gateway] Parsed query params - callId: ${callId}, userId: ${userId}`);
    } catch (error) {
      // Fallback: manual parsing
      const match = req.url?.match(/[?&]callId=([^&]+)/);
      const match2 = req.url?.match(/[?&]userId=([^&]+)/);
      callId = match ? decodeURIComponent(match[1]) : null;
      userId = match2 ? decodeURIComponent(match2[1]) : null;
    }

    if (!callId || !userId) {
      console.error('[Voice Gateway] Missing callId or userId, closing connection');
      console.error(`[Voice Gateway] callId: ${callId}, userId: ${userId}`);
      try {
        ws.close(1008, 'Missing callId or userId');
      } catch (e: any) {
        console.error('[Voice Gateway] Error closing connection:', e.message);
      }
      return;
    }

    console.log(`[Voice Gateway] ✅ New connection: userId=${userId}, callId=${callId}`);

    // Store connection metadata
    const connId = `${userId}-${Date.now()}`;
    connections.set(ws, {
      connId,
      userId,
      callId,
      connectedAt: Date.now(),
      packetsRelayed: 0,
    });

    // Join room
    if (!rooms.has(callId)) {
      rooms.set(callId, new Set());
    }
    rooms.get(callId)!.add(ws);

    const roomSize = rooms.get(callId)!.size;
    console.log(`[Voice Gateway] User ${userId} joined call ${callId} (${roomSize} participant${roomSize !== 1 ? 's' : ''})`);

    // Initialize isAlive flag
    (ws as any).isAlive = true;

    // Handle pong for keepalive
    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    // Handle incoming binary messages (audio packets)
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      const conn = connections.get(ws);
      if (!conn) return;

      // Skip text messages (connection confirmations, etc.)
      if (!isBinary) {
        return;
      }

      // Convert to Buffer if needed
      let buffer: Buffer;
      try {
        if (Buffer.isBuffer(data)) {
          buffer = data;
        } else if (data instanceof ArrayBuffer) {
          buffer = Buffer.from(data);
        } else if ((data as any).buffer && (data as any).buffer instanceof ArrayBuffer) {
          const typedData = data as any;
          buffer = Buffer.from(typedData.buffer, typedData.byteOffset, typedData.byteLength);
        } else if (typeof data === 'object' && (data as any).data) {
          // Handle wrapped data
          buffer = Buffer.from((data as any).data);
        } else {
          console.warn(`[Voice Gateway] Unknown data type: ${typeof data}, constructor: ${(data as any)?.constructor?.name}`);
          return;
        }
      } catch (error: any) {
        console.error(`[Voice Gateway] Error converting data to buffer: ${error.message}`);
        return;
      }

      // Validate packet size: header (12 bytes) + payload (640 bytes) = 652 bytes
      if (!buffer || buffer.length !== 652) {
        console.warn(`[Voice Gateway] Invalid packet size: ${buffer?.length || 'undefined'} bytes (expected 652)`);
        return;
      }

      // Relay to all other connections in the same room
      const room = rooms.get(conn.callId);
      if (!room) return;

      let relayed = 0;
      room.forEach((otherWs) => {
        if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
          otherWs.send(buffer);
          relayed++;
        }
      });

      conn.packetsRelayed += relayed;
      
      // Log occasionally (every 100 packets)
      if (conn.packetsRelayed % 100 === 0) {
        console.log(`[Voice Gateway] ${conn.userId} relayed ${conn.packetsRelayed} packets`);
      }
    });

    // Handle close
    ws.on('close', (code: number, reason: Buffer) => {
      const conn = connections.get(ws);
      if (conn) {
        console.log(`[Voice Gateway] User ${conn.userId} disconnected from call ${conn.callId} (code: ${code})`);
        
        // Remove from room
        const room = rooms.get(conn.callId);
        if (room) {
          room.delete(ws);
          if (room.size === 0) {
            rooms.delete(conn.callId);
            console.log(`[Voice Gateway] Room ${conn.callId} closed (no participants)`);
          } else {
            console.log(`[Voice Gateway] Room ${conn.callId} now has ${room.size} participant${room.size !== 1 ? 's' : ''}`);
          }
        }
        
        connections.delete(ws);
      }
    });

    // Handle errors
    ws.on('error', (error: Error) => {
      const conn = connections.get(ws);
      console.error(`[Voice Gateway] WebSocket error for ${conn?.userId || 'unknown'}:`, error.message);
    });

    // Send initial connection confirmation after a small delay to ensure connection is ready
    setTimeout(() => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'connected',
            callId,
            userId,
            timestamp: Date.now(),
          }));
          console.log(`[Voice Gateway] Sent connection confirmation to ${userId}`);
        }
      } catch (error: any) {
        console.error(`[Voice Gateway] Error sending connection confirmation:`, error.message);
      }
    }, 100);
  });

  // Ping/pong keepalive
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if ((ws as any).isAlive === false) {
        const conn = connections.get(ws);
        console.log(`[Voice Gateway] Terminating inactive connection: ${conn?.userId || 'unknown'}`);
        return ws.terminate();
      }
      (ws as any).isAlive = false;
      try {
        ws.ping();
      } catch (error) {
        // Connection might be closed, ignore
      }
    });
  }, PING_INTERVAL);

  // Cleanup on server shutdown
  process.on('SIGINT', () => {
    console.log('\n[Voice Gateway] Shutting down...');
    wss.close(() => {
      console.log('[Voice Gateway] Server closed');
    });
  });
}

