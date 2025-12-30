const fs = require('fs');
const path = require('path');

// Read ngrok URL from file
const ngrokUrlPath = path.join(__dirname, '..', 'src', 'environments', '.ngrok-url');
const envPath = path.join(__dirname, '..', 'src', 'environments', 'environment.ts');

try {
  const ngrokUrl = fs.readFileSync(ngrokUrlPath, 'utf-8').trim();
  
  if (ngrokUrl) {
    // Read current environment file
    let envContent = fs.readFileSync(envPath, 'utf-8');
    
    // Replace the apiUrl with ngrok URL
    const newApiUrl = `${ngrokUrl}/api`;
    envContent = envContent.replace(
      /apiUrl:\s*['"`][^'"`]+['"`]/,
      `apiUrl: '${newApiUrl}'`
    );
    
    // Also update ngrokUrl property if it exists
    if (envContent.includes('ngrokUrl:')) {
      envContent = envContent.replace(
        /ngrokUrl:\s*['"`][^'"`]*['"`]/,
        `ngrokUrl: '${ngrokUrl}'`
      );
    } else {
      // Add ngrokUrl property after apiUrl
      envContent = envContent.replace(
        /(apiUrl:\s*['"`][^'"`]+['"`],)/,
        `$1\n  ngrokUrl: '${ngrokUrl}',`
      );
    }
    
    // Write back
    fs.writeFileSync(envPath, envContent, 'utf-8');
    console.log(`✅ Updated environment.ts with ngrok URL: ${ngrokUrl}`);
  } else {
    console.log('⚠️  No ngrok URL found, using localhost');
  }
} catch (error) {
  // If .ngrok-url doesn't exist, that's fine - use localhost
  console.log('ℹ️  No ngrok URL file found, using localhost (run "npm run dev:ngrok" in server/)');
}

