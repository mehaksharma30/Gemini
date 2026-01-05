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
    clientTracking: true
  });

  console.log('[Voice Gateway] WebSocket server initialized on /voice-gateway');

  wss.on('connection', (ws: WebSocket, req) => {
    // Parse query parameters from URL
    let callId: string | null = null;
    let userId: string | null = null;
    
    try {
      // Try using URL constructor first
      const host = req.headers.host || 'localhost';
      const url = new URL(req.url || '', `http://${host}`);
      callId = url.searchParams.get('callId');
      userId = url.searchParams.get('userId');
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

