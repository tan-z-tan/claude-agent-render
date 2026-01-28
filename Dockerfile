FROM node:22-slim

# Claude Code CLI をグローバルインストール
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# 全依存インストール（ビルド用に devDependencies も含む）
COPY package.json package-lock.json ./
RUN npm ci

# ソースコピー & ビルド
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ビルド後に devDependencies を削除
RUN npm prune --omit=dev

EXPOSE 3000
CMD ["node", "dist/server.js"]
