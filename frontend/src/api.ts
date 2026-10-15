export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// Vercel deployments set VITE_API_BASE to the backend origin (e.g. https://jarvis.example.com).
// Local serving keeps same-origin relative paths. Cross-origin live backends additionally
// need backend CORS/cookie work (M1); the labeled demo mode needs no backend at all.
export const apiBase = () => (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
export const isDemoPortal = () => (import.meta.env.VITE_PORTAL_DEMO as string | undefined) === "true";

export const isRemoteCall = () => typeof document !== "undefined" &&
  document.querySelector('meta[name="jarvis-remote-call"]')?.getAttribute("content") === "true";
export const isRemoteOperator = () => typeof document !== "undefined" &&
  document.querySelector('meta[name="jarvis-operator-enabled"]')?.getAttribute("content") === "true";

export async function authorizedFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const request = {
    ...options,
    credentials: "same-origin" as RequestCredentials,
  };
  let response = await fetch(apiBase() + path, request);
  // A restarted local host rotates its cookie. A 401 is rejected before any action.
  if (
    response.status === 401 &&
    path.startsWith("/api/") &&
    path !== "/api/session" &&
    (!path.startsWith("/api/operator/") || response.headers.get("X-Jarvis-Session-Rejected") === "true")
  ) {
    const session = await fetch(apiBase() + "/api/session", {
      credentials: "same-origin",
      signal: options.signal,
    });
    if (session.ok) response = await fetch(apiBase() + path, request);
  }
  return response;
}

export async function api<T>(
  path: string,
  body?: unknown,
  options: RequestInit = {},
): Promise<T> {
  const response = await authorizedFetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...options,
  });
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(
      typeof value.error === "string"
        ? value.error
        : `Request failed (${response.status}).`,
      response.status,
    );
  return value as T;
}

export async function boundedApi<T>(path: string, body?: unknown, signal?: AbortSignal, milliseconds = 8000): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  const timer = setTimeout(() => controller.abort(new DOMException("The connection did not respond in time. Please try again.", "TimeoutError")), milliseconds);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await api<T>(path, body, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export type ChatEvent = {
  type: "start" | "delta" | "done" | "error";
  text?: string;
  answer?: string;
  error?: string;
  thread?: string;
  session?: string;
  elapsed_ms?: number;
  finish_reason?: string;
};

export function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); signal.removeEventListener("abort", aborted); reject(new DOMException("Request cancelled.", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

async function pollVoiceChat(body: Record<string, unknown>, onEvent: (event: ChatEvent) => void, signal: AbortSignal) {
  signal.throwIfAborted();
  const deadline = Date.now() + 250000;
  const id = crypto.randomUUID().replaceAll("-", "");
  const owner = { project: body.project, thread: body.thread };
  const cancel = () => { void boundedApi(`/api/chat/jobs/${id}/cancel`, owner, undefined, 5000).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let completed = false;
  try {
    await boundedApi("/api/chat/jobs", { ...body, stream: false, request_id: id }, signal);
    signal.throwIfAborted();
    onEvent({ type: "start", thread: String(body.thread) });
    let offset = 0, answer = "";
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const result = await boundedApi<{ text: string; next_offset: number; has_more: boolean; status: string; error?: string; elapsed_ms?: number }>(
        `/api/chat/jobs/${id}?project=${encodeURIComponent(String(body.project))}&thread=${encodeURIComponent(String(body.thread))}&offset=${offset}`,
        undefined, signal, Math.max(1, Math.min(5000, deadline - Date.now())),
      );
      signal.throwIfAborted();
      if (result.text) {
        answer += result.text;
        // Already-complete short answers need only one speech synthesis request.
        if (result.status === "running" || result.has_more)
          onEvent({ type: "delta", text: result.text });
      }
      offset = result.next_offset;
      if (!result.has_more && result.status !== "running") {
        if (result.status !== "completed") throw new Error(result.error || "The voice turn was cancelled.");
        completed = true;
        onEvent({ type: "done", answer, elapsed_ms: result.elapsed_ms, thread: String(body.thread) });
        return;
      }
      if (!result.has_more) await waitFor(200, signal);
    }
    throw new Error("The assistant exceeded its voice-turn deadline.");
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!completed && !signal.aborted) cancel();
  }
}
export async function streamChat(
  body: unknown,
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  if (body && typeof body === "object" && (body as Record<string, unknown>).voice_mode === true)
    return pollVoiceChat(body as Record<string, unknown>, onEvent, signal);
  if (isRemoteCall()) {
    // Cloudflare Quick Tunnels do not support SSE; retain the same completion contract.
    const result = await boundedApi<{ answer: string; thread: string }>("/api/chat", {      ...(body as Record<string, unknown>), stream: false,
    }, signal, 250000);
    signal.throwIfAborted();
    if (typeof result.answer !== "string" || !result.answer.trim())
      throw new Error("The assistant returned no completed answer.");
    onEvent({ type: "done", answer: result.answer, thread: result.thread });
    return;
  }
  const response = await authorizedFetch("/api/chat", {    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const result = await response.json();
    throw new ApiError(
      result.error || "Assistant request failed.",
      response.status,
    );
  }
  if (!response.body)
    throw new Error("This browser cannot read the assistant stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let done = false;
  try {
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      pending = pending.replace(/\r\n/g, "\n");
      let end: number;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const event = JSON.parse(data) as ChatEvent;
        onEvent(event);
        if (event.type === "error")
          throw new Error(event.error || "The assistant run failed.");
        if (event.type === "done") done = true;
      }
      if (pending.length > 1024 * 1024)
        throw new Error("Assistant stream frame is too large.");
      if (chunk.done) break;
    }
    if (!done)
      throw new Error(
        "The connection ended before completion. Reload this conversation.",
      );
  } finally {
    reader.releaseLock();
  }
}
