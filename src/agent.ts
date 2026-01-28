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
  const conversation = query({
    prompt,
    options: {
      allowedTools: ["WebSearch", "WebFetch", "Read", "Write", "Bash"],
      permissionMode: "bypassPermissions",
      maxTurns: 30,
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  });

  for await (const message of conversation) {
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
}
