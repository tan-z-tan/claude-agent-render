# Claude Agent on Render - 設計仕様

## 目的

採用のためのゴールを与えて、自律的に情報を収集してくれるAIエージェントを構築する。
Render上で常時稼働し、外部からAPIでリクエストを受けてストリームで結果を返す。

## アーキテクチャ概要

```
┌──────────────────────────────────────────────┐
│  Render Web Service (常時稼働)                │
│                                              │
│  Express Server (TypeScript)                 │
│  ├─ POST /api/tasks        → タスク作成・実行  │
│  ├─ GET  /api/tasks/:id/stream → SSE        │
│  └─ POST /api/tasks/:id/resume → セッション再開│
│                                              │
│  In-Memory State (Map)                       │
│  ├─ taskId → { sessionId, status, messages } │
│  └─ サーバー再起動で消える = OK               │
│                                              │
│  Claude Agent SDK (query())                  │
│  └─ WebSearch, WebFetch 等のツール            │
└──────────────────────────────────────────────┘
         ▲
         │ HTTPS (SSE streaming)
┌────────┴──────────┐
│  ローカルクライアント │
│  (Express or curl) │
└───────────────────┘
```

## 技術スタック

- **ランタイム**: Node.js + TypeScript
- **サーバー**: Express
- **エージェント**: `@anthropic-ai/claude-code` SDK (`query()`)
- **ストリーミング**: SSE (Server-Sent Events)
- **状態管理**: インメモリ (Map)
- **デプロイ**: Render Web Service + Dockerfile

## ファイル構成

```
src/
├── server.ts       # Express サーバー（Render 側）、ルーティング、SSE
├── agent.ts        # Claude Agent SDK のラッパー
├── store.ts        # インメモリのタスク/セッション管理
├── types.ts        # 型定義
└── client.ts       # ローカル確認用 Express サーバー（簡易 Web UI）
Dockerfile          # Render デプロイ用
```

## API 設計

### POST /api/tasks

タスクを作成してエージェント実行を開始する。

```json
// Request
{ "prompt": "〇〇会社のエンジニア採用情報を調べて" }

// Response
{ "taskId": "abc-123", "status": "running" }
```

### GET /api/tasks/:id/stream

SSE でエージェントの出力をリアルタイムに受け取る。

```
event: system
data: {"type":"system","subtype":"init","session_id":"..."}

event: assistant
data: {"type":"assistant","message":{...}}

event: result
data: {"type":"result","subtype":"success","result":"..."}
```

### POST /api/tasks/:id/resume

既存セッションに追加のプロンプトを送る。

```json
// Request
{ "prompt": "さらに給与レンジも調べて" }

// Response
{ "taskId": "abc-123", "status": "running" }
```

## 実装の流れ

1. `types.ts` — Task, CreateTaskRequest 等の型定義
2. `store.ts` — Map ベースのインメモリストア
3. `agent.ts` — `query()` を呼び出してメッセージを store に蓄積
4. `server.ts` — Express ルート定義、SSE エンドポイント
5. `Dockerfile` — Node.js + Claude Code CLI のセットアップ
6. ローカル動作確認 → Render デプロイ

## Agent SDK の使い方

```typescript
import { query } from "@anthropic-ai/claude-code";

const conversation = query({
  prompt: "...",
  options: {
    allowedTools: ["WebSearch", "WebFetch"],
    permissionMode: "bypassPermissions",
    maxTurns: 20,
    // セッション再開時
    resume: sessionId,
  },
});

for await (const message of conversation) {
  // message: SDKMessage (system | assistant | result | stream_event | ...)
}
```

## 制約・割り切り

- サーバー再起動で全セッション消失 → OK
- 同時実行タスク数は当面制限しない（メモリ注意）
- 認証は当面なし（後から追加可能）
- ローカルに簡易 Express サーバー（client.ts）を立てて動作確認する
