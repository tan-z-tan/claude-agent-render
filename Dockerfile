FROM node:22-slim

# Claude Code CLI をグローバルインストール
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# 依存インストール
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ソースコピー & ビルド
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

EXPOSE 3000
CMD ["node", "dist/server.js"]
