# Voice Gateway

WebSocket-based voice gateway for real-time audio communication.

## Features

- WebSocket server on port 8080
- Room-based audio routing (by `callId`)
- Binary audio packet relaying (652 bytes per packet)
- Connection logging and room size tracking
- Ping/pong keepalive

## Installation

```bash
cd voice-gateway
npm install
```

## Running

```bash
npm start
```

The server will start on `ws://localhost:8080`

## Usage

### Connect to a call

```
ws://localhost:8080/?callId=<call-id>&userId=<user-id>
```

### Packet Format

Each audio packet is exactly **652 bytes**:
- Bytes 0-3: seq (uint32 LE) - Sequence number
- Bytes 4-11: timestampMs (uint64 LE) - Timestamp in milliseconds
- Bytes 12-651: payload (640 bytes) - PCM16 audio data (320 samples * 2 bytes)

### Room Management

- All clients with the same `callId` are in the same room
- Binary packets are relayed to all other clients in the same room
- Rooms are automatically cleaned up when empty

## Logs

The server logs:
- Connection/disconnection events
- Room join/leave with participant counts
- Packet relay statistics (every 100 packets)
- Inactive connection terminations

## Example

```javascript
const ws = new WebSocket('ws://localhost:8080/?callId=test-call-1&userId=userA');

ws.onopen = () => {
  console.log('Connected');
};

ws.onmessage = (event) => {
  if (typeof event.data === 'string') {
    // Connection confirmation
    const msg = JSON.parse(event.data);
    console.log('Connected to call:', msg.callId);
  } else {
    // Binary audio packet (652 bytes)
    // Process audio data...
  }
};
```
