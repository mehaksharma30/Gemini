# Walkie-Talkie Implementation Plan

## Files to Modify/Create

### Server Side:
1. `server/src/models/WalkieTalkieMessage.ts` - Update schema (remove AI fields, add fromUserId/toUserId)
2. `server/src/controllers/walkieTalkie.controller.ts` - Complete rewrite (remove all AI/STT/TTS)
3. `server/src/routes/walkieTalkie.routes.ts` - Update routes to match new API spec

### Client Side (Website):
4. `client/src/app/core/services/walkie-talkie.service.ts` - Update to use new API
5. `client/src/app/walkie-talkie/walkie-talkie.component.ts` - Remove AI features, add polling

### WatchOS (if exists):
6. New WalkieTalkieService.swift
7. New WalkieTalkieView.swift

## API Endpoints (New):
- POST /api/wt/send - Upload audio, store message
- GET /api/wt/thread?userA=<id>&userB=<id> - Get thread between two users
- GET /api/wt/poll?threadId=<id>&after=<timestamp> - Get new messages
- GET /api/wt/audio/:messageId - Serve audio file

## Confirmation:
✅ Panic AI Chat will remain completely untouched

