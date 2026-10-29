/**
 * Backend access — one module so the API base never leaks across components.
 * SSE comes from a POST (EventSource can't POST), so we parse the
 * `event: X / data: JSON` blocks off a ReadableStream ourselves.
 *
 * `NEXT_PUBLIC_API_URL` is the canonical build-time origin. The legacy
 * `NEXT_PUBLIC_API_BASE_URL` is still accepted. A production build with no
 * configured origin fails loudly instead of silently calling localhost.
 */

import type { AuditEvent, Encounter, Healthz } from "./types";

const configuredBase = (
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  ""
)
  .trim()
  .replace(/\/+$/, "");

const absoluteBase = /^https?:\/\//i.test(configuredBase) ? configuredBase : "";
const devFallback =
  process.env.NODE_ENV === "production" ? "" : "http://localhost:8000";

export const API_BASE = configuredBase ? absoluteBase : devFallback;

export const API_CONFIG_ERROR: string | null = absoluteBase
  ? null
  : configuredBase
    ? `NEXT_PUBLIC_API_URL must be an absolute http(s) URL (got "${configuredBase}").`
    : process.env.NODE_ENV === "production"
      ? "NEXT_PUBLIC_API_URL is not set for this deployment. Point it at the FastAPI origin and redeploy."
      : null;

function apiBase(): string {
  if (!API_BASE) {
    throw new Error(API_CONFIG_ERROR ?? "Backend URL is not configured.");
  }
  return API_BASE;
}

/** Absolute backend URL for static assets (scan slices, fixtures). */
export function assetUrl(path: string): string {
  return `${API_BASE}${path}`;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const base = apiBase();
  try {
    return await fetch(`${base}${path}`, init);
  } catch (err) {
    // Preserve abort semantics: the console uses AbortError to ignore stale runs.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error(
      `Cannot reach backend at ${base}: ${err instanceof Error ? err.message : "network error"}`
    );
  }
}

export async function getHealthz(): Promise<Healthz> {
  const res = await request("/healthz", { cache: "no-store" });
  if (!res.ok) throw new Error(`healthz ${res.status} (${API_BASE})`);
  return res.json();
}

export async function getEncounters(): Promise<Encounter[]> {
  const res = await request("/api/encounters", { cache: "no-store" });
  if (!res.ok) throw new Error(`encounters ${res.status} (${API_BASE})`);
  return res.json();
}

export interface StreamAuditRequest {
  encounter_id: string;
  encounter?: Encounter; // patched packet for the FR-5.2 re-verify loop
}

export async function streamAudit(
  req: StreamAuditRequest,
  onEvent: (evt: AuditEvent) => void,
  { signal }: { signal?: AbortSignal } = {}
): Promise<void> {
  const res = await request("/api/audit-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    cache: "no-store",
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`audit-stream ${res.status} (${API_BASE})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  const dispatchBlock = (block: string) => {
    const lines = block.split("\n");
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event: ")) eventName = line.slice("event: ".length).trim();
      else if (line.startsWith("data: ")) dataLines.push(line.slice("data: ".length));
    }
    if (dataLines.length === 0) return;
    let data: unknown;
    try {
      data = JSON.parse(dataLines.length === 1 ? dataLines[0] : dataLines.join("\n"));
    } catch {
      return; // malformed frame — skip, never crash the console on a bad line
    }
    onEvent({ event: eventName, data } as AuditEvent);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffered.indexOf("\n\n")) !== -1) {
      const block = buffered.slice(0, sep);
      buffered = buffered.slice(sep + 2);
      dispatchBlock(block);
    }
  }
}
