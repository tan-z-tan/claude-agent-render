import { query } from "@anthropic-ai/claude-code";
import type { SDKMessage } from "@anthropic-ai/claude-code";
import { pushMessage, updateTask } from "./store.js";

export type MessageCallback = (message: SDKMessage) => void;

/**
 * タスクに対して Agent SDK の query() を実行する。
 * メッセージが来るたびに callback を呼び、store にも蓄積する。
 */
export async function runAgent(
  taskId: string,
  prompt: string,
  onMessage: MessageCallback,
  resumeSessionId?: string
): Promise<void> {
  console.log(`[agent] Starting task ${taskId}, prompt: "${prompt.slice(0, 80)}"`);

  const conversation = query({
    prompt,
    options: {
      allowedTools: ["WebSearch", "WebFetch", "Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      permissionMode: "bypassPermissions",
      maxTurns: 30,
      stderr: (data: string) => console.error(`[agent:stderr] ${data}`),
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  });

  try {
    for await (const message of conversation) {
      console.log(`[agent] message type=${message.type}`);
      pushMessage(taskId, message);
      onMessage(message);

      // system init からセッションID を取得
      if (message.type === "system" && message.subtype === "init") {
        updateTask(taskId, { sessionId: message.session_id });
      }

      // 結果メッセージで完了/エラーを記録
      if (message.type === "result") {
        if (message.subtype === "success") {
          updateTask(taskId, { status: "completed", result: message.result });
        } else {
          updateTask(taskId, { status: "error", error: message.subtype });
        }
      }
    }
  } catch (err) {
    console.error(`[agent] Task ${taskId} error:`, err);
    updateTask(taskId, { status: "error", error: String(err) });
    throw err;
  }
}
