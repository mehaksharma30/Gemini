# Walkie-Talkie V1: What to Delete (WebSocket Voice Gateway Code)

## Watch App (watchOS) - Files to Delete

**Note: These files are not in the current repository but need to be deleted in the watchOS project.**

### Files to DELETE:
1. **`VoiceGateway.swift`** - Entire file
   - Contains all WebSocket connection logic
   - Contains jitter buffer logic
   - Contains packet send/receive code
   - Contains real-time audio streaming

### Code Sections to DELETE (if in other files):
- All WebSocket connection code (`URLSessionWebSocketTask`)
- All jitter buffer management code
- All packet encoding/decoding logic (676-byte packets)
- All real-time audio streaming logic
- All sequence number tracking
- All binary packet handling

### Replace With:
- New `WalkieTalkieService.swift` that:
  - Records 3-10 seconds audio (WAV 16kHz mono 16-bit preferred)
  - POSTs to `/api/wt/message` with multipart/form-data
  - Parses JSON response: `{threadId, transcript, responseText, ttsAudioUrl?}`
  - Displays transcript + responseText
  - Plays audio from `ttsAudioUrl` if provided

## Server-Side - Files to KEEP

**Note: Do NOT delete Voice Gateway server code yet - website still uses it.**

### Files to KEEP:
- `server/src/services/voiceGateway.service.ts` - **KEEP** (website still uses WebSocket)
- `server/src/socket/voiceChatSocket.ts` - **KEEP** (website still uses it)

### Why Keep:
- The website (Angular frontend) still uses WebSocket for website-to-website calls
- Only watchOS is switching to HTTP-only
- Website can continue using WebSocket for better real-time performance

## Frontend (Website) - Files to KEEP

**Note: Website still uses WebSocket for website-to-website calls.**

### Files to KEEP:
- `client/src/app/core/services/voice-gateway.service.ts` - **KEEP** (for website calls)
- `client/src/app/core/services/audio-communication.service.ts` - **KEEP** (for website calls)
- `client/src/app/voice-gateway/voice-gateway.component.ts` - **KEEP** (test/debug tool)

### Why Keep:
- Website-to-website calls still use WebSocket (better performance)
- Walkie-talkie is a separate feature for watchOS integration
- Both can coexist

## Summary

### Watch App (NOT in this repo):
- ✅ DELETE: `VoiceGateway.swift` (entire file)
- ✅ DELETE: All WebSocket connection code
- ✅ DELETE: All jitter buffer code
- ✅ DELETE: All packet send/receive code
- ✅ REPLACE: With `WalkieTalkieService.swift` (HTTP POST only)

### Server (KEEP - website still uses):
- ✅ KEEP: `server/src/services/voiceGateway.service.ts`
- ✅ KEEP: `server/src/socket/voiceChatSocket.ts`
- ✅ ADD: New walkie-talkie endpoints (already created)

### Frontend (KEEP - website still uses):
- ✅ KEEP: `client/src/app/core/services/voice-gateway.service.ts`
- ✅ KEEP: `client/src/app/core/services/audio-communication.service.ts`
- ✅ ADD: New walkie-talkie component (already created)

## Migration Path

1. **Watch App**: Replace `VoiceGateway.swift` with `WalkieTalkieService.swift`
2. **Website**: Continue using WebSocket (no changes needed)
3. **Server**: Add walkie-talkie endpoints (already done)
4. **Frontend**: Add walkie-talkie UI (already done)

Both systems can coexist - WebSocket for website, HTTP for watch.

