# Image untuk Railway: indexer Ponder dari monorepo pnpm.
# Build context = root repo. Web TIDAK ada di sini (dideploy ke Vercel).
FROM node:22-slim

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# pnpm versi persis dari packageManager di package.json.
RUN corepack enable

WORKDIR /app

# 1. Dependensi dulu (cache layer). Semua package.json workspace disalin supaya --frozen-lockfile valid.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY contracts/package.json contracts/package.json
COPY indexer/package.json indexer/package.json
COPY scripts/package.json scripts/package.json
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile --filter "@rivl/indexer..." --filter "@rivl/scripts..."

# 2. Source yang dibutuhkan. Indexer & scripts hanya memakai ABI dari contracts (bukan Foundry).
COPY contracts/abi contracts/abi
COPY indexer indexer
COPY scripts scripts

ENV NODE_ENV=production

# Default: indexer (deploy/railway/indexer.json memakai start command yang sama).
CMD ["sh", "-c", "pnpm --filter @rivl/indexer exec ponder start --port ${PORT:-42069}"]
