FROM node:20-bookworm-slim

WORKDIR /app

# Prisma schema engine needs OpenSSL at runtime (migrations/startup).
RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Optional: install local Whisper runtime only when explicitly requested.
# Keeps Railway image smaller/stabler by default.
ARG INSTALL_LOCAL_WHISPER=false
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"
RUN if [ "${INSTALL_LOCAL_WHISPER}" = "true" ]; then \
    apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv ffmpeg && \
    python3 -m venv "${VIRTUAL_ENV}" && \
    "${VIRTUAL_ENV}/bin/pip" install --no-cache-dir --upgrade pip && \
    "${VIRTUAL_ENV}/bin/pip" install --no-cache-dir openai-whisper && \
    rm -rf /var/lib/apt/lists/*; \
  fi

# Install workspace dependencies
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci

# Copy source and build API
COPY . .
RUN npm -w apps/api run build

EXPOSE 3000
CMD ["npm", "-w", "apps/api", "run", "start"]
