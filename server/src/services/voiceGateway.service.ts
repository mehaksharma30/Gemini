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

    // CRITICAL FIX: Normalize callId to ensure consistency (remove whitespace, lowercase if needed)
    const normalizedCallId = callId.trim();
    
    // Join room
    if (!rooms.has(normalizedCallId)) {
      rooms.set(normalizedCallId, new Set());
      console.log(`[Voice Gateway] Created new room: callId=${normalizedCallId}`);
    }
    
    // CRITICAL FIX: Check if this WebSocket is already in a room and remove it first
    for (const [existingCallId, roomSet] of rooms.entries()) {
      if (roomSet.has(ws)) {
        roomSet.delete(ws);
        console.log(`[Voice Gateway] Removed ${userId} from previous room ${existingCallId}`);
        if (roomSet.size === 0) {
          rooms.delete(existingCallId);
        }
        break;
      }
    }
    
    // CRITICAL FIX: Update connection metadata with normalized callId
    const conn = connections.get(ws);
    if (conn) {
      conn.callId = normalizedCallId;
    }
    
    rooms.get(normalizedCallId)!.add(ws);

    const roomSize = rooms.get(normalizedCallId)!.size;
    console.log(`[Voice Gateway] User ${userId} joined call ${normalizedCallId} (${roomSize} participant${roomSize !== 1 ? 's' : ''})`);
    
    // INSTRUMENTATION: Log room participants to verify both users in same callId
    const participants = Array.from(rooms.get(normalizedCallId)!).map(roomWs => {
      const c = connections.get(roomWs);
      return c ? `${c.userId}(callId=${c.callId}, readyState=${roomWs.readyState})` : 'unknown';
    }).filter(Boolean);
    console.log(`[Voice Gateway] Room ${normalizedCallId} participants: [${participants.join(', ')}]`);
    
    // CRITICAL FIX: Verify callId consistency and fix mismatches
    const allCallIds = Array.from(rooms.get(normalizedCallId)!).map(roomWs => connections.get(roomWs)?.callId).filter(Boolean);
    const uniqueCallIds = [...new Set(allCallIds)];
    if (uniqueCallIds.length > 1) {
      console.error(`[Voice Gateway] ⚠️ WARNING: Room ${normalizedCallId} has participants with different callIds: ${uniqueCallIds.join(', ')}`);
      // CRITICAL FIX: Normalize all participants to use the same callId
      rooms.get(normalizedCallId)!.forEach(roomWs => {
        const c = connections.get(roomWs);
        if (c && c.callId !== normalizedCallId) {
          console.log(`[Voice Gateway] 🔧 Fixing callId mismatch: ${c.userId} callId changed from ${c.callId} to ${normalizedCallId}`);
          c.callId = normalizedCallId;
        }
      });
    }
    
    // CRITICAL FIX: Send room status update to all participants
    const roomStatusMessage = JSON.stringify({
      type: 'room_status',
      callId: normalizedCallId,
      roomSize,
      participants: participants.map(p => {
        const match = p.match(/^([^(]+)/);
        return match ? match[1] : p;
      })
    });
    
    rooms.get(normalizedCallId)!.forEach(roomWs => {
      if (roomWs.readyState === WebSocket.OPEN) {
        try {
          roomWs.send(roomStatusMessage);
        } catch (error: any) {
          console.error(`[Voice Gateway] Error sending room status to participant:`, error.message);
        }
      }
    });

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

      // INSTRUMENTATION: Increment per-user recv count (packets received FROM client, not relayed)
      conn.packetsReceived++;
      
      // INSTRUMENTATION: Log every 100 received packets per user with userId, callId, roomSize
      if (conn.packetsReceived % 100 === 0) {
        const room = rooms.get(conn.callId);
        const roomSize = room ? room.size : 0;
        console.log(`[Voice Gateway] ${conn.userId} received ${conn.packetsReceived} packets from client (callId=${conn.callId}, roomSize=${roomSize})`);
      }
      
      // DIAGNOSTIC: Log first few audio packets
      if (conn.packetsReceived <= 3) {
        const roomSize = rooms.get(conn.callId)?.size || 0;
        console.log(`[Voice Gateway] 🎤 Received audio packet #${conn.packetsReceived} from ${conn.userId} in call ${conn.callId}, size: ${Buffer.isBuffer(data) ? data.length : 'unknown'}, roomSize: ${roomSize}`);
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
      
      // CRITICAL FIX: Handle room size < 2 - try to find receiver in other rooms with similar callId
      if (roomSize < 2) {
        console.warn(`[Voice Gateway] ⚠️ Room ${conn.callId} has only ${roomSize} participant(s) - no receiver! User ${conn.userId} is sending but no one to receive.`);
        const participants = Array.from(room).map(ws => {
          const c = connections.get(ws);
          return c ? `${c.userId}(${c.callId}, readyState=${ws.readyState})` : 'unknown';
        }).filter(Boolean);
        console.warn(`[Voice Gateway] ⚠️ Room ${conn.callId} participants: [${participants.join(', ')}]`);
        console.warn(`[Voice Gateway] ⚠️ ALL rooms in server:`, Array.from(rooms.entries()).map(([id, roomSet]) => 
          `${id}(${roomSet.size} participants)`
        ).join(', '));
        
        // CRITICAL FIX: Try to find receiver in other rooms (might be callId mismatch)
        let foundReceiver = false;
        for (const [otherCallId, otherRoom] of rooms.entries()) {
          if (otherCallId !== conn.callId && otherRoom.size > 0) {
            // Check if callIds are similar (might be same call with different format)
            const callIdSimilar = otherCallId.includes(conn.callId) || conn.callId.includes(otherCallId);
            if (callIdSimilar || otherRoom.size === 1) {
              console.warn(`[Voice Gateway] 🔍 Found potential receiver room: ${otherCallId} with ${otherRoom.size} participant(s)`);
              // Try to merge rooms or find the other participant
              otherRoom.forEach(otherWs => {
                const otherConn = connections.get(otherWs);
                if (otherConn && otherConn.userId !== conn.userId && otherWs.readyState === WebSocket.OPEN) {
                  console.warn(`[Voice Gateway] 🔧 Attempting to relay to ${otherConn.userId} in room ${otherCallId} (callId mismatch fix)`);
                  try {
                    otherWs.send(packetWithSender);
                    foundReceiver = true;
                    console.log(`[Voice Gateway] ✅ Successfully relayed to ${otherConn.userId} in different room (callId fix)`);
                  } catch (error: any) {
                    console.error(`[Voice Gateway] ❌ Failed to relay to ${otherConn.userId}:`, error.message);
                  }
                }
              });
            }
          }
        }
        
        if (!foundReceiver) {
          return; // No one to relay to
        }
        // If we found a receiver, continue to normal relay logic as well
      }
      
      let relayed = 0;
      const recipients: string[] = [];
      const skippedRecipients: string[] = [];
      
      // INSTRUMENTATION: Log room details before relay (ALWAYS log first 50 packets to diagnose)
      if (conn.packetsRelayed < 50) {
        const allParticipants = Array.from(room).map(roomWs => {
          const c = connections.get(roomWs);
          const isSender = roomWs === ws;
          return c ? `${c.userId}(readyState=${roomWs.readyState}, callId=${c.callId}${isSender ? ', SENDER' : ''})` : 'unknown';
        }).filter(Boolean);
        console.log(`[Voice Gateway] 🔄 Relay attempt #${conn.packetsRelayed + 1}: sender=${conn.userId}, roomSize=${roomSize}, participants: [${allParticipants.join(', ')}]`);
      } else if (conn.packetsRelayed % 100 === 0) {
        // Log every 100th packet after first 50
        const allParticipants = Array.from(room).map(roomWs => {
          const c = connections.get(roomWs);
          return c ? `${c.userId}(readyState=${roomWs.readyState})` : 'unknown';
        }).filter(Boolean);
        console.log(`[Voice Gateway] 🔄 Relay attempt #${conn.packetsRelayed + 1}: sender=${conn.userId}, roomSize=${roomSize}, participants: [${allParticipants.join(', ')}]`);
      }
      
      room.forEach((otherWs) => {
        // CRITICAL: Do NOT send to sender (prevents loopback)
        if (otherWs === ws) {
          // INSTRUMENTATION: Log when skipping sender (first few times)
          if (conn.packetsRelayed < 5) {
            console.log(`[Voice Gateway] ⏭️ Skipping sender ${conn.userId} (self)`);
          }
          return; // Skip sender
        }
        
        const otherConn = connections.get(otherWs);
        if (!otherConn) {
          console.warn(`[Voice Gateway] ⚠️ No connection metadata for WebSocket in room ${conn.callId}`);
          skippedRecipients.push('unknown(no metadata)');
          return;
        }
        
        // CRITICAL: Check WebSocket state - use numeric constant (1 = OPEN) for reliability
        const WS_OPEN = 1; // WebSocket.OPEN constant value
        const WS_CONNECTING = 0;
        const WS_CLOSING = 2;
        const WS_CLOSED = 3;
        let wsReadyState = otherWs.readyState;
        
        // CRITICAL FIX: Handle WebSocket state transitions
        // If WebSocket is CONNECTING, wait a bit and check again (might be race condition)
        if (wsReadyState === WS_CONNECTING) {
          // Wait 100ms and check again (WebSocket might be opening)
          setTimeout(() => {
            const newState = otherWs.readyState;
            if (newState === WS_OPEN) {
              console.log(`[Voice Gateway] 🔧 WebSocket for ${otherConn.userId} transitioned to OPEN, retrying send`);
              try {
                otherWs.send(packetWithSender);
                console.log(`[Voice Gateway] ✅ Successfully sent packet to ${otherConn.userId} after state transition`);
              } catch (error: any) {
                console.error(`[Voice Gateway] ❌ Error sending to ${otherConn.userId} after state transition:`, error.message);
              }
            }
          }, 100);
          skippedRecipients.push(`${otherConn.userId}(readyState=${wsReadyState}, retrying)`);
          if (conn.packetsRelayed < 10) {
            console.warn(`[Voice Gateway] ⚠️ WebSocket for ${otherConn.userId} is CONNECTING (readyState=0), will retry in 100ms`);
          }
          return; // Skip this attempt, but retry will happen
        }
        
        // INSTRUMENTATION: Log WebSocket state before sending (ALWAYS log first 50, then every 100)
        if (conn.packetsRelayed < 50 || conn.packetsRelayed % 100 === 0) {
          console.log(`[Voice Gateway] 🔍 Checking recipient ${otherConn.userId}: readyState=${wsReadyState} (OPEN=1, CONNECTING=0, CLOSING=2, CLOSED=3), callId=${otherConn.callId}`);
        }
        
        if (wsReadyState !== WS_OPEN) {
          skippedRecipients.push(`${otherConn.userId}(readyState=${wsReadyState})`);
          // CRITICAL: Always log skipped recipients to diagnose (not rate-limited for first 50)
          if (conn.packetsRelayed < 50) {
            console.warn(`[Voice Gateway] ⚠️ Skipping relay to ${otherConn.userId}: WebSocket readyState=${wsReadyState} (not OPEN=1). CallId: ${otherConn.callId}, Sender callId: ${conn.callId}`);
            // CRITICAL FIX: If WebSocket is CLOSED or CLOSING, try to find if user reconnected
            if (wsReadyState === WS_CLOSED || wsReadyState === WS_CLOSING) {
              console.warn(`[Voice Gateway] 🔍 WebSocket for ${otherConn.userId} is ${wsReadyState === WS_CLOSED ? 'CLOSED' : 'CLOSING'}, checking for reconnection...`);
              // Check if there's a newer connection for this userId
              for (const [checkWs, checkConn] of connections.entries()) {
                if (checkConn.userId === otherConn.userId && 
                    checkConn.callId === conn.callId && 
                    checkWs !== otherWs && 
                    checkWs.readyState === WS_OPEN) {
                  console.log(`[Voice Gateway] 🔧 Found reconnected WebSocket for ${otherConn.userId}, using new connection`);
                  try {
                    checkWs.send(packetWithSender);
                    recipients.push(otherConn.userId);
                    relayed++;
                    console.log(`[Voice Gateway] ✅ Successfully relayed to reconnected ${otherConn.userId}`);
                  } catch (error: any) {
                    console.error(`[Voice Gateway] ❌ Error sending to reconnected ${otherConn.userId}:`, error.message);
                  }
                  return; // Skip the old connection
                }
              }
            }
          } else if (conn.packetsRelayed % 100 === 0) {
            console.warn(`[Voice Gateway] ⚠️ Skipping relay to ${otherConn.userId}: WebSocket readyState=${wsReadyState} (not OPEN=1)`);
          }
          return;
        }
        
        try {
          // CRITICAL: Send packet - this is where the actual relay happens
          otherWs.send(packetWithSender);
          recipients.push(otherConn.userId);
          relayed++;
          
          // INSTRUMENTATION: Log first successful relay and every 100th
          if (conn.packetsRelayed === 0 && relayed === 1) {
            console.log(`[Voice Gateway] ✅ First successful relay: ${conn.userId} -> ${otherConn.userId}, packetSize=${packetWithSender.length} bytes, callId=${conn.callId}`);
          } else if (relayed > 0 && (conn.packetsRelayed + relayed) % 100 === 0) {
            console.log(`[Voice Gateway] ✅ Relayed ${conn.packetsRelayed + relayed} packets: ${conn.userId} -> ${otherConn.userId}`);
          }
        } catch (error: any) {
          console.error(`[Voice Gateway] ❌ Error sending packet to ${otherConn.userId}:`, error.message, `CallId: ${otherConn.callId}`);
          skippedRecipients.push(`${otherConn.userId}(error: ${error.message})`);
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
      
      // INSTRUMENTATION: Log relay details (first 10 packets, then every 100)
      if (conn.packetsRelayed <= 10 || conn.packetsRelayed % 100 === 0) {
        console.log(`[Voice Gateway] 🔄 Relayed packet from ${conn.userId} to ${relayed} recipient(s) in room ${conn.callId} (roomSize=${roomSize}): [${recipients.join(', ')}]`);
        if (skippedRecipients.length > 0) {
          console.warn(`[Voice Gateway] ⚠️ Skipped recipients: [${skippedRecipients.join(', ')}]`);
        }
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

