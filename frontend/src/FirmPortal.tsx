import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Bell, Check, Download, FileUp, LoaderCircle, Phone, RefreshCw, Send, X } from "lucide-react";
import { api, isDemoPortal } from "./api";
import { DEMO_BANNER, demoActions, demoArtifacts, demoConnections, demoEvents, demoNotices, demoProfile, demoTasks } from "./portalDemo";
import type { FirmProfile } from "./types";

const base = "/api/operator";
const req = <T,>(route: string, body?: unknown, signal?: AbortSignal) => api<T>(base + route, body, { signal });
const errorText = (error: unknown) => error instanceof Error ? error.message : "The request failed.";
const uuid = /^[0-9a-f-]{36}$/i;

type Action = { id: string; tool: string; state: string; reason: string; inputHash: string; fingerprint: string };
type Task = { id: string; data: { title: string; state: string; dueAt: number | null } };
type Artifact = { id: string; name: string; format: string; bytes: number; url: string };
type AuditEvent = { kind?: string; created?: number; at?: number; [key: string]: unknown };
type Notice = { id?: string; title?: string; message?: string; [key: string]: unknown };
type Tab = "dashboard" | "approvals" | "documents" | "reports" | "connections" | "permissions" | "settings" | "audit";

export function summarizeFirm(profile: FirmProfile, pending: number, open: number): string {
  return `${profile.displayName} · ${profile.industry} · ${profile.languages.join("+").toUpperCase()} · ` +
    `${pending} waiting for approval · ${open} open tasks · packs: ${profile.fieldPacks.join(", ") || "none"}`;
}

export function FirmPortal({ onTalk }: { onTalk: () => void }) {
  const demo = isDemoPortal();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState(demo ? "" : "");
  const [profile, setProfile] = useState<FirmProfile | null>(demo ? demoProfile : null);
  const [actions, setActions] = useState<Action[]>(demo ? demoActions : []);
  const [tasks, setTasks] = useState<Task[]>(demo ? demoTasks : []);
  const [artifacts, setArtifacts] = useState<Artifact[]>(demo ? demoArtifacts : []);
  const [events, setEvents] = useState<AuditEvent[]>(demo ? demoEvents : []);
  const [notices, setNotices] = useState<Notice[]>(demo ? demoNotices : []);
  const [conn, setConn] = useState<Record<string, { connected?: boolean; displayName?: string; message?: string }>>(demo ? demoConnections : {});
  const [model, setModel] = useState(demo ? "demo reasoner" : "assistant");
  const [busy, setBusy] = useState("");
  const [perm, setPerm] = useState({ tool: "", automatic: false, maxPerMinute: "5", maxPerDay: "50" });

  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const firm = await req<{ firm: FirmProfile | null }>("/api/firm/profile", undefined, signal);
      if (signal?.aborted) return;
      setProfile(firm.firm);
      const settled = await Promise.allSettled([
        req<{ actions: Action[] }>("/api/actions", undefined, signal),
        req<{ tasks: Task[] }>("/api/tasks", undefined, signal),
        req<{ artifacts: Artifact[] }>("/api/artifacts", undefined, signal),
        req<{ events: AuditEvent[] }>("/api/audit", undefined, signal),
        req<{ notifications: Notice[] } | Notice[]>("/api/notifications", undefined, signal),
        req<{ skills: unknown[]; model?: { name: string } }>("/api/skills", undefined, signal),
      ]);
      if (signal?.aborted) return;
      if (settled[0].status === "fulfilled") setActions(settled[0].value.actions);
      if (settled[1].status === "fulfilled") setTasks(settled[1].value.tasks);
      if (settled[2].status === "fulfilled") setArtifacts(settled[2].value.artifacts);
      if (settled[3].status === "fulfilled") setEvents(settled[3].value.events);
      if (settled[4].status === "fulfilled") {
        const value = settled[4].value;
        setNotices(Array.isArray(value) ? value : value.notifications ?? []);
      }
      if (settled[5].status === "fulfilled" && settled[5].value.model) setModel(settled[5].value.model.name);
      const links: Array<[string, string]> = [["clinic", "/api/connections/clinic"], ["mail", "/api/connections/mail"],
        ["social", "/api/social/connections"], ["finance", "/api/finance"]];
      const states = await Promise.all(links.map(async ([name, route]) => {
        try { return [name, await req<{ connected?: boolean; displayName?: string; message?: string }>(route, undefined, signal)] as const; }
        catch { return [name, {}] as const; }
      }));
      if (signal?.aborted) return;
      setConn(Object.fromEntries(states));
    } catch (cause) {
      if (!signal?.aborted) setError(errorText(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, demo]);

  const decide = async (action: Action, decision: "approve" | "deny") => {
    if (demo) { setError("Disabled in the demo — approvals act only in the live portal."); return; }
    setBusy(action.id + decision);
    try {
      await req("/api/actions/" + action.id + "/decision",
        { decision, inputHash: action.inputHash, fingerprint: action.fingerprint, eventKey: crypto.randomUUID() });
      const queue = await req<{ actions: Action[] }>("/api/actions");
      setActions(queue.actions);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(""); }
  };

  const upload = async (file: File) => {
    if (demo) { setError("Disabled in the demo — uploads work only in the live portal."); return; }
    if (file.size > 20 * 1024 * 1024) { setError("Upload up to 20 MiB."); return; }
    setBusy("upload");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("The file could not be read."));
        reader.readAsDataURL(file);
      });
      await req("/api/files/upload", { name: file.name, data });
      const files = await req<{ artifacts: Artifact[] }>("/api/artifacts");
      setArtifacts(files.artifacts);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(""); }
  };

  const savePermission = async () => {
    if (demo) { setError("Disabled in the demo — permission rules change only in the live portal."); return; }
    setBusy("perm");
    try {
      await req("/api/permissions", { tool: perm.tool, automatic: perm.automatic,
        maxPerMinute: Number(perm.maxPerMinute), maxPerDay: Number(perm.maxPerDay) });
      setPerm({ tool: "", automatic: false, maxPerMinute: "5", maxPerDay: "50" });
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(""); }
  };

  const pending = actions.filter((item) => item.state === "awaiting_approval");
  const open = tasks.filter((item) => !["done", "completed", "cancelled"].includes(item.data.state));
  const tabs: Array<[Tab, string]> = [["dashboard", "Dashboard"], ["approvals", `Approvals${pending.length ? ` (${pending.length})` : ""}`],
    ["documents", "Documents"], ["reports", "Reports"], ["connections", "Connections"],
    ["permissions", "Permissions"], ["settings", "Settings"], ["audit", "Audit log"]];

  if (loading) return <section className="operator-panel"><p role="status"><LoaderCircle className="spin" size={18} />Connecting the firm portal…</p></section>;

  return (
    <section className="operator-panel">
      <div className="page-heading">
        <div>
          <p className="section-label">Firm portal</p>
          <h1>{profile?.displayName ?? "Your firm"}</h1>
          <p>{profile ? summarizeFirm(profile, pending.length, open.length) : "The firm profile is not configured yet."}</p>
        </div>
        <div className="operator-row">
          <button className="button primary" onClick={onTalk}><Send size={16} />Talk to JARVIS</button>
          <button className="button" disabled={demo} title={demo ? "Live data refreshes only in the live portal." : undefined}
            onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }}><RefreshCw size={16} />Refresh</button>
        </div>
      </div>
      {error && <p className="operator-error" role="alert">{error}</p>}
      {demo && <p className="operator-card" role="note"><strong>{DEMO_BANNER}</strong></p>}
      <nav className="operator-workspace-tabs" aria-label="Firm portal sections">
        {tabs.map(([id, label]) => (
          <button key={id} className={"button " + (tab === id ? "primary" : "")} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {tab === "dashboard" && (
        <div className="stats-row">
          <div><Bell size={20} /><span><strong>{pending.length}</strong><small>Waiting for approval</small></span></div>
          <div><BadgeCheck size={20} /><span><strong>{open.length}</strong><small>Open tasks</small></span></div>
          <div><FileUp size={20} /><span><strong>{artifacts.length}</strong><small>Documents ready</small></span></div>
          <div><Phone size={20} /><span><strong>{model.replace(/^jarvis-/, "").replace(":", " ")}</strong><small>Assistant model</small></span></div>
        </div>
      )}
      {tab === "dashboard" && notices.length > 0 && (
        <section className="operator-card"><h2>Latest notices</h2>
          {notices.slice(0, 5).map((notice, index) => (
            <p key={String(notice.id ?? index)}>{String(notice.title ?? notice.message ?? JSON.stringify(notice)).slice(0, 200)}</p>
          ))}
        </section>
      )}

      {tab === "approvals" && (
        <section className="operator-card"><h2>Approval inbox</h2>
          <p className="muted">Nothing is sent, published, or paid without your tap. Approving the same item twice is refused.</p>
          {pending.length === 0 && <p>Nothing is waiting. New proposals from JARVIS appear here.</p>}
          {pending.map((action) => (
            <div key={action.id} className="operator-row">
              <span><strong>{action.tool}</strong> · {action.reason.slice(0, 160)}</span>
              <button className="button primary" disabled={busy !== ""} onClick={() => void decide(action, "approve")}><Check size={15} />Approve</button>
              <button className="button" disabled={busy !== ""} onClick={() => void decide(action, "deny")}><X size={15} />Deny</button>
            </div>
          ))}
        </section>
      )}

      {tab === "documents" && (
        <section className="operator-card"><h2>Documents</h2>
          <label className="button">Upload a document
            <input type="file" hidden accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.json"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
          </label>
          {busy === "upload" && <p role="status">Uploading…</p>}
          {artifacts.length === 0 && <p>No documents yet. Ask JARVIS to prepare an offer, report, or invoice draft.</p>}
          {artifacts.map((file) => (
            <a className="operator-artifact" key={file.id}
              href={uuid.test(file.id) ? base + "/api/artifacts/" + file.id + "/download" : undefined} download>
              <Download size={18} /><span>{file.name}<small>{file.format.toUpperCase()} · {file.bytes.toLocaleString()} bytes</small></span>
            </a>
          ))}
        </section>
      )}

      {tab === "reports" && (
        <section className="operator-card"><h2>Work report</h2>
          {tasks.length === 0 && <p>No tasks recorded yet.</p>}
          {tasks.slice(0, 30).map((task) => (
            <p key={task.id}><strong>{task.data.title}</strong> · {task.data.state}
              {task.data.dueAt ? " · due " + new Date(task.data.dueAt * 1000).toLocaleString() : ""}</p>
          ))}
        </section>
      )}

      {tab === "connections" && (
        <section className="operator-card"><h2>Connected accounts</h2>
          <p className="muted">Sign-ins stay encrypted on your server. Connect them in the Tasks view; this page only shows status.</p>
          {[["clinic", "Clinic system"], ["mail", "Email"], ["social", "Social accounts"], ["finance", "Finance (paper only)"]].map(([name, label]) => (
            <p key={name}><strong>{label}:</strong> {conn[name]?.connected ? "Connected" + (conn[name]?.displayName ? " · " + conn[name]?.displayName : "") : "Not connected"}</p>
          ))}
        </section>
      )}

      {tab === "permissions" && (
        <section className="operator-card"><h2>What JARVIS may do alone</h2>
          <p className="muted">Per tool: automatic or ask-first, with per-minute and per-day limits. Money and trading stay ask-first or off.</p>
          <div className="operator-row">
            <input aria-label="Tool name" placeholder="jarvis_tool_name" value={perm.tool} onChange={(event) => setPerm({ ...perm, tool: event.target.value })} />
            <label><input type="checkbox" checked={perm.automatic} onChange={(event) => setPerm({ ...perm, automatic: event.target.checked })} /> automatic</label>
            <input aria-label="Max per minute" value={perm.maxPerMinute} onChange={(event) => setPerm({ ...perm, maxPerMinute: event.target.value })} />
            <input aria-label="Max per day" value={perm.maxPerDay} onChange={(event) => setPerm({ ...perm, maxPerDay: event.target.value })} />
            <button className="button primary" disabled={busy === "perm" || !perm.tool} onClick={() => void savePermission()}>Save rule</button>
          </div>
        </section>
      )}

      {tab === "settings" && profile && (
        <section className="operator-card"><h2>Firm settings</h2>
          <p><strong>Industry:</strong> {profile.industry} · <strong>Languages:</strong> {profile.languages.join(", ").toUpperCase()}</p>
          <p><strong>Voice and style:</strong> {profile.tone}</p>
          <p><strong>Field packs:</strong> {profile.fieldPacks.join(", ")}</p>
          <p><strong>Approval defaults:</strong> {Object.entries(profile.approvalDefaults).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>
          <section className="operator-card"><h2>Billing</h2><p>{profile.billingNote}</p></section>
        </section>
      )}

      {tab === "audit" && (
        <section className="operator-card"><h2>Audit log</h2>
          {events.length === 0 && <p>No recorded events yet.</p>}
          {events.slice(0, 50).map((event, index) => (
            <p key={index}><strong>{String(event.kind ?? "event")}</strong>
              {(event.created ?? event.at) ? " · " + new Date(Number(event.created ?? event.at) * 1000).toLocaleString() : ""}</p>
          ))}
        </section>
      )}
    </section>
  );
}
