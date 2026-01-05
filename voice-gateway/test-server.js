// Minimal test server
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

wss.on('listening', () => {
  console.log('✅ Server listening on port 8080');
});

wss.on('connection', (ws, req) => {
  console.log('✅ Connection received!');
  console.log('URL:', req.url);
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  ws.send(JSON.stringify({ type: 'connected' }));
  
  ws.on('close', () => {
    console.log('Connection closed');
  });
});

console.log('Starting test server...');

