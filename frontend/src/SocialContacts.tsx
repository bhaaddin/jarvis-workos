import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Link,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { Check, Copy, Download, ExternalLink, Search, Users, X } from "lucide-react";
import { api } from "./api";

type Platform = "instagram" | "tiktok";
type Connection = { platform: Platform; hasSession: boolean; state: string; loginId: string | null; expiresAt: number | null; label: string | null; savedAt: string | null };
type Contact = { id: string; revision: number; platform: Platform; handle: string; url: string; displayName: string; bio: string; followers: string | null; emails: string[]; phones: string[]; websites: string[];
  stage: string; notes: string; draft: string; draftPurpose: string; matchReason: string; evidenceQuote: string; assessmentStale: boolean; observedAt: string; sourceState: string; purpose: string; query: string };
type SearchRecord = { id: string; brief: { query: string; location: string; purpose: string }; status: string; requested: number; saved: number; issues: Array<{ platform: string; state: string; message?: string }>; observedAt: string };
type Props = { conversationId: string; runTask: (text: string) => Promise<string>; stopTask: () => void; busy: boolean };
const base = "/api/operator/social";
const errorText = (error: unknown) => error instanceof Error ? error.message : "The social-contact operation could not complete.";
const platformLabel = (value: Platform) => value === "instagram" ? "Instagram" : "TikTok";
const connectionLabel: Record<string, string> = { not_connected: "Not signed in", awaiting_login: "Sign-in window open on PC", session_saved: "Session saved — ready to check", read_verified: "Profile reads verified",
  login_required: "Sign in again", challenge_required: "Platform verification needed", platform_unavailable: "Platform unavailable", no_visible_results: "No inspectable search results",
  login_expired: "Sign-in window timed out — open it again", login_closed: "Sign-in window closed before saving", rate_limited: "Platform rate limit — wait before another search",
  saving_session: "Saving verified sign-in…", save_failed: "Automatic save needs attention — try Save connection", login_permission_changed: "Account permissions changed; sign-in stopped" };
const pendingConnection = (value: Connection) => ["awaiting_login", "saving_session", "save_failed"].includes(value.state);

export function SocialContacts({ conversationId, runTask, stopTask, busy }: Props) {
  const [connections, setConnections] = useState<Connection[]>([]), [contacts, setContacts] = useState<Contact[]>([]), [searches, setSearches] = useState<SearchRecord[]>([]);
  const [query, setQuery] = useState("fitness creators"), [location, setLocation] = useState("Prague"), [languages, setLanguages] = useState("Czech, English"), [purpose, setPurpose] = useState("Paid collaboration");
  const [limit, setLimit] = useState(20), [platforms, setPlatforms] = useState<Platform[]>(["instagram", "tiktok"]), [urls, setUrls] = useState("");
  const [filter, setFilter] = useState(""), [stage, setStage] = useState("all"), [selected, setSelected] = useState<Contact | null>(null), [picked, setPicked] = useState<string[]>([]);
  const [working, setWorking] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = async (signal?: AbortSignal) => {
    const [account, list, history] = await Promise.all([api<{ connections: Connection[] }>(base + "/connections", undefined, { signal }), api<{ contacts: Contact[] }>(base + "/contacts", undefined, { signal }), api<{ searches: SearchRecord[] }>(base + "/searches", undefined, { signal })]);
    if (signal?.aborted) return; setConnections(account.connections); setContacts(list.contacts); setSearches(history.searches);
  };
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch((cause) => { if (!controller.signal.aborted) setError(errorText(cause)); }); return () => controller.abort(); }, []);
  const pendingLogin = connections.some(pendingConnection);
  useEffect(() => {
    if (!pendingLogin) return;
    const controller = new AbortController(), timer = setInterval(() => {
      void api<{ connections: Connection[] }>(base + "/connections", undefined, { signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) { setConnections(value.connections); if (value.connections.length === 2 && value.connections.every((item) => item.hasSession && !pendingConnection(item))) setNotice("Both sessions are saved privately. Profile access will be checked during research."); } }).catch(() => {});
    }, 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [pendingLogin]);
  const accountAction = async (platform: Platform, action: "start" | "save" | "disconnect" | "close", loginId?: string | null) => {
    setWorking(platform); setError(""); setNotice(action === "start" ? "Opening a separate " + platformLabel(platform) + " sign-in window on the PC…" : "");
    try {
      await api(base + "/connections/" + platform + "/" + action, action === "save" || action === "close" ? { loginId } : {}); await load();
      setNotice(action === "start" ? "A separate sign-in window is open on the PC. Complete login and verification there. JARVIS will save the session privately and close the window automatically." : action === "save" ? "Session saved privately. Profile access will be checked during research." : "Connection updated.");
    } catch (cause) { setError(errorText(cause)); } finally { setWorking(""); }
  };
  const task = async (prompt: string) => {
    setWorking("research"); setError(""); setNotice("");
    try { const answer = await runTask(prompt); await load(); setNotice(answer.trim() ? answer.slice(0, 1200) + (answer.length > 1200 ? "… Full response is in Assistant." : "") : "Task finished. Review the saved profiles, source states and any platform limitations below."); }
    catch (cause) { setError(errorText(cause)); await load().catch(() => {}); } finally { setWorking(""); }
  };
  const search = () => {
    const known = urls.split(/\s+/).map((value) => value.trim()).filter(Boolean);
    if (known.length > 20) { setError("Provide up to 20 known profile URLs."); return; }
    const brief = { query: query.trim(), location: location.trim(), languages: languages.trim(), purpose: purpose.trim(), platforms, limit, ...(known.length ? { profileUrls: known } : {}) };
    void task("Find and save public social-profile candidates using the connected social research tool with this brief: " + JSON.stringify(brief) +
      ". Then review saved profiles in batches of up to five and save source-supported match explanations with exact evidence quotations. Shortlist clear matches; leave unknown location/language criteria unverified. Report the actual number observed and any login, verification or partial-result limits. Do not invent contact details, mark contacted, or send messages.");
  };
  const draft = (ids: string[]) => {
    void task("Read the saved social contacts with these IDs: " + JSON.stringify(ids) + ". Review their actual source evidence against this outreach purpose: " + purpose +
      ". Save a concise personalized outreach draft for each using the social contact update tool and current revisions. Explain a genuine match only with an exact quotation from sourceText; leave unknown criteria unverified. Do not invent a brand, budget, relationship or claim to have watched content. Use Czech or English as supported by the profile and brief. Draft only; do not send or mark contacted.");
  };
  const save = async (contact: Contact, values: Partial<Contact>) => {
    const response = await api<{ ok: boolean; status?: string; error?: { message?: string } }>("/api/operator/tools/invoke", { conversationId, requestId: crypto.randomUUID(), tool: "jarvis_social_contact_update",
      input: { edits: [{ id: contact.id, expectedRevision: contact.revision, ...values }], _confidence: "high" } });
    if (!response.ok || response.status !== "succeeded") throw new Error(response.error?.message ?? "The contact edit was not completed. Refresh the saved state.");
    await load();
  };
  const listed = contacts.filter((contact) => (stage === "all" || contact.stage === stage) && [contact.handle, contact.displayName, contact.bio, contact.matchReason].join(" ").toLowerCase().includes(filter.toLowerCase()));
  const canSearch = query.trim() && platforms.length > 0 && platforms.every((platform) => connections.some((value) => value.platform === platform && value.hasSession));
  const unavailable = working !== "" || busy;
  return (
    <Box component="section" aria-label="Social contacts">
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="caption" color="primary" sx={{ fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>
            Search → review → reach out
          </Typography>
          <Typography variant="h4" sx={{ display: "flex", alignItems: "center", gap: 1 }}><Users size={25} /> Social contacts</Typography>
          <Typography variant="body2" color="text.secondary">Find relevant Instagram and TikTok profiles. Keep evidence, public contact details and drafts in one place.</Typography>
        </Box>
        <Button variant="outlined" size="small" onClick={() => { void load().catch((cause) => setError(errorText(cause))); }}>Refresh</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="info" sx={{ mb: 2 }}>{notice}</Alert>}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, mb: 2 }}>
        {(["instagram", "tiktok"] as const).map((platform) => {
          const connection = connections.find((value) => value.platform === platform);
          return (
            <Card variant="outlined" key={platform}>
              <CardContent>
                <Typography variant="h6">{platformLabel(platform)}</Typography>
                <Typography variant="body2" color="text.secondary">{connectionLabel[connection?.state ?? "not_connected"] ?? connection?.state.replaceAll("_", " ")}</Typography>
                {connection?.savedAt && <Typography variant="caption" color="text.secondary">Session saved {new Date(connection.savedAt).toLocaleString()}</Typography>}
                {connection && pendingConnection(connection) ? <>
                  <Typography variant="body2" sx={{ mt: 1 }}>Sign in on the PC (through TeamViewer if needed). Complete verification directly on the platform. JARVIS saves the session and closes the window automatically once ready.</Typography>
                  <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
                    <Button variant="contained" size="small" disabled={unavailable || connection.state === "saving_session"} onClick={() => void accountAction(platform, "save", connection.loginId)}>Save {platformLabel(platform)} connection</Button>
                    <Button variant="outlined" size="small" disabled={unavailable} onClick={() => void accountAction(platform, "close", connection.loginId)}>Close sign-in</Button>
                  </Box>
                </> : (
                  <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
                    <Button variant="contained" size="small" disabled={unavailable} onClick={() => void accountAction(platform, "start")}>Sign in to {platformLabel(platform)}</Button>
                    {connection?.hasSession && <Button variant="outlined" size="small" disabled={unavailable} onClick={() => void accountAction(platform, "disconnect")}>Disconnect</Button>}
                  </Box>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Box>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Who are you looking for?</Typography>
          <Box component="form" onSubmit={(event) => { event.preventDefault(); search(); }}>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
              <TextField label="Niche / keywords" value={query} slotProps={{ htmlInput: { maxLength: 200 } }} required onChange={(event) => setQuery(event.target.value)} />
              <TextField label="Location" value={location} slotProps={{ htmlInput: { maxLength: 100 } }} onChange={(event) => setLocation(event.target.value)} />
              <TextField label="Languages" value={languages} slotProps={{ htmlInput: { maxLength: 100 } }} onChange={(event) => setLanguages(event.target.value)} />
              <TextField label="Profiles to research" type="number" value={limit} onChange={(event) => setLimit(Number(event.target.value))} slotProps={{ htmlInput: { min: 1, max: 20 } }} />
            </Box>
            <TextField label="Outreach purpose / offer" multiline rows={2} value={purpose} slotProps={{ htmlInput: { maxLength: 500 } }} onChange={(event) => setPurpose(event.target.value)} sx={{ mt: 1.5 }} />
            <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
              {(["instagram", "tiktok"] as const).map((platform) => (
                <FormControlLabel key={platform} control={
                  <Checkbox checked={platforms.includes(platform)} onChange={(event) => setPlatforms((values) => event.target.checked ? [...values, platform] : values.filter((value) => value !== platform))} />
                } label={platformLabel(platform)} />
              ))}
            </Box>
            <Divider sx={{ my: 1.5 }} />
            <TextField label="Known profile URLs (one per line)" multiline rows={2} value={urls} onChange={(event) => setUrls(event.target.value)} placeholder="https://www.instagram.com/profile/" />
            <Typography variant="caption" color="text.secondary">These profiles can be inspected directly instead of using site search.</Typography>
            <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap", alignItems: "center" }}>
              <Button variant="contained" startIcon={<Search size={16} />} disabled={unavailable || !canSearch}>{working === "research" ? "Researching…" : "Find and save profiles"}</Button>
              {(busy || working === "research") && <Button variant="outlined" type="button" onClick={stopTask}>Stop current task</Button>}
              {!canSearch && <Typography variant="caption" color="text.secondary">Save a session for every selected platform first.</Typography>}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>Results are candidates. Review niche, location and language evidence before choosing whom to contact. This workflow does not send messages.</Typography>
          </Box>
        </CardContent>
      </Card>
      {searches[0] && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>Last search: {searches[0].saved} saved / {searches[0].requested} requested · {searches[0].status}</strong>
          {searches[0].issues.map((issue, index) => <Typography variant="body2" key={index}>{issue.platform}: {issue.state.replaceAll("_", " ")}{issue.message ? " — " + issue.message : ""}</Typography>)}
        </Alert>
      )}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "flex-end" }}>
          <TextField label="Filter saved contacts" placeholder="Name, bio or match reason" value={filter} onChange={(event) => setFilter(event.target.value)} sx={{ minWidth: 200, flex: 1 }} />
          <TextField label="Stage" select value={stage} onChange={(event) => setStage(event.target.value)} sx={{ minWidth: 150 }}>
            {["all", "new", "shortlisted", "contacted", "dismissed"].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
          </TextField>
          <Button variant="outlined" startIcon={<Download size={16} />} href={base + "/contacts/export"} download>Export CSV</Button>
          <Button variant="contained" disabled={unavailable || picked.length === 0} onClick={() => draft(picked)}>Draft selected ({picked.length}/5)</Button>
        </CardContent>
      </Card>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {listed.length} shown · {contacts.length} saved (most recent 100). “Contacted” is your manual tracking status.
      </Typography>
      {contacts.length === 0 ? (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: "center", py: 4 }}>
            <Users size={28} />
            <Typography variant="h6" sx={{ mt: 1 }}>Your shortlist will appear here</Typography>
            <Typography variant="body2" color="text.secondary">Connect the platforms, enter a search brief and inspect the resulting profiles.</Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {listed.map((contact) => (
            <Card variant="outlined" key={contact.id}>
              <CardContent>
                <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
                  <Checkbox aria-label={"Select " + contact.handle} checked={picked.includes(contact.id)} disabled={!picked.includes(contact.id) && picked.length >= 5}
                    onChange={(event) => setPicked((values) => event.target.checked ? [...values, contact.id] : values.filter((value) => value !== contact.id))} />
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="h6">{contact.displayName || contact.handle}</Typography>
                    <Link href={contact.url} target="_blank" rel="noreferrer" variant="body2">
                      {platformLabel(contact.platform)} · @{contact.handle} <ExternalLink size={12} />
                    </Link>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{contact.stage}</Typography>
                  </Box>
                </Box>
                <Typography variant="body2" sx={{ mt: 1 }}>{contact.bio}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {contact.followers ? contact.followers + " followers shown · " : ""}{contact.sourceState.replaceAll("_", " ")} · observed {new Date(contact.observedAt).toLocaleString()}
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>{contact.matchReason || "Match not yet assessed — review the observed profile."}</Typography>
                {contact.evidenceQuote && (
                  <Box component="blockquote" sx={{ ml: 0, pl: 2, borderLeft: 3, borderColor: "primary.main", my: 1 }}>
                    <Typography variant="body2">{contact.evidenceQuote}</Typography>
                  </Box>
                )}
                {contact.assessmentStale && <Alert severity="warning" sx={{ mt: 1 }}>Profile evidence changed; review the earlier assessment.</Alert>}
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
                  {contact.emails.map((email) => <Link key={email} href={"mailto:" + encodeURIComponent(email)}>{email}</Link>)}
                  {contact.phones.map((phone) => <Typography key={phone} variant="body2">{phone}</Typography>)}
                  {contact.websites.map((website) => <Link href={website} key={website} target="_blank" rel="noreferrer">{website} <ExternalLink size={12} /></Link>)}
                  {!contact.emails.length && !contact.phones.length && <Typography variant="caption" color="text.secondary">No public email/phone observed. Open the profile for its available contact options.</Typography>}
                </Box>
                {contact.draft && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="subtitle2">Saved message draft</Typography>
                    <Typography variant="body2">{contact.draft}</Typography>
                    <Typography variant="caption" color="text.secondary">Purpose: {contact.draftPurpose || contact.purpose}</Typography>
                  </Box>
                )}
                <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
                  <Button variant="outlined" size="small" disabled={unavailable} onClick={() => setSelected(contact)}>Review / edit</Button>
                  <Button variant="outlined" size="small" disabled={unavailable} onClick={() => draft([contact.id])}>Generate draft</Button>
                  {contact.draft && <Button variant="outlined" size="small" startIcon={<Copy size={14} />} onClick={() => { void navigator.clipboard.writeText(contact.draft).then(() => setNotice("Draft copied. Send it yourself from the profile or your email app.")).catch(() => setError("Clipboard access failed; open Review / edit and copy the draft.")); }}>Copy draft</Button>}
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}
      {selected && <ContactEditor contact={selected} close={() => setSelected(null)} save={async (values) => { await save(selected, values); setSelected(null); setNotice("Contact updated. No message was sent."); }} />}
    </Box>
  );
}

function ContactEditor({ contact, close, save }: { contact: Contact; close: () => void; save: (values: Partial<Contact>) => Promise<void> }) {
  const [draft, setDraft] = useState(contact.draft), [notes, setNotes] = useState(contact.notes), [stage, setStage] = useState(contact.stage), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const doSave = () => {
    setBusy(true);
    void save({ draft, notes, stage }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false));
  };
  return (
    <Dialog open onClose={(_event, reason) => { if (!busy && reason !== "backdropClick") close(); }} fullWidth maxWidth="sm" aria-labelledby="social-editor-title">
      <DialogTitle id="social-editor-title">Review @{contact.handle}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2">{contact.bio}</Typography>
        <Link href={contact.url} target="_blank" rel="noreferrer">Open source profile</Link>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 2 }}>
          <TextField label="Message draft" multiline rows={3} value={draft} slotProps={{ htmlInput: { maxLength: 1500 } }} onChange={(event) => setDraft(event.target.value)} />
          <TextField label="Your notes" multiline rows={3} value={notes} slotProps={{ htmlInput: { maxLength: 2000 } }} onChange={(event) => setNotes(event.target.value)} />
          <TextField label="Stage" select value={stage} onChange={(event) => setStage(event.target.value)}>
            {["new", "shortlisted", "contacted", "dismissed"].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
          </TextField>
          {error && <Alert severity="error">{error}</Alert>}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: "block" }}>
          Observed profile/contact fields are read-only. Mark contacted only when you have actually reached out.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button startIcon={<X size={16} />} disabled={busy} onClick={close}>Close</Button>
        <Button variant="contained" startIcon={<Check size={16} />} disabled={busy} onClick={doSave}>
          {busy ? "Saving…" : "Save contact"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
