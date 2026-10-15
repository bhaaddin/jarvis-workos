import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  List,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { Bot, Check, ChevronDown, Download, FileUp, Phone, Plus, Send, Square, X } from "lucide-react";
import { api, waitFor, boundedApi, ApiError } from "./api";
import { useVoice } from "./useVoice";
import { CallScreen } from "./CallScreen";
import { TaskRequests } from "./taskRequests";
import { SocialContacts } from "./SocialContacts";
import { FinancePanel } from "./FinancePanel";
import { RichText } from "./components";

export type OperatorPanelHandle = { startCall(): void };
type TaskThreadHandle = OperatorPanelHandle & { runTask(text: string): Promise<string>; stopTask(): void };
type Message = { role: string; content: string | null; tool_call_id?: string; tool_calls?: Array<{ id: string; function: { name: string } }> };
type Action = { id: string; tool: string; state: string; reason: string; inputHash: string; fingerprint: string; input?: unknown; result?: unknown };
type Artifact = { id: string; name: string; format: string; bytes: number; url: string };
type Run = { id: string; state: string; result?: { text: string; toolResults: unknown[]; completion?: "complete" | "incomplete" } | null; error?: { message?: string } | null };
type Skill = { id: string; state: string; mode: string; missing: string[]; reason?: string };
const base = "/api/operator";
const errorText = (error: unknown) => error instanceof Error ? error.message : "The task could not complete.";
const uuid = /^[0-9a-f-]{36}$/i;
const toolLabels: Record<string, string> = { jarvis_document_read: "Read document", jarvis_document_create: "Create document", jarvis_table_query: "Analyze table data",
  jarvis_projects: "Inspect project source", jarvis_calculate: "Verify calculation", jarvis_files: "Find files", jarvis_sportmedical: "Check Medical",
  jarvis_web: "Read web source", jarvis_remind_after: "Save reminder", jarvis_memory_remember: "Remember information", jarvis_memory_search: "Recall information",
  jarvis_social_research: "Research social profiles", jarvis_social_contacts: "Read contact evidence", jarvis_social_contact_update: "Save outreach drafts", jarvis_finance: "Read connected Finance", jarvis_code: "Change project code", jarvis_code_read: "Read project code", jarvis_ares: "Look up company", jarvis_cnb: "CNB rates", jarvis_czech_calc: "Czech business math", jarvis_owner_todo: "Owner checklist", jarvis_transit: "Plan transit" };
const request = <T,>(route: string, body?: unknown, signal?: AbortSignal) => api<T>(base + route, body, { signal });
const examples = [
  "Check which Claude and OpenCode processes are running, and report free RAM and disk space.",
  "Create an Excel spending sheet: groceries 85, transport 24, utilities 110. Calculate the total and give me the download.",
  "Read the actual React version in the connected Medical frontend and cite the source line.",
  "Read https://example.com and summarize what the page actually says.",
  "Remind me in 10 minutes to review the invoices.",
];

export const OperatorPanel = forwardRef<OperatorPanelHandle, { voiceId: string }>(function OperatorPanel({ voiceId }, ref) {
  const [conversations, setConversations] = useState<Array<{ id: string }>>([]), [selected, setSelected] = useState(""), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [workspace, setWorkspace] = useState<"chat" | "contacts" | "finance">("chat"), [threadBusy, setThreadBusy] = useState(false);
  const alive = useRef<AbortController | null>(null), thread = useRef<TaskThreadHandle>(null);
  useImperativeHandle(ref, () => ({ startCall: () => { setWorkspace("chat"); thread.current?.startCall(); } }), []);
  useEffect(() => {
    const controller = new AbortController(); alive.current = controller;
    void (async () => {
      const value = await request<{ conversations: Array<{ id: string }> }>("/conversations", undefined, controller.signal);
      controller.signal.throwIfAborted();
      const list = value.conversations.length ? value.conversations : [await request<{ id: string }>("/conversations", {}, controller.signal)];
      controller.signal.throwIfAborted(); setConversations(list);
      const saved = localStorage.getItem("jarvis-task-conversation"); setSelected(list.find((item) => item.id === saved)?.id ?? list[0]!.id); setLoading(false);
    })().catch((cause) => { if (!controller.signal.aborted) { setError(errorText(cause)); setLoading(false); } });
    return () => { controller.abort(); alive.current = null; };
  }, []);
  useEffect(() => { if (selected) localStorage.setItem("jarvis-task-conversation", selected); }, [selected]);
  const [autoCall] = useState(() => new URLSearchParams(location.search).has("call"));
  useEffect(() => {
    if (!autoCall || !selected) return;
    const timer = setInterval(() => {
      if (thread.current) {
        clearInterval(timer); thread.current.startCall();
        history.replaceState(null, "", location.pathname + location.hash);
      }
    }, 400);
    const stop = setTimeout(() => clearInterval(timer), 15000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [autoCall, selected]);
  const create = async () => {
    if (!alive.current) return; setLoading(true);
    try { const item = await request<{ id: string }>("/conversations", {}, alive.current.signal); if (alive.current.signal.aborted) return; setConversations((value) => [item, ...value]); setSelected(item.id); setError(""); }
    catch (cause) { setError(errorText(cause)); } finally { setLoading(false); }
  };
  return (
    <Box component="section">
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="caption" color="primary" sx={{ fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>
            Give me the job
          </Typography>
          <Typography variant="h1">JARVIS Tasks</Typography>
          <Typography variant="body2" color="text.secondary">Files, documents, your computer, projects and connected accounts.</Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end", flexWrap: "wrap" }}>
          <FormControl sx={{ minWidth: 220 }}>
            <InputLabel id="task-conversation-label">Task conversation</InputLabel>
            <Select labelId="task-conversation-label" label="Task conversation" value={selected} disabled={loading}
              onChange={(event) => setSelected(String(event.target.value))}>
              {conversations.map((item, index) => <MenuItem key={item.id} value={item.id}>Conversation {conversations.length - index} · {item.id.slice(0, 8)}</MenuItem>)}
            </Select>
          </FormControl>
          <Button variant="outlined" disabled={loading} startIcon={<Plus size={16} />} onClick={() => void create()}>New</Button>
        </Box>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Tabs value={workspace} onChange={(_, value: "chat" | "contacts" | "finance") => setWorkspace(value)} sx={{ mb: 2 }} aria-label="Task workspace">
        <Tab value="chat" label="Assistant" />
        <Tab value="contacts" label="Social contacts" />
        <Tab value="finance" label="Finance" />
      </Tabs>
      {loading && !selected && <Box sx={{ display: "flex", alignItems: "center", gap: 1 }} role="status"><CircularProgress size={18} /><Typography variant="body2">Connecting the task engine…</Typography></Box>}
      {selected && <Box hidden={workspace !== "chat"}><TaskThread key={selected} ref={thread} id={selected} voiceId={voiceId} onBusyChange={setThreadBusy} /></Box>}
      {selected && workspace === "contacts" && <SocialContacts conversationId={selected} busy={threadBusy}
        runTask={(text) => thread.current?.runTask(text) ?? Promise.reject(new Error("The task engine is still connecting."))} stopTask={() => thread.current?.stopTask()} />}
      {selected && workspace === "finance" && <FinancePanel key={selected} conversationId={selected} busy={threadBusy}
        ask={(text) => { setWorkspace("chat"); void thread.current?.runTask(text).catch(() => {}); }} talk={() => { setWorkspace("chat"); thread.current?.startCall(); }} />}
    </Box>
  );
});

const TaskThread = forwardRef<TaskThreadHandle, { id: string; voiceId: string; onBusyChange: (busy: boolean) => void }>(function TaskThread({ id, voiceId, onBusyChange }, ref) {
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [status, setStatus] = useState("Ready");
  const [actions, setActions] = useState<Action[]>([]), [artifacts, setArtifacts] = useState<Artifact[]>([]), [skills, setSkills] = useState<Skill[]>([]);
  const [modelName, setModelName] = useState("Local reasoning model");
  const [tasks, setTasks] = useState<Array<{ id: string; data: { title: string; state: string; dueAt: number | null; dueAtLocal?: string; timezone?: string; notifiedAt: number | null } }>>([]);
  const [callOpen, setCallOpen] = useState(false), [uploading, setUploading] = useState(false), [refresh, setRefresh] = useState(0);
  const lifetime = useRef<AbortController | null>(null), bottom = useRef<HTMLDivElement>(null);
  const path = "/conversations/" + id;
  const [requests] = useState(() => new TaskRequests((requestId) => boundedApi(base + path + "/runs/" + requestId + "/cancel", {}, undefined, 8000), () => {
    if (lifetime.current && !lifetime.current.signal.aborted) setError("A previous task's cancellation could not be confirmed. Check its recorded state before repeating actions.");
  }));
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => { controller.abort(); requests.dispose(); lifetime.current = null; }; }, [requests]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const [history, queue, files, capabilities, reminders] = await Promise.all([
            request<{ messages: Array<{ message: Message }> }>(path + "/messages", undefined, controller.signal), request<{ actions: Action[] }>("/actions", undefined, controller.signal),
            request<{ artifacts: Artifact[] }>("/artifacts", undefined, controller.signal), request<{ skills: Skill[]; model?: { name: string } }>("/skills", undefined, controller.signal), request<{ tasks: typeof tasks }>("/tasks", undefined, controller.signal)]);
          controller.signal.throwIfAborted(); setMessages(history.messages.map((value) => value.message)); setActions(queue.actions); setArtifacts(files.artifacts); setSkills(capabilities.skills); setTasks(reminders.tasks);
          if (capabilities.model) setModelName(capabilities.model.name.replace(/^jarvis-/, "").replace(":", " ").replace("-text-gpu", ""));
        } catch (cause) { if (controller.signal.aborted) return; setError(errorText(cause)); }
        try { await waitFor(2500, controller.signal); } catch { return; }
      }
    })(); return () => controller.abort();
  }, [id, path, refresh]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [messages.length]);
  const send = useCallback(async (text: string, parent?: AbortSignal, delivery: "text" | "voice" = "text"): Promise<string> => {
    if (!text.trim()) throw new Error("Enter a task.");
    const execution = requests.begin(parent), requestId = execution.id, signal = execution.signal; setBusy(true); setError(""); setStatus("Working");
    try {
      const accepted = await request<Run>("/chat", { conversationId: id, requestId, message: text, delivery, waitMs: 20000 }, signal); signal.throwIfAborted();
      if (accepted.state === "completed") { setRefresh((value) => value + 1); setStatus(accepted.result?.completion === "incomplete" ? "Partial results — needs attention" : "Completed"); return accepted.result?.text ?? ""; }
      if (["failed", "cancelled"].includes(accepted.state)) throw new Error(accepted.error?.message ?? "The task was cancelled.");
      const deadline = Date.now() + 330000;
      while (Date.now() < deadline) {
        const run = await request<Run>("/runs/" + requestId, undefined, signal); signal.throwIfAborted(); setStatus(run.state);
        if (run.state === "completed") { setRefresh((value) => value + 1); setStatus(run.result?.completion === "incomplete" ? "Partial results — needs attention" : "Completed"); return run.result?.text ?? ""; }
        if (["failed", "cancelled"].includes(run.state)) throw new Error(run.error?.message ?? "The task was cancelled.");
        await waitFor(350, signal);
      }
      throw new Error("The task is taking too long. Its recorded state remains available.");
    } catch (cause) { if (!signal.aborted) { setError(errorText(cause)); setStatus("Needs attention"); } throw cause; }
    finally { if (execution.finish() && lifetime.current && !lifetime.current.signal.aborted) setBusy(false); }
  }, [id, requests]);
  const voice = useVoice("operator:" + id, voiceId, setDraft, setError, (text, signal) => send(text, signal, "voice"));
  useEffect(() => () => { voice.cancel(); }, [voice.cancel]);
  const startCall = () => { if (!voice.conversationSupported) { setError("Use a microphone-enabled HTTPS browser for calls."); return; } setCallOpen(true); void voice.startConversation().catch((cause) => setError(errorText(cause))); };
  const stop = () => { voice.cancel(); setCallOpen(false); requests.cancel(); setStatus("Cancellation requested"); };
  useImperativeHandle(ref, () => ({ startCall, runTask: (text) => send(text), stopTask: stop }));
  const upload = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) { setError("Upload a file up to 20 MiB."); return; } setUploading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(new Error("File could not be read.")); reader.readAsDataURL(file); });
      if (!lifetime.current) return;
      const value = await request<{ root: string; path: string }>("/files/upload", { name: file.name, data }, lifetime.current.signal);
      if (!lifetime.current) return; setDraft((current) => (current ? current + "\n" : "") + `Attached document: root=${value.root}, path=${value.path}`); setError("");
    } catch (cause) { setError(errorText(cause)); } finally { setUploading(false); }
  };
  const pending = actions.filter((action) => ["awaiting_approval", "queued", "running", "uncertain"].includes(action.state));
  const currentMessages = messages.slice(messages.map((message) => message.role).lastIndexOf("user") + 1);
  const completedIds = new Set(currentMessages.filter((message) => message.role === "tool").map((message) => message.tool_call_id));
  const steps = currentMessages.flatMap((message) => message.tool_calls ?? []).filter((call) => call.function.name !== "jarvis_finish").slice(-6);
  return (
    <>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 320px" }, gap: 2, alignItems: "start" }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Chip size="small" color={busy ? "warning" : "success"} label={status} />
            <Typography variant="body2" color="text.secondary">{modelName}</Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button variant="outlined" size="small" startIcon={<Phone size={16} />} onClick={startCall} disabled={busy}>Talk</Button>
            {busy && <Button variant="outlined" size="small" color="error" startIcon={<Square size={15} />} onClick={stop}>Stop</Button>}
          </Box>
          <Paper variant="outlined" sx={{ p: 2, maxHeight: 420, overflowY: "auto" }} aria-label="Task conversation messages">
            {!messages.some((message) => message.role === "user") && (
              <Box sx={{ textAlign: "center", py: 3 }}>
                <Bot size={34} />
                <Typography variant="h6" sx={{ mt: 1 }}>Tell me what you need done.</Typography>
                <Typography variant="body2" color="text.secondary">I can inspect the PC, work with documents, read projects, browse public pages and use your connected accounts.</Typography>
              </Box>
            )}
            {messages.map((message, index) => message.role === "tool" || message.tool_calls?.length ? (
              <Accordion key={index} variant="outlined" sx={{ mt: 1 }}>
                <AccordionSummary expandIcon={<ChevronDown size={16} />}>
                  <Typography variant="body2">{message.role === "tool" ? "Tool result" : message.tool_calls?.map((call) => call.function.name).join(", ")}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box component="pre" sx={{ m: 0, fontSize: "0.75rem", overflowX: "auto" }}>{message.content}</Box>
                </AccordionDetails>
              </Accordion>
            ) : (
              <Box key={index} sx={{ display: "flex", gap: 1.5, mt: index === 0 ? 0 : 2 }}>
                <Avatar sx={{ width: 30, height: 30, bgcolor: message.role === "user" ? "secondary.main" : "primary.main", fontSize: "0.8rem" }}>
                  {message.role === "user" ? "M" : <Bot size={16} />}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2">{message.role === "user" ? "You" : message.role === "system" ? "Task update" : "JARVIS"}</Typography>
                  <RichText text={message.content ?? ""} />
                </Box>
              </Box>
            ))}
            {busy && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2 }} role="status">
                <CircularProgress size={16} />
                <Typography variant="body2">JARVIS is carrying out the task…</Typography>
              </Box>
            )}
            {busy && steps.length > 0 && (
              <List dense disablePadding sx={{ mt: 1 }}>
                {steps.map((step) => (
                  <ListItemText key={step.id}
                    primary={`${completedIds.has(step.id) ? "Result received" : "In progress"} · ${toolLabels[step.function.name] ?? step.function.name.replace("jarvis_", "").replaceAll("_", " ")}`}
                    slotProps={{ primary: { sx: { fontSize: "0.8rem" } } }} />
                ))}
              </List>
            )}
            <div ref={bottom} />
          </Paper>
          {error && <Alert severity="error">{error}</Alert>}
          <Paper variant="outlined" sx={{ p: 1.5 }} component="form" onSubmit={(event) => { event.preventDefault(); const text = draft; setDraft(""); void send(text).catch(() => {}); }}>
            <TextField
              multiline rows={3} aria-label="Task or message" placeholder="Describe the job, or attach a document…"
              value={draft} slotProps={{ htmlInput: { maxLength: 12000 } }} onChange={(event) => setDraft(event.target.value)} disabled={busy}
            />
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1, flexWrap: "wrap" }}>
              <Button variant="outlined" size="small" component="label" startIcon={<FileUp size={16} />}>
                {uploading ? "Uploading…" : "Attach document"}
                <input type="file" hidden accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.json" disabled={uploading || busy}
                  onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
              </Button>
              <Box sx={{ flexGrow: 1 }} />
              <Button variant="contained" size="small" type="submit" disabled={busy || !draft.trim()} startIcon={<Send size={16} />}>Do this</Button>
            </Box>
          </Paper>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {examples.map((text) => (
              <Chip key={text} label={text.length > 48 ? text.slice(0, 48) + "…" : text} title={text}
                onClick={() => setDraft(text)} disabled={busy} variant="outlined" sx={{ maxWidth: "100%" }} />
            ))}
          </Box>
          {pending.length > 0 && (
            <Box component="section">
              <Typography variant="h6" sx={{ mb: 1 }}>Needs your attention</Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {pending.map((action) => <ActionCard key={action.id + action.state} action={action} changed={() => setRefresh((value) => value + 1)} />)}
              </Box>
            </Box>
          )}
          <Accordion variant="outlined">
            <AccordionSummary expandIcon={<ChevronDown size={16} />}>Recent executed actions</AccordionSummary>
            <AccordionDetails sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {actions.filter((action) => !pending.includes(action)).slice(0, 12).map((action) => <ActionCard key={action.id + action.state} action={action} changed={() => setRefresh((value) => value + 1)} />)}
            </AccordionDetails>
          </Accordion>
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <RuntimeStatus />
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>Your results</Typography>
              {artifacts.length === 0
                ? <Typography variant="body2" color="text.secondary">Created files appear here with real downloads.</Typography>
                : artifacts.map((file) => (
                  <Box key={file.id} component="a" href={uuid.test(file.id) ? base + "/artifacts/" + file.id + "/download" : undefined}
                    download sx={{ display: "flex", gap: 1.5, alignItems: "center", py: 0.75, color: "inherit", textDecoration: "none" }}>
                    <Download size={18} />
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{file.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{file.format.toUpperCase()} · {file.bytes.toLocaleString()} bytes</Typography>
                    </Box>
                  </Box>
                ))}
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>Tasks & reminders</Typography>
              {tasks.filter((task) => task.data.state === "open").map((task) => (
                <Box key={task.id} sx={{ py: 0.75 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{task.data.title}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {task.data.dueAtLocal ? task.data.dueAtLocal + " " + task.data.timezone : task.data.dueAt ? new Date(task.data.dueAt).toISOString() : "No due time"}{task.data.notifiedAt ? " · DUE" : ""}
                  </Typography>
                  <Button variant="outlined" size="small" startIcon={<Check size={14} />} sx={{ mt: 0.5 }}
                    onClick={() => { void request("/tools/invoke", { conversationId: id, requestId: crypto.randomUUID(), tool: "jarvis_task_save", input: { action: "complete", id: task.id, _confidence: "high" } }).then(() => setRefresh((value) => value + 1)).catch((cause) => setError(errorText(cause))); }}>
                    Done
                  </Button>
                </Box>
              ))}
              {!tasks.some((task) => task.data.state === "open") && <Typography variant="body2" color="text.secondary">Ask JARVIS to remember a task or remind you at a time.</Typography>}
            </CardContent>
          </Card>
          <ClinicConnection />
          <MailConnection />
          <Accordion variant="outlined">
            <AccordionSummary expandIcon={<ChevronDown size={16} />}>Available tools</AccordionSummary>
            <AccordionDetails>
              {skills.map((skill) => (
                <Box key={skill.id} sx={{ py: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{skill.id.replace("jarvis_", "").replaceAll("_", " ")}</Typography>
                  <Typography variant="caption" color="text.secondary">{skill.state} · {skill.mode}{skill.missing.length ? " · " + skill.missing.join(", ") : ""}{skill.reason ? " · " + skill.reason : ""}</Typography>
                </Box>
              ))}
            </AccordionDetails>
          </Accordion>
        </Box>
      </Box>
      <audio ref={voice.audioRef} hidden />
      <CallScreen open={callOpen} project="JARVIS Tasks" state={voice.conversation} playbackPhase={voice.phase} playbackStatus={voice.status} audioVisual={voice.audioVisual}
        onHangUp={stop} onMute={(muted) => { void voice.setMuted(muted).catch((cause) => setError(errorText(cause))); }} onResumeAudio={() => { void voice.resumePlayback(); }} onRetry={startCall} />
    </>
  );
});

type RuntimeInfo = {
  selected: { transport: string; model?: string; reasoning?: string | boolean; contextTokens?: number };
  resources: { profile: string; keepAliveSeconds: number; transition: string | null };
  model: { state: string; warm: boolean | null; reportedGpuBytes?: number | null; version?: string | null };
  inference: { requests: number; failures: number; cancellations?: number; active: number; medianModelMs: number | null; last: { elapsedMs: number; cancelled?: boolean; outputTokensPerSecond?: number | null; load_ms?: number } | null };
};
function RuntimeStatus() {
  const [value, setValue] = useState<RuntimeInfo | null>(null), [error, setError] = useState(""), [hidden, setHidden] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      while (!controller.signal.aborted) {
        try { const status = await request<RuntimeInfo>("/runtime", undefined, controller.signal); controller.signal.throwIfAborted(); setValue(status); setError(""); }
        catch (cause) { if (controller.signal.aborted) return; if (cause instanceof ApiError && cause.status === 403) { setHidden(true); return; } setError("Runtime diagnostics are unavailable."); }
        try { await waitFor(5000, controller.signal); } catch { return; }
      }
    })(); return () => controller.abort();
  }, []);
  if (hidden) return null;
  const states: Record<string, string> = { ready: "Model loaded", cold: "Cold — loads on the next task", missing: "Selected model is not installed", offline: "Model service offline", context_mismatch: "Loaded context differs from configuration", gateway: "Gateway available" };
  return (
    <Accordion variant="outlined" defaultExpanded={false}>
      <AccordionSummary expandIcon={<ChevronDown size={16} />}>Runtime & resources</AccordionSummary>
      <AccordionDetails>
        {error && <Typography variant="body2" role="status" color="text.secondary">{error}</Typography>}
        {value && <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{value.resources.transition ? "Changing model resources" : states[value.model.state] ?? value.model.state}</Typography>
          <Typography variant="body2">{value.resources.profile === "balanced" ? "Balanced · model idle timeout15 minutes" : "Interactive · model stays loaded"}</Typography>
          <Typography variant="body2">Reasoning: {String(value.selected.reasoning ?? "configured")} · Context: {value.selected.contextTokens?.toLocaleString() ?? "configured"}</Typography>
          {typeof value.model.reportedGpuBytes === "number" && <Typography variant="body2">Model-reported GPU allocation: {(value.model.reportedGpuBytes / 1024 ** 3).toFixed(2)} GiB</Typography>}
          <Typography variant="body2">{value.inference.active} active model calls · {value.inference.requests} calls · {value.inference.cancellations ?? 0} cancelled · {value.inference.failures} failures since restart</Typography>
          {value.inference.last && <Typography variant="body2">Last model call: {(value.inference.last.elapsedMs / 1000).toFixed(2)}s
            {value.inference.last.cancelled ? " · cancelled" : ""}
            {typeof value.inference.last.outputTokensPerSecond === "number" ? ` · ${value.inference.last.outputTokensPerSecond.toFixed(1)} output tokens/s` : ""}</Typography>}
          <Typography variant="caption" color="text.secondary">Model timing excludes tools and audio. Resource changes use the local development CLI.</Typography>
        </>}
      </AccordionDetails>
    </Accordion>
  );
}

function ActionCard({ action, changed }: { action: Action; changed(): void }) {
  const [detail, setDetail] = useState<Action | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false); const alive = useRef(true);
  useEffect(() => { alive.current = true; const controller = new AbortController(); void request<Action>("/actions/" + action.id, undefined, controller.signal).then((value) => { if (!controller.signal.aborted) setDetail(value); }).catch((cause) => { if (!controller.signal.aborted) setError(errorText(cause)); }); return () => { alive.current = false; controller.abort(); }; }, [action.id]);
  const decide = async (decision: "approve" | "deny" | "cancel") => {
    if (!detail || busy) return; setBusy(true); setError("");
    try { await request("/actions/" + action.id + (decision === "cancel" ? "/cancel" : "/decision"), decision === "cancel" ? {} : { decision, inputHash: detail.inputHash, fingerprint: detail.fingerprint, eventKey: crypto.randomUUID() }); if (alive.current) changed(); }
    catch (cause) { if (alive.current) setError(errorText(cause)); } finally { if (alive.current) setBusy(false); }
  };
  return (
    <Card variant="outlined">
      <CardContent sx={{ "&:last-child": { pb: 2 } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>{action.tool.replace("jarvis_", "").replaceAll("_", " ")}</Typography>
          <Chip size="small" label={action.state.replaceAll("_", " ")} />
        </Box>
        {detail && (
          <Accordion variant="outlined" sx={{ mt: 1 }} defaultExpanded={action.state === "awaiting_approval"}>
            <AccordionSummary expandIcon={<ChevronDown size={16} />}>
              <Typography variant="body2">{action.state === "awaiting_approval" ? "Proposed action — review before approving" : "Arguments and actual result"}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box component="pre" sx={{ m: 0, fontSize: "0.75rem", overflowX: "auto" }}>{JSON.stringify(action.state === "awaiting_approval" ? detail.input : { input: detail.input, result: detail.result }, null, 2)}</Box>
            </AccordionDetails>
          </Accordion>
        )}
        {action.state === "awaiting_approval" && (
          <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
            <Button variant="contained" size="small" disabled={!detail || busy} startIcon={<Check size={15} />} onClick={() => void decide("approve")}>Approve</Button>
            <Button variant="outlined" size="small" disabled={!detail || busy} startIcon={<X size={15} />} onClick={() => void decide("deny")}>Deny</Button>
          </Box>
        )}
        {["queued", "running"].includes(action.state) && <Button variant="outlined" size="small" disabled={!detail || busy} onClick={() => void decide("cancel")} sx={{ mt: 1 }}>Cancel action</Button>}
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </CardContent>
    </Card>
  );
}

function ClinicConnection() {
  const [status, setStatus] = useState<{ connected: boolean; displayName?: string; configuredOrigin?: string; apiReachable?: boolean; apiProfile?: string; contractVerified?: boolean; message?: string } | null>(null), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); void request<typeof status>("/connections/clinic", undefined, controller.signal).then((value) => { if (!controller.signal.aborted) setStatus(value); }).catch(() => {}); return () => controller.abort(); }, []);
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" sx={{ mb: 1 }}>SportMedical</Typography>
        {status?.message && <Typography variant="body2">{status.message}{status.apiProfile && status.apiProfile !== "unknown" ? " Profile: " + status.apiProfile + "." : ""}</Typography>}
        {status?.connected
          ? <Typography variant="body2" color="success.main">Connected · {status.displayName}</Typography>
          : <>
            <Typography variant="body2" color="text.secondary">Connect your existing clinic sign-in to read real appointments, invoices and prices.</Typography>
            <Box component="form" sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1.5 }} onSubmit={(event) => {
              event.preventDefault(); setBusy(true); setError("");
              void request<NonNullable<typeof status>>("/connections/clinic", { email, password }).then(setStatus).catch((cause) => setError(errorText(cause))).finally(() => { setPassword(""); setBusy(false); });
            }}>
              <TextField label="Clinic email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
              <TextField label="Clinic password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <Button variant="contained" type="submit" disabled={busy}>{busy ? "Connecting…" : "Connect SportMedical"}</Button>
            </Box>
          </>}
        {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      </CardContent>
    </Card>
  );
}

function MailConnection() {
  const [status, setStatus] = useState<{ connected: boolean; user?: string; sendingConfigured?: boolean } | null>(null), [values, setValues] = useState({ imapHost: "", user: "", password: "", smtpHost: "", smtpPort: 465 }), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); void request<typeof status>("/connections/mail", undefined, controller.signal).then((value) => { if (!controller.signal.aborted) setStatus(value); }).catch(() => {}); return () => controller.abort(); }, []);
  return (
    <Accordion variant="outlined">
      <AccordionSummary expandIcon={<ChevronDown size={16} />}>
        Email {status?.connected ? "· connected" : ""}
      </AccordionSummary>
      <AccordionDetails>
        {status?.connected
          ? <Typography variant="body2">{status.user} · inbox connected{status.sendingConfigured ? " · SMTP configured" : ""}</Typography>
          : <Typography variant="body2" color="text.secondary">Connect an IMAP mailbox with its password/app password. Providers that require OAuth need that provider&apos;s OAuth connection.</Typography>}
        <Box component="form" sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1.5 }} onSubmit={(event) => {
          event.preventDefault(); setBusy(true); setError("");
          void request<NonNullable<typeof status>>("/connections/mail", values).then(setStatus).catch((cause) => setError(errorText(cause))).finally(() => { setValues((value) => ({ ...value, password: "" })); setBusy(false); });
        }}>
          {(["imapHost", "user", "password", "smtpHost"] as const).map((key) => (
            <TextField key={key}
              label={{ imapHost: "IMAP hostname (TLS 993)", user: "Mailbox username", password: "Password / app password", smtpHost: "SMTP hostname (optional)" }[key]}
              type={key === "password" ? "password" : "text"}
              autoComplete={key === "password" ? "current-password" : key === "user" ? "username" : "off"}
              value={values[key]} required={key !== "smtpHost"}
              onChange={(event) => setValues((value) => ({ ...value, [key]: event.target.value }))} />
          ))}
          <FormControl>
            <InputLabel id="smtp-security-label">SMTP security</InputLabel>
            <Select labelId="smtp-security-label" label="SMTP security" value={values.smtpPort}
              onChange={(event) => setValues((value) => ({ ...value, smtpPort: Number(event.target.value) }))}>
              <MenuItem value={465}>TLS · 465</MenuItem>
              <MenuItem value={587}>Required STARTTLS · 587</MenuItem>
            </Select>
          </FormControl>
          <Button variant="contained" type="submit" disabled={busy}>{busy ? "Checking mailbox…" : "Connect email"}</Button>
        </Box>
        {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      </AccordionDetails>
    </Accordion>
  );
}

