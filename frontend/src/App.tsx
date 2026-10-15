import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Boxes,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  Layers3,
  LoaderCircle,
  Menu,
  MessageSquare,
  Mic,
  Monitor,
  Moon,
  Network,
  Play,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  Terminal,
  Volume2,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, boundedApi, isDemoPortal, isRemoteCall, isRemoteOperator, streamChat } from "./api";
import { useVoice } from "./useVoice";
import { CallScreen } from "./CallScreen";
import { OperatorPanel } from "./OperatorPanel";
import { FirmPortal } from "./FirmPortal";
import { FleetAdmin } from "./FleetAdmin";
import { ConnectionCatalog } from "./ConnectionCatalog";
import type { OperatorPanelHandle } from "./OperatorPanel";
import "./call.css";
import type {
  Capability,
  CatalogPage,
  History,
  InstalledSkill,
  Message,
  Operation,
  Overview,
  Preferences,
  Project,
  Review,
  SearchResult,
  SourceFile,
  System,
  Thread,
  Tree,
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
const defaults: Preferences = {
  theme: "dark",
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
const when = (value?: number) =>
  value
    ? new Date(value * 1000).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Saved earlier";
const running = (status: string) => ["queued", "running"].includes(status);
type ChatOptions = { voiceMode?: boolean; signal?: AbortSignal; onPartial?: (text: string) => void };
type SendChat = (text: string, options?: ChatOptions) => Promise<string>;

function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  type = "button",
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${primary ? "primary" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  icon: Icon = CircleHelp,
  title,
  children,
}: {
  icon?: typeof Bot;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={30} />
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
const RichText = memo(function RichText({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

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
  const [projectFilter,setProjectFilter]=useState('');
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
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);
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
      <div className="boot">
        <div className="brand-symbol">J</div>
        <h1>JARVIS</h1>
        <p>Connecting your workspace…</p>
        {toast ? (
          <p className="error-text">{toast.text}</p>
        ) : (
          <LoaderCircle className="spin" />
        )}
      </div>
    );
  return (
    <div className={`app-shell ${remoteCall ? "notebook-session" : ""}`}>
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
      <audio ref={voice.audioRef} controls className="read-aloud-player"
        hidden={callOpen || !voice.playing} aria-label="Spoken answer" />
      {menu && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a
          href="#"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-symbol">J</span>
          <span>
            JARVIS<small>Command center</small>
          </span>
          <Badge>0.5</Badge>
        </a>
        <button
          className="quick-search"
          onClick={() => {
            navigate("skills");
            setTimeout(
              () => document.getElementById("catalog-search")?.focus(),
              30,
            );
          }}
        >
          <Search size={16} />
          <span>Find a capability</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav aria-label="Main navigation">
          {visibleNav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "selected" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "skills" && system && (
                <small>{number(system.catalog.available)}</small>
              )}
              {item.id === "runs" &&
                operations.some((run) => running(run.status)) && (
                  <i className="live-dot" />
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-projects">
          <div className="sidebar-section">
            <span>Connected projects</span>
            <button
              className="icon-button"
              aria-label="Connect a project"
              onClick={() => setConnect(true)}
            >
              <Plus size={15} />
            </button>
          </div>
          <input className="sidebar-project-filter" aria-label="Filter connected projects" placeholder="Filter projects…" value={projectFilter} onChange={event=>setProjectFilter(event.target.value)}/>
          {projects.filter(item=>!projectFilter||(item.id+' '+item.name).toLowerCase().includes(projectFilter.toLowerCase())).map((item) => (
            <button
              key={item.id}
              className={`project-shortcut ${project === item.id ? "current" : ""}`}
              onClick={() => {
                setProject(item.id);
                navigate("projects");
              }}
            >
              <span className="project-avatar">{item.name.slice(0, 1)}</span>
              <span>
                {item.name}
                <small>
                  {item.roots.length} source folder
                  {item.roots.length === 1 ? "" : "s"}
                </small>
              </span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <i className="live-dot" />
            Running on your PC
          </div>
          <a href="http://localhost:18789" target="_blank" rel="noreferrer">
            OpenClaw controls <ExternalLink size={13} />
          </a>
          <a href="http://localhost:5679" target="_blank" rel="noreferrer">
            n8n workflow editor <ExternalLink size={13} />
          </a>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span>{remoteCall ? "Notebook call" : "Workspace"}</span>
            <ChevronRight size={14} />
            <label className="sr-only" htmlFor="active-project">
              Active project
            </label>
            <select
              id="active-project"
              value={project}
              onChange={(event) => setProject(event.target.value)}
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="topbar-right">
            <button
              className="call-launch"
              onClick={callJarvis}
              disabled={!voiceStatus.available || !voice.conversationSupported || (view !== "operator" && (!thread || busy.has(key) || historyLoading))}
            >
              <Phone size={18} /> Call JARVIS
            </button>
            <span className="model-chip">
              <Bot size={15} />
              {demoMode ? "Demo" : (system?.model || "Connecting assistant")}
            </span>
            <button
              className="icon-button"
              aria-label="Toggle theme"
              onClick={() =>
                void savePreferences({
                  theme: preferences.theme === "dark" ? "light" : "dark",
                })
              }
            >
              {preferences.theme === "dark" ? (
                <Sun size={18} />
              ) : (
                <Moon size={18} />
              )}
            </button>
            <span className="user-avatar">M</span>
          </div>
        </header>
        {toast && (
          <div
            className={`toast ${toast.error ? "error" : ""}`}
            role={toast.error ? "alert" : "status"}
          >
            {toast.error ? <CircleHelp size={17} /> : <Check size={17} />}
            <span>{toast.text}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <main className={`content view-${view}`}>
          {remoteOperator&&<nav className="notebook-project-nav" aria-label="Notebook workspace">
            <button className="button" onClick={()=>navigate('operator')}>JARVIS Tasks</button>
            <button className="button" onClick={()=>navigate('projects')}>Projects & connections</button>
          </nav>}
          {view === "operator" && <OperatorPanel ref={operatorPanel} voiceId={preferences.voice} />}
          {view === "firm" && <FirmPortal onTalk={() => demoMode
            ? notify("Calls and live chat work in the live portal — this demo shows the firm's screens.")
            : navigate("operator")} />}
          {view === "fleet" && <FleetAdmin />}
          {view === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="section-label">Your work, connected</p>
                  <h1>What are we building today?</h1>
                  <p>One assistant for your projects, tools, and ideas.</p>
                </div>
                <Button
                  primary
                  onClick={() => void newConversation()}
                  disabled={!project}
                >
                  <Plus size={17} />
                  New conversation
                </Button>
              </div>
              <section className="command-deck">
                <div className="command-main">
                  <div className="assistant-emblem">
                    <Bot size={34} />
                  </div>
                  <div>
                    <h2>Ready when you are.</h2>
                    <p>
                      Ask a question, explore a project, or bring a new skill
                      into your workflow.
                    </p>
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      setView("assistant");
                    }}
                  >
                    <input
                      aria-label="Start a conversation"
                      placeholder={`What would you like to do with ${selected?.name || "your project"}?`}
                      value={drafts[key] || ""}
                      onChange={(event) =>
                        setDrafts((previous) => ({
                          ...previous,
                          [key]: event.target.value,
                        }))
                      }
                    />
                    <button className="send-circle" aria-label="Open assistant">
                      <ArrowRight size={20} />
                    </button>
                  </form>
                  <div className="deck-shortcuts">
                    <button
                      onClick={() => {
                        setView("assistant");
                        setDrafts((previous) => ({
                          ...previous,
                          [key]:
                            "Explain this project’s architecture using its source files.",
                        }));
                      }}
                    >
                      <Code2 size={15} />
                      Understand my code
                    </button>
                    <button onClick={() => navigate("skills")}>
                      <Boxes size={15} />
                      Find a skill
                    </button>
                    <button onClick={() => navigate("automations")}>
                      <Workflow size={15} />
                      Run a workflow
                    </button>
                  </div>
                </div>
                <div className="system-panel">
                  <div className="panel-heading">
                    <h3>System connections</h3>
                    <button
                      className="icon-button"
                      aria-label="Refresh service health"
                      onClick={() => void refreshSystem()}
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  {system ? (
                    system.services.map((service) => (
                      <div className="service-row" key={service.name}>
                        <span>
                          <i className={`status-dot ${service.status}`} />
                          {service.name}
                        </span>
                        <small>
                          {service.status === "healthy"
                            ? "Connected"
                            : "Unavailable"}
                        </small>
                      </div>
                    ))
                  ) : (
                    <p className="muted">Checking local services…</p>
                  )}
                  <div className="system-foot">
                    <Monitor size={15} />
                    Local-first infrastructure
                  </div>
                </div>
              </section>
              <section className="stats-row">
                <div>
                  <FolderOpen size={20} />
                  <span>
                    <strong>{projects.length}</strong>
                    <small>Connected projects</small>
                  </span>
                </div>
                <div>
                  <Boxes size={20} />
                  <span>
                    <strong>
                      {system ? number(system.catalog.available) : "—"}
                    </strong>
                    <small>Discoverable skills</small>
                  </span>
                </div>
                <div>
                  <ShieldCheck size={20} />
                  <span>
                    <strong>
                      {skillsLoaded
                        ? skills.filter((item) => item.ready).length
                        : "—"}
                    </strong>
                    <small>Ready assistant skills</small>
                  </span>
                </div>
                <div>
                  <Activity size={20} />
                  <span>
                    <strong>
                      {operations.filter((item) => running(item.status)).length}
                    </strong>
                    <small>Operations in progress</small>
                  </span>
                </div>
              </section>
              <div className="section-heading">
                <div>
                  <h2>Pick up a project</h2>
                  <p>Use its real files, instructions, and tools.</p>
                </div>
                <Button onClick={() => setConnect(true)}>
                  <Plus size={16} />
                  Connect project
                </Button>
              </div>
              <div className="project-grid">
                {projects.map((item) => (
                  <button
                    key={item.id}
                    className="project-card"
                    onClick={() => {
                      setProject(item.id);
                      navigate("projects");
                    }}
                  >
                    <span className="project-avatar large">
                      {item.name.slice(0, 1)}
                    </span>
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.roots.map((root) => root.label).join(" + ")}</p>
                    </div>
                    <ArrowRight size={18} />
                  </button>
                ))}
              </div>
              <section className="library-banner">
                <div>
                  <Badge tone="blue">Extensible by design</Badge>
                  <h2>A growing library of real capabilities.</h2>
                  <p>
                    Search upstream skill definitions. Install individual
                    skills, check their requirements, and use the ones your
                    assistant is ready to run.
                  </p>
                </div>
                <Button onClick={() => navigate("skills")}>
                  Explore the library
                  <ArrowRight size={16} />
                </Button>
              </section>
            </>
          )}
          {view === "assistant" && (
            <div className="assistant-layout">
              <aside className="thread-panel">
                <div className="panel-heading">
                  <h3>Conversations</h3>
                  <button
                    className="icon-button"
                    aria-label="New conversation"
                    onClick={() => void newConversation()}
                  >
                    <Plus size={17} />
                  </button>
                </div>
                {threads.map((item) => (
                  <button
                    key={item.thread}
                    className={`thread-item ${thread === item.thread ? "active" : ""}`}
                    onClick={() => setThread(item.thread)}
                  >
                    <MessageSquare size={15} />
                    <span>
                      {item.title}
                      <small>{when(item.updated)}</small>
                    </span>
                  </button>
                ))}
                {!threads.length && (
                  <p className="muted">Connect a project to begin.</p>
                )}
              </aside>
              <section className="chat-panel">
                <div className="chat-title">
                  <div>
                    <span className="assistant-mini">
                      <Bot size={19} />
                    </span>
                    <div>
                      <h2>JARVIS</h2>
                      <p>{selected?.name} · source-aware conversation</p>
                    </div>
                  </div>
                  <div className="row">
                    <button
                      className="icon-button"
                      aria-label="Reload conversation"
                      disabled={historyLoading || !thread}
                      onClick={() =>
                        void loadHistory(project, thread).catch(fail)
                      }
                    >
                      <RefreshCw size={17} />
                    </button>
                    <Badge tone={voiceStatus.available ? "green" : "neutral"}>
                      {voiceStatus.available ? "Voice ready" : "Text mode"}
                    </Badge>
                  </div>
                </div>
                <div className="mobile-thread-picker">
                  <select
                    aria-label="Conversation"
                    value={thread}
                    onChange={(event) => setThread(event.target.value)}
                  >
                    {threads.map((item) => (
                      <option key={item.thread} value={item.thread}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-button"
                    aria-label="New mobile conversation"
                    onClick={() => void newConversation()}
                  >
                    <Plus size={18} />
                  </button>
                </div>
                <div
                  className="messages"
                  aria-live="polite"
                  ref={messagesRef}
                  onScroll={(event) => {
                    const element = event.currentTarget;
                    followMessages.current =
                      element.scrollHeight -
                        element.scrollTop -
                        element.clientHeight <
                      80;
                  }}
                >
                  {historyMore[key] !== undefined && (
                    <Button
                      onClick={() =>
                        void loadHistory(
                          project,
                          thread,
                          historyMore[key],
                        ).catch(fail)
                      }
                    >
                      <ArrowDown size={14} />
                      Load earlier messages
                    </Button>
                  )}
                  {historyLoading && (
                    <div className="loading-row">
                      <LoaderCircle className="spin" size={18} />
                      Loading conversation…
                    </div>
                  )}
                  {!historyLoading && !currentMessages.length && (
                    <Empty icon={Bot} title="Let’s get to work.">
                      <p>
                        Ask about your project, use a ready skill, or dictate a
                        message.
                      </p>
                      <div className="suggestion-grid">
                        {[
                          "What can you help me do with this project?",
                          "Find the verification commands for this project.",
                          "Summarize the current Git changes.",
                        ].map((text) => (
                          <button
                            key={text}
                            onClick={() =>
                              setDrafts((previous) => ({
                                ...previous,
                                [key]: text,
                              }))
                            }
                          >
                            {text}
                            <ArrowRight size={14} />
                          </button>
                        ))}
                      </div>
                    </Empty>
                  )}
                  {currentMessages.map((message) => (
                    <article
                      key={message.id}
                      className={`message ${message.role} ${message.error ? "failed" : ""}`}
                    >
                      <div className="message-avatar">
                        {message.role === "assistant" ? <Bot size={18} /> : "M"}
                      </div>
                      <div className="message-body">
                        <div className="message-meta">
                          <strong>
                            {message.role === "assistant" ? "JARVIS" : "You"}
                          </strong>
                          {message.streaming && (
                            <span>
                              <LoaderCircle className="spin" size={12} />
                              Working
                            </span>
                          )}
                          {message.error && (
                            <Badge tone="amber">Check run state</Badge>
                          )}
                        </div>
                        {message.text ? (
                          <RichText text={message.text} />
                        ) : (
                          <div className="thinking">
                            <span />
                            <span />
                            <span />
                            Working with your project tools…
                          </div>
                        )}
                        {message.role === "assistant" &&
                          message.text &&
                          !message.streaming && (
                            <div className="message-actions">
                              <button
                                onClick={() => {
                                  void navigator.clipboard
                                    .writeText(message.text)
                                    .then(() => notify("Answer copied."), fail);
                                }}
                              >
                                <Copy size={13} />
                                Copy
                              </button>
                              <button
                                disabled={
                                   !voiceStatus.available || voice.recording || voice.conversationActive
                                }
                                onClick={() => void voice.speak(message.text)}
                              >
                                <Volume2 size={14} />
                                Read aloud
                              </button>
                            </div>
                          )}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="composer-area">
                  <form
                    className={`composer ${voice.recording ? "listening" : ""} ${voice.conversationActive ? "conversation-composer" : ""}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendChat(drafts[key] || "").catch(fail);
                    }}
                  >
                    <textarea
                      aria-label="Message JARVIS"
                      placeholder={
                        voice.phase === "recording"
                          ? "Listening…"
                          : `Ask JARVIS about ${selected?.name || "your work"}…`
                      }
                      rows={3}
                      disabled={voice.conversationActive}
                      maxLength={12000}
                      value={drafts[key] || ""}
                      onChange={(event) =>
                        setDrafts((previous) => ({
                          ...previous,
                          [key]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          if (!voice.recording && !voice.conversationActive)
                            void sendChat(drafts[key] || "").catch(fail);
                        }
                      }}
                    />
                    <div className="composer-tools">
                      <div className="row">
                        <button
                          type="button"
                          className={`icon-button ${voice.recording ? "recording" : ""}`}
                          aria-label={
                            voice.phase === "recording"
                              ? "Stop recording"
                              : voice.recording
                                ? "Cancel dictation"
                                : "Record dictation"
                          }
                          disabled={
                             !voiceStatus.available ||
                             voice.conversationActive ||
                            !voice.supported ||
                            !thread
                          }
                          onClick={() => void voice.record()}
                        >
                          {voice.recording ? (
                            <Square size={18} />
                          ) : (
                            <Mic size={19} />
                          )}
                        </button>
                        <span className="voice-caption">{voice.conversationActive ? "Your spoken turns appear in the chat above." : voice.status}</span>
                        {voice.playing && !voice.conversationActive && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={voice.stopPlayback}
                          >
                            Stop playback
                          </button>
                        )}
                      </div>
                      {busy.has(key) ? (
                        <Button onClick={() => void stopChat()}>
                          <Square size={15} />
                          Stop
                        </Button>
                      ) : (
                        <button
                          className="send-circle"
                          type="submit"
                          aria-label="Send message"
                          disabled={
                             !thread || !drafts[key]?.trim() || voice.recording || voice.conversationActive
                          }
                        >
                          <Send size={18} />
                        </button>
                      )}
                    </div>
                  </form>
                  <div className="composer-note">
                    <span>
                      Answers use connected tools and project instructions.
                    </span>
                    <span>Enter to send · Shift Enter for a new line</span>
                  </div>
                </div>
              </section>
            </div>
          )}
          {view === "projects" && (
            <>
            <ConnectionCatalog selected={project} onSelect={setProject}/>
            <ProjectView
              project={selected}
              readOnly={remoteCall}
              onConnect={() => setConnect(true)}
              onChat={() => navigate(remoteOperator?"operator":"assistant")}
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
            <>
              <div className="page-heading">
                <div>
                  <h1>Automations</h1>
                  <p>Turn repeatable work into a reliable workflow.</p>
                </div>
                <a
                  className="button"
                  href="http://localhost:5679"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open n8n
                  <ExternalLink size={16} />
                </a>
              </div>
              <div className="workflow-feature">
                <div className="workflow-icon">
                  <Workflow size={36} />
                </div>
                <div>
                  <Badge tone="green">Connected</Badge>
                  <h2>Assistant-to-workflow demonstration</h2>
                  <p>
                    Call the authenticated n8n workflow and verify its request
                    ID. The result is explicitly marked as synthetic data.
                  </p>
                  <div className="flow-chain">
                    <span>JARVIS</span>
                    <ChevronRight size={16} />
                    <span>Authenticated webhook</span>
                    <ChevronRight size={16} />
                    <span>Verified result</span>
                  </div>
                  <Button
                    primary
                    onClick={() => {
                      void startOperation("/api/workflows/demo", {});
                    }}
                  >
                    Run connection test
                    <Play size={15} />
                  </Button>
                </div>
              </div>
              <div className="section-heading">
                <div>
                  <h2>Connect your work apps</h2>
                  <p>
                    These integrations need their own accounts and workflow
                    configuration.
                  </p>
                </div>
              </div>
              <div className="integration-grid">
                {[
                  [
                    "Email & calendar",
                    "Outlook, Gmail, meetings and daily briefings",
                  ],
                  [
                    "Project management",
                    "GitHub, task lists and project notifications",
                  ],
                  [
                    "Documents & knowledge",
                    "Source collections, notes and research workflows",
                  ],
                  [
                    "Business applications",
                    "Your application APIs and operational reports",
                  ],
                ].map(([name, description]) => (
                  <div className="integration-card" key={name}>
                    <Workflow size={22} />
                    <h3>{name}</h3>
                    <p>{description}</p>
                    <Badge tone="amber">Setup required</Badge>
                    <a
                      href="http://localhost:5679"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Configure in n8n
                      <ExternalLink size={14} />
                    </a>
                  </div>
                ))}
              </div>
            </>
          )}
          {view === "runs" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>Run history</h1>
                  <p>
                    Real operation receipts and the latest reviews for{" "}
                    {selected?.name}.
                  </p>
                </div>
                <Button
                  onClick={() => {
                    void refreshRuns();
                    if (project)
                      void api<{ jobs: Review[] }>(
                        "/api/reviews?project=" + encodeURIComponent(project),
                      ).then((result) => setReviews(result.jobs), fail);
                  }}
                >
                  <RefreshCw size={16} />
                  Refresh
                </Button>
              </div>
              <div className="run-list">
                {operations.map((item) => (
                  <button
                    key={item.id}
                    className="run-row"
                    onClick={() => setRunDetail(item)}
                  >
                    <div className={`run-icon ${item.status}`}>
                      {running(item.status) ? (
                        <LoaderCircle className="spin" size={19} />
                      ) : item.status === "completed" ? (
                        <Check size={19} />
                      ) : (
                        <Activity size={19} />
                      )}
                    </div>
                    <span className="run-name">
                      <strong>{item.title}</strong>
                      <small>
                        {when(item.created)} · {item.kind}
                      </small>
                    </span>
                    <Badge
                      tone={
                        item.status === "completed"
                          ? "green"
                          : running(item.status)
                            ? "blue"
                            : "amber"
                      }
                    >
                      {item.status}
                    </Badge>
                    <ChevronRight size={17} />
                  </button>
                ))}
                {reviews.map((item) => (
                  <button
                    key={item.id}
                    className="run-row"
                    onClick={() => setRunDetail(item)}
                  >
                    <div className="run-icon">
                      <Code2 size={19} />
                    </div>
                    <span className="run-name">
                      <strong>OpenCode review</strong>
                      <small>
                        {item.project} · {item.id.slice(0, 10)}
                      </small>
                    </span>
                    <Badge
                      tone={item.status === "completed" ? "green" : "amber"}
                    >
                      {item.status}
                    </Badge>
                    <ChevronRight size={17} />
                  </button>
                ))}
                {!operations.length && !reviews.length && (
                  <Empty icon={Activity} title="Your next run starts here.">
                    <p>
                      Run a workflow, review source, or install a skill to see
                      its result.
                    </p>
                    <Button onClick={() => navigate("automations")}>
                      Open automations
                    </Button>
                  </Empty>
                )}
              </div>
            </>
          )}
          {view === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>Settings</h1>
                  <p>Make the workspace fit the way you work.</p>
                </div>
              </div>
              <div className="settings-grid">
                <section className="panel">
                  <h2>Appearance</h2>
                  <p className="muted">Saved on this PC.</p>
                  <div className="theme-options">
                    <button
                      className={preferences.theme === "dark" ? "active" : ""}
                      onClick={() => void savePreferences({ theme: "dark" })}
                    >
                      <Moon size={22} />
                      Dark workspace
                    </button>
                    <button
                      className={preferences.theme === "light" ? "active" : ""}
                      onClick={() => void savePreferences({ theme: "light" })}
                    >
                      <Sun size={22} />
                      Light workspace
                    </button>
                  </div>
                </section>
                <section className="panel">
                  <h2>Voice preferences</h2>
                  <label className="field-label" htmlFor="reading-voice">
                    Reading voice
                  </label>
                  <select
                    id="reading-voice"
                    value={preferences.voice}
                    onChange={(event) =>
                      void savePreferences({ voice: event.target.value })
                    }
                  >
                    {Object.entries(voices).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <label className="toggle-row">
                    <span>
                      <strong>Speak new replies</strong>
                      <small>
                        Automatically read answers in the active chat.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={preferences.auto_speak}
                      onChange={(event) =>
                        void savePreferences({
                          auto_speak: event.target.checked,
                        })
                      }
                    />
                  </label>
                  <label className="toggle-row">
                    <span>
                      <strong>Send after dictation</strong>
                      <small>
                        Submit recognized speech when recording stops.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={preferences.auto_send_voice}
                      onChange={(event) =>
                        void savePreferences({
                          auto_send_voice: event.target.checked,
                        })
                      }
                    />
                  </label>
                  <Badge tone={voiceStatus.available ? "green" : "amber"}>
                    {voiceStatus.available
                      ? "Local speech models ready"
                      : "Voice unavailable"}
                  </Badge>
                </section>
                <section className="panel">
                  <h2>Assistant engine</h2>
                  <div className="engine-card">
                    <Bot size={26} />
                    <div>
                      <strong>{system?.model || "OpenClaw default"}</strong>
                      <small>Current configured model</small>
                    </div>
                  </div>
                  <p className="muted">
                    Strong source reviews use the existing OpenCode account.
                    Model/provider configuration belongs to OpenClaw.
                  </p>
                  <a
                    className="button"
                    href="http://localhost:18789"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open assistant controls
                    <ExternalLink size={15} />
                  </a>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Connections</h2>
                    <button
                      className="icon-button"
                      aria-label="Refresh connections"
                      onClick={() => void refreshSystem()}
                    >
                      <RefreshCw size={17} />
                    </button>
                  </div>
                  {system?.services.map((service) => (
                    <div className="service-row" key={service.name}>
                      <span>
                        <i className={`status-dot ${service.status}`} />
                        {service.name}
                      </span>
                      <Badge
                        tone={service.status === "healthy" ? "green" : "amber"}
                      >
                        {service.status}
                      </Badge>
                    </div>
                  ))}
                  <p className="muted">
                    Command Center {system?.version || "0.3.0"}
                  </p>
                  <a href="/classic" target="_blank" rel="noreferrer">
                    Open the earlier interface
                    <ExternalLink size={13} />
                  </a>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
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
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <div className="detail-meta">
            <Badge tone="blue">Community skill</Badge>
            <span>@{detail.owner}</span>
            <span>v{detail.version || "unknown"}</span>
          </div>
          <p className="detail-description">{detail.description}</p>
          <div className="tags">
            {detail.topics.map((topic) => (
              <Badge key={topic}>{topic}</Badge>
            ))}
          </div>
          <div className="detail-facts">
            <div>
              <small>License</small>
              <strong>{detail.license}</strong>
            </div>
            <div>
              <small>Upstream downloads</small>
              <strong>{number(detail.downloads)}</strong>
            </div>
            <div>
              <small>Availability</small>
              <strong>Catalog definition</strong>
            </div>
          </div>
          {detail.requirements.length > 0 && (
            <>
              <h3>Published setup requirements</h3>
              <ul>
                {detail.requirements.map((item) => (
                  <li key={item.key}>
                    <code>{item.key}</code>{" "}
                    {item.required ? "required" : "optional"}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted">
            Installation uses OpenClaw’s registry checks. Actual readiness is
            shown in the installed inventory after requirements and agent
            visibility are checked.
          </p>
          <div className="modal-actions">
            <a
              className="button"
              href={detail.url}
              target="_blank"
              rel="noreferrer"
            >
              View upstream source
              <ExternalLink size={15} />
            </a>
            <Button
              primary
              disabled={!detail.version}
              onClick={() => {
                void startOperation("/api/catalog/install", { id: detail.id });
                setDetail(null);
              }}
            >
              Install selected version
              <Download size={15} />
            </Button>
          </div>
        </Modal>
      )}
      {runDetail && (
        <Modal
          title={"title" in runDetail ? runDetail.title : "OpenCode review"}
          onClose={() => setRunDetail(null)}
        >
          <Badge tone={runDetail.status === "completed" ? "green" : "amber"}>
            {runDetail.status}
          </Badge>
          {"result" in runDetail ? (
            <pre className="result-json">
              {JSON.stringify(runDetail.result, null, 2)}
            </pre>
          ) : (
            <>
              <RichText
                text={
                  runDetail.answer ||
                  runDetail.error ||
                  (runDetail.errors || []).join("\n") ||
                  "The review has not returned a result yet."
                }
              />
              {runDetail.artifacts && (
                <p className="path-text">{runDetail.artifacts}</p>
              )}
            </>
          )}
          <p className="muted">Run ID: {runDetail.id}</p>
        </Modal>
      )}
    </div>
  );
}

function ConnectModal({
  onClose,
  onConnect,
}: {
  onClose: () => void;
  onConnect: (value: {
    name: string;
    roots: { path: string; label?: string }[];
  }) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [folders, setFolders] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const roots = folders
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const at = line.indexOf("=");
          return at > 0
            ? {
                label: line.slice(0, at).trim(),
                path: line.slice(at + 1).trim(),
              }
            : { path: line };
        });
      await onConnect({ name: name.trim(), roots });
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Connect a project" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <p>Connect a local folder or several repositories as one workspace.</p>
        <label>
          Project name
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My project"
          />
        </label>
        <label>
          Folders
          <textarea
            required
            rows={4}
            value={folders}
            onChange={(event) => setFolders(event.target.value)}
            placeholder={
              "backend=C:\\Projects\\my-api\nfrontend=C:\\Projects\\my-web"
            }
          />
        </label>
        <small className="muted">
          One path per line. Labels such as backend= and frontend= are optional.
        </small>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" primary disabled={busy}>
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <FolderOpen size={16} />
          )}
          Connect project
        </Button>
      </form>
    </Modal>
  );
}

function SkillsView({
  skills,
  system,
  onRefresh,
  onDetail,
  onUse,
  onEnable,
  onSync,
  onError,
}: {
  skills: InstalledSkill[];
  system: System | null;
  onRefresh: () => void;
  onDetail: (item: Capability) => void;
  onUse: (name: string) => void;
  onEnable: (name: string) => void;
  onSync: () => void;
  onError: (error: unknown) => void;
}) {
  const [mode, setMode] = useState<"catalog" | "installed" | "ready">(
    "catalog",
  );
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => { window.scrollTo(0, 0); }, [page]);
  const [data, setData] = useState<CatalogPage | null>(null),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (mode !== "catalog") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api<CatalogPage>(
        `/api/catalog?${new URLSearchParams({ q: query, category, page: String(page), limit: "24" })}`,
        undefined,
        { signal: controller.signal },
      )
        .then(setData, onError)
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mode, query, category, page, onError]);
  const visible = skills.filter(
    (item) =>
      (mode !== "ready" || item.ready) &&
      `${item.name} ${item.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Skills library</h1>
          <p>Find the right capability. Connect what you need.</p>
        </div>
        <Button onClick={onSync}>
          <RefreshCw size={16} />
          Expand catalog
        </Button>
      </div>
      <div className="library-summary">
        <div>
          <Boxes size={26} />
          <span>
            <strong>
              {number(system?.catalog.available || data?.total || 0)}
            </strong>
            <small>Real upstream definitions indexed</small>
          </span>
        </div>
        <p>
          Catalog availability and installed readiness are different states.
          Requirements are checked against your running assistant.
        </p>
      </div>
      <div className="library-tabs">
        <button
          className={mode === "catalog" ? "active" : ""}
          onClick={() => {
            setMode("catalog");
            setPage(0);
          }}
        >
          Discover
        </button>
        <button
          className={mode === "installed" ? "active" : ""}
          onClick={() => setMode("installed")}
        >
          Installed <span>{skills.length}</span>
        </button>
        <button
          className={mode === "ready" ? "active" : ""}
          onClick={() => setMode("ready")}
        >
          Ready <span>{skills.filter((item) => item.ready).length}</span>
        </button>
        <button className="refresh-inventory" onClick={onRefresh}>
          <RefreshCw size={14} />
          Refresh inventory
        </button>
      </div>
      <div className="catalog-toolbar">
        <div className="search-field">
          <Search size={18} />
          <input
            id="catalog-search"
            aria-label="Search skills"
            placeholder="Search coding, email, research, design…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
          {query && (
            <button
              aria-label="Clear search"
              className="icon-button"
              onClick={() => {
                setQuery("");
                setPage(0);
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
        {mode === "catalog" && (
          <select
            aria-label="Skill category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All topics</option>
            {[
              "coding",
              "automation",
              "research",
              "design",
              "productivity",
              "github",
              "calendar",
              "email",
              "data",
              "health",
            ].map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </select>
        )}
      </div>
      {mode === "catalog" ? (
        <>
          <div className="catalog-count">
            <span>
              {loading
                ? "Searching…"
                : `${number(data?.total || 0)} matching definitions`}
            </span>
            <span>ClawHub registry · paginated locally</span>
          </div>
          <div className="skill-grid">
            {data?.items.map((item) => (
              <article className="skill-card" key={item.id}>
                <div className="skill-card-head">
                  <span className="skill-icon">
                    <Boxes size={20} />
                  </span>
                  <Badge tone="blue">Available</Badge>
                </div>
                <h3>{item.name}</h3>
                <small className="publisher">@{item.owner}</small>
                <p>
                  {item.description ||
                    "Open the upstream definition for this capability."}
                </p>
                <div className="tags">
                  {item.topics.slice(0, 2).map((topic) => (
                    <Badge key={topic}>{topic}</Badge>
                  ))}
                </div>
                <div className="skill-card-foot">
                  <span>
                    <Download size={13} />
                    {number(item.downloads)}
                  </span>
                  <button onClick={() => onDetail(item)}>
                    View skill
                    <ArrowRight size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!loading && !data?.items.length && (
            <Empty icon={Search} title="No matching skills">
              <p>Try a broader search or expand the catalog.</p>
            </Empty>
          )}
          <div className="pagination">
            <Button
              disabled={page === 0 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              <ArrowLeft size={15} />
              Previous
            </Button>
            <span>
              Page {page + 1}
              {data
                ? ` of ${Math.max(1, Math.ceil(data.total / data.limit))}`
                : ""}
            </span>
            <Button
              disabled={!data?.has_more || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
              <ArrowRight size={15} />
            </Button>
          </div>
        </>
      ) : (
        <div className="skill-grid">
          {visible.map((item) => {
            const missing = Object.entries(item.missing || {}).flatMap(
              ([kind, values]) => values.map((value) => `${kind}: ${value}`),
            );
            return (
              <article className="skill-card" key={item.name}>
                <div className="skill-card-head">
                  <span className="skill-icon">
                    <ShieldCheck size={20} />
                  </span>
                  <Badge tone={item.ready ? "green" : "amber"}>
                    {item.ready
                      ? "Ready"
                      : missing.length
                        ? "Setup required"
                        : "Not enabled"}
                  </Badge>
                </div>
                <h3>{item.name}</h3>
                <small className="publisher">
                  {item.source.replace("openclaw-", "")}
                </small>
                <p>{item.description}</p>
                {missing.length > 0 && (
                  <div className="requirements">
                    {missing.slice(0, 4).join(" · ")}
                  </div>
                )}
                <div className="skill-card-foot">
                  <span>
                    {item.modelVisible
                      ? "Visible to assistant"
                      : "Agent visibility off"}
                  </span>
                  {item.ready ? (
                    <button onClick={() => onUse(item.name)}>
                      Use in chat
                      <ArrowRight size={14} />
                    </button>
                  ) : (
                    <button
                      disabled={missing.length > 0}
                      onClick={() => onEnable(item.name)}
                    >
                      Enable
                      <Zap size={14} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function ProjectView({
  project,
  readOnly=false,
  onConnect,
  onChat,
  onError,
  onNotice,
  onReview,
}: {
  project: Project | undefined;
  readOnly?:boolean;
  onConnect: () => void;
  onChat: () => void;
  onError: (error: unknown) => void;
  onNotice: (message: string, error?: boolean) => void;
  onReview: (review: Review) => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null),
    [root, setRoot] = useState(""),
    [folder, setFolder] = useState(""),
    [tree, setTree] = useState<Tree | null>(null),
    [file, setFile] = useState<SourceFile | null>(null),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState<SearchResult | null>(null);
  const [tab, setTab] = useState<"overview" | "source" | "review">("overview"),
    [reviewFiles, setReviewFiles] = useState(""),
    [reviewTask, setReviewTask] = useState(""),
    [reviewMode, setReviewMode] = useState("review"),
    [reviewBusy, setReviewBusy] = useState(false);
  const epoch = useRef(0);
  const projectEpoch = useRef(0);
  const sequence = useRef(0);
  useEffect(() => {
    epoch.current++;
    const current = ++projectEpoch.current;
    setRoot(project?.roots[0]?.id || "");
    setFolder("");
    setFile(null);
    setTree(null);
    setSearch(null);
    setOverview(null);
    setTab("overview");
    setReviewFiles("");
    setReviewTask("");
    if (!project) return;
    api<Overview>("/api/tool", {
      action: "overview",
      project: project.id,
    }).then((value) => {
      if (projectEpoch.current === current) setOverview(value);
    }, onError);
  }, [project?.id, onError]);
  useEffect(() => {
    if (!project || !root || tab !== "source") return;
    const current = epoch.current;
    const controller = new AbortController();
    setTree(null);
    api<Tree>(
      "/api/tool",
      { action: "tree", project: project.id, root, path: folder },
      { signal: controller.signal },
    ).then((value) => {
      if (epoch.current === current) setTree(value);
    }, onError);
    return () => controller.abort();
  }, [project, root, folder, tab, onError]);
  async function read(path: string, start = 1) {
    if (!project) return;
    const current = epoch.current,
      n = ++sequence.current;
    try {
      const result = await api<SourceFile>("/api/tool", {
        action: "read",
        project: project.id,
        root,
        path,
        start,
        limit: 160,
      });
      if (epoch.current === current && sequence.current === n) setFile(result);
    } catch (error) {
      onError(error);
    }
  }
  async function searchSource(event: FormEvent) {
    event.preventDefault();
    if (!project) return;
    const current = epoch.current;
    try {
      const result = await api<SearchResult>("/api/tool", {
        action: "search",
        project: project.id,
        root,
        query,
      });
      if (epoch.current === current) setSearch(result);
    } catch (error) {
      onError(error);
    }
  }
  if (!project)
    return (
      <Empty icon={FolderOpen} title="Connect your first project">
        <p>Give JARVIS a source folder to work with.</p>
        {!readOnly&&<Button primary onClick={onConnect}>
          Connect project
        </Button>}
      </Empty>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{project.name}</h1>
          <p>
            Connected source, live repository context, and focused coding tools.
          </p>
        </div>
        <div className="row">
          {!readOnly&&<Button onClick={onConnect}>
            <Plus size={16} />
            Connect another
          </Button>}
          <Button primary onClick={onChat}>
            <MessageSquare size={16} />
            Ask about this project
          </Button>
        </div>
      </div>
      <div className="project-toolbar">
        <label htmlFor="source-root">Source folder</label>
        <select
          id="source-root"
          value={root}
          onChange={(event) => {
            epoch.current++;
            setRoot(event.target.value);
            setFolder("");
            setFile(null);
            setSearch(null);
            setTree(null);
            setReviewFiles("");
          }}
        >
          {project.roots.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {!readOnly&&<Button
          onClick={() => {
            void api<{ folder: string }>("/api/coding/open", {
              project: project.id,
              root,
            }).then(
              (result) => onNotice("Opened OpenCode in " + result.folder),
              onError,
            );
          }}
        >
          <Terminal size={16} />
          Open coding session
        </Button>}
      </div>
      <div className="library-tabs">
        <button
          className={tab === "overview" ? "active" : ""}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          className={tab === "source" ? "active" : ""}
          onClick={() => setTab("source")}
        >
          Source explorer
        </button>
        {!readOnly&&<button
          className={tab === "review" ? "active" : ""}
          onClick={() => setTab("review")}
        >
          Strong review
        </button>}
      </div>
      {tab === "overview" && (
        <div className="root-grid">
          {overview ? (
            overview.roots.map((item) => (
              <article className="panel root-panel" key={item.id}>
                <div className="panel-heading">
                  <h2>
                    <Folder size={20} />
                    {item.label}
                  </h2>
                  <Badge tone={item.available ? "green" : "amber"}>
                    {item.available ? "Connected" : "Unavailable"}
                  </Badge>
                </div>
                <p className="path-text">{item.path}</p>
                {item.available ? (
                  <>
                    <div className="tags">
                      {item.stack?.map((value) => (
                        <Badge key={value} tone="blue">
                          {value}
                        </Badge>
                      ))}
                    </div>
                    <div className="root-stats">
                      <div>
                        <strong>{number(item.source_files || 0)}</strong>
                        <small>
                          Source files{item.index_truncated ? " (bounded)" : ""}
                        </small>
                      </div>
                      <div>
                        <strong>{item.git?.change_count || 0}</strong>
                        <small>Changed source paths</small>
                      </div>
                    </div>
                    <p className="branch">
                      <GitBranch size={16} />
                      {item.git?.branch || "Local folder"}
                      {item.git?.head && <code>{item.git.head}</code>}
                    </p>
                    {item.git?.changes.slice(0, 6).map((change) => (
                      <div className="change" key={change.path}>
                        <code>{change.status}</code>
                        <span>{change.path}</span>
                      </div>
                    ))}
                    {item.instructions?.map((instruction) => (
                      <details className="instruction" key={instruction.path}>
                        <summary>
                          <BookOpen size={14} />
                          {instruction.path}
                        </summary>
                        <pre>{instruction.content}</pre>
                        {instruction.truncated && (
                          <small>
                            Preview is truncated. Read the source file for more.
                          </small>
                        )}
                      </details>
                    ))}
                  </>
                ) : (
                  <p className="error-text">{item.error}</p>
                )}
              </article>
            ))
          ) : (
            <div className="loading-row">
              <LoaderCircle className="spin" size={19} />
              Reading project context…
            </div>
          )}
        </div>
      )}
      {tab === "source" && (
        <>
          <form className="source-search" onSubmit={searchSource}>
            <div className="search-field">
              <Search size={17} />
              <input
                aria-label="Search project source"
                value={query}
                minLength={2}
                maxLength={200}
                required
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search filenames or code…"
              />
            </div>
            <Button type="submit" primary>
              Search source
            </Button>
          </form>
          <div className="source-layout">
            <div className="file-tree">
              <div className="file-tree-head">
                <button
                  className="icon-button"
                  aria-label="Parent folder"
                  onClick={() =>
                    setFolder((value) =>
                      value.split("/").slice(0, -1).join("/"),
                    )
                  }
                >
                  <ArrowLeft size={15} />
                </button>
                <span>/{folder}</span>
              </div>
              {tree ? (
                tree.entries.map((entry) => (
                  <button
                    className="file-entry"
                    key={entry.path}
                    onClick={() =>
                      entry.kind === "folder"
                        ? setFolder(entry.path)
                        : void read(entry.path)
                    }
                  >
                    {entry.kind === "folder" ? (
                      <Folder size={15} />
                    ) : (
                      <FileCode2 size={15} />
                    )}
                    <span>{entry.name}</span>
                  </button>
                ))
              ) : (
                <div className="loading-row">
                  <LoaderCircle className="spin" size={17} />
                  Loading…
                </div>
              )}
            </div>
            <section className="source-code">
              <div className="file-tree-head">
                <span>{file?.source || "Select a source file"}</span>
                {file && (
                  <div className="row">
                    <button
                      className="icon-button"
                      aria-label="Previous source page"
                      disabled={file.start <= 1}
                      onClick={() =>
                        void read(file.path, Math.max(1, file.start - 160))
                      }
                    >
                      <ArrowLeft size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Next source page"
                      disabled={file.start + 160 > file.total_lines}
                      onClick={() => void read(file.path, file.start + 160)}
                    >
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </div>
              <pre>
                {file?.content ||
                  "Choose a file to read its current source with line numbers."}
              </pre>
            </section>
          </div>
          {search && (
            <section className="panel search-results">
              <h3>
                {search.hits.length} results
                {search.truncated ? " · bounded search" : ""}
              </h3>
              {search.hits.map((hit, index) => (
                <button
                  key={index}
                  onClick={() =>
                    void read(hit.path, Math.max(1, hit.line - 10))
                  }
                >
                  <strong>
                    {hit.path}:{hit.line}
                  </strong>
                  <span>{hit.preview}</span>
                </button>
              ))}
            </section>
          )}
        </>
      )}
      {tab === "review" && (
        <form
          className="panel review-form"
          onSubmit={(event) => {
            event.preventDefault();
            setReviewBusy(true);
            void api<Review>("/api/reviews", {
              project: project.id,
              root,
              mode: reviewMode,
              task: reviewTask,
              files: reviewFiles
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
            })
              .then(onReview, onError)
              .finally(() => setReviewBusy(false));
          }}
        >
          <div className="section-heading">
            <div>
              <h2>A stronger second look</h2>
              <p>
                Use the existing OpenCode account for a bounded review or patch
                proposal.
              </p>
            </div>
            <Code2 size={28} />
          </div>
          <label className="field-label" htmlFor="review-mode">
            Task type
          </label>
          <select
            id="review-mode"
            value={reviewMode}
            onChange={(event) => setReviewMode(event.target.value)}
          >
            <option value="review">Review and investigate</option>
            <option value="patch">Propose a patch</option>
          </select>
          <label className="field-label" htmlFor="review-files">
            One to four relative source paths
          </label>
          <textarea
            id="review-files"
            required
            rows={3}
            value={reviewFiles}
            onChange={(event) => setReviewFiles(event.target.value)}
            placeholder={"package.json\nsrc/example.ts"}
          />
          <label className="field-label" htmlFor="review-task">
            Requested outcome
          </label>
          <textarea
            id="review-task"
            required
            minLength={5}
            maxLength={8000}
            rows={4}
            value={reviewTask}
            onChange={(event) => setReviewTask(event.target.value)}
            placeholder="What should the coding model investigate or propose?"
          />
          <p className="muted">
            Applicable instructions accompany the selected snapshots. A returned
            proposal is not an applied change. The run record preserves the
            actual outcome.
          </p>
          <Button primary type="submit" disabled={reviewBusy}>
            {reviewBusy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Play size={16} />
            )}
            Run focused review
          </Button>
        </form>
      )}
    </>
  );
}
