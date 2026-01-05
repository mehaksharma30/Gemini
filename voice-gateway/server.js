import { WebSocketServer, WebSocket } from 'ws';

const PORT = 8080;
const PING_INTERVAL = 30000; // 30 seconds

// Store rooms: callId -> Set of WebSocket connections
const rooms = new Map();

// Store connection metadata
const connections = new Map();

const server = new WebSocketServer({ 
  port: PORT,
  perMessageDeflate: false, // Disable compression for lower latency
  clientTracking: true
});

server.on('listening', () => {
  console.log(`[Voice Gateway] Server listening on ws://localhost:${PORT}`);
});

server.on('error', (error) => {
  console.error('[Voice Gateway] Server error:', error);
});

server.on('connection', (ws, req) => {
  // Parse query parameters from URL
  let callId, userId;
  try {
    // Try using URL constructor first
    const host = req.headers.host || 'localhost:8080';
    const url = new URL(req.url, `http://${host}`);
    callId = url.searchParams.get('callId');
    userId = url.searchParams.get('userId');
  } catch (error) {
    // Fallback: manual parsing
    const match = req.url.match(/[?&]callId=([^&]+)/);
    const match2 = req.url.match(/[?&]userId=([^&]+)/);
    callId = match ? decodeURIComponent(match[1]) : null;
    userId = match2 ? decodeURIComponent(match2[1]) : null;
  }

  if (!callId || !userId) {
    console.error('[Voice Gateway] Missing callId or userId, closing connection');
    console.error(`[Voice Gateway] callId: ${callId}, userId: ${userId}`);
    try {
      ws.close(1008, 'Missing callId or userId');
    } catch (e) {
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
  rooms.get(callId).add(ws);

  const roomSize = rooms.get(callId).size;
  console.log(`[Voice Gateway] User ${userId} joined call ${callId} (${roomSize} participant${roomSize !== 1 ? 's' : ''})`);

  // Initialize isAlive flag
  ws.isAlive = true;

  // Handle pong for keepalive
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Handle incoming binary messages (audio packets)
  ws.on('message', (data, isBinary) => {
    const conn = connections.get(ws);
    if (!conn) return;

    // Skip text messages (connection confirmations, etc.)
    if (!isBinary) {
      return;
    }

    // Convert to Buffer if needed
    let buffer;
    try {
      if (Buffer.isBuffer(data)) {
        buffer = data;
      } else if (data instanceof ArrayBuffer) {
        buffer = Buffer.from(data);
      } else if (data.buffer && data.buffer instanceof ArrayBuffer) {
        buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      } else if (typeof data === 'object' && data.data) {
        // Handle wrapped data
        buffer = Buffer.from(data.data);
      } else {
        console.warn(`[Voice Gateway] Unknown data type: ${typeof data}, constructor: ${data?.constructor?.name}`);
        return;
      }
    } catch (error) {
      console.error(`[Voice Gateway] Error converting data to buffer: ${error.message}`);
      return;
    }

    // Validate packet size: header (12 bytes) + payload (640 bytes) = 652 bytes
    if (!buffer || buffer.length !== 652) {
      console.warn(`[Voice Gateway] Invalid packet size: ${buffer?.length || 'undefined'} bytes (expected 652)`);
      return;
    }

    // Relay to all other connections in the same room
    const room = rooms.get(callId);
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
      console.log(`[Voice Gateway] ${userId} relayed ${conn.packetsRelayed} packets`);
    }
  });

  // Handle close
  ws.on('close', (code, reason) => {
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
  ws.on('error', (error) => {
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
    } catch (error) {
      console.error(`[Voice Gateway] Error sending connection confirmation:`, error.message);
    }
  }, 100);
});

// Ping/pong keepalive
setInterval(() => {
  server.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      const conn = connections.get(ws);
      console.log(`[Voice Gateway] Terminating inactive connection: ${conn?.userId || 'unknown'}`);
      return ws.terminate();
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (error) {
      // Connection might be closed, ignore
    }
  });
}, PING_INTERVAL);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Voice Gateway] Shutting down...');
  server.close(() => {
    console.log('[Voice Gateway] Server closed');
    process.exit(0);
  });
});
