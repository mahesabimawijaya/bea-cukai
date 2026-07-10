# -----------------------------
# Builder Stage
# -----------------------------
FROM node:24-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++

COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

COPY . .

ARG DATABASE_URL
ARG NEXTAUTH_URL
ARG NEXTAUTH_SECRET
ARG JIRA_BASE_URL
ARG JIRA_USERNAME
ARG JIRA_PASSWORD
ARG TELE_BOT_TOKEN
ARG TELE_GROUP_ID

ENV DATABASE_URL=${DATABASE_URL}
ENV NEXTAUTH_URL=${NEXTAUTH_URL}
ENV NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
ENV JIRA_BASE_URL=${JIRA_BASE_URL}
ENV JIRA_USERNAME=${JIRA_USERNAME}
ENV JIRA_PASSWORD=${JIRA_PASSWORD}
ENV TELE_BOT_TOKEN=${TELE_BOT_TOKEN}
ENV TELE_GROUP_ID=${TELE_GROUP_ID}

RUN npm run build

# -----------------------------
# Production Stage
# -----------------------------
FROM node:24-bookworm-slim AS runner

WORKDIR /app

ARG DATABASE_URL
ARG NEXTAUTH_URL
ARG NEXTAUTH_SECRET
ARG JIRA_BASE_URL
ARG JIRA_USERNAME
ARG JIRA_PASSWORD
ARG TELE_BOT_TOKEN
ARG TELE_GROUP_ID

ENV NODE_ENV=production
ENV DATABASE_URL=${DATABASE_URL}
ENV NEXTAUTH_URL=${NEXTAUTH_URL}
ENV NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
ENV JIRA_BASE_URL=${JIRA_BASE_URL}
ENV JIRA_USERNAME=${JIRA_USERNAME}
ENV JIRA_PASSWORD=${JIRA_PASSWORD}
ENV TELE_BOT_TOKEN=${TELE_BOT_TOKEN}
ENV TELE_GROUP_ID=${TELE_GROUP_ID}

# Next.js standalone membaca port dari ENV PORT
ENV PORT=3002
ENV HOSTNAME="0.0.0.0"

# 1. Copy folder public (wajib)
COPY --from=builder /app/public ./public

# 2. Copy hasil build standalone (ini sudah berisi mini node_modules yg dibutuhkan saja)
COPY --from=builder /app/.next/standalone ./

# 3. Copy static folder (Next.js standalone tidak meng-copy ini secara otomatis)
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3002

# 4. Jalankan langsung dengan node, TANPA npm start
CMD ["node", "server.js"]