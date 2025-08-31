# Worker image (Node + TypeScript multi-stage)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
RUN npm install
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm install --production
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]