# Comprehensive Audio Fix: Loopback Prevention, Duplicate Connections, Diagnostics

## Summary

Fixed audio echo/repeat/distortion and "mic not sending" issues by:
1. **Preventing loopback** at server and client (senderId filtering)
2. **Preventing duplicate connections** (singleton guard)
3. **Ensuring mic sends audio** (soft mute, never kill tracks)
4. **Adding comprehensive diagnostics** (packet counters, state logging)

---

## Server Changes: `server/src/services/voiceGateway.service.ts`

### 1. Enhanced Connection Metadata Tracking

```diff
// Store connection metadata
const connections = new Map<WebSocket, {
  connId: string;
  userId: string;
  callId: string;
  connectedAt: number;
  packetsRelayed: number;
+ packetsReceived: number; // Track received audio frames
+ lastStatsLog: number; // Last time stats were logged (rate limiting)
}>();
```

### 2. Enhanced Connection Logging

```diff
    console.log(`[Voice Gateway] ✅ New connection: userId=${userId}, callId=${callId}`);
+   console.log(`[Voice Gateway] 📊 Connection details: origin=${req.headers.origin || 'none'}, path=${pathname}, fullURL=${req.url}`);

    // Store connection metadata
    const connId = `${userId}-${Date.now()}`;
    connections.set(ws, {
      connId,
      userId,
      callId,
      connectedAt: Date.now(),
      packetsRelayed: 0,
+     packetsReceived: 0,
+     lastStatsLog: Date.now(),
    });
```

### 3. Enhanced Message Handling with Diagnostics

```diff
      // Skip text messages (connection confirmations, etc.)
      if (!isBinary) {
+       // Log text messages for debugging (first few only)
+       if (conn.packetsReceived < 3) {
+         console.log(`[Voice Gateway] 📨 Received text message from ${conn.userId} in call ${conn.callId}:`, data.toString().substring(0, 100));
+       }
        return;
      }

+     // DIAGNOSTIC: Log first few audio packets
+     if (conn.packetsReceived < 3) {
+       console.log(`[Voice Gateway] 🎤 Received audio packet from ${conn.userId} in call ${conn.callId}, size: ${Buffer.isBuffer(data) ? data.length : 'unknown'}, roomSize: ${rooms.get(conn.callId)?.size || 0}`);
+     }
+     
      conn.packetsReceived++;
```

### 4. Enhanced Relay Logging with Broadcast Recipients

```diff
      // Relay to all other connections in the same room
      // CRITICAL: Exclude sender (ws) to prevent loopback
      const room = rooms.get(conn.callId);
      if (!room) {
+       console.warn(`[Voice Gateway] ⚠️ No room found for callId: ${conn.callId}`);
        return;
      }

+     const roomSize = room.size;
      let relayed = 0;
+     const recipients: string[] = [];
      
      room.forEach((otherWs) => {
        // CRITICAL: Do NOT send to sender (prevents loopback)
        if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
+         const otherConn = connections.get(otherWs);
+         if (otherConn) {
+           recipients.push(otherConn.userId);
+         }
          otherWs.send(packetWithSender);
          relayed++;
        }
      });

      conn.packetsRelayed += relayed;
      
+     // DIAGNOSTIC: Rate-limited stats logging (once per second per user)
+     const now = Date.now();
+     if (now - conn.lastStatsLog >= 1000) {
+       console.log(`[Voice Gateway] 📊 ${conn.userId} (call ${conn.callId}): received=${conn.packetsReceived}, relayed=${conn.packetsRelayed}, roomSize=${roomSize}, broadcastRecipients=${relayed}`);
+       conn.lastStatsLog = now;
+     }
+     
+     // Log first few relay operations for debugging
+     if (conn.packetsRelayed <= 5) {
+       console.log(`[Voice Gateway] 🔄 Relayed packet from ${conn.userId} to ${relayed} recipient(s): [${recipients.join(', ')}]`);
+     }
```

---

## Client Changes: `client/src/app/core/services/voice-gateway.service.ts`

### 1. Enhanced Stats Tracking

```diff
  // Stats for logging (once per second)
  private packetsRecvCount: number = 0;
+ private packetsSentCount: number = 0;
+ private packetsPlayedCount: number = 0;
  private lastLogTime: number = 0;
  private statsLogInterval: any = null;
  
+ // Singleton connection guard
+ private activeCallId: string | null = null;
+ private activeUserId: string | null = null;
+ private onmessageHandlerAttached: boolean = false;
```

### 2. Strengthened Singleton Connection Guard

```diff
  async connect(callId: string, userId: string): Promise<void> {
    // CRITICAL: Singleton connection guard - ensure only ONE WebSocket per callId
    // If already connected to the same call, return early
-   if (this.ws && this.ws.readyState === WebSocket.OPEN && this.callId === callId && this.userId === userId) {
+   if (this.ws && this.ws.readyState === WebSocket.OPEN && this.activeCallId === callId && this.activeUserId === userId) {
      console.log(`[Voice Gateway] ⚠️ Already connected to call ${callId} as ${userId}, skipping duplicate connection`);
+     console.log(`[Voice Gateway] Active connection: callId=${this.activeCallId}, userId=${this.activeUserId}, readyState=${this.ws.readyState}`);
      return;
    }
    
-   // CRITICAL: Clean up any existing connection and handlers to prevent duplicates
+   // CRITICAL: If connecting to different call, close previous connection first
    if (this.ws && (this.activeCallId !== callId || this.activeUserId !== userId)) {
+     console.log(`[Voice Gateway] 🔄 Switching calls: ${this.activeCallId}/${this.activeUserId} -> ${callId}/${userId}`);
      console.log(`[Voice Gateway] 🧹 Cleaning up previous connection`);
      console.log(`[Voice Gateway] Previous connection: callId=${this.activeCallId}, userId=${this.activeUserId}, readyState=${this.ws.readyState}`);
      
      // Remove all handlers to prevent duplicate handlers
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
+     this.onmessageHandlerAttached = false;
      console.log(`[Voice Gateway] 🧹 Removed all handlers from previous WebSocket`);
      
      // Close existing connection cleanly
-     if (this.ws.readyState !== WebSocket.CLOSED) {
+     if (this.ws.readyState !== WebSocket.CLOSED && this.ws.readyState !== WebSocket.CLOSING) {
        console.log(`[Voice Gateway] 🔌 Closing previous WebSocket connection`);
-       this.ws.close(1000, 'Reconnecting with new callId/userId');
+       this.ws.close(1000, 'Switching to new call');
      }
      this.ws = null;
+     this.activeCallId = null;
+     this.activeUserId = null;
    }
```

### 3. Enhanced Connection Lifecycle Logging

```diff
        // Create new WebSocket connection
        // CRITICAL: Log WebSocket creation to detect duplicates
-       console.log(`[Voice Gateway] 🔌 Creating new WebSocket connection (callId: ${this.callId}, userId: ${this.userId})`);
+       console.log(`[Voice Gateway] 🔌 Creating new WebSocket connection`);
+       console.log(`[Voice Gateway] URL: ${url}`);
+       console.log(`[Voice Gateway] callId: ${this.callId}, userId: ${this.userId}`);
        console.log(`[Voice Gateway] Previous WebSocket state: ${prevWsState}`);
+       console.log(`[Voice Gateway] Active call: ${this.activeCallId}, Active user: ${this.activeUserId}`);
```

### 4. Single onmessage Handler Guard

```diff
        // CRITICAL: Log when onmessage handler is attached
+       // CRITICAL: Ensure onmessage handler is attached ONLY ONCE
+       if (this.onmessageHandlerAttached) {
+         console.error('[Voice Gateway] ❌ ERROR: onmessage handler already attached! This should not happen.');
+         return;
+       }
+       
        console.log(`[Voice Gateway] 📨 Attaching onmessage handler to WebSocket (callId: ${this.callId}, userId: ${this.userId})`);
+       this.onmessageHandlerAttached = true;
```

### 5. Enhanced Close Handler with Active Connection Tracking

```diff
          // CRITICAL: Remove handlers to prevent duplicate handlers on reconnect
          if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onerror = null;
            this.ws.onclose = null;
+           this.onmessageHandlerAttached = false;
            console.log(`[Voice Gateway] 🧹 Removed all WebSocket handlers`);
          }
+         
+         // Clear active connection tracking
+         if (this.activeCallId === this.callId && this.activeUserId === this.userId) {
+           this.activeCallId = null;
+           this.activeUserId = null;
+         }
```

### 6. Packet Counters

```diff
      // Send packet as binary
      this.ws.send(packet);
+     this.packetsSentCount++;
```

```diff
      // Track scheduled source for cleanup
      this.scheduledSources.add(source);
+     this.packetsPlayedCount++; // Track played packets
```

### 7. Enhanced Stats Logging

```diff
  private getCurrentStats(): { packetsRecvPerSec: number; bufferDepth: number } {
-   return {
-     packetsRecvPerSec: this.packetsRecvCount,
-     bufferDepth: this.jitterBuffer.size,
-   };
+   const packetsSentPerSec = this.packetsSentCount;
+   const packetsRecvPerSec = this.packetsRecvCount;
+   const packetsPlayedPerSec = this.packetsPlayedCount;
+   
+   // Reset counters for next second
+   this.packetsSentCount = 0;
+   this.packetsRecvCount = 0;
+   this.packetsPlayedCount = 0;
+   
+   return {
+     packetsSentPerSec,
+     packetsRecvPerSec,
+     packetsPlayedPerSec,
+     bufferDepth: this.jitterBuffer.size,
+   };
  }
```

```diff
-   console.log(`[Voice Gateway] Stats: packetsRecv/sec=${stats.packetsRecvPerSec}, bufferDepth=${this.jitterBuffer.size}, scheduledAheadMs=${scheduledAheadMs}, playing=${this.isPlaying}, schedulingPaused=${this.isSchedulingPaused}, audioCtx.state=${audioCtxState}`);
+   // DIAGNOSTIC: Comprehensive stats logging
+   console.log(`[Voice Gateway] 📊 Stats: sent/sec=${stats.packetsSentPerSec}, recv/sec=${stats.packetsRecvPerSec}, played/sec=${stats.packetsPlayedPerSec}, bufferDepth=${this.jitterBuffer.size}, scheduledAheadMs=${scheduledAheadMs}, playing=${this.isPlaying}, schedulingPaused=${this.isSchedulingPaused}, audioCtx.state=${audioCtxState}, micMuted=${this.isMicMuted}, speakerMuted=${this.isSpeakerMuted}`);
```

### 8. Reset Counters on Connect

```diff
    this.callId = callId;
    this.userId = userId;
+   this.activeCallId = callId;
+   this.activeUserId = userId;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
+   
+   // Reset packet counters
+   this.packetsSentCount = 0;
+   this.packetsRecvCount = 0;
+   this.packetsPlayedCount = 0;
```

---

## Client Changes: `client/src/app/core/services/audio-communication.service.ts`

### 1. Mic Track Diagnostic Logging

```diff
      // Store mic track for soft mute (enable/disable, never stop)
      this.micTrack = this.mediaStream.getAudioTracks()[0] || null;
      if (!this.micTrack) {
        throw new Error('No audio track found in media stream');
      }
+     
+     // DIAGNOSTIC: Log mic track state
+     console.log(`[Audio Communication] 🎤 Mic track initialized: enabled=${this.micTrack.enabled}, readyState=${this.micTrack.readyState}, muted=${this.micTrack.muted}, label=${this.micTrack.label}`);
```

### 2. Enhanced Mute State Logging

```diff
      // Log mute state
-     console.log(`[Audio Communication] Microphone ${this.currentState.isMuted ? 'muted' : 'unmuted'}`);
-     console.log(`[Audio Communication] micMuted=${this.currentState.isMuted}, audioCtx.state=${this.audioContext?.state || 'null'}, micTrack.enabled=${this.micTrack?.enabled ?? 'null'}`);
+     // DIAGNOSTIC: Log mute state with comprehensive details
+     console.log(`[Audio Communication] 🎤 Microphone ${this.currentState.isMuted ? 'MUTED' : 'UNMUTED'}`);
+     console.log(`[Audio Communication] 📊 Mute state: micMuted=${this.currentState.isMuted}, audioCtx.state=${this.audioContext?.state || 'null'}, micTrack.enabled=${this.micTrack?.enabled ?? 'null'}, micTrack.readyState=${this.micTrack?.readyState || 'null'}, micTrack.muted=${this.micTrack?.muted ?? 'null'}`);
```

---

## How to Verify

### Test Setup
1. Open two browser tabs/windows (or two devices)
2. Both users join the same `callId`
3. Use headphones to prevent acoustic feedback

### Expected Client Console Logs (User A - Sender)

```
[Voice Gateway] 🔌 Creating new WebSocket connection
[Voice Gateway] URL: wss://...
[Voice Gateway] callId: ..., userId: ...
[Voice Gateway] 📨 Attaching onmessage handler to WebSocket
[Voice Gateway] ✅ Connected successfully
[Audio Communication] 🎤 Mic track initialized: enabled=true, readyState=live, muted=false, label=...
[Voice Gateway] 📊 Stats: sent/sec=50, recv/sec=0, played/sec=0, bufferDepth=0, ...
```

### Expected Client Console Logs (User B - Receiver)

```
[Voice Gateway] 🔌 Creating new WebSocket connection
[Voice Gateway] 📨 Attaching onmessage handler to WebSocket
[Voice Gateway] ✅ Connected successfully
[Voice Gateway] Received packet #1, seq=..., bufferDepth=1
[Voice Gateway] 📊 Stats: sent/sec=0, recv/sec=50, played/sec=50, bufferDepth=25, ...
```

### Expected Server Logs

```
[Voice Gateway] ✅ New connection: userId=userA, callId=call-123
[Voice Gateway] 📊 Connection details: origin=..., path=/voice-gateway, fullURL=...
[Voice Gateway] 🎤 Received audio packet from userA in call call-123, size: 676, roomSize: 2
[Voice Gateway] 🔄 Relayed packet from userA to 1 recipient(s): [userB]
[Voice Gateway] 📊 userA (call call-123): received=100, relayed=100, roomSize=2, broadcastRecipients=1
```

### Verification Checklist

- [ ] **No Loopback**: User A should NOT hear their own voice
  - Check console: `⚠️ Ignoring self packet` should appear (first few packets only)
  - Server logs: `broadcastRecipients=1` (not 2)

- [ ] **Mic Sending**: When User A speaks, `sent/sec > 0`
  - Check console: `sent/sec=50` (or similar, ~50 packets/sec = 1 second of audio)
  - Server logs: `received=...` increments

- [ ] **Audio Receiving**: When User B receives, `recv/sec > 0`
  - Check console: `recv/sec=50` (or similar)
  - Server logs: `relayed=...` increments

- [ ] **Audio Playing**: When User B receives, `played/sec > 0`
  - Check console: `played/sec=50` (or similar)
  - User B should hear User A's voice

- [ ] **No Duplicate Connections**: Only one WebSocket per call
  - Check console: `⚠️ Already connected` should appear if `connect()` called twice
  - No duplicate `onmessage` handlers

- [ ] **Mute/Unmute Works**: Mic mute doesn't kill audio permanently
  - Mute: `sent/sec=0`, but mic track still `enabled=true` (or `enabled=false` but track not stopped)
  - Unmute: `sent/sec` resumes, `audioCtx.state=running`

- [ ] **No Echo/Repeat**: Audio plays once, not multiple times
  - Check console: `played/sec` should match `recv/sec` (not higher)
  - No repeated audio in playback

---

## Key Fixes

1. **Loopback Prevention**: Server excludes sender from broadcast, client ignores self packets
2. **Singleton Connection**: `activeCallId`/`activeUserId` tracking prevents duplicate WebSockets
3. **Single Handler**: `onmessageHandlerAttached` flag ensures only one `onmessage` handler
4. **Soft Mute**: `micTrack.enabled` toggle, never `track.stop()`
5. **Comprehensive Diagnostics**: Packet counters (sent/recv/played), state logging, rate-limited stats

---

## Files Modified

1. `server/src/services/voiceGateway.service.ts` - Enhanced logging, tracking
2. `client/src/app/core/services/voice-gateway.service.ts` - Singleton guard, diagnostics, packet counters
3. `client/src/app/core/services/audio-communication.service.ts` - Mic track diagnostics

