FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source files
COPY src/ ./src/

# Copy web UI
COPY web/ ./web/

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

CMD ["node", "src/index.js"]
