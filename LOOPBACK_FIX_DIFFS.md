# Audio Loopback and Duplicate Connection Fix - Exact Diffs

## Problem
- Audio has distortion/echo/repeating
- Logs show 1000+ packets relayed, both users join same callId
- Strongly suggests feedback loop or duplicate playback

## Solution
**A) Prevent Loopback**: Add senderId to packets, ignore self packets on client
**B) Prevent Duplicate Connections**: Ensure only one WebSocket per call with proper cleanup

---

## Server Changes: `server/src/services/voiceGateway.service.ts`

### Change 1: Add senderId to relayed packets

```diff
      // Validate packet size: header (12 bytes) + payload (640 bytes) = 652 bytes
      if (!buffer || buffer.length !== 652) {
        console.warn(`[Voice Gateway] Invalid packet size: ${buffer?.length || 'undefined'} bytes (expected 652)`);
        return;
      }

+     // CRITICAL: Add senderId to packet to prevent loopback on client side
+     // Packet format: seq (4) + timestamp (8) + senderId (24) + payload (640) = 676 bytes
+     // Convert existing packet to new format with senderId
+     const senderId = conn.userId;
+     const senderIdBytes = Buffer.from(senderId.padEnd(24, '\0').slice(0, 24), 'utf8'); // Fixed 24 bytes
+     
+     // Create new packet with senderId
+     const packetWithSender = Buffer.alloc(676);
+     buffer.copy(packetWithSender, 0, 0, 12); // Copy seq + timestamp (12 bytes)
+     senderIdBytes.copy(packetWithSender, 12, 0, 24); // Add senderId (24 bytes)
+     buffer.copy(packetWithSender, 36, 12, 652); // Copy payload (640 bytes)

      // Relay to all other connections in the same room
+     // CRITICAL: Exclude sender (ws) to prevent loopback
      const room = rooms.get(conn.callId);
      if (!room) return;

      let relayed = 0;
      room.forEach((otherWs) => {
-       if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
-         otherWs.send(buffer);
+       // CRITICAL: Do NOT send to sender (prevents loopback)
+       if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
+         otherWs.send(packetWithSender);
          relayed++;
        }
      });
```

**Lines**: ~228-244

---

## Client Changes: `client/src/app/core/services/voice-gateway.service.ts`

### Change 1: Update packet size constants

```diff
// Voice Gateway Constants
const SAMPLE_RATE = 16000;
const SAMPLES_PER_FRAME = 320; // 20ms at 16kHz
const FRAME_DURATION_MS = 20;
const PAYLOAD_SIZE = 640; // SAMPLES_PER_FRAME * 2 (Int16 = 2 bytes)
-const PACKET_SIZE = 12 + PAYLOAD_SIZE; // header (12) + payload (640)
+const PACKET_SIZE_OLD = 12 + PAYLOAD_SIZE; // Old format: header (12) + payload (640) = 652 bytes
+const PACKET_SIZE = 12 + 24 + PAYLOAD_SIZE; // New format: seq (4) + timestamp (8) + senderId (24) + payload (640) = 676 bytes
+const SENDER_ID_SIZE = 24; // Fixed 24 bytes for senderId
```

**Lines**: ~5-11

### Change 2: Add senderId to outgoing packets

```diff
    try {
-     // Create packet: seq (4 bytes) + timestamp (8 bytes) + payload (640 bytes)
+     // Create packet: seq (4 bytes) + timestamp (8 bytes) + senderId (24 bytes) + payload (640 bytes)
      const packet = new ArrayBuffer(PACKET_SIZE);
      const view = new DataView(packet);
      const timestamp = Date.now();
      const seq = this.seqCounter++;

      view.setUint32(0, seq, true); // seq (little-endian)
      view.setBigUint64(4, BigInt(timestamp), true); // timestamp (little-endian)
      
+     // Add senderId (24 bytes, UTF-8 encoded, padded/truncated)
+     const senderIdStr = this.userId.padEnd(SENDER_ID_SIZE, '\0').slice(0, SENDER_ID_SIZE);
+     const senderIdBytes = new TextEncoder().encode(senderIdStr);
+     new Uint8Array(packet, 12, SENDER_ID_SIZE).set(senderIdBytes.slice(0, SENDER_ID_SIZE));
+     
-     // Copy PCM payload
+     // Copy PCM payload (starts at offset 36: 12 + 24)
      const pcmBytes = new Uint8Array(pcm16Data.buffer);
-     new Uint8Array(packet, 12).set(pcmBytes);
+     new Uint8Array(packet, 36).set(pcmBytes);
```

**Lines**: ~466-479

### Change 3: Ignore self packets in handleAudioPacket

```diff
  private handleAudioPacket(data: ArrayBuffer): void {
    if (!data) {
      console.warn('[Voice Gateway] Received null/undefined packet');
      return;
    }
    
-   if (data.byteLength !== PACKET_SIZE) {
-     console.warn(`[Voice Gateway] Invalid packet size: ${data.byteLength} (expected ${PACKET_SIZE})`);
+   // Support both old format (652 bytes) and new format (676 bytes with senderId)
+   const isOldFormat = data.byteLength === PACKET_SIZE_OLD;
+   const isNewFormat = data.byteLength === PACKET_SIZE;
+   
+   if (!isOldFormat && !isNewFormat) {
+     console.warn(`[Voice Gateway] Invalid packet size: ${data.byteLength} (expected ${PACKET_SIZE_OLD} or ${PACKET_SIZE})`);
      return;
    }

    try {
      const view = new DataView(data);
      const seq = view.getUint32(0, true); // Little-endian
      const timestampMs = Number(view.getBigUint64(4, true)); // Little-endian
-     const payload = data.slice(12); // 640 bytes
+     
+     // Extract senderId if new format, or use empty string for old format
+     let senderId = '';
+     let payloadOffset = 12;
+     
+     if (isNewFormat) {
+       // Extract senderId (24 bytes, UTF-8)
+       const senderIdBytes = new Uint8Array(data, 12, SENDER_ID_SIZE);
+       senderId = new TextDecoder('utf-8').decode(senderIdBytes).replace(/\0/g, ''); // Remove null padding
+       
+       // CRITICAL: Ignore packets from self to prevent loopback/echo
+       if (senderId && senderId === this.userId) {
+         // Log first few self-packets for debugging
+         if (this.packetsRecvCount < 5) {
+           console.warn(`[Voice Gateway] ⚠️ Ignoring self packet (senderId=${senderId}, localUserId=${this.userId})`);
+         }
+         return;
+       }
+       
+       payloadOffset = 36; // 12 + 24
+     }
+     
+     const payload = data.slice(payloadOffset); // 640 bytes
```

**Lines**: ~618-650

### Change 4: Single connection guard with logging

```diff
  async connect(callId: string, userId: string): Promise<void> {
+   // CRITICAL: Ensure only ONE WebSocket connection per call
+   // If already connected to the same call, return early
+   if (this.ws && this.ws.readyState === WebSocket.OPEN && this.callId === callId && this.userId === userId) {
+     console.log(`[Voice Gateway] ⚠️ Already connected to call ${callId} as ${userId}, skipping duplicate connection`);
+     return;
+   }
+   
    // CRITICAL: Clean up any existing connection and handlers to prevent duplicates
    if (this.ws) {
-     console.log('[Voice Gateway] Cleaning up existing connection before new connection');
+     console.log(`[Voice Gateway] 🧹 Cleaning up existing connection before new connection`);
+     console.log(`[Voice Gateway] Previous connection: callId=${this.callId}, userId=${this.userId}, readyState=${this.ws.readyState}`);
      
      // Remove all handlers to prevent duplicate handlers
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
+     console.log(`[Voice Gateway] 🧹 Removed all handlers from previous WebSocket`);
      
      // Close existing connection cleanly
      if (this.ws.readyState !== WebSocket.CLOSED) {
+       console.log(`[Voice Gateway] 🔌 Closing previous WebSocket connection`);
        this.ws.close(1000, 'Reconnecting with new callId/userId');
      }
      this.ws = null;
    }
```

**Lines**: ~98-130

### Change 5: Connection lifecycle logging

```diff
-       this.ws = new WebSocket(url);
+       // CRITICAL: Log WebSocket creation to detect duplicates
+       console.log(`[Voice Gateway] 🔌 Creating new WebSocket connection (callId: ${this.callId}, userId: ${this.userId})`);
+       console.log(`[Voice Gateway] Previous WebSocket state: ${this.ws ? `exists, readyState=${this.ws.readyState}` : 'null'}`);
+       
+       this.ws = new WebSocket(url);
+       console.log(`[Voice Gateway] WebSocket object created, readyState: ${this.ws.readyState}`);
```

**Lines**: ~141-147

```diff
+       // CRITICAL: Log when onmessage handler is attached
+       console.log(`[Voice Gateway] 📨 Attaching onmessage handler to WebSocket`);
+       
        this.ws.onmessage = async (event) => {
```

**Lines**: ~237-239

```diff
+       // CRITICAL: Log when onclose handler is attached
+       console.log(`[Voice Gateway] 🔌 Attaching onclose handler to WebSocket`);
+       
        this.ws.onclose = (event: CloseEvent) => {
          const connectionDuration = Date.now() - connectionStartTime;
-         console.log(`[Voice Gateway] 🔌 Disconnected (code: ${event.code}, reason: ${event.reason || 'none'}, duration: ${connectionDuration}ms)`);
+         console.log(`[Voice Gateway] 🔌 WebSocket CLOSED (code: ${event.code}, reason: ${event.reason || 'none'}, duration: ${connectionDuration}ms)`);
          console.log(`[Voice Gateway] Close event details:`, {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
-           readyState: this.ws?.readyState
+           readyState: this.ws?.readyState,
+           callId: this.callId,
+           userId: this.userId
          });
          
          this.connectedSubject.next(false);
          
          // CRITICAL: Clean up playback state but do NOT close audioContext
          // AudioContext should remain open for reuse
          this.cleanupPlayback();
          
          // CRITICAL: Remove handlers to prevent duplicate handlers on reconnect
          if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onerror = null;
            this.ws.onclose = null;
+           console.log(`[Voice Gateway] 🧹 Removed all WebSocket handlers`);
          }
```

**Lines**: ~334-360

---

## Packet Format Changes

### Old Format (652 bytes)
```
[seq: 4 bytes][timestamp: 8 bytes][payload: 640 bytes]
```

### New Format (676 bytes)
```
[seq: 4 bytes][timestamp: 8 bytes][senderId: 24 bytes][payload: 640 bytes]
```

**senderId**: UTF-8 encoded, padded with null bytes to 24 bytes, truncated if longer

---

## Expected Behavior

### Server
- Adds senderId to all relayed packets
- Excludes sender from broadcast (already implemented, but now with senderId)

### Client
- Sends packets with senderId
- Ignores packets where senderId === local userId
- Only one WebSocket connection per call
- Comprehensive logging for connection lifecycle

### Console Logs (Client)
```
[Voice Gateway] 🔌 Creating new WebSocket connection (callId: ..., userId: ...)
[Voice Gateway] WebSocket object created, readyState: 0
[Voice Gateway] 📨 Attaching onmessage handler to WebSocket
[Voice Gateway] 🔌 Attaching onclose handler to WebSocket
[Voice Gateway] ✅ Connected successfully
[Voice Gateway] ⚠️ Ignoring self packet (senderId=..., localUserId=...)  // First few only
[Voice Gateway] 🔌 WebSocket CLOSED (code: 1000, ...)
[Voice Gateway] 🧹 Removed all WebSocket handlers
```

---

## Testing

1. **Test Loopback Prevention**:
   - User A sends audio
   - User A should NOT hear their own audio
   - Console should show "Ignoring self packet" for first few packets

2. **Test Duplicate Connection Prevention**:
   - Call `connect()` twice with same callId/userId
   - Should see "Already connected, skipping duplicate connection"
   - Only one WebSocket should exist

3. **Test Connection Cleanup**:
   - Call `connect()` with different callId/userId
   - Should see cleanup logs and new connection created
   - Old handlers should be removed

---

## Files Modified

1. `server/src/services/voiceGateway.service.ts` - Add senderId to packets
2. `client/src/app/core/services/voice-gateway.service.ts` - Ignore self packets, single connection guard, logging

