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
  packetsReceived: number; // Track received audio frames
  lastStatsLog: number; // Last time stats were logged (rate limiting)
}>();

/**
 * Initialize Voice Gateway WebSocket server
 * Attaches to the existing HTTP server
 */
export function initializeVoiceGateway(httpServer: HttpServer): void {
  // Create WebSocket server without path restriction (we'll handle paths in verifyClient)
  const wss = new WebSocketServer({ 
    server: httpServer,
    // Don't set path here - we'll handle multiple paths in verifyClient
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
      
      // Accept both /voice-gateway and /vo_* paths (for backward compatibility and different client implementations)
      const isVoiceGatewayPath = pathname === '/voice-gateway' || pathname === '/voice-gateway/';
      const isVoSessionPath = pathname.startsWith('/vo_');
      
      if (!isVoiceGatewayPath && !isVoSessionPath) {
        console.warn(`[Voice Gateway] ❌ Rejected connection to invalid path: ${pathname}`);
        console.warn(`[Voice Gateway] Expected paths: /voice-gateway or /vo_<session>`);
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
    
    // Parse query parameters from URL
    let callId: string | null = null;
    let userId: string | null = null;
    
    try {
      // Try using URL constructor first
      const host = req.headers.host || 'localhost';
      const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const url = new URL(req.url || '', `${protocol}://${host}`);
      
      // Support both query params and path-based session IDs
      // For /vo_<session> paths, extract session from path
      if (pathname.startsWith('/vo_')) {
        const sessionMatch = pathname.match(/^\/vo_(.+)$/);
        if (sessionMatch) {
          callId = sessionMatch[1]; // Use session ID from path as callId
        }
        userId = url.searchParams.get('userId');
      } else {
        // For /voice-gateway, use query params
        callId = url.searchParams.get('callId');
        userId = url.searchParams.get('userId');
      }
      
      console.log(`[Voice Gateway] Parsed params - callId: ${callId}, userId: ${userId}`);
    } catch (error) {
      // Fallback: manual parsing
      // Try to extract from /vo_<session> path
      if (pathname.startsWith('/vo_')) {
        const sessionMatch = pathname.match(/^\/vo_(.+)$/);
        if (sessionMatch) {
          callId = sessionMatch[1];
        }
      }
      
      // Extract userId from query string
      const match2 = req.url?.match(/[?&]userId=([^&]+)/);
      userId = match2 ? decodeURIComponent(match2[1]) : null;
      
      // If not found in path, try callId from query
      if (!callId) {
        const match = req.url?.match(/[?&]callId=([^&]+)/);
        callId = match ? decodeURIComponent(match[1]) : null;
      }
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
    console.log(`[Voice Gateway] 📊 Connection details: origin=${req.headers.origin || 'none'}, path=${pathname}, fullURL=${req.url}`);

    // Store connection metadata
    const connId = `${userId}-${Date.now()}`;
    connections.set(ws, {
      connId,
      userId,
      callId,
      connectedAt: Date.now(),
      packetsRelayed: 0,
      packetsReceived: 0,
      lastStatsLog: Date.now(),
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
      if (!conn) {
        console.warn('[Voice Gateway] ⚠️ Received message from unknown connection');
        return;
      }

      // Skip text messages (connection confirmations, etc.)
      if (!isBinary) {
        // Log text messages for debugging (first few only)
        if (conn.packetsReceived < 3) {
          console.log(`[Voice Gateway] 📨 Received text message from ${conn.userId} in call ${conn.callId}:`, data.toString().substring(0, 100));
        }
        return;
      }

      // DIAGNOSTIC: Log first few audio packets
      if (conn.packetsReceived < 3) {
        console.log(`[Voice Gateway] 🎤 Received audio packet from ${conn.userId} in call ${conn.callId}, size: ${Buffer.isBuffer(data) ? data.length : 'unknown'}, roomSize: ${rooms.get(conn.callId)?.size || 0}`);
      }
      
      conn.packetsReceived++;

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

      // CRITICAL: Add senderId to packet to prevent loopback on client side
      // Packet format: seq (4) + timestamp (8) + senderId (24) + payload (640) = 676 bytes
      // Convert existing packet to new format with senderId
      const senderId = conn.userId;
      const senderIdBytes = Buffer.from(senderId.padEnd(24, '\0').slice(0, 24), 'utf8'); // Fixed 24 bytes
      
      // Create new packet with senderId
      const packetWithSender = Buffer.alloc(676);
      buffer.copy(packetWithSender, 0, 0, 12); // Copy seq + timestamp (12 bytes)
      senderIdBytes.copy(packetWithSender, 12, 0, 24); // Add senderId (24 bytes)
      buffer.copy(packetWithSender, 36, 12, 652); // Copy payload (640 bytes)

      // Relay to all other connections in the same room
      // CRITICAL: Exclude sender (ws) to prevent loopback
      const room = rooms.get(conn.callId);
      if (!room) {
        console.warn(`[Voice Gateway] ⚠️ No room found for callId: ${conn.callId}`);
        return;
      }

      const roomSize = room.size;
      let relayed = 0;
      const recipients: string[] = [];
      
      room.forEach((otherWs) => {
        // CRITICAL: Do NOT send to sender (prevents loopback)
        if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
          const otherConn = connections.get(otherWs);
          if (otherConn) {
            recipients.push(otherConn.userId);
          }
          otherWs.send(packetWithSender);
          relayed++;
        }
      });

      conn.packetsRelayed += relayed;
      
      // DIAGNOSTIC: Rate-limited stats logging (once per second per user)
      const now = Date.now();
      if (now - conn.lastStatsLog >= 1000) {
        console.log(`[Voice Gateway] 📊 ${conn.userId} (call ${conn.callId}): received=${conn.packetsReceived}, relayed=${conn.packetsRelayed}, roomSize=${roomSize}, broadcastRecipients=${relayed}`);
        conn.lastStatsLog = now;
        // Reset counters for next second (optional, or keep cumulative)
        // conn.packetsReceived = 0; // Keep cumulative for now
      }
      
      // Log first few relay operations for debugging
      if (conn.packetsRelayed <= 5) {
        console.log(`[Voice Gateway] 🔄 Relayed packet from ${conn.userId} to ${relayed} recipient(s): [${recipients.join(', ')}]`);
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

