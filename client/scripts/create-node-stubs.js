#!/usr/bin/env node

// Create stub modules for Node.js built-ins that are not available in browser
// These are needed because https-proxy-agent (dependency of speech SDK) tries to use them
// but they're not needed in browser environments

const fs = require('fs');
const path = require('path');

const nodeModulesPath = path.join(__dirname, '..', 'node_modules');

const stubs = {
  'url': 'module.exports = {};',
  'assert': 'module.exports = function() {};',
  'util': 'module.exports = { inherits: function() {} };',
};

// Create stub modules
Object.keys(stubs).forEach(moduleName => {
  const modulePath = path.join(nodeModulesPath, moduleName);
  const indexPath = path.join(modulePath, 'index.js');
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(modulePath)) {
    fs.mkdirSync(modulePath, { recursive: true });
  }
  
  // Write stub file
  fs.writeFileSync(indexPath, stubs[moduleName], 'utf8');
  console.log(`Created stub for ${moduleName}`);
});

