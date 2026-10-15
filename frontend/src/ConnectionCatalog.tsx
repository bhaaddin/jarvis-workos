import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Link,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import { api } from "./api";
import type { Project } from "./types";

type Entry = Project & { sourceAvailable: boolean; runtimeMode: string; connections: Array<{ id: string; adapter: string; configured: boolean; description: string }> };
type Compatibility = { project: string; sourceReady: boolean; mode: string; note: string; checkedAt: string; roots: Array<{ root: string; state: string; adapter?: string; revision?: string | null; upstream?: string | null; sparse?: boolean;
  manifests?: Array<{ path: string; state: string; requirements: Record<string, string> }>; sample?: { path: string } }>;
  runtimes: Array<{ id: string; adapter: string; state: string; compatible: boolean; description: string; required: string[]; baseUrl?: string; details?: Record<string, unknown> }> };

export function ConnectionCatalog({ selected, onSelect }: { selected?: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState(""), [entries, setEntries] = useState<Entry[]>([]), [total, setTotal] = useState(0), [error, setError] = useState("");
  const [detail, setDetail] = useState<Compatibility | null>(null), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ projects: Entry[]; total: number }>("/api/connections?limit=100&q=" + encodeURIComponent(query), undefined, { signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) { setEntries(value.projects); setTotal(value.total); setError(""); } })
        .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Connection catalogue is unavailable."); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, revision]);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    const controller = new AbortController(); setBusy(true); setDetail(null);
    void api<Compatibility>("/api/connections/" + encodeURIComponent(selected) + (revision ? "?refresh=1" : ""), undefined, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setDetail(value); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Compatibility check failed."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [selected, revision]);
  return (
    <Box component="section" aria-label="Project connections">
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="h4">Connections & cloned projects</Typography>
          <Typography variant="body2" color="text.secondary">Inspect source and check explicitly configured service contracts.</Typography>
        </Box>
        <Button variant="outlined" size="small" startIcon={<RefreshCw size={16} />} onClick={() => setRevision((value) => value + 1)}>Refresh checks</Button>
      </Box>
      <TextField
        aria-label="Find connected projects"
        placeholder="Search a project or cloned repository…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        slotProps={{ input: { startAdornment: <Search size={16} style={{ marginRight: 8, color: "#64748b" }} /> } }}
        sx={{ mb: 2 }}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(240px, 340px) 1fr" }, gap: 2 }}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {total} matching projects{entries.length < total ? ` · first ${entries.length} shown` : ""}
            </Typography>
            <List dense disablePadding aria-label="Connected repository catalogue">
              {entries.map((entry) => (
                <ListItemButton key={entry.id} selected={entry.id === selected} onClick={() => onSelect(entry.id)} sx={{ borderRadius: 2 }}>
                  <ListItemText
                    primary={entry.name}
                    secondary={`${entry.id} · ${entry.metadata?.category?.replaceAll("-", " ") ?? "workspace"} · ${entry.sourceAvailable ? "source available" : "source unavailable"} · ${entry.runtimeMode.replaceAll("-", " ")}`}
                  />
                </ListItemButton>
              ))}
            </List>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent aria-live="polite">
            {busy && <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><CircularProgress size={16} /><Typography variant="body2">Checking the selected connection…</Typography></Box>}
            {detail && <>
              <Typography variant="h6">Connection check</Typography>
              <Typography variant="body2"><strong>{detail.sourceReady ? "Source inspection ready" : "Source inspection needs attention"}</strong></Typography>
              <Typography variant="caption" color="text.secondary">Checked {new Date(detail.checkedAt).toLocaleString()}</Typography>
              {detail.roots.map((root) => (
                <Box key={root.root} sx={{ mt: 1.5 }}>
                  <Typography variant="body2"><strong>{root.root}</strong> · {root.adapter ?? "unavailable"} · {root.state.replaceAll("_", " ")}</Typography>
                  {root.revision && <Typography variant="caption" color="text.secondary">HEAD {root.revision.slice(0, 12)}{root.sparse ? " · sparse checkout" : ""}</Typography>}
                  {root.sample && <Typography variant="body2">Verified source: <Typography component="code" variant="body2" sx={{ fontFamily: "monospace" }}>{root.sample.path}</Typography></Typography>}
                  {root.upstream?.startsWith("https://") && <Link href={root.upstream} target="_blank" rel="noreferrer">Upstream repository</Link>}
                  {root.manifests?.some((item) => Object.keys(item.requirements).length > 0) && (
                    <Accordion variant="outlined" sx={{ mt: 1 }}>
                      <AccordionSummary expandIcon={<ChevronDown size={16} />}>Declared development requirements</AccordionSummary>
                      <AccordionDetails>
                        {root.manifests.filter((item) => Object.keys(item.requirements).length > 0).map((item) => (
                          <Typography variant="body2" key={item.path}>
                            <Typography component="code" variant="body2" sx={{ fontFamily: "monospace" }}>{item.path}</Typography>: {Object.entries(item.requirements).map(([name, value]) => `${name} ${value}`).join(" · ")}
                          </Typography>
                        ))}
                        <Typography variant="caption" color="text.secondary">Manifest requirements are source evidence, not proof that this checkout builds or runs here.</Typography>
                      </AccordionDetails>
                    </Accordion>
                  )}
                </Box>
              ))}
              <Typography variant="h6" sx={{ mt: 2 }}>Runtime connections</Typography>
              {detail.runtimes.length === 0
                ? <Typography variant="body2">Source-only connection. No runtime endpoint is declared.</Typography>
                : detail.runtimes.map((item) => (
                  <Box key={item.id} sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      <strong>{item.id}</strong>{" "}
                      <Typography component="span" variant="caption" color={item.compatible ? "success.main" : "warning.main"}>
                        {item.compatible ? "Probe passed" : item.state.replaceAll("_", " ")}
                      </Typography>
                    </Typography>
                    <Typography variant="body2">{item.description}</Typography>
                    <Typography variant="caption" color="text.secondary">{item.adapter}{item.baseUrl ? " · " + item.baseUrl : ""}</Typography>
                    {item.required.length > 0 && <Typography variant="body2">Needed: {item.required.join(", ")}</Typography>}
                  </Box>
                ))}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{detail.note}</Typography>
            </>}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
