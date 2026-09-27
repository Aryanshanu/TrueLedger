# Build from the frontend/ directory:
#   docker build -t outliers-frontend frontend/
FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-fund --no-audit

COPY server.js ./
COPY public/ ./public/

ENV PORT=8080
CMD ["node", "server.js"]
