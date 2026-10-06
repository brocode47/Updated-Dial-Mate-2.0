FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY prisma ./prisma
RUN npx --yes prisma@5.22.0 generate

COPY src ./src

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npm","start"]
