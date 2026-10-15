import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  MessageSquare,
  Mic,
  Monitor,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Square,
  Sun,
  Terminal,
  Volume2,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { api } from "./api";
import { EmptyState, RichText, StatCard } from "./components";
import type {
  Capability,
  CatalogPage,
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
import type { useVoice } from "./useVoice";

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
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed.";

type Voice = ReturnType<typeof useVoice>;
type ChatOptions = { voiceMode?: boolean; signal?: AbortSignal; onPartial?: (text: string) => void };

export function OverviewView({ projects, system, skills, skillsLoaded, operations, project, draftKey, selected, drafts, setDrafts, navigate, setProject, setConnect, newConversation, refreshSystem }: {
  projects: Project[];
  system: System | null;
  skills: InstalledSkill[];
  skillsLoaded: boolean;
  operations: Operation[];
  project: string;
  draftKey: string;
  selected: Project | undefined;
  drafts: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  navigate: (next: View) => void;
  setProject: (id: string) => void;
  setConnect: (value: boolean) => void;
  newConversation: () => void;
  refreshSystem: () => void;
}) {
  return (
    <>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2.5 }}>
        <Box>
          <Typography variant="caption" color="primary" sx={{ fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>
            Your work, connected
          </Typography>
          <Typography variant="h1">What are we building today?</Typography>
          <Typography variant="body2" color="text.secondary">One assistant for your projects, tools, and ideas.</Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={17} />} onClick={newConversation} disabled={!project}>
          New conversation
        </Button>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.6fr) minmax(0, 1fr)" }, gap: 2 }}>
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
              <Avatar sx={{ width: 56, height: 56, bgcolor: "primary.main", color: "primary.contrastText" }}>
                <Bot size={34} />
              </Avatar>
              <Box>
                <Typography variant="h4">Ready when you are.</Typography>
                <Typography variant="body2" color="text.secondary">
                  Ask a question, explore a project, or bring a new skill into your workflow.
                </Typography>
              </Box>
            </Box>
            <Box component="form" sx={{ display: "flex", gap: 1, mt: 2 }} onSubmit={(event) => {
              event.preventDefault();
              navigate("assistant");
            }}>
              <TextField
                aria-label="Start a conversation"
                placeholder={`What would you like to do with ${selected?.name || "your project"}?`}
                value={drafts[draftKey] || ""}
                onChange={(event) =>
                  setDrafts((previous) => ({
                    ...previous,
                    [draftKey]: event.target.value,
                  }))
                }
              />
              <Fab color="primary" size="medium" type="submit" aria-label="Open assistant" sx={{ flexShrink: 0 }}>
                <ArrowRight size={20} />
              </Fab>
            </Box>
            <Box sx={{ display: "flex", gap: 1, mt: 2, flexWrap: "wrap" }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Code2 size={15} />}
                onClick={() => {
                  navigate("assistant");
                  setDrafts((previous) => ({
                    ...previous,
                    [draftKey]: "Explain this project’s architecture using its source files.",
                  }));
                }}
              >
                Understand my code
              </Button>
              <Button variant="outlined" size="small" startIcon={<Boxes size={15} />} onClick={() => navigate("skills")}>
                Find a skill
              </Button>
              <Button variant="outlined" size="small" startIcon={<Workflow size={15} />} onClick={() => navigate("automations")}>
                Run a workflow
              </Button>
            </Box>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
              <Typography variant="h6">System connections</Typography>
              <IconButton size="small" aria-label="Refresh service health" onClick={refreshSystem}>
                <RefreshCw size={16} />
              </IconButton>
            </Box>
            {system ? (
              <List dense disablePadding>
                {system.services.map((service) => (
                  <ListItem key={service.name} disableGutters sx={{ py: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", mr: 1.5, bgcolor: service.status === "healthy" ? "success.main" : "warning.main" }} />
                    <ListItemText primary={service.name} />
                    <Typography variant="caption" color="text.secondary">
                      {service.status === "healthy" ? "Connected" : "Unavailable"}
                    </Typography>
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary">Checking local services…</Typography>
            )}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2 }}>
              <Monitor size={15} />
              <Typography variant="body2" color="text.secondary">Local-first infrastructure</Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "1fr 1fr 1fr 1fr" }, gap: 2, mt: 2 }}>
        <StatCard label="Connected projects" value={projects.length} />
        <StatCard label="Discoverable skills" value={system ? number(system.catalog.available) : "—"} />
        <StatCard label="Ready assistant skills" value={skillsLoaded ? skills.filter((item) => item.ready).length : "—"} />
        <StatCard label="Operations in progress" value={operations.filter((item) => running(item.status)).length} />
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mt: 3, mb: 2 }}>
        <Box>
          <Typography variant="h4">Pick up a project</Typography>
          <Typography variant="body2" color="text.secondary">Use its real files, instructions, and tools.</Typography>
        </Box>
        <Button variant="outlined" startIcon={<Plus size={16} />} onClick={() => setConnect(true)}>
          Connect project
        </Button>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
        {projects.map((item) => (
          <Card variant="outlined" key={item.id}>
            <CardActionArea
              sx={{ p: 2, display: "flex", alignItems: "center", gap: 2 }}
              onClick={() => {
                setProject(item.id);
                navigate("projects");
              }}
            >
              <Avatar>{item.name.slice(0, 1)}</Avatar>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{item.name}</Typography>
                <Typography variant="body2" color="text.secondary">{item.roots.map((root) => root.label).join(" + ")}</Typography>
              </Box>
              <ArrowRight size={18} />
            </CardActionArea>
          </Card>
        ))}
      </Box>
      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Box sx={{ maxWidth: 560 }}>
            <Chip size="small" color="info" label="Extensible by design" sx={{ mb: 1 }} />
            <Typography variant="h4">A growing library of real capabilities.</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Search upstream skill definitions. Install individual skills, check their requirements, and use the ones your assistant is ready to run.
            </Typography>
          </Box>
          <Button variant="contained" endIcon={<ArrowRight size={16} />} onClick={() => navigate("skills")}>
            Explore the library
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

export function AssistantView({ threads, thread, setThread, newConversation, historyMore, historyLoading, currentMessages, messagesRef, followMessages, loadHistory, project, chatKey, busyKeys, fail, selected, voiceStatus, voice, drafts, setDrafts, sendChat, stopChat, notify }: {
  threads: Thread[];
  thread: string;
  setThread: (value: string) => void;
  newConversation: () => void;
  historyMore: Record<string, number | undefined>;
  historyLoading: boolean;
  currentMessages: Message[];
  messagesRef: React.RefObject<HTMLDivElement | null>;
  followMessages: React.MutableRefObject<boolean>;
  loadHistory: (p: string, t: string, older?: number) => Promise<unknown>;
  project: string;
  chatKey: string;
  busyKeys: Set<string>;
  fail: (error: unknown) => void;
  selected: Project | undefined;
  voiceStatus: VoiceStatus;
  voice: Voice;
  drafts: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  sendChat: (text: string, options?: ChatOptions) => Promise<string>;
  stopChat: () => void;
  notify: (text: string, error?: boolean) => void;
}) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "280px minmax(0, 1fr)" }, gap: 2, alignItems: "start" }}>
      <Card variant="outlined" sx={{ display: { xs: "none", md: "block" } }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
            <Typography variant="h6">Conversations</Typography>
            <IconButton size="small" aria-label="New conversation" onClick={newConversation}>
              <Plus size={17} />
            </IconButton>
          </Box>
          <List dense disablePadding>
            {threads.map((item) => (
              <ListItemButton key={item.thread} selected={thread === item.thread} onClick={() => setThread(item.thread)} sx={{ borderRadius: 2 }}>
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <MessageSquare size={15} />
                </ListItemIcon>
                <ListItemText primary={item.title} secondary={when(item.updated)} />
              </ListItemButton>
            ))}
          </List>
          {!threads.length && (
            <Typography variant="body2" color="text.secondary">Connect a project to begin.</Typography>
          )}
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1, mb: 1.5 }}>
            <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
              <Avatar sx={{ bgcolor: "primary.main", color: "primary.contrastText" }}>
                <Bot size={19} />
              </Avatar>
              <Box>
                <Typography variant="h6">JARVIS</Typography>
                <Typography variant="body2" color="text.secondary">{selected?.name} · source-aware conversation</Typography>
              </Box>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <IconButton
                size="small"
                aria-label="Reload conversation"
                disabled={historyLoading || !thread}
                onClick={() => void loadHistory(project, thread).catch(fail)}
              >
                <RefreshCw size={17} />
              </IconButton>
              <Chip size="small" color={voiceStatus.available ? "success" : "default"} label={voiceStatus.available ? "Voice ready" : "Text mode"} />
            </Box>
          </Box>
          <Box sx={{ display: { xs: "flex", md: "none" }, gap: 1, mb: 1.5 }}>
            <FormControl sx={{ flexGrow: 1 }}>
              <InputLabel id="thread-picker-label">Conversation</InputLabel>
              <Select
                labelId="thread-picker-label"
                label="Conversation"
                value={thread}
                onChange={(event) => setThread(String(event.target.value))}
              >
                {threads.map((item) => (
                  <MenuItem key={item.thread} value={item.thread}>
                    {item.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <IconButton aria-label="New mobile conversation" onClick={newConversation} sx={{ border: 1, borderColor: "divider" }}>
              <Plus size={18} />
            </IconButton>
          </Box>
          <Box
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
            sx={{ maxHeight: { xs: 380, md: 480 }, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, py: 1 }}
          >
            {historyMore[chatKey] !== undefined && (
              <Button
                size="small"
                startIcon={<ArrowDown size={14} />}
                onClick={() =>
                  void loadHistory(
                    project,
                    thread,
                    historyMore[chatKey],
                  ).catch(fail)
                }
              >
                Load earlier messages
              </Button>
            )}
            {historyLoading && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CircularProgress size={18} />
                <Typography variant="body2">Loading conversation…</Typography>
              </Box>
            )}
            {!historyLoading && !currentMessages.length && (
              <EmptyState title="Let’s get to work.">
                <Typography variant="body2" color="text.secondary">
                  Ask about your project, use a ready skill, or dictate a message.
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 2 }}>
                  {[
                    "What can you help me do with this project?",
                    "Find the verification commands for this project.",
                    "Summarize the current Git changes.",
                  ].map((text) => (
                    <Button
                      key={text}
                      variant="outlined"
                      size="small"
                      endIcon={<ArrowRight size={14} />}
                      onClick={() =>
                        setDrafts((previous) => ({
                          ...previous,
                          [chatKey]: text,
                        }))
                      }
                    >
                      {text}
                    </Button>
                  ))}
                </Box>
              </EmptyState>
            )}
            {currentMessages.map((message) => (
              <Box key={message.id} sx={{ display: "flex", gap: 1.5 }}>
                <Avatar sx={{ width: 32, height: 32, bgcolor: message.role === "assistant" ? "primary.main" : "secondary.main", fontSize: "0.85rem" }}>
                  {message.role === "assistant" ? <Bot size={18} /> : "M"}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="subtitle2">
                      {message.role === "assistant" ? "JARVIS" : "You"}
                    </Typography>
                    {message.streaming && (
                      <Chip size="small" icon={<CircularProgress size={12} />} label="Working" variant="outlined" />
                    )}
                    {message.error && (
                      <Chip size="small" color="warning" label="Check run state" />
                    )}
                  </Box>
                  {message.text ? (
                    <RichText text={message.text} />
                  ) : (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
                      <CircularProgress size={14} />
                      <Typography variant="body2" color="text.secondary">Working with your project tools…</Typography>
                    </Box>
                  )}
                  {message.role === "assistant" &&
                    message.text &&
                    !message.streaming && (
                      <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                        <Button
                          size="small"
                          startIcon={<Copy size={13} />}
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(message.text)
                              .then(() => notify("Answer copied."), fail);
                          }}
                        >
                          Copy
                        </Button>
                        <Button
                          size="small"
                          startIcon={<Volume2 size={14} />}
                          disabled={
                            !voiceStatus.available || voice.recording || voice.conversationActive
                          }
                          onClick={() => void voice.speak(message.text)}
                        >
                          Read aloud
                        </Button>
                      </Box>
                    )}
                </Box>
              </Box>
            ))}
          </Box>
          <Paper variant="outlined" sx={{ p: 1.5, mt: 1.5 }} component="form" onSubmit={(event) => {
            event.preventDefault();
            void sendChat(drafts[chatKey] || "").catch(fail);
          }}>
            <TextField
              aria-label="Message JARVIS"
              placeholder={
                voice.phase === "recording"
                  ? "Listening…"
                  : `Ask JARVIS about ${selected?.name || "your work"}…`
              }
              multiline
              rows={3}
              disabled={voice.conversationActive}
              slotProps={{ htmlInput: { maxLength: 12000 } }}
              value={drafts[chatKey] || ""}
              onChange={(event) =>
                setDrafts((previous) => ({
                  ...previous,
                  [chatKey]: event.target.value,
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!voice.recording && !voice.conversationActive)
                    void sendChat(drafts[chatKey] || "").catch(fail);
                }
              }}
            />
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1, flexWrap: "wrap" }}>
              <IconButton
                type="button"
                color={voice.recording ? "error" : "default"}
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
                {voice.recording ? <Square size={18} /> : <Mic size={19} />}
              </IconButton>
              <Typography variant="caption" color="text.secondary">
                {voice.conversationActive ? "Your spoken turns appear in the chat above." : voice.status}
              </Typography>
              {voice.playing && !voice.conversationActive && (
                <Button size="small" onClick={voice.stopPlayback}>
                  Stop playback
                </Button>
              )}
              <Box sx={{ flexGrow: 1 }} />
              {chatKey && (busyKeys.has(chatKey) ? (
                <Button variant="outlined" size="small" startIcon={<Square size={15} />} onClick={stopChat}>
                  Stop
                </Button>
              ) : (
                <Fab
                  color="primary"
                  size="small"
                  type="submit"
                  aria-label="Send message"
                  disabled={
                    !thread || !drafts[chatKey]?.trim() || voice.recording || voice.conversationActive
                  }
                >
                  <Send size={18} />
                </Fab>
              ))}
            </Box>
          </Paper>
          <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, mt: 1, flexWrap: "wrap" }}>
            <Typography variant="caption" color="text.secondary">
              Answers use connected tools and project instructions.
            </Typography>
            <Typography variant="caption" color="text.secondary">Enter to send · Shift Enter for a new line</Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

export function ProjectView({ project, readOnly = false, onConnect, onChat, onError, onNotice, onReview }: {
  project: Project | undefined;
  readOnly?: boolean;
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
      <EmptyState title="Connect your first project">
        <Typography variant="body2" color="text.secondary">Give JARVIS a source folder to work with.</Typography>
        {!readOnly && <Button variant="contained" sx={{ mt: 2 }} onClick={onConnect}>
          Connect project
        </Button>}
      </EmptyState>
    );
  return (
    <>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2.5 }}>
        <Box>
          <Typography variant="h1">{project.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            Connected source, live repository context, and focused coding tools.
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {!readOnly && <Button variant="outlined" startIcon={<Plus size={16} />} onClick={onConnect}>
            Connect another
          </Button>}
          <Button variant="contained" startIcon={<MessageSquare size={16} />} onClick={onChat}>
            Ask about this project
          </Button>
        </Box>
      </Box>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ display: "flex", gap: 1.5, alignItems: "flex-end", flexWrap: "wrap" }}>
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel id="source-root-label">Source folder</InputLabel>
            <Select
              labelId="source-root-label"
              id="source-root"
              label="Source folder"
              value={root}
              onChange={(event) => {
                epoch.current++;
                setRoot(String(event.target.value));
                setFolder("");
                setFile(null);
                setSearch(null);
                setTree(null);
                setReviewFiles("");
              }}
            >
              {project.roots.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {!readOnly && <Button
            variant="outlined"
            startIcon={<Terminal size={16} />}
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
            Open coding session
          </Button>}
        </CardContent>
      </Card>
      <Tabs value={tab} onChange={(_, value: "overview" | "source" | "review") => setTab(value)} sx={{ mb: 2 }}>
        <Tab value="overview" label="Overview" />
        <Tab value="source" label="Source explorer" />
        {!readOnly && <Tab value="review" label="Strong review" />}
      </Tabs>
      {tab === "overview" && (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
          {overview ? (
            overview.roots.map((item) => (
              <Card variant="outlined" key={item.id}>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
                    <Typography variant="h6" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Folder size={20} />
                      {item.label}
                    </Typography>
                    <Chip size="small" color={item.available ? "success" : "warning"} label={item.available ? "Connected" : "Unavailable"} />
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace", fontSize: "0.75rem", wordBreak: "break-all" }}>{item.path}</Typography>
                  {item.available ? (
                    <>
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1 }}>
                        {item.stack?.map((value) => (
                          <Chip key={value} size="small" color="info" label={value} />
                        ))}
                      </Box>
                      <Box sx={{ display: "flex", gap: 3, mt: 1.5 }}>
                        <Box>
                          <Typography variant="h6">{number(item.source_files || 0)}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            Source files{item.index_truncated ? " (bounded)" : ""}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="h6">{item.git?.change_count || 0}</Typography>
                          <Typography variant="caption" color="text.secondary">Changed source paths</Typography>
                        </Box>
                      </Box>
                      <Typography variant="body2" sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
                        <GitBranch size={16} />
                        {item.git?.branch || "Local folder"}
                        {item.git?.head && <Typography component="code" variant="caption" sx={{ fontFamily: "monospace" }}>{item.git.head}</Typography>}
                      </Typography>
                      {item.git?.changes.slice(0, 6).map((change) => (
                        <Box key={change.path} sx={{ display: "flex", gap: 1, mt: 0.5 }}>
                          <Typography component="code" variant="caption" sx={{ fontFamily: "monospace" }}>{change.status}</Typography>
                          <Typography variant="body2">{change.path}</Typography>
                        </Box>
                      ))}
                      {item.instructions?.map((instruction) => (
                        <Accordion key={instruction.path} variant="outlined" sx={{ mt: 1 }}>
                          <AccordionSummary expandIcon={<ChevronDown size={14} />}>
                            <Typography variant="body2" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <BookOpen size={14} />
                              {instruction.path}
                            </Typography>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Box component="pre" sx={{ m: 0, fontSize: "0.75rem", overflowX: "auto" }}>{instruction.content}</Box>
                            {instruction.truncated && (
                              <Typography variant="caption" color="text.secondary">
                                Preview is truncated. Read the source file for more.
                              </Typography>
                            )}
                          </AccordionDetails>
                        </Accordion>
                      ))}
                    </>
                  ) : (
                    <Alert severity="error" sx={{ mt: 1 }}>{item.error}</Alert>
                  )}
                </CardContent>
              </Card>
            ))
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CircularProgress size={19} />
              <Typography variant="body2">Reading project context…</Typography>
            </Box>
          )}
        </Box>
      )}
      {tab === "source" && (
        <>
          <Box component="form" sx={{ display: "flex", gap: 1, mb: 2 }} onSubmit={searchSource}>
            <TextField
              aria-label="Search project source"
              value={query}
              slotProps={{ htmlInput: { minLength: 2, maxLength: 200 }, input: { startAdornment: <Search size={17} style={{ marginRight: 8, color: "#64748b" }} /> } }}
              required
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search filenames or code..."
            />
            <Button type="submit" variant="contained" sx={{ flexShrink: 0 }}>
              Search source
            </Button>
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(220px, 300px) minmax(0, 1fr)" }, gap: 2, alignItems: "start" }}>
            <Card variant="outlined">
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                  <IconButton
                    size="small"
                    aria-label="Parent folder"
                    onClick={() =>
                      setFolder((value) =>
                        value.split("/").slice(0, -1).join("/"),
                      )
                    }
                  >
                    <ArrowLeft size={15} />
                  </IconButton>
                  <Typography variant="body2" sx={{ fontFamily: "monospace" }}>/{folder}</Typography>
                </Box>
                {tree ? (
                  <List dense disablePadding>
                    {tree.entries.map((entry) => (
                      <ListItemButton
                        key={entry.path}
                        sx={{ borderRadius: 1 }}
                        onClick={() =>
                          entry.kind === "folder"
                            ? setFolder(entry.path)
                            : void read(entry.path)
                        }
                      >
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          {entry.kind === "folder" ? <Folder size={15} /> : <FileCode2 size={15} />}
                        </ListItemIcon>
                        <ListItemText primary={entry.name} />
                      </ListItemButton>
                    ))}
                  </List>
                ) : (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <CircularProgress size={17} />
                    <Typography variant="body2">Loading…</Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
                  <Typography variant="body2" sx={{ fontFamily: "monospace" }}>{file?.source || "Select a source file"}</Typography>
                  {file && (
                    <Box sx={{ display: "flex", gap: 0.5 }}>
                      <IconButton
                        size="small"
                        aria-label="Previous source page"
                        disabled={file.start <= 1}
                        onClick={() =>
                          void read(file.path, Math.max(1, file.start - 160))
                        }
                      >
                        <ArrowLeft size={15} />
                      </IconButton>
                      <IconButton
                        size="small"
                        aria-label="Next source page"
                        disabled={file.start + 160 > file.total_lines}
                        onClick={() => void read(file.path, file.start + 160)}
                      >
                        <ArrowRight size={15} />
                      </IconButton>
                    </Box>
                  )}
                </Box>
                <Box component="pre" sx={{ m: 0, fontSize: "0.78rem", overflowX: "auto", fontFamily: "monospace" }}>
                  {file?.content ||
                    "Choose a file to read its current source with line numbers."}
                </Box>
              </CardContent>
            </Card>
          </Box>
          {search && (
            <Card variant="outlined" sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  {search.hits.length} results
                  {search.truncated ? " · bounded search" : ""}
                </Typography>
                <List dense disablePadding>
                  {search.hits.map((hit, index) => (
                    <ListItemButton
                      key={index}
                      sx={{ borderRadius: 1 }}
                      onClick={() =>
                        void read(hit.path, Math.max(1, hit.line - 10))
                      }
                    >
                      <ListItemText
                        primary={`${hit.path}:${hit.line}`}
                        secondary={hit.preview}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </CardContent>
            </Card>
          )}
        </>
      )}
      {tab === "review" && (
        <Card variant="outlined" component="form" onSubmit={(event) => {
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
        }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
              <Box>
                <Typography variant="h6">A stronger second look</Typography>
                <Typography variant="body2" color="text.secondary">
                  Use the existing OpenCode account for a bounded review or patch proposal.
                </Typography>
              </Box>
              <Code2 size={28} />
            </Box>
            <FormControl>
              <InputLabel id="review-mode-label">Task type</InputLabel>
              <Select
                labelId="review-mode-label"
                id="review-mode"
                label="Task type"
                value={reviewMode}
                onChange={(event) => setReviewMode(String(event.target.value))}
              >
                <MenuItem value="review">Review and investigate</MenuItem>
                <MenuItem value="patch">Propose a patch</MenuItem>
              </Select>
            </FormControl>
            <TextField
              id="review-files"
              label="One to four relative source paths"
              multiline
              rows={3}
              required
              value={reviewFiles}
              onChange={(event) => setReviewFiles(event.target.value)}
              placeholder={"package.json\nsrc/example.ts"}
            />
            <TextField
              id="review-task"
              label="Requested outcome"
              multiline
              rows={4}
              required
              slotProps={{ htmlInput: { minLength: 5, maxLength: 8000 } }}
              value={reviewTask}
              onChange={(event) => setReviewTask(event.target.value)}
              placeholder="What should the coding model investigate or propose?"
            />
            <Typography variant="body2" color="text.secondary">
              Applicable instructions accompany the selected snapshots. A returned
              proposal is not an applied change. The run record preserves the
              actual outcome.
            </Typography>
            <Box>
              <Button variant="contained" type="submit" disabled={reviewBusy} startIcon={reviewBusy ? <CircularProgress size={16} color="inherit" /> : <Play size={16} />}>
                Run focused review
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}
    </>
  );
}

export function SkillsView({ skills, system, onRefresh, onDetail, onUse, onEnable, onSync, onError }: {
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
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2.5 }}>
        <Box>
          <Typography variant="h1">Skills library</Typography>
          <Typography variant="body2" color="text.secondary">Find the right capability. Connect what you need.</Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshCw size={16} />} onClick={onSync}>
          Expand catalog
        </Button>
      </Box>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
          <Avatar sx={{ bgcolor: "primary.main", color: "primary.contrastText" }}>
            <Boxes size={26} />
          </Avatar>
          <Box>
            <Typography variant="h4">
              {number(system?.catalog.available || data?.total || 0)}
            </Typography>
            <Typography variant="caption" color="text.secondary">Real upstream definitions indexed</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Catalog availability and installed readiness are different states.
              Requirements are checked against your running assistant.
            </Typography>
          </Box>
        </CardContent>
      </Card>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mb: 2 }}>
        <Tabs value={mode} onChange={(_, value: "catalog" | "installed" | "ready") => { setMode(value); setPage(0); }}>
          <Tab value="catalog" label="Discover" />
          <Tab value="installed" label={`Installed (${skills.length})`} />
          <Tab value="ready" label={`Ready (${skills.filter((item) => item.ready).length})`} />
        </Tabs>
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" startIcon={<RefreshCw size={14} />} onClick={onRefresh}>
          Refresh inventory
        </Button>
      </Box>
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
        <TextField
          id="catalog-search"
          aria-label="Search skills"
          placeholder="Search coding, email, research, design…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          sx={{ flexGrow: 1, minWidth: 220 }}
          slotProps={{
            input: {
              startAdornment: <Search size={18} style={{ marginRight: 8, color: "#64748b" }} />,
              endAdornment: query ? (
                <InputAdornment position="end">
                  <IconButton aria-label="Clear search" size="small" onClick={() => {
                    setQuery("");
                    setPage(0);
                  }}>
                    <X size={16} />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
        {mode === "catalog" && (
          <FormControl sx={{ minWidth: 160 }}>
            <InputLabel id="skill-category-label">Skill category</InputLabel>
            <Select
              labelId="skill-category-label"
              label="Skill category"
              value={category}
              onChange={(event) => {
                setCategory(String(event.target.value));
                setPage(0);
              }}
            >
              <MenuItem value="">All topics</MenuItem>
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
                <MenuItem key={topic} value={topic}>
                  {topic}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Box>
      {mode === "catalog" ? (
        <>
          <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
            <Typography variant="body2" color="text.secondary">
              {loading
                ? "Searching…"
                : `${number(data?.total || 0)} matching definitions`}
            </Typography>
            <Typography variant="body2" color="text.secondary">ClawHub registry · paginated locally</Typography>
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" }, gap: 2 }}>
            {data?.items.map((item) => (
              <Card variant="outlined" key={item.id}>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                    <Avatar sx={{ bgcolor: "action.hover" }}>
                      <Boxes size={20} />
                    </Avatar>
                    <Chip size="small" color="info" label="Available" />
                  </Box>
                  <Typography variant="h6">{item.name}</Typography>
                  <Typography variant="caption" color="text.secondary">@{item.owner}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {item.description ||
                      "Open the upstream definition for this capability."}
                  </Typography>
                  <Box sx={{ display: "flex", gap: 0.5, mt: 1, flexWrap: "wrap" }}>
                    {item.topics.slice(0, 2).map((topic) => (
                      <Chip key={topic} size="small" label={topic} />
                    ))}
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 1.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Download size={13} />
                      {number(item.downloads)}
                    </Typography>
                    <Button size="small" endIcon={<ArrowRight size={14} />} onClick={() => onDetail(item)}>
                      View skill
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
          {!loading && !data?.items.length && (
            <EmptyState title="No matching skills">
              <Typography variant="body2" color="text.secondary">Try a broader search or expand the catalog.</Typography>
            </EmptyState>
          )}
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, mt: 2 }}>
            <Button
              size="small"
              startIcon={<ArrowLeft size={15} />}
              disabled={page === 0 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </Button>
            <Typography variant="body2" color="text.secondary">
              Page {page + 1}
              {data
                ? ` of ${Math.max(1, Math.ceil(data.total / data.limit))}`
                : ""}
            </Typography>
            <Button
              size="small"
              endIcon={<ArrowRight size={15} />}
              disabled={!data?.has_more || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </Box>
        </>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" }, gap: 2 }}>
          {visible.map((item) => {
            const missing = Object.entries(item.missing || {}).flatMap(
              ([kind, values]) => values.map((value) => `${kind}: ${value}`),
            );
            return (
              <Card variant="outlined" key={item.name}>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                    <Avatar sx={{ bgcolor: "action.hover" }}>
                      <ShieldCheck size={20} />
                    </Avatar>
                    <Chip
                      size="small"
                      color={item.ready ? "success" : missing.length ? "warning" : "default"}
                      label={item.ready
                        ? "Ready"
                        : missing.length
                          ? "Setup required"
                          : "Not enabled"}
                    />
                  </Box>
                  <Typography variant="h6">{item.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.source.replace("openclaw-", "")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{item.description}</Typography>
                  {missing.length > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                      {missing.slice(0, 4).join(" · ")}
                    </Typography>
                  )}
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {item.modelVisible
                        ? "Visible to assistant"
                        : "Agent visibility off"}
                    </Typography>
                    {item.ready ? (
                      <Button size="small" endIcon={<ArrowRight size={14} />} onClick={() => onUse(item.name)}>
                        Use in chat
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        endIcon={<Zap size={14} />}
                        disabled={missing.length > 0}
                        onClick={() => onEnable(item.name)}
                      >
                        Enable
                      </Button>
                    )}
                  </Box>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}
    </>
  );
}

export function AutomationsView({ startOperation }: { startOperation: (path: string, body: unknown) => void }) {
  return (
    <>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2.5 }}>
        <Box>
          <Typography variant="h1">Automations</Typography>
          <Typography variant="body2" color="text.secondary">Turn repeatable work into a reliable workflow.</Typography>
        </Box>
        <Button variant="outlined" endIcon={<ExternalLink size={16} />} href="http://localhost:5679" target="_blank">
          Open n8n
        </Button>
      </Box>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
          <Avatar sx={{ width: 56, height: 56, bgcolor: "primary.main", color: "primary.contrastText" }}>
            <Workflow size={36} />
          </Avatar>
          <Box sx={{ flexGrow: 1 }}>
            <Chip size="small" color="success" label="Connected" sx={{ mb: 1 }} />
            <Typography variant="h4">Assistant-to-workflow demonstration</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Call the authenticated n8n workflow and verify its request
              ID. The result is explicitly marked as synthetic data.
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1, flexWrap: "wrap" }}>
              <Chip size="small" variant="outlined" label="JARVIS" />
              <ChevronRight size={16} />
              <Chip size="small" variant="outlined" label="Authenticated webhook" />
              <ChevronRight size={16} />
              <Chip size="small" variant="outlined" label="Verified result" />
            </Box>
            <Button
              variant="contained"
              endIcon={<Play size={15} />}
              sx={{ mt: 2 }}
              onClick={() => {
                startOperation("/api/workflows/demo", {});
              }}
            >
              Run connection test
            </Button>
          </Box>
        </CardContent>
      </Card>
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="h4">Connect your work apps</Typography>
        <Typography variant="body2" color="text.secondary">
          These integrations need their own accounts and workflow configuration.
        </Typography>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
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
          <Card variant="outlined" key={name}>
            <CardContent>
              <Workflow size={22} />
              <Typography variant="h6" sx={{ mt: 1 }}>{name}</Typography>
              <Typography variant="body2" color="text.secondary">{description}</Typography>
              <Box sx={{ mt: 1 }}>
                <Chip size="small" color="warning" label="Setup required" />
              </Box>
              <Button size="small" endIcon={<ExternalLink size={14} />} href="http://localhost:5679" target="_blank" sx={{ mt: 1 }}>
                Configure in n8n
              </Button>
            </CardContent>
          </Card>
        ))}
      </Box>
    </>
  );
}

export function RunsView({ operations, reviews, project, selectedName, refreshRuns, setReviews, setRunDetail, navigate, fail }: {
  operations: Operation[];
  reviews: Review[];
  project: string;
  selectedName: string | undefined;
  refreshRuns: () => void;
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>;
  setRunDetail: (value: Operation | Review | null) => void;
  navigate: (next: View) => void;
  fail: (error: unknown) => void;
}) {
  return (
    <>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2.5 }}>
        <Box>
          <Typography variant="h1">Run history</Typography>
          <Typography variant="body2" color="text.secondary">
            Real operation receipts and the latest reviews for{" "}
            {selectedName}.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshCw size={16} />}
          onClick={() => {
            refreshRuns();
            if (project)
              void api<{ jobs: Review[] }>(
                "/api/reviews?project=" + encodeURIComponent(project),
              ).then((result) => setReviews(result.jobs), fail);
          }}
        >
          Refresh
        </Button>
      </Box>
      <Card variant="outlined">
        <List disablePadding>
          {operations.map((item) => (
            <ListItemButton key={item.id} onClick={() => setRunDetail(item)} divider>
              <Avatar sx={{ mr: 2, bgcolor: item.status === "completed" ? "success.main" : running(item.status) ? "info.main" : "action.hover" }}>
                {running(item.status) ? (
                  <CircularProgress size={19} color="inherit" />
                ) : item.status === "completed" ? (
                  <Check size={19} />
                ) : (
                  <Activity size={19} />
                )}
              </Avatar>
              <ListItemText
                primary={item.title}
                secondary={`${when(item.created)} · ${item.kind}`}
              />
              <Chip
                size="small"
                color={
                  item.status === "completed"
                    ? "success"
                    : running(item.status)
                      ? "info"
                      : "warning"
                }
                label={item.status}
                sx={{ mr: 1 }}
              />
              <ChevronRight size={17} />
            </ListItemButton>
          ))}
          {reviews.map((item) => (
            <ListItemButton key={item.id} onClick={() => setRunDetail(item)} divider>
              <Avatar sx={{ mr: 2, bgcolor: "action.hover" }}>
                <Code2 size={19} />
              </Avatar>
              <ListItemText
                primary="OpenCode review"
                secondary={`${item.project} · ${item.id.slice(0, 10)}`}
              />
              <Chip
                size="small"
                color={item.status === "completed" ? "success" : "warning"}
                label={item.status}
                sx={{ mr: 1 }}
              />
              <ChevronRight size={17} />
            </ListItemButton>
          ))}
        </List>
        {!operations.length && !reviews.length && (
          <CardContent>
            <EmptyState title="Your next run starts here.">
              <Typography variant="body2" color="text.secondary">
                Run a workflow, review source, or install a skill to see its result.
              </Typography>
              <Button variant="outlined" sx={{ mt: 2 }} onClick={() => navigate("automations")}>
                Open automations
              </Button>
            </EmptyState>
          </CardContent>
        )}
      </Card>
    </>
  );
}

export function SettingsView({ preferences, savePreferences, voices, voiceStatus, system, refreshSystem }: {
  preferences: Preferences;
  savePreferences: (changes: Partial<Preferences>) => void;
  voices: Record<string, string>;
  voiceStatus: VoiceStatus;
  system: System | null;
  refreshSystem: () => void;
}) {
  return (
    <>
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h1">Settings</Typography>
        <Typography variant="body2" color="text.secondary">Make the workspace fit the way you work.</Typography>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2, alignItems: "start" }}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6">Appearance</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Saved on this PC.</Typography>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                variant={preferences.theme === "dark" ? "contained" : "outlined"}
                startIcon={<Moon size={22} />}
                onClick={() => savePreferences({ theme: "dark" })}
              >
                Dark workspace
              </Button>
              <Button
                variant={preferences.theme === "light" ? "contained" : "outlined"}
                startIcon={<Sun size={22} />}
                onClick={() => savePreferences({ theme: "light" })}
              >
                Light workspace
              </Button>
            </Box>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Typography variant="h6">Voice preferences</Typography>
            <FormControl>
              <InputLabel id="reading-voice-label">Reading voice</InputLabel>
              <Select
                labelId="reading-voice-label"
                id="reading-voice"
                label="Reading voice"
                value={preferences.voice}
                onChange={(event) =>
                  savePreferences({ voice: String(event.target.value) })
                }
              >
                {Object.entries(voices).map(([id, name]) => (
                  <MenuItem key={id} value={id}>
                    {name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={preferences.auto_speak}
                  onChange={(event) =>
                    savePreferences({
                      auto_speak: event.target.checked,
                    })
                  }
                />
              }
              label="Speak new replies"
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
              Automatically read answers in the active chat.
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={preferences.auto_send_voice}
                  onChange={(event) =>
                    savePreferences({
                      auto_send_voice: event.target.checked,
                    })
                  }
                />
              }
              label="Send after dictation"
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
              Submit recognized speech when recording stops.
            </Typography>
            <Box>
              <Chip
                size="small"
                color={voiceStatus.available ? "success" : "warning"}
                label={voiceStatus.available
                  ? "Local speech models ready"
                  : "Voice unavailable"}
              />
            </Box>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1.5 }}>Assistant engine</Typography>
            <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", mb: 1.5 }}>
              <Avatar sx={{ bgcolor: "primary.main", color: "primary.contrastText" }}>
                <Bot size={26} />
              </Avatar>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{system?.model || "OpenClaw default"}</Typography>
                <Typography variant="caption" color="text.secondary">Current configured model</Typography>
              </Box>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Strong source reviews use the existing OpenCode account.
              Model/provider configuration belongs to OpenClaw.
            </Typography>
            <Button
              variant="outlined"
              endIcon={<ExternalLink size={15} />}
              href="http://localhost:18789"
              target="_blank"
            >
              Open assistant controls
            </Button>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
              <Typography variant="h6">Connections</Typography>
              <IconButton
                size="small"
                aria-label="Refresh connections"
                onClick={() => refreshSystem()}
              >
                <RefreshCw size={17} />
              </IconButton>
            </Box>
            <List dense disablePadding>
              {system?.services.map((service) => (
                <ListItem key={service.name} disableGutters sx={{ py: 0.5, display: "flex", alignItems: "center", gap: 1.5 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: service.status === "healthy" ? "success.main" : "warning.main" }} />
                  <ListItemText primary={service.name} sx={{ flexGrow: 1 }} />
                  <Chip size="small" color={service.status === "healthy" ? "success" : "warning"} label={service.status} />
                </ListItem>
              ))}
            </List>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              Command Center {system?.version || "0.3.0"}
            </Typography>
            <Button size="small" endIcon={<ExternalLink size={13} />} href="/classic" target="_blank" sx={{ mt: 0.5 }}>
              Open the earlier interface
            </Button>
          </CardContent>
        </Card>
      </Box>
    </>
  );
}

export function ConnectModal({ onClose, onConnect }: {
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
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Connect a project</DialogTitle>
      <DialogContent dividers>
        <Box component="form" id="connect-project-form" onSubmit={submit} sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary">Connect a local folder or several repositories as one workspace.</Typography>
          <TextField
            label="Project name"
            autoFocus
            required
            slotProps={{ htmlInput: { maxLength: 100 } }}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My project"
          />
          <TextField
            label="Folders"
            multiline
            rows={4}
            required
            value={folders}
            onChange={(event) => setFolders(event.target.value)}
            placeholder={"backend=C:\\Projects\\my-api\nfrontend=C:\\Projects\\my-web"}
          />
          <Typography variant="caption" color="text.secondary">
            One path per line. Labels such as backend= and frontend= are optional.
          </Typography>
          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          type="submit"
          form="connect-project-form"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <FolderOpen size={16} />}
        >
          Connect project
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function SkillDetailDialog({ detail, onClose, onInstall }: {
  detail: Capability;
  onClose: () => void;
  onInstall: () => void;
}) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{detail.name}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mb: 1.5 }}>
          <Chip size="small" color="info" label="Community skill" />
          <Typography variant="body2" color="text.secondary">@{detail.owner}</Typography>
          <Typography variant="body2" color="text.secondary">v{detail.version || "unknown"}</Typography>
        </Box>
        <Typography variant="body1">{detail.description}</Typography>
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1.5 }}>
          {detail.topics.map((topic) => (
            <Chip key={topic} size="small" label={topic} />
          ))}
        </Box>
        <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ color: "text.secondary" }}>License</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{detail.license}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ color: "text.secondary" }}>Upstream downloads</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{number(detail.downloads)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ color: "text.secondary" }}>Availability</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Catalog definition</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
        {detail.requirements.length > 0 && (
          <>
            <Typography variant="h6" sx={{ mt: 2 }}>Published setup requirements</Typography>
            <List dense disablePadding>
              {detail.requirements.map((item) => (
                <ListItem key={item.key} disableGutters>
                  <ListItemText
                    primary={<><Typography component="code" variant="body2" sx={{ fontFamily: "monospace" }}>{item.key}</Typography>{" "}{item.required ? "required" : "optional"}</>}
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Installation uses OpenClaw’s registry checks. Actual readiness is
          shown in the installed inventory after requirements and agent
          visibility are checked.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button
          endIcon={<ExternalLink size={15} />}
          href={detail.url}
          target="_blank"
        >
          View upstream source
        </Button>
        <Button
          variant="contained"
          startIcon={<Download size={15} />}
          disabled={!detail.version}
          onClick={onInstall}
        >
          Install selected version
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function RunDetailDialog({ runDetail, onClose, notify }: {
  runDetail: Operation | Review;
  onClose: () => void;
  notify: (text: string, error?: boolean) => void;
}) {
  void notify;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{"title" in runDetail ? runDetail.title : "OpenCode review"}</DialogTitle>
      <DialogContent dividers>
        <Chip
          size="small"
          color={runDetail.status === "completed" ? "success" : "warning"}
          label={runDetail.status}
          sx={{ mb: 1.5 }}
        />
        {"result" in runDetail ? (
          <Box component="pre" sx={{ m: 0, fontSize: "0.78rem", overflowX: "auto", fontFamily: "monospace" }}>
            {JSON.stringify(runDetail.result, null, 2)}
          </Box>
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
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{runDetail.artifacts}</Typography>
            )}
          </>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Run ID: {runDetail.id}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}




