import { useCallback, useEffect, useState } from "react";
import { Bell, Check, Download, FileUp, RefreshCw, Send, X } from "lucide-react";
import { api, isDemoPortal } from "./api";
import { Badge, Button, Field, Tabs, TextInput } from "./ui/controls";
import { Card, CardTitle, DataTable, DemoBanner, ErrorBanner, LoadingRow, PageHeader, Stat } from "./ui/layout";
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
  const [error, setError] = useState("");
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
  const tabs: Array<readonly [Tab, string]> = [["dashboard", "Dashboard"],
    ["approvals", `Approvals${pending.length ? ` (${pending.length})` : ""}`],
    ["documents", "Documents"], ["reports", "Reports"], ["connections", "Connections"],
    ["permissions", "Permissions"], ["settings", "Settings"], ["audit", "Audit log"]];

  if (loading) return <LoadingRow text="Connecting the firm portal…" />;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader kicker="Firm portal" title={profile?.displayName ?? "Your firm"}
        subtitle={profile ? summarizeFirm(profile, pending.length, open.length) : "The firm profile is not configured yet."}
        actions={<>
          <Button variant="primary" onClick={onTalk}><Send size={16} />Talk to JARVIS</Button>
          <Button variant="secondary" disabled={demo} title={demo ? "Live data refreshes only in the live portal." : undefined}
            onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }}>
            <RefreshCw size={16} />Refresh
          </Button>
        </>} />
      {error && <ErrorBanner text={error} />}
      {demo && <DemoBanner text={DEMO_BANNER} />}
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-5">
        {tab === "dashboard" && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <Stat label="Waiting for approval" value={pending.length} sub="tap to decide in the Approvals tab" />
              <Stat label="Open tasks" value={open.length} sub="tracked work for this firm" />
              <Stat label="Documents ready" value={artifacts.length} sub="offers, reports, invoice drafts" />
              <Stat label="Assistant model" value={model.replace(/^jarvis-/, "").replace(":", " ")} sub={profile?.languages.join(" / ").toUpperCase()} />
            </div>
            {notices.length > 0 && (
              <Card><CardTitle>Latest notices</CardTitle>
                <ul className="flex flex-col gap-2">
                  {notices.slice(0, 5).map((notice, index) => (
                    <li key={String(notice.id ?? index)} className="flex items-start gap-2 text-sm text-slate-200">
                      <Bell size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                      {String(notice.title ?? notice.message ?? "Notice").slice(0, 200)}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}

        {tab === "approvals" && (
          <Card>
            <CardTitle>Approval inbox</CardTitle>
            <p className="mb-4 text-sm text-slate-400">Nothing is sent, published, or paid without your tap. Deciding twice on one item is refused.</p>
            <DataTable headers={["Proposal", "Tool", "Decision"]}
              empty="Nothing is waiting. New proposals from JARVIS appear here."
              rows={pending.map((action) => [
                <span key="r">{action.reason.slice(0, 160)}</span>,
                <span key="t" className="font-mono text-xs text-slate-400">{action.tool}</span>,
                <span key="d" className="flex gap-2">
                  <Button variant="primary" disabled={busy !== ""} onClick={() => void decide(action, "approve")}><Check size={15} />Approve</Button>
                  <Button variant="danger" disabled={busy !== ""} onClick={() => void decide(action, "deny")}><X size={15} />Deny</Button>
                </span>,
              ])} />
          </Card>
        )}

        {tab === "documents" && (
          <Card>
            <CardTitle action={
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface-800 px-4 py-2 text-sm text-slate-100 transition-colors hover:bg-surface-700">
                <FileUp size={16} />Upload a document
                <input type="file" hidden accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.json"
                  onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
              </label>
            }>Documents</CardTitle>
            {busy === "upload" && <p role="status" className="mb-3 text-sm text-slate-400">Uploading…</p>}
            <DataTable headers={["File", "Size", "Get"]}
              empty="No documents yet. Ask JARVIS to prepare an offer, report, or invoice draft."
              rows={artifacts.map((file) => [
                <span key="n">{file.name}<span className="ml-2 text-xs text-slate-500">{file.format.toUpperCase()}</span></span>,
                <span key="b" className="text-slate-400">{file.bytes.toLocaleString()} B</span>,
                uuid.test(file.id)
                  ? <a key="d" className="inline-flex items-center gap-1.5 text-sm text-emerald-300 hover:text-emerald-200"
                      href={base + "/api/artifacts/" + file.id + "/download"} download><Download size={15} />Download</a>
                  : <span key="d" className="text-xs text-slate-600">demo file</span>,
              ])} />
          </Card>
        )}

        {tab === "reports" && (
          <Card><CardTitle>Work report</CardTitle>
            <DataTable headers={["Task", "State", "Due"]}
              empty="No tasks recorded yet."
              rows={tasks.slice(0, 30).map((task) => [
                <span key="t">{task.data.title}</span>,
                <span key="s"><Badge tone={task.data.state === "open" ? "blue" : "neutral"}>{task.data.state}</Badge></span>,
                <span key="d" className="text-slate-400">{task.data.dueAt ? new Date(task.data.dueAt * 1000).toLocaleString() : "—"}</span>,
              ])} />
          </Card>
        )}

        {tab === "connections" && (
          <Card><CardTitle>Connected accounts</CardTitle>
            <p className="mb-4 text-sm text-slate-400">Sign-ins stay encrypted on your server. Connect them in the Tasks view; this page only shows status.</p>
            <DataTable headers={["Account", "Status"]}
              empty="No accounts registered."
              rows={[["clinic", "Clinic system"], ["mail", "Email"], ["social", "Social accounts"], ["finance", "Finance (paper only)"]].map(([name, label]) => [
                <span key="n">{label}</span>,
                conn[name]?.connected
                  ? <span key="s"><Badge tone="green">Connected</Badge>{conn[name]?.displayName && <span className="ml-2 text-sm text-slate-400">{conn[name]?.displayName}</span>}</span>
                  : <span key="s"><Badge>Not connected</Badge></span>,
              ])} />
          </Card>
        )}

        {tab === "permissions" && (
          <Card><CardTitle>What JARVIS may do alone</CardTitle>
            <p className="mb-4 text-sm text-slate-400">Per tool: automatic or ask-first, with per-minute and per-day limits. Money and trading stay ask-first or off.</p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Tool name"><TextInput placeholder="jarvis_tool_name" value={perm.tool}
                onChange={(event) => setPerm({ ...perm, tool: event.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={perm.automatic} className="h-4 w-4 accent-emerald-500"
                  onChange={(event) => setPerm({ ...perm, automatic: event.target.checked })} /> automatic</label>
              <Field label="Max / minute"><TextInput value={perm.maxPerMinute} className="w-24"
                onChange={(event) => setPerm({ ...perm, maxPerMinute: event.target.value })} /></Field>
              <Field label="Max / day"><TextInput value={perm.maxPerDay} className="w-24"
                onChange={(event) => setPerm({ ...perm, maxPerDay: event.target.value })} /></Field>
              <Button variant="primary" disabled={busy === "perm" || !perm.tool} onClick={() => void savePermission()}>Save rule</Button>
            </div>
          </Card>
        )}

        {tab === "settings" && profile && (
          <div className="flex flex-col gap-5">
            <Card><CardTitle>Firm settings</CardTitle>
              <DataTable headers={["Setting", "Value"]} empty=""
                rows={[
                  ["Industry", profile.industry],
                  ["Languages", profile.languages.join(", ").toUpperCase()],
                  ["Voice and style", profile.tone],
                  ["Field packs", profile.fieldPacks.join(", ")],
                  ["Approval defaults", Object.entries(profile.approvalDefaults).map(([key, value]) => `${key}: ${value}`).join(" · ")],
                ].map(([key, value]) => [<span key="k" className="text-slate-400">{key}</span>, <span key="v">{String(value)}</span>])} />
            </Card>
            <Card><CardTitle>Billing</CardTitle><p className="text-sm text-slate-300">{profile.billingNote}</p></Card>
          </div>
        )}

        {tab === "audit" && (
          <Card><CardTitle>Audit log</CardTitle>
            <DataTable headers={["Event", "Time"]} empty="No recorded events yet."
              rows={events.slice(0, 50).map((event) => [
                <span key="k" className="font-mono text-xs">{String(event.kind ?? "event")}</span>,
                <span key="t" className="text-slate-400">{(event.created ?? event.at)
                  ? new Date(Number(event.created ?? event.at) * 1000).toLocaleString() : "—"}</span>,
              ])} />
          </Card>
        )}
      </div>
    </div>
  );
}
