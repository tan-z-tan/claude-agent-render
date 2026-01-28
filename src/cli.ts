#!/usr/bin/env node
/**
 * CLI クライアント — Claude Code 風のインタラクティブ会話
 *
 * 使い方:
 *   npx tsx src/cli.ts                        # 新規セッション
 *   npx tsx src/cli.ts --resume <taskId>      # セッション再開
 *   AGENT_URL=https://... npx tsx src/cli.ts  # リモート接続
 */
import * as readline from "readline";
import { EventSource } from "eventsource";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:3000";
const API_KEY = process.env.AGENT_API_KEY || "";

// --- ANSI colors ---
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

let currentTaskId: string | null = null;

// --- Parse args ---
function parseArgs(): { resume?: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--resume");
  if (idx !== -1 && args[idx + 1]) {
    return { resume: args[idx + 1] };
  }
  return {};
}

// --- SSE streaming ---
function streamTask(taskId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = API_KEY
      ? `${AGENT_URL}/api/tasks/${taskId}/stream?key=${API_KEY}`
      : `${AGENT_URL}/api/tasks/${taskId}/stream`;
    const es = new EventSource(url);

    es.addEventListener("system", (e: any) => {
      const d = JSON.parse(e.data);
      if (d.subtype === "init") {
        console.log(dim(`session: ${d.session_id}`));
      }
    });

    es.addEventListener("assistant", (e: any) => {
      const d = JSON.parse(e.data);
      const content = d.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            process.stdout.write(`\n${block.text}\n`);
          }
          if (block.type === "tool_use") {
            console.log(yellow(`  ↳ ${block.name}(${JSON.stringify(block.input).slice(0, 200)})`));
          }
        }
      }
    });

    es.addEventListener("user", (e: any) => {
      const d = JSON.parse(e.data);
      const content = d.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            const text =
              typeof block.content === "string"
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map((c: any) => c.text || "").join("\n")
                  : JSON.stringify(block.content);
            if (text) {
              const preview = text.length > 300 ? text.slice(0, 300) + "..." : text;
              console.log(dim(`  ← ${preview}`));
            }
          }
        }
      }
    });

    es.addEventListener("result", (e: any) => {
      const d = JSON.parse(e.data);
      const cost = (d.total_cost_usd || 0).toFixed(4);
      const turns = d.num_turns || "?";
      console.log(dim(`\n─── done (cost: $${cost}, turns: ${turns}) ───`));
      if (d.result) {
        console.log(green(d.result));
      }
    });

    es.addEventListener("done", () => {
      es.close();
      resolve();
    });

    es.addEventListener("error", () => {
      es.close();
      reject(new Error("stream error"));
    });
  });
}

// --- API calls ---
function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["Authorization"] = `Bearer ${API_KEY}`;
  return h;
}

async function createTask(prompt: string): Promise<string> {
  const res = await fetch(`${AGENT_URL}/api/tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "failed to create task");
  return data.taskId;
}

async function resumeTask(taskId: string, prompt: string): Promise<void> {
  const res = await fetch(`${AGENT_URL}/api/tasks/${taskId}/resume`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "failed to resume task");
}

// --- REPL ---
async function main() {
  const { resume } = parseArgs();

  console.log(bold("Claude Agent CLI"));
  console.log(dim(`server: ${AGENT_URL}`));
  console.log(dim(`commands: /quit, /resume <taskId>\n`));

  if (resume) {
    currentTaskId = resume;
    console.log(dim(`resuming task: ${currentTaskId}`));
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question(cyan("\n> "), async (input) => {
      const line = input.trim();
      if (!line) return prompt();

      // --- commands ---
      if (line === "/quit" || line === "/exit") {
        if (currentTaskId) {
          console.log(dim(`\ntask id (for resume): ${currentTaskId}`));
        }
        rl.close();
        process.exit(0);
      }
      if (line.startsWith("/resume ")) {
        currentTaskId = line.slice("/resume ".length).trim();
        console.log(dim(`switched to task: ${currentTaskId}`));
        return prompt();
      }

      try {
        if (currentTaskId) {
          // 既存セッションを継続
          await resumeTask(currentTaskId, line);
        } else {
          // 新規タスク作成
          currentTaskId = await createTask(line);
          console.log(dim(`task: ${currentTaskId}`));
        }
        await streamTask(currentTaskId);
      } catch (err: any) {
        console.error(red(`error: ${err.message}`));
      }

      prompt();
    });
  };

  prompt();
}

main();
