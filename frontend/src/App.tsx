import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Boxes,
  Building2,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Layers3,
  Menu,
  MessageSquare,
  Moon,
  Network,
  Phone,
  Plus,
  Search,
  Settings2,
  Sun,
  Workflow,
} from "lucide-react";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  CssBaseline,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Snackbar,
  TextField,
  ThemeProvider,
  Toolbar,
  Typography,
} from "@mui/material";
import { api, boundedApi, isDemoPortal, isRemoteCall, isRemoteOperator, streamChat } from "./api";
import { useVoice } from "./useVoice";
import { CallScreen } from "./CallScreen";
import { OperatorPanel } from "./OperatorPanel";
import { FirmPortal } from "./FirmPortal";
import { FleetAdmin } from "./FleetAdmin";
import { ConnectionCatalog } from "./ConnectionCatalog";
import type { OperatorPanelHandle } from "./OperatorPanel";
import { makeJarvisTheme } from "./theme";
import {
  AssistantView,
  AutomationsView,
  ConnectModal,
  OverviewView,
  ProjectView,
  RunDetailDialog,
  RunsView,
  SettingsView,
  SkillDetailDialog,
  SkillsView,
} from "./views";
import type {
  Capability,
  History,
  InstalledSkill,
  Message,
  Operation,
  Preferences,
  Project,
  Review,
  System,
  Thread,
  View,
  VoiceStatus,
} from "./types";

const navigation: { id: View; label: string; icon: typeof Bot }[] = [
  { id: "operator", label: "JARVIS Tasks", icon: Bot },
  { id: "firm", label: "Firm portal", icon: Building2 },
  { id: "fleet", label: "Fleet admin", icon: Network },
  { id: "overview", label: "Overview", icon: Layers3 },
  { id: "assistant", label: "Project chat", icon: MessageSquare },
  { id: "projects", label: "Projects", icon: FolderOpen },
  { id: "skills", label: "Skills library", icon: Boxes },
  { id: "automations", label: "Automations", icon: Workflow },
  { id: "runs", label: "Run history", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings2 },
];
const defaults: Preferences = {  theme: "dark",
  voice: "bm_george",
  auto_speak: false,
  auto_send_voice: false,
};
const voices: Record<string, string> = {
  bm_george: "George · British male",
  af_heart: "Heart · American female",
  bf_emma: "Emma · British female",
  am_michael: "Michael · American male",
  jirka: "Jirka · Czech male",
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed.";
const number = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: value > 99999 ? "compact" : "standard",
  }).format(value);
const running = (status: string) => ["queued", "running"].includes(status);
type ChatOptions = { voiceMode?: boolean; signal?: AbortSignal; onPartial?: (text: string) => void };
type SendChat = (text: string, options?: ChatOptions) => Promise<string>;

const DRAWER_WIDTH = 280;

export default function App() {
  const [demoMode] = useState(() => isDemoPortal());
  const demoViews: View[] = ["firm", "fleet"];
  const visibleNav = demoMode ? navigation.filter((item) => demoViews.includes(item.id)) : navigation;
  const operatorPanel = useRef<OperatorPanelHandle>(null);
  const remoteCall = isRemoteCall();
  const remoteOperator = isRemoteOperator();
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>(() => {
    if (demoMode) {
      const hash = location.hash.slice(1);
      return demoViews.includes(hash as View) ? (hash as View) : "firm";
    }
    if (remoteCall) return remoteOperator ? (location.hash==="#projects"?"projects":"operator") : "assistant";
    const value =
      location.hash.slice(1) || localStorage.getItem("jarvis-active-view");
    return navigation.some((item) => item.id === value)
      ? (value as View)
      : "operator";
  });
  const [menu, setMenu] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter,setProjectFilter]=useState("");
  const [project, setProject] = useState("");
  const [system, setSystem] = useState<System | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const confirmedPreferences = useRef<Preferences>(defaults);
  const pendingPreferences = useRef(new Map<number, Partial<Preferences>>());
  const preferenceQueue = useRef(Promise.resolve());
  const preferenceSequence = useRef(0);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({
    available: false,
    voices: [],
  });
  const [callOpen, setCallOpen] = useState(false);
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadSelection, setThreadSelection] = useState({
    project: "",
    thread: "",
  });
  const thread =
    threadSelection.project === project ? threadSelection.thread : "";
  const setThread = (value: string) =>
    setThreadSelection({ project, thread: value });
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const busyState = useRef(new Set<string>());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMore, setHistoryMore] = useState<
    Record<string, number | undefined>
  >({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [connect, setConnect] = useState(false);
  const [detail, setDetail] = useState<Capability | null>(null);
  const [runDetail, setRunDetail] = useState<Operation | Review | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const aborters = useRef(new Map<string, () => Promise<void>>());
  const historyVersions = useRef(new Map<string, number>());
  const historyRequests = useRef(new Map<string, Promise<History | null>>());
  const projectRevision = useRef(0);
  const operationStates = useRef(new Map<string, string>());
  const messagesRef = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const active = useRef({ project, thread, view });
  active.current = { project, thread, view };
  const key = project + "/" + thread;
  const muiTheme = useMemo(
    () => makeJarvisTheme(preferences.theme === "light" ? "light" : "dark"),
    [preferences.theme],
  );
  useEffect(() => { setCallOpen(false); }, [key, view]);
  const selected = projects.find((item) => item.id === project);
  const currentMessages = messages[key] || [];
  useEffect(() => {
    localStorage.setItem("jarvis-active-view", view);
    window.scrollTo(0, 0);
    if (location.hash !== "#" + view)
      history.replaceState(null, "", "#" + view);
  }, [view]);
  useEffect(() => {
    const change = () => {
      if (demoMode) {
        const hash = location.hash.slice(1);
        if (demoViews.includes(hash as View)) setView(hash as View);
        return;
      }
      if (remoteCall) { setView(remoteOperator ? (location.hash==="#projects"?"projects":"operator") : "assistant"); return; }
      const value = location.hash.slice(1);
      if (navigation.some((item) => item.id === value)) setView(value as View);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    followMessages.current = true;
  }, [key]);
  useEffect(() => {
    if (followMessages.current && messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [currentMessages.length, currentMessages.at(-1)?.text, view]);
  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify(errorText(error), true);
    },
    [notify],
  );

  const refreshSystem = useCallback(async () => {
    try {
      setSystem(await api<System>("/api/system?refresh=true"));
    } catch (error) {
      fail(error);
    }
  }, [fail]);
  const refreshSkills = useCallback(async () => {
    try {
      setSkills(
        (await api<{ skills: InstalledSkill[] }>("/api/skills?refresh=true"))
          .skills,
      );
      setSkillsLoaded(true);
    } catch (error) {
      fail(error);
    }
  }, [fail]);
  const refreshRuns = useCallback(async () => {
    try {
      setOperations(
        (await api<{ operations: Operation[] }>("/api/operations")).operations,
      );
    } catch (error) {
      fail(error);
    }
  }, [fail]);
  useEffect(() => {
    let inventoryChanged = false,
      catalogChanged = false;
    for (const operation of operations) {
      if (
        running(operationStates.current.get(operation.id) || "") &&
        !running(operation.status)
      ) {
        inventoryChanged ||= operation.kind.startsWith("skill-");
        catalogChanged ||= operation.kind === "catalog";
      }
    }
    operationStates.current = new Map(
      operations.map((operation) => [operation.id, operation.status]),
    );
    if (inventoryChanged) void refreshSkills();
    if (catalogChanged) void refreshSystem();
  }, [operations, refreshSkills, refreshSystem]);
  const refreshProjects = useCallback(async (preferred?: string) => {
    const list = (await api<{ projects: Project[] }>("/api/projects")).projects;
    setProjects(list);
    setProject((previous) =>
      list.some((item) => item.id === (preferred || previous))
        ? preferred || previous
        : list.find((item) => item.id === "medical")?.id || list[0]?.id || "",
    );
  }, []);

  useEffect(() => {
    if (demoMode) { setReady(true); return; }
    let alive = true;
    const controller = new AbortController();
    (async () => {
      await api("/api/session", undefined, { signal: controller.signal });
      const [connected, prefs] = await Promise.all([
        api<{ projects: Project[] }>("/api/projects", undefined, {
          signal: controller.signal,
        }),
        api<Preferences>("/api/preferences", undefined, {
          signal: controller.signal,
        }),
      ]);
      if (!alive) return;
      setProjects(connected.projects);
      confirmedPreferences.current = prefs;
      setPreferences(prefs);
      const saved = localStorage.getItem("jarvis-current-project");
      setProject(
        connected.projects.find((item) => item.id === saved)?.id ||
          connected.projects.find((item) => item.id === "medical")?.id ||
          connected.projects[0]?.id ||
          "",
      );
      setReady(true);
      const results = await Promise.allSettled([
        api<System>("/api/system"),
        api<{ skills: InstalledSkill[] }>("/api/skills"),
        api<VoiceStatus>("/api/voice/status"),
        api<{ operations: Operation[] }>("/api/operations"),
      ]);
      if (!alive) return;
      if (results[0].status === "fulfilled") setSystem(results[0].value);
      if (results[1].status === "fulfilled") {
        setSkills(results[1].value.skills);
        setSkillsLoaded(true);
      }
      if (results[2].status === "fulfilled") setVoiceStatus(results[2].value);
      if (results[3].status === "fulfilled")
        setOperations(results[3].value.operations);
    })().catch(fail);
    return () => {
      alive = false;
      controller.abort();
    };
  }, [fail]);
  useEffect(() => {
    if (!project) return;
    projectRevision.current++;
    localStorage.setItem("jarvis-current-project", project);
    let alive = true;
    setThreads([]);
    setThread("");
    (async () => {
      let list = (
        await api<{ conversations: Thread[] }>(
          "/api/conversations?project=" + encodeURIComponent(project),
        )
      ).conversations;
      if (!alive) return;
      if (!list.length)
        list = [await api<Thread>("/api/conversations", { project })];
      if (!alive) return;
      setThreads(list);
      const saved = localStorage.getItem("jarvis-thread-v3-" + project);
      setThread(
        list.find((item) => item.thread === saved)?.thread || list[0].thread,
      );
      const history = await api<{ jobs: Review[] }>(
        "/api/reviews?project=" + encodeURIComponent(project),
      );
      if (alive) setReviews(history.jobs);
    })().catch(fail);
    return () => {
      alive = false;
    };
  }, [project, fail]);

  const loadHistory = useCallback(
    (p: string, t: string, older?: number): Promise<History | null> => {
      const id = p + "/" + t;
      const requestKey = id + ":" + (older || 0);
      const pending = historyRequests.current.get(requestKey);
      if (pending) return pending;
      const operation = (async () => {
      if (controllers.current.has(id)) return null;
      const revision = (historyVersions.current.get(id) || 0) + 1;
      historyVersions.current.set(id, revision);
      const result = await boundedApi<History>(
        `/api/conversations/history?project=${encodeURIComponent(p)}&thread=${encodeURIComponent(t)}&offset=${older || 0}`,
      );
      if (
        controllers.current.has(id) ||
        historyVersions.current.get(id) !== revision
      )
        return result;
      setMessages((previous) => {
        if (controllers.current.has(id) || historyVersions.current.get(id) !== revision) return previous;
        const combined = older
          ? [...result.messages, ...(previous[id] || [])]
          : result.messages;
        const seen = new Set<string>();
        return {
          ...previous,
          [id]: combined.filter(
            (message) => !seen.has(message.id) && Boolean(seen.add(message.id)),
          ),
        };
      });
      setHistoryMore((previous) => ({
        ...previous,
        [id]: result.has_more ? result.next_offset : undefined,
      }));
      if (!controllers.current.has(id)) {
        if (result.active) busyState.current.add(id);
        else busyState.current.delete(id);
        setBusy((previous) => {
          if (controllers.current.has(id) || historyVersions.current.get(id) !== revision) return previous;
          const next = new Set(previous);
          if (result.active) next.add(id);
          else next.delete(id);
          return next;
        });
      }
      return result;
      })();
      historyRequests.current.set(requestKey, operation);
      void operation.finally(() => {
        if (historyRequests.current.get(requestKey) === operation) historyRequests.current.delete(requestKey);
      }).catch(() => {});
      return operation;
    },
    [],
  );
  useEffect(() => {
    if (!project || !thread) return;
    localStorage.setItem("jarvis-thread-v3-" + project, thread);
    setHistoryLoading(true);
    let alive = true;
    loadHistory(project, thread)
      .catch(fail)
      .finally(() => {
        if (alive) setHistoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [project, thread, loadHistory, fail]);
  useEffect(() => {
    if (!busy.has(key) || controllers.current.has(key) || !thread) return;
    const timer = setInterval(() => {
      void loadHistory(project, thread).catch(fail);
    }, 4000);
    return () => clearInterval(timer);
  }, [busy, key, thread, project, loadHistory, fail]);
  useEffect(() => {
    if (!operations.some((item) => running(item.status))) return;
    const timer = setInterval(() => {
      void refreshRuns();
    }, 2500);
    return () => clearInterval(timer);
  }, [operations, refreshRuns]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (remoteCall) return;
        event.preventDefault();
        setView("skills");
        setMenu(false);
        setTimeout(
          () => document.getElementById("catalog-search")?.focus(),
          50,
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const updateMessage = (
    id: string,
    messageId: string,
    change: Partial<Message>,
  ) =>
    setMessages((previous) => ({
      ...previous,
      [id]: (previous[id] || []).map((message) =>
        message.id === messageId ? { ...message, ...change } : message,
      ),
    }));
  const sendRef = useRef<SendChat>(async () => { throw new Error("Chat is not ready."); });
  const voice = useVoice(
    key + ":" + view,
    preferences.voice,
    (text) => {
      const id = active.current.project + "/" + active.current.thread;
      if (
        preferences.auto_send_voice &&
        !busy.has(id) &&
        !controllers.current.has(id)
      ) {
        void sendRef.current(((drafts[id] || "") + "\n" + text).trim()).catch(fail);
        return;
      }
      setDrafts((previous) => {
        const next = ((previous[id] || "") + "\n" + text).trim();
        if (next.length > 12000) {
          notify("The dictated text exceeds this draft’s limit.", true);
          return previous;
        }
        return { ...previous, [id]: next };
      });
    },
    (message) => notify(message, true),
    (text, signal, onPartial) => sendRef.current(text, { voiceMode: true, signal, onPartial }),
  );

  function callJarvis() {
    if (view === "operator") { operatorPanel.current?.startCall(); return; }
    if (!thread || busyState.current.has(key) || controllers.current.has(key)) return;
    setCallOpen(true);
    void voice.startConversation();
  }
  function hangUp() {
    voice.cancel();
    setCallOpen(false);
  }

  async function sendChat(text: string, options: ChatOptions = {}): Promise<string> {
    options.signal?.throwIfAborted();
    const p = active.current.project,
      t = active.current.thread,
      id = p + "/" + t;
    if (!p || !t || !text.trim()) throw new Error("Select a conversation and enter a message.");
    // A spoken interruption can finish before the preceding history refresh.
    // Wait for that origin's authoritative idle state, never retry a submitted turn.
    if (options.voiceMode) {
      const deadline = Date.now() + 30000;
      while (controllers.current.has(id) || busyState.current.has(id)) {
        options.signal?.throwIfAborted();
        if (Date.now() >= deadline) throw new Error("The preceding reply is still finishing. Please call again shortly.");
        if (!controllers.current.has(id)) await loadHistory(p, t);
        if (!controllers.current.has(id) && !busyState.current.has(id)) break;
        await new Promise<void>((resolve, reject) => {
          const aborted = () => { clearTimeout(timer); reject(new DOMException("Call ended.", "AbortError")); };
          const timer = setTimeout(() => { options.signal?.removeEventListener("abort", aborted); resolve(); }, 300);
          options.signal?.addEventListener("abort", aborted, { once: true });
          if (options.signal?.aborted) aborted();
        });
      }
      options.signal?.throwIfAborted();
      if (active.current.project !== p || active.current.thread !== t)
        throw new DOMException("Call project changed.", "AbortError");
    }
    if (controllers.current.has(id) || busyState.current.has(id))
      throw new Error("This conversation is still working. Wait for the current reply.");
    if (!options.voiceMode && voice.conversationActive)
      throw new Error("Hang up before sending a typed message.");
    const controller = new AbortController();
    let abortRequest: Promise<void> | undefined;
    const requestAbort = () => {
      controller.abort();
      // Hold admission until this origin-bound native abort has settled.
      abortRequest ??= boundedApi("/api/conversations/abort", { project: p, thread: t }, undefined, 8000).then(() => {});
      return abortRequest;
    };
    const abort = () => { void requestAbort().catch(fail); };
    aborters.current.set(id, requestAbort);
    options.signal?.addEventListener("abort", abort, { once: true });
    historyVersions.current.set(id, (historyVersions.current.get(id) || 0) + 1);
    controllers.current.set(id, controller);
    const userId = crypto.randomUUID(),
      answerId = crypto.randomUUID();
    setMessages((previous) => ({
      ...previous,
      [id]: [
        ...(previous[id] || []),
        { id: userId, role: "user", text: text.trim() },
        { id: answerId, role: "assistant", text: "", streaming: true },
      ],
    }));
    if (!options.voiceMode) setDrafts((previous) => ({ ...previous, [id]: "" }));
    busyState.current.add(id);
    setBusy((previous) => new Set(previous).add(id));
    let answer = "";
    try {
      await streamChat(
        { project: p, thread: t, message: text.trim(), stream: true, voice_mode: Boolean(options.voiceMode) },
        (event) => {
          if (controller.signal.aborted) return;
          if (event.type === "delta") {
            answer += event.text || "";
            updateMessage(id, answerId, { text: answer });
            options.onPartial?.(answer);
          }
          if (event.type === "done") {
            answer = event.answer ?? answer;
            updateMessage(id, answerId, { text: answer, streaming: false });
          }
        },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (!answer.trim()) throw new Error("JARVIS returned no completed answer.");
      if (
        !options.voiceMode &&
        preferences.auto_speak &&
        active.current.project === p &&
        active.current.thread === t &&
        active.current.view === "assistant"
      )
        void voice.speak(answer);
      void api<{ conversations: Thread[] }>(
        "/api/conversations?project=" + encodeURIComponent(p),
      ).then((list) => { if (active.current.project === p) setThreads(list.conversations); }).catch(fail);
      return answer;
    } catch (error) {
      updateMessage(id, answerId, {
        text: answer || errorText(error),
        error: true,
        streaming: false,
      });
      if (!answer && !options.voiceMode) setDrafts((previous) => previous[id] ? previous : ({ ...previous, [id]: text }));
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (abortRequest) await abortRequest.catch(() => {});
      if (controllers.current.get(id) === controller) controllers.current.delete(id);
      if (aborters.current.get(id) === requestAbort) aborters.current.delete(id);
      // History is authoritative; keep admission closed until it confirms idle.
      // Reconciliation does not delay synthesis or invalidate a completed answer.
      void loadHistory(p, t).catch(fail);
    }
  }
  sendRef.current = sendChat;
  async function newConversation() {
    if (!project) return;
    const origin = project,
      revision = projectRevision.current;
    voice.cancel();
    try {
      const value = await api<Thread>("/api/conversations", {
        project: origin,
      });
      if (
        active.current.project !== origin ||
        projectRevision.current !== revision
      )
        return;
      setThreads((previous) => [value, ...previous]);
      setThreadSelection({ project: origin, thread: value.thread });
      setView("assistant");
    } catch (error) {
      fail(error);
    }
  }
  async function stopChat() {
    voice.cancel();
    try {
      const abort = aborters.current.get(key);
      if (abort) await abort();
      else await boundedApi("/api/conversations/abort", { project, thread });
      notify("Stop requested. Reload history to confirm the final run state.");
    } catch (error) {
      fail(error);
    }
  }
  async function savePreferences(changes: Partial<Preferences>) {
    if (demoMode) { setPreferences((previous) => ({ ...previous, ...changes })); return; }
    const identifier = ++preferenceSequence.current;
    pendingPreferences.current.set(identifier, changes);
    const renderPreferences = () =>
      setPreferences(
        Object.assign(
          {},
          confirmedPreferences.current,
          ...pendingPreferences.current.values(),
        ),
      );
    renderPreferences();
    preferenceQueue.current = preferenceQueue.current.then(async () => {
      try {
        confirmedPreferences.current = await api<Preferences>(
          "/api/preferences",
          changes,
        );
        pendingPreferences.current.delete(identifier);
        renderPreferences();
        notify("Preferences saved.");
      } catch (error) {
        pendingPreferences.current.delete(identifier);
        renderPreferences();
        fail(error);
      }
    });
    await preferenceQueue.current;
  }
  async function startOperation(path: string, body: unknown) {
    try {
      const operation = await api<Operation>(path, body);
      setOperations((previous) => [operation, ...previous]);
      notify(operation.title + " started.");
      return operation;
    } catch (error) {
      fail(error);
      return null;
    }
  }
  function navigate(next: View) {
    if (location.hash !== "#" + next) history.pushState(null, "", "#" + next);
    setView(next);
    setMenu(false);
    setToast(null);
  }
  function useSkill(name: string) {
    setView("assistant");
    setDrafts((previous) => ({ ...previous, [key]: `Use $${name} to ` }));
  }

  if (!ready)
    return (
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <Avatar sx={{ width: 56, height: 56, bgcolor: "primary.main", color: "primary.contrastText", fontSize: "1.5rem", fontWeight: 800 }}>J</Avatar>
          <Typography variant="h4" component="h1">JARVIS</Typography>
          <Typography variant="body2" color="text.secondary">Connecting your workspace…</Typography>
          {toast ? (
            <Alert severity="error">{toast.text}</Alert>
          ) : (
            <CircularProgress />
          )}
        </Box>
      </ThemeProvider>
    );

  const drawerContent = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>      <Box
        sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 2, cursor: "pointer" }}
        onClick={() => navigate("overview")}
      >
        <Avatar sx={{ bgcolor: "primary.main", color: "primary.contrastText", fontWeight: 800 }}>J</Avatar>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.1 }}>JARVIS</Typography>
          <Typography variant="caption" color="text.secondary">Command center</Typography>
        </Box>
        <Chip size="small" label="0.5" />
      </Box>
      <Box sx={{ px: 2, pb: 1 }}>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<Search size={16} />}
          endIcon={<Chip size="small" label="Ctrl K" />}
          onClick={() => {
            navigate("skills");
            setTimeout(
              () => document.getElementById("catalog-search")?.focus(),
              30,
            );
          }}
          sx={{ justifyContent: "flex-start" }}
        >
          <Box component="span" sx={{ flexGrow: 1, textAlign: "left" }}>Find a capability</Box>
        </Button>
      </Box>
      <List sx={{ px: 1 }} aria-label="Main navigation">
        {visibleNav.map((item) => (
          <ListItemButton
            key={item.id}
            selected={view === item.id}
            onClick={() => navigate(item.id)}
            sx={{ borderRadius: 2 }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              <item.icon size={19} />
            </ListItemIcon>
            <ListItemText primary={item.label} />
            {item.id === "skills" && system && (
              <Chip size="small" label={number(system.catalog.available)} />
            )}
            {item.id === "runs" && operations.some((run) => running(run.status)) && (
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "success.main" }} />
            )}
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ px: 2, pt: 1, flexGrow: 1, overflowY: "auto" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            Connected projects
          </Typography>
          <IconButton size="small" aria-label="Connect a project" onClick={() => setConnect(true)}>
            <Plus size={15} />
          </IconButton>
        </Box>
        <TextField
          aria-label="Filter connected projects"
          placeholder="Filter projects…"
          value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}
          sx={{ my: 1 }}
        />
        <List dense disablePadding>
          {projects.filter((item) => !projectFilter || (item.id + " " + item.name).toLowerCase().includes(projectFilter.toLowerCase())).map((item) => (
            <ListItemButton
              key={item.id}
              selected={project === item.id}
              onClick={() => {
                setProject(item.id);
                navigate("projects");
              }}
              sx={{ borderRadius: 2 }}
            >
              <Avatar sx={{ width: 28, height: 28, fontSize: "0.8rem", mr: 1.5 }}>{item.name.slice(0, 1)}</Avatar>
              <ListItemText
                primary={item.name}
                secondary={`${item.roots.length} source folder${item.roots.length === 1 ? "" : "s"}`}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>
      <Box sx={{ p: 2, borderTop: 1, borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "success.main" }} />
          <Typography variant="body2">Running on your PC</Typography>
        </Box>
        <Button size="small" endIcon={<ExternalLink size={13} />} href="http://localhost:18789" target="_blank" sx={{ mt: 0.5 }}>
          OpenClaw controls
        </Button>
        <Button size="small" endIcon={<ExternalLink size={13} />} href="http://localhost:5679" target="_blank">
          n8n workflow editor
        </Button>
      </Box>
    </Box>
  );

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <Drawer
          variant="temporary"
          open={menu}
          onClose={() => setMenu(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: DRAWER_WIDTH } }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{ display: { xs: "none", md: "block" }, "& .MuiDrawer-paper": { width: DRAWER_WIDTH } }}
          open
        >
          {drawerContent}
        </Drawer>
        <Box sx={{ flexGrow: 1, width: { md: `calc(100% - ${DRAWER_WIDTH}px)` }, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <AppBar position="sticky" color="default" elevation={1} sx={{ borderRadius: 0 }}>
            <Toolbar sx={{ gap: 1.5 }}>
              <IconButton
                aria-label="Open navigation"
                onClick={() => setMenu(true)}
                sx={{ display: { md: "none" } }}
              >
                <Menu size={22} />
              </IconButton>
              <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
                {remoteCall ? "Notebook call" : "Workspace"}
              </Typography>
              <ChevronRight size={14} />
              <FormControl sx={{ minWidth: 160, maxWidth: 260 }}>
                <InputLabel id="active-project-label">Active project</InputLabel>
                <Select
                  labelId="active-project-label"
                  id="active-project"
                  label="Active project"
                  value={project}
                  onChange={(event) => setProject(String(event.target.value))}
                >
                  {projects.map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Box sx={{ flexGrow: 1 }} />
              <Button
                variant="contained"
                startIcon={<Phone size={18} />}
                onClick={callJarvis}
                disabled={!voiceStatus.available || !voice.conversationSupported || (view !== "operator" && (!thread || busy.has(key) || historyLoading))}
              >
                Call JARVIS
              </Button>
              <Chip icon={<Bot size={15} />} label={demoMode ? "Demo" : (system?.model || "Connecting assistant")} variant="outlined" sx={{ display: { xs: "none", lg: "flex" } }} />
              <IconButton
                aria-label="Toggle theme"
                onClick={() =>
                  void savePreferences({
                    theme: preferences.theme === "dark" ? "light" : "dark",
                  })
                }
              >
                {preferences.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </IconButton>
              <Avatar sx={{ width: 32, height: 32, fontSize: "0.9rem" }}>M</Avatar>
            </Toolbar>
          </AppBar>
          <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, maxWidth: 1200, width: "100%", mx: "auto" }}>
            {remoteOperator && (
              <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
                <Button variant="outlined" size="small" onClick={() => navigate("operator")}>JARVIS Tasks</Button>
                <Button variant="outlined" size="small" onClick={() => navigate("projects")}>Projects & connections</Button>
              </Box>
            )}
            {view === "operator" && <OperatorPanel ref={operatorPanel} voiceId={preferences.voice} />}
            {view === "firm" && <FirmPortal onTalk={() => demoMode
              ? notify("Calls and live chat work in the live portal — this demo shows the firm's screens.")
              : navigate("operator")} />}
            {view === "fleet" && <FleetAdmin />}
            {view === "overview" && (
              <OverviewView
                projects={projects}
                system={system}
                skills={skills}
                skillsLoaded={skillsLoaded}
                operations={operations}
                project={project}
                draftKey={key}
                selected={selected}
                drafts={drafts}
                setDrafts={setDrafts}
                navigate={navigate}
                setProject={setProject}
                setConnect={setConnect}
                newConversation={() => void newConversation()}
                refreshSystem={() => void refreshSystem()}
              />
            )}
            {view === "assistant" && (
              <AssistantView
                threads={threads}
                thread={thread}
                setThread={setThread}
                newConversation={() => void newConversation()}
                historyMore={historyMore}
                historyLoading={historyLoading}
                currentMessages={currentMessages}
                messagesRef={messagesRef}
                followMessages={followMessages}
                loadHistory={loadHistory}
                project={project}
                chatKey={key}
                busyKeys={busy}
                fail={fail}
                selected={selected}
                voiceStatus={voiceStatus}
                voice={voice}
                drafts={drafts}
                setDrafts={setDrafts}
                sendChat={sendChat}
                stopChat={() => void stopChat()}
                notify={notify}
              />
            )}
            {view === "projects" && (
              <>
                <ConnectionCatalog selected={project} onSelect={setProject} />
                <ProjectView
                  project={selected}
                  readOnly={remoteCall}
                  onConnect={() => setConnect(true)}
                  onChat={() => navigate(remoteOperator ? "operator" : "assistant")}
                  onError={fail}
                  onNotice={notify}
                  onReview={(review) => {
                    setReviews((previous) => [review, ...previous]);
                    navigate("runs");
                  }}
                />
              </>
            )}
            {view === "skills" && (
              <SkillsView
                skills={skills}
                system={system}
                onRefresh={() => {
                  void refreshSkills();
                  void refreshSystem();
                }}
                onDetail={(item) => setDetail(item)}
                onUse={useSkill}
                onEnable={(name) => {
                  void startOperation("/api/skills/enable", { name });
                }}
                onSync={() => {
                  void startOperation("/api/catalog/sync", {});
                }}
                onError={fail}
              />
            )}
            {view === "automations" && (
              <AutomationsView startOperation={(path, body) => { void startOperation(path, body); }} />
            )}
            {view === "runs" && (
              <RunsView
                operations={operations}
                reviews={reviews}
                project={project}
                selectedName={selected?.name}
                refreshRuns={() => void refreshRuns()}
                setReviews={setReviews}
                setRunDetail={setRunDetail}
                navigate={navigate}
                fail={fail}
              />
            )}
            {view === "settings" && (
              <SettingsView
                preferences={preferences}
                savePreferences={(changes) => void savePreferences(changes)}
                voices={voices}
                voiceStatus={voiceStatus}
                system={system}
                refreshSystem={() => void refreshSystem()}
              />
            )}
          </Box>
        </Box>
        <CallScreen
          open={callOpen}
          project={selected?.name || "Your workspace"}
          state={voice.conversation}
          playbackPhase={voice.phase}
          playbackStatus={voice.status}
          audioVisual={voice.audioVisual}
          onHangUp={hangUp}
          onMute={(muted) => { void voice.setMuted(muted); }}
          onResumeAudio={() => { void voice.resumePlayback(); }}
          onRetry={callJarvis}
        />
        <audio ref={voice.audioRef} controls aria-label="Spoken answer"
          hidden={callOpen || !voice.playing} style={{ width: "100%" }} />
        <Snackbar
          open={Boolean(toast)}
          autoHideDuration={6000}
          onClose={() => setToast(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert severity={toast?.error ? "error" : "success"} onClose={() => setToast(null)} sx={{ width: "100%" }}>
            {toast?.text}
          </Alert>
        </Snackbar>
        {connect && (
          <ConnectModal
            onClose={() => setConnect(false)}
            onConnect={async (value) => {
              await api("/api/projects", value);
              await refreshProjects();
              setConnect(false);
              notify("Project connected.");
            }}
          />
        )}
        {detail && (
          <SkillDetailDialog
            detail={detail}
            onClose={() => setDetail(null)}
            onInstall={() => {
              void startOperation("/api/catalog/install", { id: detail.id });
              setDetail(null);
            }}
          />
        )}
        {runDetail && (
          <RunDetailDialog runDetail={runDetail} onClose={() => setRunDetail(null)} notify={notify} />
        )}
      </Box>
    </ThemeProvider>
  );
}
