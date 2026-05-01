import { writable, get } from "svelte/store";
import type { ChatEvent } from "../stream-parser";

export interface ToolCall {
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
  stdout?: string;
  stderr?: string;
  isError?: boolean;
  completed: boolean;
}

export type ChatMessage =
  | { type: "user"; id: string; text: string; timestamp: number }
  | { type: "agent"; id: string; text: string; timestamp: number }
  | { type: "tool"; id: string; call: ToolCall; timestamp: number };

export interface SessionMeta {
  sessionId: string;
  model: string;
  cwd: string;
  tools: string[];
  cost: number;
  durationMs: number;
  tokenUsage: { input: number; output: number };
}

export interface ChatSession {
  messages: ChatMessage[];
  meta: SessionMeta;
  streaming: boolean;
}

const RAW_MESSAGE_ID = "__raw__";
const sessions = writable<Map<string, ChatSession>>(new Map());

function ensureSession(tabId: string): ChatSession {
  const map = get(sessions);
  let session = map.get(tabId);
  if (!session) {
    session = {
      messages: [],
      meta: { sessionId: "", model: "", cwd: "", tools: [], cost: 0, durationMs: 0, tokenUsage: { input: 0, output: 0 } },
      streaming: false,
    };
    map.set(tabId, session);
  }
  return session;
}

function updateSession(tabId: string, updater: (session: ChatSession) => void) {
  const map = get(sessions);
  const session = ensureSession(tabId);
  updater(session);
  sessions.set(new Map(map));
}

export function getSessionStore(tabId: string) {
  const map = get(sessions);
  if (!map.has(tabId)) {
    ensureSession(tabId);
    sessions.set(new Map(map));
  }
  return {
    subscribe: (fn: (value: ChatSession) => void) => {
      let prev: ChatSession | undefined;
      return sessions.subscribe((m) => {
        const s = m.get(tabId);
        if (s && s !== prev) {
          prev = s;
          fn(s);
        }
      });
    },
  };
}

export function appendUserMessage(tabId: string, text: string) {
  updateSession(tabId, (s) => {
    s.messages.push({
      type: "user",
      id: crypto.randomUUID(),
      text,
      timestamp: Date.now(),
    });
  });
}

export function handleChatEvent(tabId: string, event: ChatEvent) {
  switch (event.type) {
    case "init":
      updateSession(tabId, (s) => {
        s.meta.sessionId = event.sessionId;
        s.meta.model = event.model;
        s.meta.cwd = event.cwd;
        s.meta.tools = event.tools;
        s.streaming = true;
      });
      break;

    case "agent-text":
      updateSession(tabId, (s) => {
        const last = s.messages[s.messages.length - 1];
        if (last?.type === "agent" && last.id === event.messageId) {
          last.text = event.text;
        } else {
          s.messages.push({
            type: "agent",
            id: event.messageId,
            text: event.text,
            timestamp: Date.now(),
          });
        }
      });
      break;

    case "agent-text-delta":
      updateSession(tabId, (s) => {
        const last = s.messages[s.messages.length - 1];
        if (last?.type === "agent" && last.id === event.messageId) {
          last.text += event.delta;
        } else {
          s.messages.push({
            type: "agent",
            id: event.messageId,
            text: event.delta,
            timestamp: Date.now(),
          });
        }
      });
      break;

    case "tool-use":
      updateSession(tabId, (s) => {
        s.messages.push({
          type: "tool",
          id: event.toolId,
          call: {
            toolId: event.toolId,
            toolName: event.toolName,
            input: event.input,
            completed: false,
          },
          timestamp: Date.now(),
        });
      });
      break;

    case "tool-result":
      updateSession(tabId, (s) => {
        const msg = s.messages.find(
          (m) => m.type === "tool" && m.call.toolId === event.toolId,
        );
        if (msg?.type === "tool") {
          msg.call.stdout = event.stdout;
          msg.call.stderr = event.stderr;
          msg.call.isError = event.isError;
          msg.call.completed = true;
        }
      });
      break;

    case "result":
      updateSession(tabId, (s) => {
        s.meta.cost += event.cost;
        s.meta.durationMs += event.durationMs;
        s.meta.tokenUsage = {
          input: s.meta.tokenUsage.input + event.tokenUsage.input,
          output: s.meta.tokenUsage.output + event.tokenUsage.output,
        };
        s.streaming = false;
      });
      break;

    case "raw-text":
      updateSession(tabId, (s) => {
        const last = s.messages[s.messages.length - 1];
        if (last?.type === "agent" && last.id === RAW_MESSAGE_ID) {
          last.text += "\n" + event.text;
        } else {
          s.messages.push({
            type: "agent",
            id: RAW_MESSAGE_ID,
            text: event.text,
            timestamp: Date.now(),
          });
        }
      });
      break;
  }
}

export function startStreaming(tabId: string) {
  const s = get(sessions).get(tabId);
  if (s?.streaming) return;
  updateSession(tabId, (s) => {
    s.streaming = true;
  });
}

export function endStreaming(tabId: string) {
  const s = get(sessions).get(tabId);
  if (!s || !s.streaming) return;
  updateSession(tabId, (s) => {
    s.streaming = false;
  });
}

export function clearSession(tabId: string) {
  const map = get(sessions);
  map.delete(tabId);
  sessions.set(new Map(map));
}
