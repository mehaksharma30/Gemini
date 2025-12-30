import axios from 'axios';

/**
 * Find an available ngrok API port (4040, 4041, 4042, etc.)
 */
async function findNgrokApiPort(): Promise<number | null> {
  for (let port = 4040; port < 4050; port++) {
    try {
      const response = await axios.get(`http://127.0.0.1:${port}/api/tunnels`, { timeout: 1000 });
      // Port is in use and ngrok is running
      return port;
    } catch (e: any) {
      if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') {
        // Port is not in use, continue checking
        continue;
      }
      // Some other error, try next port
    }
  }
  return null;
}

async function getNgrokPublicUrl(): Promise<string> {
  const apiPort = await findNgrokApiPort();
  
  if (!apiPort) {
    throw new Error('Ngrok API not accessible. Is ngrok running? Run "npm run dev:ngrok" first.');
  }
  
  try {
    const response = await axios.get(`http://127.0.0.1:${apiPort}/api/tunnels`, {
      timeout: 2000,
    });
    const tunnels = response.data?.tunnels || [];
    const httpsTunnel = tunnels.find((t: any) => t.proto === 'https');
    
    if (httpsTunnel?.public_url) {
      return httpsTunnel.public_url;
    } else if (tunnels.length > 0 && tunnels[0].public_url) {
      return tunnels[0].public_url;
    } else {
      throw new Error('No active ngrok HTTPS tunnel found.');
    }
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Ngrok API not accessible. Is ngrok running? Run "npm run dev:ngrok" first.');
    }
    throw new Error(`Failed to get ngrok URL: ${error.message}`);
  }
}

async function main() {
  try {
    const url = await getNgrokPublicUrl();
    console.log(`NGROK_URL=${url}`);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
