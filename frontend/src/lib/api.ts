/**
 * Backend access — one module so the API base never leaks across components.
 * SSE comes from a POST (EventSource can't POST), so we parse the
 * `event: X / data: JSON` blocks off a ReadableStream ourselves.
 */

import type { AuditEvent, Encounter, Healthz } from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8000";

export async function getHealthz(): Promise<Healthz> {
  const res = await fetch(`${API_BASE}/healthz`, { cache: "no-store" });
  if (!res.ok) throw new Error(`healthz ${res.status}`);
  return res.json();
}

export async function getEncounters(): Promise<Encounter[]> {
  const res = await fetch(`${API_BASE}/api/encounters`, { cache: "no-store" });
  if (!res.ok) throw new Error(`encounters ${res.status}`);
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
  const res = await fetch(`${API_BASE}/api/audit-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    cache: "no-store",
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`audit-stream ${res.status}`);

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
      data = JSON.parse(dataLines.join("\n"));
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
