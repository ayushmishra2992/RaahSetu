# RaahSetu API — production image
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build
ENV NODE_ENV=production PORT=5000
EXPOSE 5000
# Apply migrations on start; seed demo data only when SEED_DEMO=true.
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$SEED_DEMO\" = \"true\" ]; then ALLOW_DEMO_SEED=true npx prisma db seed; fi && node --enable-source-maps dist/server.js"]
