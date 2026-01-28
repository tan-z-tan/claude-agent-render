import type { SDKMessage } from "@anthropic-ai/claude-code";

export type TaskStatus = "running" | "completed" | "error";

export interface Task {
  id: string;
  sessionId: string | null;
  prompt: string;
  status: TaskStatus;
  messages: SDKMessage[];
  result: string | null;
  error: string | null;
  createdAt: number;
}

export interface CreateTaskRequest {
  prompt: string;
}

export interface ResumeTaskRequest {
  prompt: string;
}
