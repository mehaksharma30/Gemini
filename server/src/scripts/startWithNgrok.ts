import { spawn } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;
const NGROK_AUTH_TOKEN = process.env.NGROK_AUTH_TOKEN || '';

let ngrokProcess: any = null;
let ngrokApiPort = 4040; // Default ngrok web interface port

async function startNgrok(): Promise<string> {
  try {
    console.log('🚀 Starting ngrok tunnel...');
    
    // Ngrok now requires authentication (even for free accounts)
    if (!NGROK_AUTH_TOKEN) {
      console.error('\n❌ NGROK_AUTH_TOKEN is required!');
      console.error('\n📝 To get your free ngrok auth token:');
      console.error('   1. Go to: https://dashboard.ngrok.com/get-started/your-authtoken');
      console.error('   2. Sign up for a free account (if needed)');
      console.error('   3. Copy your authtoken');
      console.error('   4. Add to server/.env:');
      console.error('      NGROK_AUTH_TOKEN=your-token-here');
      console.error('\n');
      throw new Error('NGROK_AUTH_TOKEN is required. Get your free token from https://dashboard.ngrok.com/get-started/your-authtoken');
    }
    
    const portNumber = typeof PORT === 'string' ? parseInt(PORT) : PORT;
    console.log(`🔌 Connecting to port ${portNumber}...`);
    
    // ALWAYS use npx ngrok (never system ngrok) to ensure we get the latest version
    console.log('📡 Starting ngrok via npx (ensures latest version)...');
    
    // Find available API port (4040, 4041, 4042, etc.)
    ngrokApiPort = await findAvailablePort(4040);
    if (ngrokApiPort !== 4040) {
      console.log(`   Using ngrok API port ${ngrokApiPort} (4040 was busy)`);
    }
    
    // Check if ngrok is already running on this API port
    try {
      const checkResponse = await axios.get(`http://127.0.0.1:${ngrokApiPort}/api/tunnels`, { timeout: 1000 });
      const existingTunnels = checkResponse.data?.tunnels || [];
      if (existingTunnels.length > 0) {
        const existingUrl = existingTunnels[0].public_url;
        console.log('✅ Found existing ngrok tunnel!');
        console.log(`📡 Public URL: ${existingUrl}`);
        return existingUrl;
      }
    } catch (e) {
      // No existing ngrok, continue to start new one
    }
    
    // Build ngrok command - ALWAYS use npx
    const ngrokArgs = [
      '--yes', // Auto-install if not found
      'ngrok',
      'http',
      portNumber.toString(),
      '--authtoken',
      NGROK_AUTH_TOKEN,
      '--log=stdout', // Log to stdout for debugging
    ];
    
    // Add web-addr if using non-default port
    if (ngrokApiPort !== 4040) {
      ngrokArgs.push('--web-addr', `127.0.0.1:${ngrokApiPort}`);
    }
    
    console.log(`   Command: npx ${ngrokArgs.join(' ')}`);
    
    // Start ngrok process
    ngrokProcess = spawn('npx', ngrokArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    
    // Capture ngrok output for debugging
    let ngrokOutput = '';
    let ngrokError = '';
    let hasOldVersionError = false;
    
    ngrokProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      ngrokOutput += output;
      
      // Check for old version error
      if (output.includes('too old') || output.includes('ERR_NGROK_121') || output.includes('minimum supported')) {
        hasOldVersionError = true;
        console.error('\n❌ Detected old system ngrok. Using npx ngrok with local dependency.');
        console.error('   Please run: npm install -D ngrok');
        console.error('   Then: npm run dev:ngrok');
      }
      
      // Log important messages
      if (output.includes('started tunnel') || output.includes('Forwarding') || output.includes('https://') || output.includes('Session Status')) {
        console.log('   ngrok:', output.trim());
      }
    });
    
    ngrokProcess.stderr?.on('data', (data) => {
      const error = data.toString();
      ngrokError += error;
      
      // Check for old version error in stderr too
      if (error.includes('too old') || error.includes('ERR_NGROK_121') || error.includes('minimum supported')) {
        hasOldVersionError = true;
        console.error('\n❌ Detected old system ngrok. Using npx ngrok with local dependency.');
        console.error('   Please run: npm install -D ngrok');
        console.error('   Then: npm run dev:ngrok');
      }
      
      // Log errors
      if (error.trim()) {
        console.error('   ngrok stderr:', error.trim());
      }
    });
    
    // Check if process exits early
    ngrokProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error('   ngrok process exited with code:', code);
        if (hasOldVersionError) {
          console.error('   This is likely due to an old system ngrok version.');
        }
      }
    });
    
    // Wait for ngrok to start and get URL from API
    let url: string | null = null;
    let attempts = 0;
    const maxAttempts = 40; // 20 seconds max wait
    
    while (!url && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
      
      // Check if ngrok process died
      if (ngrokProcess.killed || (ngrokProcess.exitCode !== null && ngrokProcess.exitCode !== 0)) {
        if (hasOldVersionError) {
          throw new Error('Old ngrok version detected. Please run: npm install -D ngrok');
        }
        throw new Error(`Ngrok process exited. Output: ${ngrokOutput}\nErrors: ${ngrokError}`);
      }
      
      try {
        const response = await axios.get(`http://127.0.0.1:${ngrokApiPort}/api/tunnels`, {
          timeout: 1000,
        });
        const tunnels = response.data?.tunnels || [];
        if (tunnels.length > 0 && tunnels[0].public_url) {
          url = tunnels[0].public_url;
          break;
        }
      } catch (apiError: any) {
        // API not ready yet, continue waiting
        if (attempts % 4 === 0) {
          console.log(`   Waiting for ngrok to start... (${attempts * 0.5}s)`);
        }
      }
    }
    
    if (!url) {
      console.error('   ngrok output:', ngrokOutput);
      console.error('   ngrok errors:', ngrokError);
      if (hasOldVersionError) {
        throw new Error('Old ngrok version detected. Please run: npm install -D ngrok');
      }
      throw new Error('Could not get ngrok URL after 20 seconds. Check ngrok output above for errors.');
    }
    
    console.log('✅ Ngrok tunnel established!');
    console.log(`📡 Public URL: ${url}`);
    
    return url;
  } catch (error: any) {
    // Clean up ngrok process if it was started
    if (ngrokProcess) {
      ngrokProcess.kill();
      ngrokProcess = null;
    }
    
    console.error('❌ Failed to start ngrok:', error.message);
    if (!error.message?.includes('NGROK_AUTH_TOKEN is required')) {
      console.error('\n💡 Troubleshooting:');
      console.error('   1. Make sure NGROK_AUTH_TOKEN is set in server/.env');
      console.error('   2. Verify your token is correct (get from: https://dashboard.ngrok.com/get-started/your-authtoken)');
      console.error('   3. Check your internet connection');
      console.error('   4. Try: npm install -D ngrok (to ensure local version)');
      console.error('   5. Then: npm run dev:ngrok');
    }
    throw error;
  }
}

/**
 * Find an available port starting from startPort
 * Returns a port that is either free (ECONNREFUSED) or has ngrok running on it
 */
async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 10; port++) {
    try {
      const response = await axios.get(`http://127.0.0.1:${port}/api/tunnels`, { timeout: 500 });
      // Port has ngrok running - we can use it
      return port;
    } catch (e: any) {
      if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') {
        // Port is free, return it
        return port;
      }
      // Some other error, try next port
    }
  }
  // Fallback to start port if all checked
  return startPort;
}

async function writeNgrokUrl(url: string): Promise<void> {
  try {
    // Write to server root for easy access
    const serverEnvPath = join(__dirname, '..', '..', '.ngrok-url');
    writeFileSync(serverEnvPath, url, 'utf-8');
    
    // Write to client environments directory
    const clientEnvPath = join(__dirname, '..', '..', '..', 'client', 'src', 'environments', '.ngrok-url');
    writeFileSync(clientEnvPath, url, 'utf-8');
    
    // Update client environment.ts file
    const clientEnvTsPath = join(__dirname, '..', '..', '..', 'client', 'src', 'environments', 'environment.ts');
    try {
      let envContent = readFileSync(clientEnvTsPath, 'utf-8');
      const newApiUrl = `${url}/api`;
      
      // Replace apiUrl
      envContent = envContent.replace(
        /apiUrl:\s*['"`][^'"`]+['"`]/,
        `apiUrl: '${newApiUrl}'`
      );
      
      // Update or add ngrokUrl
      if (envContent.includes('ngrokUrl:')) {
        envContent = envContent.replace(
          /ngrokUrl:\s*['"`][^'"`]*['"`]/,
          `ngrokUrl: '${url}'`
        );
      } else {
        // Add ngrokUrl after apiUrl
        envContent = envContent.replace(
          /(apiUrl:\s*['"`][^'"`]+['"`],)/,
          `$1\n  ngrokUrl: '${url}',`
        );
      }
      
      writeFileSync(clientEnvTsPath, envContent, 'utf-8');
      console.log('📝 Updated client environment.ts with ngrok URL');
    } catch (envError: any) {
      console.log('⚠️  Could not update environment.ts automatically:', envError.message);
      console.log('   You may need to manually update client/src/environments/environment.ts');
    }
    
    console.log('📝 Ngrok URL written to .ngrok-url files');
  } catch (error: any) {
    console.error('⚠️  Failed to write ngrok URL file:', error.message);
  }
}

async function main() {
  try {
    // Start the backend server first
    console.log(`🚀 Starting backend server on port ${PORT}...`);
    const serverProcess = spawn('npm', ['run', 'dev'], {
      stdio: 'pipe',
      shell: true,
      cwd: join(__dirname, '..', '..'),
    });
    
    // Wait a moment for server to start
    console.log('⏳ Waiting for server to initialize...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Start ngrok after server is starting
    const ngrokUrl = await startNgrok();
    
    // Write URL to files
    await writeNgrokUrl(ngrokUrl);
    
    // Print clear instructions with NGROK_URL format
    console.log('\n' + '='.repeat(60));
    console.log('🌐 NGROK PUBLIC URL:');
    console.log(`   ${ngrokUrl}`);
    console.log('='.repeat(60));
    console.log(`\n📋 NGROK_URL=${ngrokUrl}\n`);
    console.log('📱 Use this URL on your phone/other device:');
    console.log(`   ${ngrokUrl}`);
    console.log('\n💡 Frontend will automatically use this URL in dev mode.');
    console.log('   Make sure to run: cd client && npm start');
    console.log('\n');
    
    // Forward server output
    serverProcess.stdout?.on('data', (data) => {
      process.stdout.write(data);
    });
    serverProcess.stderr?.on('data', (data) => {
      process.stderr.write(data);
    });
    
    // Handle process termination
    const cleanup = () => {
      console.log('\n🛑 Shutting down...');
      serverProcess.kill();
      if (ngrokProcess) {
        ngrokProcess.kill();
        ngrokProcess = null;
      }
    };
    
    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
    
    // Keep process alive
    serverProcess.on('exit', (code) => {
      console.log(`\n⚠️  Backend server exited with code ${code}`);
      cleanup();
      process.exit(code || 0);
    });
    
  } catch (error: any) {
    console.error('❌ Failed to start with ngrok:', error);
    process.exit(1);
  }
}

main();
