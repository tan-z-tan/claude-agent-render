import express from "express";
import { createTask, getTask } from "./store.js";
import { runAgent } from "./agent.js";
import type { CreateTaskRequest, ResumeTaskRequest } from "./types.js";

const app = express();

// CORS: ローカルクライアントからのアクセスを許可
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json());

// --- API Key 認証 ---
const API_KEY = process.env.API_KEY;
app.use("/api", (req, res, next) => {
  if (!API_KEY) return next(); // API_KEY 未設定なら認証スキップ
  const auth = req.headers.authorization;
  if (auth === `Bearer ${API_KEY}`) return next();
  // SSE の EventSource は Authorization ヘッダーを送れないので query param も許可
  if (req.query.key === API_KEY) return next();
  res.status(401).json({ error: "unauthorized" });
});

// --- POST /api/tasks : タスク作成 & エージェント実行開始 ---
app.post("/api/tasks", (req, res) => {
  const { prompt } = req.body as CreateTaskRequest;
  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const task = createTask(prompt);

  // SSE で配信するため、リスナーを保持
  taskListeners.set(task.id, []);

  // バックグラウンドで実行（await しない）
  runAgent(task.id, prompt, (message) => {
    broadcast(task.id, message);
  }).catch((err) => {
    console.error(`Task ${task.id} failed:`, err);
    broadcast(task.id, { type: "error", error: String(err) } as any);
  });

  res.json({ taskId: task.id, status: "running" });
});

// --- GET /api/tasks/:id/stream : SSE ストリーム ---
app.get("/api/tasks/:id/stream", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }

  // SSE ヘッダー
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // 過去メッセージをリプレイ
  for (const msg of task.messages) {
    res.write(`event: ${msg.type}\ndata: ${JSON.stringify(msg)}\n\n`);
  }

  // 完了済みならここで閉じる
  if (task.status !== "running") {
    res.write(`event: done\ndata: {"status":"${task.status}"}\n\n`);
    res.end();
    return;
  }

  // リアルタイムリスナー登録
  const listener = (message: unknown) => {
    res.write(
      `event: ${(message as any).type}\ndata: ${JSON.stringify(message)}\n\n`
    );
    // result が来たら SSE 終了
    if ((message as any).type === "result") {
      res.write(`event: done\ndata: {"status":"completed"}\n\n`);
      res.end();
    }
  };

  const listeners = taskListeners.get(task.id);
  if (listeners) listeners.push(listener);

  // クライアント切断時にリスナー除去
  req.on("close", () => {
    const ls = taskListeners.get(task.id);
    if (ls) {
      const idx = ls.indexOf(listener);
      if (idx >= 0) ls.splice(idx, 1);
    }
  });
});

// --- POST /api/tasks/:id/resume : セッション再開 ---
app.post("/api/tasks/:id/resume", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  if (!task.sessionId) {
    res.status(400).json({ error: "task has no session yet" });
    return;
  }
  if (task.status === "running") {
    res.status(409).json({ error: "task is still running" });
    return;
  }

  const { prompt } = req.body as ResumeTaskRequest;
  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  // 状態リセットして再実行
  task.status = "running";
  task.result = null;
  task.error = null;
  taskListeners.set(task.id, []);

  runAgent(task.id, prompt, (message) => {
    broadcast(task.id, message);
  }, task.sessionId).catch((err) => {
    console.error(`Task ${task.id} resume failed:`, err);
  });

  res.json({ taskId: task.id, status: "running" });
});

// --- SSE ブロードキャスト ---
type Listener = (message: unknown) => void;
const taskListeners = new Map<string, Listener[]>();

function broadcast(taskId: string, message: unknown) {
  const listeners = taskListeners.get(taskId);
  if (listeners) {
    for (const listener of listeners) {
      listener(message);
    }
  }
}

// --- サーバー起動 ---
const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, () => {
  console.log(`Agent server listening on port ${PORT}`);
});
