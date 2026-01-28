import type { SDKMessage } from "@anthropic-ai/claude-code";
import type { Task, TaskStatus } from "./types.js";
import { randomUUID } from "crypto";

const tasks = new Map<string, Task>();

export function createTask(prompt: string): Task {
  const task: Task = {
    id: randomUUID(),
    sessionId: null,
    prompt,
    status: "running",
    messages: [],
    result: null,
    error: null,
    createdAt: Date.now(),
  };
  tasks.set(task.id, task);
  return task;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function pushMessage(taskId: string, message: SDKMessage): void {
  const task = tasks.get(taskId);
  if (task) {
    task.messages.push(message);
  }
}

export function updateTask(
  taskId: string,
  updates: Partial<Pick<Task, "sessionId" | "status" | "result" | "error">>
): void {
  const task = tasks.get(taskId);
  if (task) {
    Object.assign(task, updates);
  }
}

export function listTasks(): Task[] {
  return Array.from(tasks.values());
}
