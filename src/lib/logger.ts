import { BaseDirectory, writeTextFile, mkdir, exists, readDir, remove } from "@tauri-apps/plugin-fs";

const LOG_DIR = ".atlas/logs";
const MAX_AGE_DAYS = 7;
const FLUSH_INTERVAL_MS = 500;

let buffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirReady = false;

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function todayFile(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${LOG_DIR}/atlas-${yyyy}-${mm}-${dd}.log`;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return `${err.message}${err.stack ? "\n" + err.stack : ""}`;
  return String(err);
}

function enqueue(level: string, source: string, message: string) {
  buffer.push(`[${timestamp()}] [${level}] [${source}] ${message}`);
  if (level === "ERROR") {
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
  }
}

async function ensureLogDir() {
  if (dirReady) return;
  try {
    const dirExists = await exists(LOG_DIR, { baseDir: BaseDirectory.Home });
    if (!dirExists) {
      await mkdir(LOG_DIR, { baseDir: BaseDirectory.Home, recursive: true });
    }
    dirReady = true;
  } catch {
    // Can't create log dir — logging will silently fail
  }
}

async function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;

  const lines = buffer.join("\n") + "\n";
  buffer = [];

  try {
    await ensureLogDir();
    await writeTextFile(todayFile(), lines, {
      baseDir: BaseDirectory.Home,
      append: true,
    });
  } catch {
    // Logging must never crash the app
  }
}

async function cleanOldLogs() {
  try {
    const entries = await readDir(LOG_DIR, { baseDir: BaseDirectory.Home });
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    for (const entry of entries) {
      if (!entry.name?.startsWith("atlas-") || !entry.name.endsWith(".log")) continue;
      const match = entry.name.match(/^atlas-(\d{4})-(\d{2})-(\d{2})\.log$/);
      if (!match) continue;
      const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}`).getTime();
      if (fileDate < cutoff) {
        await remove(`${LOG_DIR}/${entry.name}`, { baseDir: BaseDirectory.Home });
      }
    }
  } catch {
    // Non-critical — old logs just stay around longer
  }
}

export const log = {
  info(source: string, message: string) {
    enqueue("INFO", source, message);
  },

  warn(source: string, message: string) {
    enqueue("WARN", source, message);
  },

  error(source: string, message: string, err?: unknown) {
    const full = err ? `${message}: ${formatError(err)}` : message;
    enqueue("ERROR", source, full);
  },

  async flush() {
    await flush();
  },

  async init() {
    await ensureLogDir();
    enqueue("INFO", "logger", "Atlas started");
    await flush();
    cleanOldLogs();
  },
};
