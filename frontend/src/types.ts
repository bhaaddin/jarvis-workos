export type View =
  | "operator"
  | "overview"
  | "assistant"
  | "projects"
  | "skills"
  | "automations"
  | "runs"
  | "settings"
  | "firm"
  | "fleet";
export type FirmProfile = {
  tenant: string;
  displayName: string;
  industry: string;
  languages: string[];
  tone: string;
  workingHours: Record<string, unknown>;
  approvalDefaults: Record<string, string>;
  fieldPacks: string[];
  branding: { symbol?: string; theme?: string };
  billingNote: string;
};
export type Project = {
  id: string;
  name: string;
  roots: { id: string; label: string; path: string }[];
  metadata?: {kind?:string;category?:string;collection?:string;upstream?:string|null;sourceOnlyByDefault?:boolean};
};
export type Overview = {
  id: string;
  name: string;
  roots: (Project["roots"][number] & {
    available: boolean;
    error?: string;
    stack?: string[];
    source_files?: number;
    index_truncated?: boolean;
    manifests?: string[];
    instructions?: { path: string; content: string; truncated: boolean }[];
    git?: {
      repository: boolean;
      branch: string | null;
      head: string | null;
      changes: { status: string; path: string }[];
      change_count?: number;
    };
  })[];
};
export type Tree = {
  path: string;
  entries: { name: string; path: string; kind: "folder" | "file" }[];
  truncated: boolean;
};
export type SourceFile = {
  source: string;
  path: string;
  content: string;
  start: number;
  total_lines: number;
  truncated: boolean;
};
export type SearchResult = {
  query: string;
  hits: { path: string; line: number; preview: string }[];
  truncated: boolean;
  files_scanned: number;
};
export type Thread = {
  project: string;
  thread: string;
  session: string;
  title: string;
  created: number;
  updated: number;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp?: number;
  error?: boolean;
  streaming?: boolean;
};
export type History = {
  messages: Message[];
  active: boolean;
  has_more: boolean;
  next_offset?: number;
  conversation: Thread;
};
export type Preferences = {
  theme: "dark" | "light";
  voice: string;
  auto_speak: boolean;
  auto_send_voice: boolean;
};
export type VoiceStatus = {
  available: boolean;
  voices: string[];
  message?: string;
};
export type CatalogStats = {
  available: number;
  updated: number;
  generation: number;
  feed_complete: boolean;
  pages: number;
  target: number;
};
export type System = {
  version: string;
  model: string;
  projects: number;
  active_operations: number;
  catalog: CatalogStats;
  services: { name: string; status: string; latency_ms: number | null }[];
};
export type Capability = {
  id: string;
  owner: string;
  slug: string;
  name: string;
  description: string;
  topics: string[];
  downloads: number;
  license: string;
  version: string;
  url: string;
  source: string;
  status: string;
  requirements: { key: string; required: boolean }[];
  installation?: {
    version: string;
    name: string | null;
    verified: boolean;
  } | null;
};
export type CatalogPage = {
  items: Capability[];
  total: number;
  page: number;
  limit: number;
  generation: number;
  has_more: boolean;
};
export type InstalledSkill = {
  name: string;
  description: string;
  ready: boolean;
  eligible: boolean;
  disabled: boolean;
  modelVisible: boolean;
  blockedByAgentFilter: boolean;
  source: string;
  homepage?: string;
  missing: Record<string, string[]>;
};
export type Operation = {
  id: string;
  kind: string;
  title: string;
  status: string;
  created: number;
  updated: number;
  result: Record<string, unknown>;
};
export type Review = {
  id: string;
  project: string;
  status: string;
  answer?: string;
  error?: string;
  errors?: string[];
  artifacts?: string;
  applied?: boolean;
  exit_code?: number;
};
