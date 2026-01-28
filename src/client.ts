/**
 * ローカル確認用 Express サーバー
 *
 * ブラウザで http://localhost:4000 を開くと簡易 UI が表示される。
 * プロンプトを入力すると Render 上（またはローカル）の Agent サーバーに
 * タスクを送信し、SSE でストリーミング結果を表示する。
 *
 * 使い方:
 *   AGENT_URL=http://localhost:3000 npx tsx src/client.ts
 */
import express from "express";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:3000";
const PORT = 4000;

const app = express();

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(HTML);
});

app.listen(PORT, () => {
  console.log(`Client UI: http://localhost:${PORT}`);
  console.log(`Agent server: ${AGENT_URL}`);
});

// --- 簡易 HTML UI ---
const HTML = /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Claude Agent Client</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 24px; }
    h1 { margin-bottom: 16px; color: #7c83ff; }
    #prompt { width: 100%; padding: 10px; font-size: 14px; font-family: monospace;
              background: #16213e; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; }
    button { margin-top: 8px; padding: 8px 20px; background: #7c83ff; color: #fff;
             border: none; border-radius: 4px; cursor: pointer; font-family: monospace; }
    button:disabled { opacity: 0.5; }
    #log { margin-top: 16px; background: #0f0f23; padding: 16px; border-radius: 4px;
           max-height: 70vh; overflow-y: auto; white-space: pre-wrap; font-size: 13px;
           line-height: 1.5; }
    .msg-system { color: #666; }
    .msg-assistant { color: #e0e0e0; }
    .msg-result { color: #4caf50; font-weight: bold; }
    .msg-error { color: #f44336; }
    .msg-stream { color: #aaa; }
    #task-info { margin-top: 8px; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Claude Agent</h1>
  <input id="prompt" placeholder="プロンプトを入力..." />
  <br>
  <button id="send" onclick="sendTask()">Send</button>
  <button id="resume" onclick="resumeTask()" disabled>Resume (追加質問)</button>
  <div id="task-info"></div>
  <div id="log"></div>

  <script>
    const AGENT = "${AGENT_URL}";
    let currentTaskId = null;

    function log(text, cls = "") {
      const el = document.getElementById("log");
      const line = document.createElement("div");
      line.className = cls;
      line.textContent = text;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }

    async function sendTask() {
      const prompt = document.getElementById("prompt").value.trim();
      if (!prompt) return;

      document.getElementById("send").disabled = true;
      document.getElementById("resume").disabled = true;
      document.getElementById("log").innerHTML = "";
      log(">> " + prompt, "msg-system");

      const res = await fetch(AGENT + "/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      currentTaskId = data.taskId;
      document.getElementById("task-info").textContent = "Task: " + currentTaskId;
      log("Task created: " + currentTaskId, "msg-system");

      streamTask(currentTaskId);
    }

    async function resumeTask() {
      if (!currentTaskId) return;
      const prompt = document.getElementById("prompt").value.trim();
      if (!prompt) return;

      document.getElementById("send").disabled = true;
      document.getElementById("resume").disabled = true;
      log("\\n>> (resume) " + prompt, "msg-system");

      const res = await fetch(AGENT + "/api/tasks/" + currentTaskId + "/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      log("Resumed: " + data.taskId, "msg-system");

      streamTask(currentTaskId);
    }

    function streamTask(taskId) {
      const es = new EventSource(AGENT + "/api/tasks/" + taskId + "/stream");

      es.addEventListener("system", (e) => {
        const d = JSON.parse(e.data);
        log("[system] " + d.subtype + " session=" + (d.session_id || ""), "msg-system");
      });

      es.addEventListener("assistant", (e) => {
        const d = JSON.parse(e.data);
        const content = d.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") log(block.text, "msg-assistant");
            if (block.type === "tool_use") log("[tool] " + block.name + ": " + JSON.stringify(block.input).slice(0, 200), "msg-stream");
          }
        }
      });

      es.addEventListener("result", (e) => {
        const d = JSON.parse(e.data);
        log("\\n--- RESULT ---", "msg-result");
        log(d.result || d.subtype, "msg-result");
      });

      es.addEventListener("done", () => {
        es.close();
        document.getElementById("send").disabled = false;
        document.getElementById("resume").disabled = false;
        log("\\n[done]", "msg-system");
      });

      es.addEventListener("error", (e) => {
        log("[stream error]", "msg-error");
        es.close();
        document.getElementById("send").disabled = false;
      });
    }
  </script>
</body>
</html>`;
