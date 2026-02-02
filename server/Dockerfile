# Dockerfile for MindMemos Server on Google Compute Engine
FROM node:20-slim

# Set working directory
WORKDIR /app

# Install system dependencies for Google Cloud SDK and audio processing
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy TypeScript source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Create directories for uploads and temp files
RUN mkdir -p uploads tmp

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["npm", "start"]

