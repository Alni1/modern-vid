# ModernVid 2.0: web server with the transcoding worker.
# docker build -t modernvid . && docker run --env-file .env -p 3000:3000 modernvid
FROM node:22-bookworm-slim

# A current FFmpeg from Debian (the bundled npm build is old); fonts are not needed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY . .
RUN npm run build:player && npm prune --omit=dev

ENV NODE_ENV=production \
    PORT=3000 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    LOCAL_STORAGE_DIR=/data/storage
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "bin/www"]
