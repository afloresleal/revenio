FROM node:20-bookworm-slim

WORKDIR /app

# Dependencies required for local Whisper transcription
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 python3-pip ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Install whisper CLI
RUN pip3 install --no-cache-dir openai-whisper

# Install workspace dependencies
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci

# Copy source and build API
COPY . .
RUN npm -w apps/api run build

EXPOSE 3000
CMD ["npm", "-w", "apps/api", "run", "start"]
