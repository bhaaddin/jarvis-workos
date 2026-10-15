import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Container,
  FormControlLabel,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { Bell, Check, Download, FileUp, RefreshCw, Send, X } from "lucide-react";
import { api, isDemoPortal } from "./api";
import { DataTable, LoadingRow, NoticeBanner, PageHeader, StatCard } from "./components";
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
type TabId = "dashboard" | "approvals" | "documents" | "reports" | "connections" | "permissions" | "settings" | "audit";

export function summarizeFirm(profile: FirmProfile, pending: number, open: number): string {
  return `${profile.displayName} · ${profile.industry} · ${profile.languages.join("+").toUpperCase()} · ` +
    `${pending} waiting for approval · ${open} open tasks · packs: ${profile.fieldPacks.join(", ") || "none"}`;
}

function toneChip(tone: string, label: React.ReactNode) {
  const color = tone === "green" ? "success" : tone === "amber" ? "warning" : tone === "blue" ? "info" : tone === "red" ? "error" : "default";
  return <Chip size="small" color={color as "success"} label={label} />;
}

export function FirmPortal({ onTalk }: { onTalk: () => void }) {
  const demo = isDemoPortal();
  const [tab, setTab] = useState<TabId>("dashboard");
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
  const tabs: Array<readonly [TabId, string]> = [["dashboard", "Dashboard"],
    ["approvals", `Approvals${pending.length ? ` (${pending.length})` : ""}`],
    ["documents", "Documents"], ["reports", "Reports"], ["connections", "Connections"],
    ["permissions", "Permissions"], ["settings", "Settings"], ["audit", "Audit log"]];

  if (loading) return <LoadingRow text="Connecting the firm portal…" />;

  return (
    <Container maxWidth="lg" sx={{ px: { xs: 2, sm: 3 }, py: 3 }}>
      <PageHeader kicker="Firm portal" title={profile?.displayName ?? "Your firm"}
        subtitle={profile ? summarizeFirm(profile, pending.length, open.length) : "The firm profile is not configured yet."}
        actions={<>
          <Button variant="contained" startIcon={<Send size={16} />} onClick={onTalk}>Talk to JARVIS</Button>
          <Button variant="outlined" disabled={demo} title={demo ? "Live data refreshes only in the live portal." : undefined}
            startIcon={<RefreshCw size={16} />} onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }}>
            Refresh
          </Button>
        </>} />
      {error && <NoticeBanner kind="error" text={error} />}
      {demo && <NoticeBanner kind="demo" text={DEMO_BANNER} />}
      <Tabs value={tab} onChange={(_, value: TabId) => setTab(value)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2.5 }}>
        {tabs.map(([id, label]) => <Tab key={id} value={id} label={label} />)}
      </Tabs>

      <Box sx={{ mt: 2.5 }}>
        {tab === "dashboard" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", xl: "1fr 1fr 1fr 1fr" }, gap: 2 }}>
              <StatCard label="Waiting for approval" value={pending.length} sub="tap to decide in the Approvals tab" />
              <StatCard label="Open tasks" value={open.length} sub="tracked work for this firm" />
              <StatCard label="Documents ready" value={artifacts.length} sub="offers, reports, invoice drafts" />
              <StatCard label="Assistant model" value={model.replace(/^jarvis-/, "").replace(":", " ")} sub={profile?.languages.join(" / ").toUpperCase()} />
            </Box>
            {notices.length > 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 1.5 }}>Latest notices</Typography>
                  <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1 }}>
                    {notices.slice(0, 5).map((notice, index) => (
                      <Box component="li" key={String(notice.id ?? index)} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                        <Bell size={15} style={{ marginTop: 2, flexShrink: 0, color: "#10b981" }} />
                        <Typography variant="body2">
                          {String(notice.title ?? notice.message ?? "Notice").slice(0, 200)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </CardContent>
              </Card>
            )}
          </Box>
        )}

        {tab === "approvals" && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6">Approval inbox</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Nothing is sent, published, or paid without your tap. Deciding twice on one item is refused.
              </Typography>
              <DataTable headers={["Proposal", "Tool", "Decision"]}
                empty="Nothing is waiting. New proposals from JARVIS appear here."
                rows={pending.map((action) => [
                  <span key="r">{action.reason.slice(0, 160)}</span>,
                  <Typography key="t" variant="body2" color="text.secondary" sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{action.tool}</Typography>,
                  <Box key="d" sx={{ display: "flex", gap: 1 }}>
                    <Button variant="contained" size="small" disabled={busy !== ""} startIcon={<Check size={15} />} onClick={() => void decide(action, "approve")}>Approve</Button>
                    <Button variant="outlined" size="small" color="error" disabled={busy !== ""} startIcon={<X size={15} />} onClick={() => void decide(action, "deny")}>Deny</Button>
                  </Box>,
                ])} />
            </CardContent>
          </Card>
        )}

        {tab === "documents" && (
          <Card variant="outlined">
            <CardContent>
              <Box sx={{ mb: 2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="h6">Documents</Typography>
                <Button variant="outlined" size="small" component="label" startIcon={<FileUp size={16} />}>
                  Upload a document
                  <input type="file" hidden accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.json"
                    onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
                </Button>
              </Box>
              {busy === "upload" && <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 1.5 }}>Uploading…</Typography>}
              <DataTable headers={["File", "Size", "Get"]}
                empty="No documents yet. Ask JARVIS to prepare an offer, report, or invoice draft."
                rows={artifacts.map((file) => [
                  <span key="n">{file.name}<Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{file.format.toUpperCase()}</Typography></span>,
                  <Typography key="b" variant="body2" color="text.secondary">{file.bytes.toLocaleString()} B</Typography>,
                  uuid.test(file.id)
                    ? <Button key="d" size="small" startIcon={<Download size={15} />} href={base + "/api/artifacts/" + file.id + "/download"} download>Download</Button>
                    : <Typography key="d" variant="caption" color="text.secondary">demo file</Typography>,
                ])} />
            </CardContent>
          </Card>
        )}

        {tab === "reports" && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Work report</Typography>
              <DataTable headers={["Task", "State", "Due"]}
                empty="No tasks recorded yet."
                rows={tasks.slice(0, 30).map((task) => [
                  <span key="t">{task.data.title}</span>,
                  <span key="s">{toneChip(task.data.state === "open" ? "blue" : "neutral", task.data.state)}</span>,
                  <Typography key="d" variant="body2" color="text.secondary">{task.data.dueAt ? new Date(task.data.dueAt * 1000).toLocaleString() : "—"}</Typography>,
                ])} />
            </CardContent>
          </Card>
        )}

        {tab === "connections" && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6">Connected accounts</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Sign-ins stay encrypted on your server. Connect them in the Tasks view; this page only shows status.
              </Typography>
              <DataTable headers={["Account", "Status"]}
                empty="No accounts registered."
                rows={[["clinic", "Clinic system"], ["mail", "Email"], ["social", "Social accounts"], ["finance", "Finance (paper only)"]].map(([name, label]) => [
                  <span key="n">{label}</span>,
                  conn[name]?.connected
                    ? <Box key="s" sx={{ display: "flex", alignItems: "center", gap: 1 }}>{toneChip("green", "Connected")}{conn[name]?.displayName && <Typography variant="body2" color="text.secondary">{conn[name]?.displayName}</Typography>}</Box>
                    : <span key="s">{toneChip("neutral", "Not connected")}</span>,
                ])} />
            </CardContent>
          </Card>
        )}

        {tab === "permissions" && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6">What JARVIS may do alone</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Per tool: automatic or ask-first, with per-minute and per-day limits. Money and trading stay ask-first or off.
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 1.5 }}>
                <TextField label="Tool name" placeholder="jarvis_tool_name" value={perm.tool}
                  onChange={(event) => setPerm({ ...perm, tool: event.target.value })} sx={{ maxWidth: 220 }} />
                <FormControlLabel
                  control={<Checkbox checked={perm.automatic} onChange={(event) => setPerm({ ...perm, automatic: event.target.checked })} />}
                  label="automatic" />
                <TextField label="Max / minute" value={perm.maxPerMinute}
                  onChange={(event) => setPerm({ ...perm, maxPerMinute: event.target.value })} sx={{ maxWidth: 130 }} />
                <TextField label="Max / day" value={perm.maxPerDay}
                  onChange={(event) => setPerm({ ...perm, maxPerDay: event.target.value })} sx={{ maxWidth: 130 }} />
                <Button variant="contained" disabled={busy === "perm" || !perm.tool} onClick={() => void savePermission()}>Save rule</Button>
              </Box>
            </CardContent>
          </Card>
        )}

        {tab === "settings" && profile && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Firm settings</Typography>
                <DataTable headers={["Setting", "Value"]} empty=""
                  rows={[
                    ["Industry", profile.industry],
                    ["Languages", profile.languages.join(", ").toUpperCase()],
                    ["Voice and style", profile.tone],
                    ["Field packs", profile.fieldPacks.join(", ")],
                    ["Approval defaults", Object.entries(profile.approvalDefaults).map(([key, value]) => `${key}: ${value}`).join(" · ")],
                  ].map(([key, value]) => [<Typography key="k" variant="body2" color="text.secondary">{key}</Typography>, <span key="v">{String(value)}</span>])} />
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ mb: 1 }}>Billing</Typography>
                <Typography variant="body2">{profile.billingNote}</Typography>
              </CardContent>
            </Card>
          </Box>
        )}

        {tab === "audit" && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Audit log</Typography>
              <DataTable headers={["Event", "Time"]} empty="No recorded events yet."
                rows={events.slice(0, 50).map((event) => [
                  <Typography key="k" variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{String(event.kind ?? "event")}</Typography>,
                  <Typography key="t" variant="body2" color="text.secondary">{(event.created ?? event.at)
                    ? new Date(Number(event.created ?? event.at) * 1000).toLocaleString() : "—"}</Typography>,
                ])} />
            </CardContent>
          </Card>
        )}
      </Box>
    </Container>
  );
}
