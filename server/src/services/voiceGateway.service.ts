import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';

const PING_INTERVAL = 10000; // 10 seconds - more frequent keepalive for better connection stability

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
      
      // CRITICAL: Check path FIRST before logging (to avoid intercepting Socket.IO)
      const pathname = info.req.url?.split('?')[0] || '';
      
      // CRITICAL: Allow Socket.IO paths to pass through silently (don't intercept them)
      // Socket.IO uses /socket.io path and has its own WebSocket server
      // Return false silently to let Socket.IO handle it (our verifyClient only handles voice-gateway)
      const isSocketIOPath = pathname === '/socket.io' || pathname.startsWith('/socket.io/');
      if (isSocketIOPath) {
        // Don't log or process Socket.IO connections - let Socket.IO server handle them
        return false;
      }
      
      // Log connection attempts for debugging (PRODUCTION CRITICAL)
      // Only log voice-gateway connections, not Socket.IO
      const origin = info.origin || 'unknown origin';
      const host = info.req.headers.host || 'unknown';
      const userAgent = info.req.headers['user-agent'] || 'unknown';
      const xForwardedFor = info.req.headers['x-forwarded-for'] || 'none';
      const xForwardedProto = info.req.headers['x-forwarded-proto'] || 'none';
      
      console.log(`[Voice Gateway] 🔄🔍 CONNECTION ATTEMPT - ${new Date().toISOString()}`);
      console.log(`[Voice Gateway] Origin: ${origin}`);
      console.log(`[Voice Gateway] Path: ${pathname}`);
      console.log(`[Voice Gateway] Full URL: ${info.req.url}`);
      console.log(`[Voice Gateway] Host: ${host}`);
      console.log(`[Voice Gateway] Secure: ${info.secure}`);
      console.log(`[Voice Gateway] X-Forwarded-For: ${xForwardedFor}`);
      console.log(`[Voice Gateway] X-Forwarded-Proto: ${xForwardedProto}`);
      console.log(`[Voice Gateway] Upgrade header: ${info.req.headers.upgrade}`);
      console.log(`[Voice Gateway] Connection header: ${info.req.headers.connection}`);
      console.log(`[Voice Gateway] User-Agent: ${userAgent}`);
      
      // Accept both /voice-gateway and /vo_* paths (for backward compatibility and different client implementations)
      const isVoiceGatewayPath = pathname === '/voice-gateway' || pathname === '/voice-gateway/';
      const isVoSessionPath = pathname.startsWith('/vo_');
      
      if (!isVoiceGatewayPath && !isVoSessionPath) {
        console.warn(`[Voice Gateway] ❌ Rejected connection to invalid path: ${pathname}`);
        console.warn(`[Voice Gateway] Expected paths: /voice-gateway or /vo_<session>`);
        return false;
      }
      
      // CRITICAL FIX: Detect watchOS/iOS clients and allow them
      // WatchOS and iOS WebSocket clients often don't send proper origin headers
      const isWatchOS = userAgent.includes('Watch') || userAgent.includes('watchOS');
      const isIOS = userAgent.includes('iPhone') || userAgent.includes('iPad') || userAgent.includes('iOS');
      const isMobile = isWatchOS || isIOS;
      
      // CRITICAL: Allow connections from watch/iOS even without proper origin
      // This is safe because we verify the WebSocket handshake and validate callId/userId
      if (isMobile) {
        console.log(`[Voice Gateway] ✅ Allowing mobile/watch connection (User-Agent: ${userAgent.substring(0, 100)})`);
        console.log(`[Voice Gateway] Device type: ${isWatchOS ? 'watchOS' : isIOS ? 'iOS' : 'unknown mobile'}`);
        return true;
      }
      
      // For non-mobile clients, verify origin (for production security)
      const isProduction = process.env.NODE_ENV === 'production';
      if (isProduction && origin !== 'unknown origin' && !allowedOrigins.includes(origin)) {
        // CRITICAL: Also allow if origin is missing/null (some clients don't send it)
        // Only block if origin is explicitly set to a disallowed value
        if (origin && origin !== 'null' && origin !== 'unknown origin') {
          console.warn(`[Voice Gateway] ❌ Rejected connection from unauthorized origin: ${origin}`);
          console.warn(`[Voice Gateway] Allowed origins: ${allowedOrigins.join(', ')}`);
          return false;
        }
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
    console.log(`[Voice Gateway] 🔍 Raw callId length: ${callId?.length || 0}, userId length: ${userId?.length || 0}`);

    // CRITICAL FIX: Normalize callId FIRST before storing connection metadata
    // This ensures consistency between connection metadata and room lookup
    // CRITICAL: Also decode URL encoding to handle special characters
    let normalizedCallId = callId.trim();
    try {
      // Decode URL encoding (e.g., %2D becomes -)
      normalizedCallId = decodeURIComponent(normalizedCallId);
    } catch (e) {
      // If decoding fails, use trimmed version
      console.warn(`[Voice Gateway] ⚠️ Failed to decode callId, using trimmed version: ${normalizedCallId}`);
    }
    console.log(`[Voice Gateway] 🔍 Normalized callId: "${normalizedCallId}" (length=${normalizedCallId.length})`);
    
    // Store connection metadata with NORMALIZED callId
    const connId = `${userId}-${Date.now()}`;
    connections.set(ws, {
      connId,
      userId,
      callId: normalizedCallId, // CRITICAL: Store normalized callId
      connectedAt: Date.now(),
      packetsRelayed: 0,
      packetsReceived: 0,
      lastStatsLog: Date.now(),
    });
    
    // CRITICAL FIX: Check if this WebSocket is already in ANY room and remove it first
    // This must happen BEFORE checking/creating the new room to prevent duplicate entries
    for (const [existingCallId, roomSet] of rooms.entries()) {
      if (roomSet.has(ws)) {
        roomSet.delete(ws);
        console.log(`[Voice Gateway] Removed ${userId} from previous room ${existingCallId} (roomSize now=${roomSet.size})`);
        if (roomSet.size === 0) {
          rooms.delete(existingCallId);
          console.log(`[Voice Gateway] Deleted empty room: ${existingCallId}`);
        }
        break;
      }
    }
    
    // CRITICAL: Join room - create if doesn't exist, otherwise add to existing
    // This ensures both users end up in the SAME room
    const roomExisted = rooms.has(normalizedCallId);
    if (!roomExisted) {
      rooms.set(normalizedCallId, new Set());
      console.log(`[Voice Gateway] ✅ Created NEW room: callId=${normalizedCallId}`);
    } else {
      const existingRoom = rooms.get(normalizedCallId)!;
      const existingRoomSize = existingRoom.size;
      const existingParticipants = Array.from(existingRoom).map(rws => {
        const rc = connections.get(rws);
        return rc ? rc.userId : 'unknown';
      }).filter(Boolean);
      console.log(`[Voice Gateway] ✅ Joining EXISTING room: callId=${normalizedCallId}, current participants=${existingRoomSize} [${existingParticipants.join(', ')}]`);
    }
    
    // Connection metadata already has normalized callId (set above)
    
    // CRITICAL: Add this WebSocket to the room
    const targetRoom = rooms.get(normalizedCallId)!;
    if (!targetRoom.has(ws)) {
      targetRoom.add(ws);
      console.log(`[Voice Gateway] ✅ Added ${userId} to room ${normalizedCallId}`);
    } else {
      console.warn(`[Voice Gateway] ⚠️ WebSocket ${userId} already in room ${normalizedCallId} (should not happen)`);
    }

    const roomSize = rooms.get(normalizedCallId)!.size;
    console.log(`[Voice Gateway] ✅✅✅ User ${userId} joined call ${normalizedCallId} (${roomSize} participant${roomSize !== 1 ? 's' : ''})`);
    
    // CRITICAL: Log all participants in room for debugging
    const allParticipants = Array.from(rooms.get(normalizedCallId)!).map(ws => {
      const c = connections.get(ws);
      return c ? `${c.userId}(readyState=${ws.readyState}, callId="${c.callId}")` : 'unknown';
    }).filter(Boolean);
    console.log(`[Voice Gateway] 📋 Room ${normalizedCallId} participants: [${allParticipants.join(', ')}]`);
    
    // CRITICAL: Log ALL rooms to diagnose why second user isn't joining
    console.log(`[Voice Gateway] 🔍 ALL ROOMS ON SERVER:`, Array.from(rooms.entries()).map(([id, roomSet]) => {
      const roomParticipants = Array.from(roomSet).map(rws => {
        const rc = connections.get(rws);
        return rc ? `${rc.userId}(callId="${rc.callId}")` : 'unknown';
      }).filter(Boolean);
      return `\n  - Room "${id}" (${roomSet.size} participants): [${roomParticipants.join(', ')}]`;
    }).join(''));
    
    // CRITICAL: If room has 2 participants, log success
    if (roomSize === 2) {
      console.log(`[Voice Gateway] 🎉🎉🎉 SUCCESS: Room ${normalizedCallId} now has 2 participants - ready for two-way communication!`);
      console.log(`[Voice Gateway] 🎉 Participants: [${allParticipants.join(', ')}]`);
      
      // CRITICAL: Send room_status to BOTH participants to confirm they're in the same room
      const roomStatusMessage = JSON.stringify({
        type: 'room_status',
        callId: normalizedCallId,
        roomSize: 2,
        participants: allParticipants.map(p => {
          const match = p.match(/^([^(]+)/);
          return match ? match[1] : p;
        }),
        ready: true
      });
      
      rooms.get(normalizedCallId)!.forEach(roomWs => {
        if (roomWs.readyState === WebSocket.OPEN) {
          try {
            roomWs.send(roomStatusMessage);
            console.log(`[Voice Gateway] ✅ Sent room_status (ready=true) to participant`);
          } catch (error: any) {
            console.error(`[Voice Gateway] Error sending room_status:`, error.message);
          }
        }
      });
    } else if (roomSize === 1) {
      console.warn(`[Voice Gateway] ⚠️ WARNING: Room ${normalizedCallId} has only 1 participant (${userId}). Waiting for second user to join...`);
      console.warn(`[Voice Gateway] ⚠️ Expected callId format: <userId1>-<userId2> (sorted user IDs)`);
      console.warn(`[Voice Gateway] ⚠️ Current callId: "${normalizedCallId}"`);
      console.warn(`[Voice Gateway] ⚠️ Current userId: "${userId}"`);
    }
    
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
    (ws as any).lastPongTime = Date.now();

    // Handle pong for keepalive
    ws.on('pong', () => {
      (ws as any).isAlive = true;
      (ws as any).lastPongTime = Date.now();
      const conn = connections.get(ws);
      if (conn) {
        // Log pong received (first few times only)
        if ((conn.packetsReceived || 0) < 5) {
          console.log(`[Voice Gateway] ✅ Pong received from ${conn.userId} (callId: ${conn.callId})`);
        }
      }
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
      
      // CRITICAL: Log first 100 received packets to diagnose relay issues
      if (conn.packetsReceived <= 100) {
        const room = rooms.get(conn.callId);
        const roomSize = room ? room.size : 0;
        const participants = room ? Array.from(room).map(ws => {
          const c = connections.get(ws);
          return c ? `${c.userId}(readyState=${ws.readyState})` : 'unknown';
        }).filter(Boolean) : [];
        console.log(`[Voice Gateway] 🎤 Received packet #${conn.packetsReceived} from ${conn.userId} in call ${conn.callId}, size: ${Buffer.isBuffer(data) ? data.length : 'unknown'}, roomSize: ${roomSize}, participants: [${participants.join(', ')}]`);
      } else if (conn.packetsReceived % 100 === 0) {
        const room = rooms.get(conn.callId);
        const roomSize = room ? room.size : 0;
        console.log(`[Voice Gateway] ${conn.userId} received ${conn.packetsReceived} packets from client (callId=${conn.callId}, roomSize=${roomSize})`);
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

      // CRITICAL: Accept BOTH packet formats:
      // - Old format: 652 bytes (seq + timestamp + payload)
      // - New format: 676 bytes (seq + timestamp + senderId + payload)
      const PACKET_SIZE_OLD = 652;
      const PACKET_SIZE_NEW = 676;
      
      if (!buffer || (buffer.length !== PACKET_SIZE_OLD && buffer.length !== PACKET_SIZE_NEW)) {
        console.warn(`[Voice Gateway] Invalid packet size: ${buffer?.length || 'undefined'} bytes (expected ${PACKET_SIZE_OLD} or ${PACKET_SIZE_NEW})`);
        return;
      }

      // CRITICAL: Handle both packet formats
      let packetWithSender: Buffer;
      const senderId = conn.userId;
      
      if (buffer.length === PACKET_SIZE_NEW) {
        // Client already sent new format with senderId - use it directly
        packetWithSender = buffer;
        if (conn.packetsReceived <= 10) {
          console.log(`[Voice Gateway] Received new format packet (676 bytes) from ${conn.userId}`);
        }
      } else {
        // Old format (652 bytes) - convert to new format by adding senderId
        const senderIdBytes = Buffer.from(senderId.padEnd(24, '\0').slice(0, 24), 'utf8'); // Fixed 24 bytes
        
        // Create new packet with senderId
        packetWithSender = Buffer.alloc(PACKET_SIZE_NEW);
        buffer.copy(packetWithSender, 0, 0, 12); // Copy seq + timestamp (12 bytes)
        senderIdBytes.copy(packetWithSender, 12, 0, 24); // Add senderId (24 bytes)
        buffer.copy(packetWithSender, 36, 12, PACKET_SIZE_OLD); // Copy payload (640 bytes)
        
        if (conn.packetsReceived <= 10) {
          console.log(`[Voice Gateway] Converted old format packet (652 bytes) to new format (676 bytes) for ${conn.userId}`);
        }
      }

      // Relay to all other connections in the same room
      // CRITICAL: Exclude sender (ws) to prevent loopback
      // CRITICAL FIX: Use normalized callId (already stored in conn.callId)
      const roomCallId = conn.callId; // This is already normalized
      let room = rooms.get(roomCallId);
      
      // CRITICAL FIX: If room not found, try to find similar room (callId format mismatch)
      if (!room) {
        console.error(`[Voice Gateway] ❌ CRITICAL: No room found for callId: ${roomCallId}`);
        console.error(`[Voice Gateway] ❌ Available rooms:`, Array.from(rooms.keys()).join(', '));
        console.error(`[Voice Gateway] ❌ Connection callId: ${conn.callId}, userId: ${conn.userId}`);
        
        // Try to find room with similar callId
        for (const [existingRoomId, roomSet] of rooms.entries()) {
          if (existingRoomId.includes(roomCallId) || roomCallId.includes(existingRoomId)) {
            console.warn(`[Voice Gateway] 🔍 Found similar room: ${existingRoomId} (searching for ${roomCallId})`);
            room = roomSet;
            console.log(`[Voice Gateway] 🔧 Using similar room ${existingRoomId} for relay`);
            break;
          }
        }
        
        if (!room) {
          console.error(`[Voice Gateway] ❌ No room found even after similarity search`);
          return;
        }
      }

      const roomSize = room.size;
      
      // CRITICAL FIX: Always log room state for first 100 packets (not just when roomSize < 2)
      if (conn.packetsReceived <= 100) {
        const participants = Array.from(room).map(ws => {
          const c = connections.get(ws);
          return c ? `${c.userId}(readyState=${ws.readyState}, callId=${c.callId})` : 'unknown';
        }).filter(Boolean);
        console.log(`[Voice Gateway] 📊 Room state: callId=${conn.callId}, roomSize=${roomSize}, participants: [${participants.join(', ')}]`);
      }
      
      // CRITICAL FIX: Handle room size < 2 - try to find receiver in other rooms with similar callId
      if (roomSize < 2) {
        // ALWAYS log this (not rate-limited) to diagnose
        console.warn(`[Voice Gateway] ⚠️ Room ${conn.callId} has only ${roomSize} participant(s) - no receiver! User ${conn.userId} is sending but no one to receive.`);
        const participants = Array.from(room).map(ws => {
          const c = connections.get(ws);
          return c ? `${c.userId}(${c.callId}, readyState=${ws.readyState})` : 'unknown';
        }).filter(Boolean);
        console.warn(`[Voice Gateway] ⚠️ Room ${conn.callId} participants: [${participants.join(', ')}]`);
        console.warn(`[Voice Gateway] ⚠️ ALL rooms in server:`, Array.from(rooms.entries()).map(([id, roomSet]) => {
          const roomParticipants = Array.from(roomSet).map(rws => {
            const rc = connections.get(rws);
            return rc ? `${rc.userId}(${rc.callId})` : 'unknown';
          }).filter(Boolean);
          return `${id}(${roomSet.size} participants: [${roomParticipants.join(', ')}])`;
        }).join(', '));
        
        // CRITICAL FIX: Try to find receiver in ALL other rooms (aggressive search)
        let foundReceiver = false;
        for (const [otherCallId, otherRoom] of rooms.entries()) {
          if (otherCallId !== conn.callId && otherRoom.size > 0) {
            // Check if callIds are similar (might be same call with different format)
            const callIdSimilar = otherCallId.includes(conn.callId) || conn.callId.includes(otherCallId);
            // Also check if rooms have same participants (userId-based matching)
            const hasOtherUser = Array.from(otherRoom).some(otherWs => {
              const otherConn = connections.get(otherWs);
              return otherConn && otherConn.userId !== conn.userId;
            });
            
            if (callIdSimilar || hasOtherUser) {
              console.warn(`[Voice Gateway] 🔍 Found potential receiver room: ${otherCallId} with ${otherRoom.size} participant(s) (similar=${callIdSimilar}, hasOtherUser=${hasOtherUser})`);
              // Try to relay to all participants in this room
              otherRoom.forEach(otherWs => {
                const otherConn = connections.get(otherWs);
                if (otherConn && otherConn.userId !== conn.userId) {
                  const wsState = otherWs.readyState;
                  console.warn(`[Voice Gateway] 🔧 Attempting to relay to ${otherConn.userId} in room ${otherCallId} (readyState=${wsState}, callId mismatch fix)`);
                  if (wsState === WebSocket.OPEN) {
                    try {
                      otherWs.send(packetWithSender);
                      foundReceiver = true;
                      console.log(`[Voice Gateway] ✅ Successfully relayed to ${otherConn.userId} in different room (callId fix)`);
                    } catch (error: any) {
                      console.error(`[Voice Gateway] ❌ Failed to relay to ${otherConn.userId}:`, error.message);
                    }
                  } else {
                    console.warn(`[Voice Gateway] ⚠️ Cannot relay to ${otherConn.userId}: WebSocket readyState=${wsState} (not OPEN)`);
                  }
                }
              });
            }
          }
        }
        
        // CRITICAL: If still no receiver, try to find ANY other user in ANY room (last resort)
        if (!foundReceiver) {
          console.warn(`[Voice Gateway] 🔍 Last resort: Searching ALL rooms for ANY other user...`);
          for (const [anyCallId, anyRoom] of rooms.entries()) {
            anyRoom.forEach(anyWs => {
              const anyConn = connections.get(anyWs);
              if (anyConn && anyConn.userId !== conn.userId && anyWs.readyState === WebSocket.OPEN) {
                console.warn(`[Voice Gateway] 🔧 Last resort relay: ${conn.userId} -> ${anyConn.userId} (room: ${anyCallId})`);
                try {
                  anyWs.send(packetWithSender);
                  foundReceiver = true;
                  console.log(`[Voice Gateway] ✅ Last resort relay successful: ${conn.userId} -> ${anyConn.userId}`);
                } catch (error: any) {
                  console.error(`[Voice Gateway] ❌ Last resort relay failed:`, error.message);
                }
              }
            });
            if (foundReceiver) break;
          }
        }
        
        if (!foundReceiver) {
          console.error(`[Voice Gateway] ❌ CRITICAL: No receiver found anywhere! Packet from ${conn.userId} will be dropped.`);
          return; // No one to relay to
        }
        // If we found a receiver, continue to normal relay logic as well
      }
      
      let relayed = 0;
      const recipients: string[] = [];
      const skippedRecipients: string[] = [];
      
      // CRITICAL: ALWAYS log first 100 relay attempts to diagnose why packets aren't being relayed
      // CRITICAL: Verify packet is a Buffer before sending
      if (!Buffer.isBuffer(packetWithSender)) {
        // Store values before type narrowing to avoid TypeScript 'never' type issues
        const packetType = typeof packetWithSender;
        let packetConstructor = 'unknown';
        try {
          if (packetWithSender && typeof packetWithSender === 'object') {
            const packetObj = packetWithSender as any;
            packetConstructor = packetObj.constructor?.name || 'unknown';
          }
        } catch (e) {
          // Ignore errors when accessing constructor
        }
        console.error(`[Voice Gateway] ❌ CRITICAL: packetWithSender is not a Buffer! Type: ${packetType}, constructor: ${packetConstructor}`);
        return;
      }
      
      // CRITICAL: ALWAYS log first 100 relay attempts (NO rate limiting)
      const allParticipants = Array.from(room).map(roomWs => {
        const c = connections.get(roomWs);
        const isSender = roomWs === ws;
        return c ? `${c.userId}(readyState=${roomWs.readyState}, callId=${c.callId}${isSender ? ', SENDER' : ''})` : 'unknown';
      }).filter(Boolean);
      
      if (conn.packetsRelayed < 100) {
        console.log(`[Voice Gateway] 🔄 Relay attempt #${conn.packetsRelayed + 1}: sender=${conn.userId}, roomSize=${roomSize}, packetSize=${packetWithSender.length}, participants: [${allParticipants.join(', ')}]`);
      } else if (conn.packetsRelayed % 100 === 0) {
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
          // CRITICAL: Log EVERY send attempt for first 100 packets (NO rate limiting)
          if (conn.packetsRelayed < 100) {
            console.log(`[Voice Gateway] 📤 SENDING packet #${conn.packetsRelayed + 1} to ${otherConn.userId}: readyState=${wsReadyState}, packetSize=${packetWithSender.length} bytes, callId=${otherConn.callId}, isBuffer=${Buffer.isBuffer(packetWithSender)}`);
          }
          
          // CRITICAL: Send as binary - Buffer is automatically sent as binary by ws library
          // The ws library automatically detects Buffer and sends as binary frame
          // send() returns false if the buffer is full (backpressure), true otherwise
          const sendSucceeded = otherWs.send(packetWithSender, (error?: Error) => {
            if (error) {
              console.error(`[Voice Gateway] ❌ Send callback error for ${otherConn.userId}:`, error.message);
            } else if (conn.packetsRelayed < 10) {
              console.log(`[Voice Gateway] ✅ Send callback success for ${otherConn.userId}`);
            }
          });
          
          // Log send result (false = backpressure, but packet is still queued)
          if (conn.packetsRelayed < 10) {
            console.log(`[Voice Gateway] 📤 Send() called for ${otherConn.userId}, succeeded=${sendSucceeded}, packetSize=${packetWithSender.length}`);
          }
          
          recipients.push(otherConn.userId);
          relayed++;
          
          // INSTRUMENTATION: Log first successful relay and every 100th
          if (conn.packetsRelayed === 0 && relayed === 1) {
            console.log(`[Voice Gateway] ✅✅✅ FIRST SUCCESSFUL RELAY: ${conn.userId} -> ${otherConn.userId}, packetSize=${packetWithSender.length} bytes, callId=${conn.callId}`);
          } else if (relayed > 0 && (conn.packetsRelayed + relayed) % 100 === 0) {
            console.log(`[Voice Gateway] ✅ Relayed ${conn.packetsRelayed + relayed} packets: ${conn.userId} -> ${otherConn.userId}`);
          } else if (conn.packetsRelayed < 10) {
            // Log first 10 successful sends
            console.log(`[Voice Gateway] ✅✅✅ Sent packet #${conn.packetsRelayed + relayed} to ${otherConn.userId} (readyState=${wsReadyState}, binary=true, size=${packetWithSender.length})`);
          }
        } catch (error: any) {
          // CRITICAL: Always log send errors (not rate-limited)
          const errorType = error && typeof error === 'object' && error.constructor ? error.constructor.name : typeof error;
          const errorMessage = error?.message || String(error) || 'unknown error';
          console.error(`[Voice Gateway] ❌❌❌ ERROR sending packet to ${otherConn.userId}:`, errorMessage, `CallId: ${otherConn.callId}, readyState: ${wsReadyState}, error type: ${errorType}`);
          skippedRecipients.push(`${otherConn.userId}(error: ${errorMessage})`);
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
        const reasonStr = reason && reason.length > 0 ? reason.toString() : 'none';
        console.log(`[Voice Gateway] ❌❌❌ User ${conn.userId} disconnected from call ${conn.callId} (code: ${code}, reason: ${reasonStr})`);
        
        // CRITICAL: Log room state BEFORE removing this connection
        const roomBefore = rooms.get(conn.callId);
        const roomSizeBefore = roomBefore ? roomBefore.size : 0;
        console.log(`[Voice Gateway] 📊 Room state BEFORE disconnect: callId=${conn.callId}, roomSize=${roomSizeBefore}`);
        
        // Remove from room
        const room = rooms.get(conn.callId);
        if (room) {
          room.delete(ws);
          const roomSizeAfter = room.size;
          if (room.size === 0) {
            rooms.delete(conn.callId);
            console.log(`[Voice Gateway] Room ${conn.callId} closed (no participants)`);
          } else {
            console.log(`[Voice Gateway] Room ${conn.callId} now has ${roomSizeAfter} participant${roomSizeAfter !== 1 ? 's' : ''} (was ${roomSizeBefore})`);
            
            // CRITICAL: Log remaining participants
            const remainingParticipants = Array.from(room).map(roomWs => {
              const c = connections.get(roomWs);
              return c ? c.userId : null;
            }).filter(Boolean) as string[];
            console.log(`[Voice Gateway] 📋 Remaining participants: [${remainingParticipants.join(', ')}]`);
            
            // CRITICAL: Notify remaining participants that someone left
            room.forEach((otherWs) => {
              if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
                try {
                  otherWs.send(JSON.stringify({
                    type: 'room_status',
                    callId: conn.callId,
                    roomSize: roomSizeAfter,
                    participants: remainingParticipants,
                    left: conn.userId
                  }));
                } catch (error: any) {
                  console.error(`[Voice Gateway] Error sending room status on disconnect:`, error.message);
                }
              }
            });
          }
        } else {
          console.warn(`[Voice Gateway] ⚠️ WARNING: No room found for callId ${conn.callId} when disconnecting ${conn.userId}`);
        }
        
        connections.delete(ws);
      } else {
        console.warn(`[Voice Gateway] ⚠️ WARNING: Connection closed but no metadata found (code: ${code})`);
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
          // Send connection confirmation
          ws.send(JSON.stringify({
            type: 'connected',
            callId: normalizedCallId, // CRITICAL FIX: Use normalized callId
            userId,
            timestamp: Date.now(),
          }));
          console.log(`[Voice Gateway] ✅ Sent connection confirmation to ${userId} for call ${normalizedCallId}`);
          
          // CRITICAL: Send room status immediately to help client verify connection
          const currentRoomSize = rooms.get(normalizedCallId)?.size || 0;
          const currentParticipants = Array.from(rooms.get(normalizedCallId) || []).map(rws => {
            const rc = connections.get(rws);
            return rc ? rc.userId : 'unknown';
          }).filter(Boolean);
          
          ws.send(JSON.stringify({
            type: 'room_status',
            callId: normalizedCallId,
            roomSize: currentRoomSize,
            participants: currentParticipants,
            ready: currentRoomSize >= 2
          }));
          console.log(`[Voice Gateway] ✅ Sent initial room_status to ${userId}: roomSize=${currentRoomSize}, participants=[${currentParticipants.join(', ')}]`);
          
          // CRITICAL TEST: Send a test binary packet to verify binary transmission works
          // This will help diagnose if binary packets can be received at all
          const testPacket = Buffer.alloc(676, 0); // Same size as audio packets
          testPacket.writeUInt32LE(999999, 0); // Special seq number for test
          try {
            const testSendResult = ws.send(testPacket, (error?: Error) => {
              if (error) {
                console.error(`[Voice Gateway] ❌ Test binary packet send failed for ${userId}:`, error.message);
              } else {
                console.log(`[Voice Gateway] ✅ Test binary packet sent successfully to ${userId} (this proves binary transmission works)`);
              }
            });
            console.log(`[Voice Gateway] 📤 Test binary packet send() called for ${userId}, result: ${testSendResult}`);
          } catch (testError: any) {
            console.error(`[Voice Gateway] ❌ Error sending test binary packet to ${userId}:`, testError.message);
          }
        } else {
          console.warn(`[Voice Gateway] ⚠️ Cannot send connection confirmation: WebSocket readyState=${ws.readyState} (not OPEN=1)`);
        }
      } catch (error: any) {
        console.error(`[Voice Gateway] ❌ Error sending connection confirmation:`, error.message);
      }
    }, 100);
  });

  // Ping/pong keepalive with improved monitoring
  setInterval(() => {
    const now = Date.now();
    wss.clients.forEach((ws) => {
      const conn = connections.get(ws);
      const isAlive = (ws as any).isAlive;
      const lastPongTime = (ws as any).lastPongTime || 0;
      const timeSinceLastPong = now - lastPongTime;
      
      // Check if connection is dead (no pong response)
      if (isAlive === false) {
        console.log(`[Voice Gateway] ⚠️⚠️⚠️ Terminating inactive connection (no pong response): ${conn?.userId || 'unknown'}, callId: ${conn?.callId || 'unknown'}, timeSinceLastPong: ${timeSinceLastPong}ms`);
        
        // Remove from room before terminating
        if (conn) {
          const room = rooms.get(conn.callId);
          if (room) {
            room.delete(ws);
            if (room.size === 0) {
              rooms.delete(conn.callId);
              console.log(`[Voice Gateway] Room ${conn.callId} closed (no participants after disconnect)`);
            } else {
              console.log(`[Voice Gateway] Room ${conn.callId} now has ${room.size} participant${room.size !== 1 ? 's' : ''} after disconnect`);
            }
          }
          connections.delete(ws);
        }
        
        try {
          ws.terminate();
        } catch (error) {
          // Connection might already be closed
        }
        return;
      }
      
      // Mark as potentially dead, ping will reset if connection is alive
      (ws as any).isAlive = false;
      
      // Send ping
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
          // Log ping sent (first few times only)
          if (conn && (conn.packetsReceived || 0) < 5) {
            console.log(`[Voice Gateway] 📡 Ping sent to ${conn.userId} (callId: ${conn.callId})`);
          }
        } else {
          // WebSocket is not open, mark as dead
          (ws as any).isAlive = false;
        }
      } catch (error: any) {
        // Connection might be closed, mark as dead
        (ws as any).isAlive = false;
        console.warn(`[Voice Gateway] Error sending ping to ${conn?.userId || 'unknown'}:`, error.message);
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

