import { useCallback, useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { Activity, ArrowUpRight, BarChart3, ChevronDown, Phone, RefreshCw } from "lucide-react";
import { boundedApi } from "./api";

type Unavailable = { status: "unavailable"; error: { code: string; message: string } };
type Paper = { status: "ready"; state: string | null; balance: number; allocatedBalance: number | null; currency: string; openPositions: number; maxPositions: number; strategy: string | null;
  closedTrades: number | null; daily: Array<{ date: string | null; profitUSDT: number | null; trades: number | null }>;
  positions: Array<{ id: number | null; pair: string | null; profitUSDT: number | null }> };
type Validation = { label: string | null; epoch: number | null; trades: number; netUSDT: number; walletDrawdownUSDT: number };
type Study = { status: "ready"; id: string; verifiedAt: string | null; decision: string; holdoutEvaluated: boolean; paperParametersChanged: boolean; validation: Validation[] };
type Research = { status: "ready"; totalResults: number; results: Array<{ filename: string | null; strategy: string | null; executedAt: string | null }> };
type Market = { symbol: string; quoteCurrency: string; latestDate: string; latestClose: number; bars: Array<{ date: string; close: number }> };
type News = { headlines: Array<{ title: string | null; publishedAt: string | null; url: string | null }> };
type Snapshot = { status: "ready" | "partial"; observedAt: string; cacheAgeMs: number; elapsedMs: number; paper: Paper | Unavailable; study: Study | Unavailable; research: Research | Unavailable };
type ReadResult = { ok: boolean; error?: { message?: string }; result?: { data: { observedAt: string; market?: Market; news?: News } } };
const symbols = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "BTC-USD", "ETH-USD", "EURUSD", "USDCZK", "EURCZK"];
const value = (number: number | null | undefined, digits = 4) => number == null ? "Unknown" : number.toLocaleString("en-US", { maximumFractionDigits: digits });
const date = (text: string | null) => text ? new Date(text).toLocaleString() : "Unknown";
const errorText = (error: unknown) => error instanceof Error ? error.message : "The Finance read could not complete.";
const unavailable = (section: Unavailable) => <Alert severity="warning" sx={{ mt: 1 }}>{section.error.message}</Alert>;

export function FinancePanel({ conversationId, busy, ask, talk }: { conversationId: string; busy: boolean; ask: (text: string) => void; talk: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [roundTrip, setRoundTrip] = useState<number | null>(null);
  const [symbol, setSymbol] = useState("SPY"), [market, setMarket] = useState<Market | null>(null), [news, setNews] = useState<News | null>(null), [reading, setReading] = useState(""), [dataError, setDataError] = useState("");
  const [marketObserved, setMarketObserved] = useState(""), [newsObserved, setNewsObserved] = useState("");
  const lifetime = useRef<AbortController | null>(null), refreshing = useRef<AbortSignal | null>(null), readingNow = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => {
    if (refreshing.current && !refreshing.current.aborted) return; refreshing.current = signal; setLoading(true); setError(""); const started = performance.now();
    try { const result = await boundedApi<Snapshot>("/api/operator/finance", undefined, signal, 25000); signal.throwIfAborted(); setSnapshot(result); setRoundTrip(Math.round(performance.now() - started)); }
    catch (cause) { if (!signal.aborted) setError(errorText(cause)); } finally { if (refreshing.current === signal) refreshing.current = null; if (!signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; void load(controller.signal); return () => { controller.abort(); lifetime.current = null; }; }, [load]);
  const read = async (action: "market" | "news") => {
    const signal = lifetime.current?.signal; if (!signal || readingNow.current) return; readingNow.current = true; setReading(action); setDataError("");
    try {
      const result = await boundedApi<ReadResult>("/api/operator/tools/invoke", { conversationId, requestId: crypto.randomUUID(), tool: "jarvis_finance", input: { action, ...(action === "market" ? { symbol } : {}) } }, signal, 25000);
      signal.throwIfAborted(); if (!result.ok || !result.result) throw new Error(result.error?.message ?? "No Finance observation was returned.");
      const data = result.result.data;
      if (action === "market" && data.market) { setMarket(data.market); setMarketObserved(data.observedAt); }
      else if (action === "news" && data.news) { setNews(data.news); setNewsObserved(data.observedAt); }
      else throw new Error("The Finance source returned an incomplete result.");
    } catch (cause) { if (!signal.aborted) setDataError(errorText(cause)); } finally { readingNow.current = false; if (!signal.aborted) setReading(""); }
  };
  const paper = snapshot?.paper, study = snapshot?.study, research = snapshot?.research;
  return (
    <Box component="section" aria-label="Finance workspace">
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="caption" color="primary" sx={{ fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>
            Connected to JARVIS
          </Typography>
          <Typography variant="h4" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <BarChart3 size={26} /> Finance
          </Typography>
          <Typography variant="body2" color="text.secondary">Paper wallet, historical research and dated market data — directly from your native services.</Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Chip size="small" label="Read-only · virtual funds" />
          <Button variant="outlined" size="small" disabled={loading} startIcon={<RefreshCw size={16} />} onClick={() => { if (lifetime.current) void load(lifetime.current.signal); }}>Refresh Finance</Button>
          <Button variant="outlined" size="small" disabled={busy} startIcon={<Phone size={16} />} onClick={talk}>Talk to JARVIS</Button>
        </Box>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}{snapshot ? " The snapshot below is the previous successful read." : ""}</Alert>}
      {loading && !snapshot && <Box sx={{ display: "flex", alignItems: "center", gap: 1 }} role="status"><CircularProgress size={18} /><Typography variant="body2">Reading the connected services…</Typography></Box>}
      {snapshot && <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 2 }}>{snapshot.status === "ready" ? "Services connected" : "Some sources unavailable"} · Observed {date(snapshot.observedAt)} · {roundTrip} ms round trip · {snapshot.elapsedMs} ms connector{snapshot.cacheAgeMs > 0 ? ` · cached ${(snapshot.cacheAgeMs / 1000).toFixed(1)}s` : ""}</Typography>}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}><Activity size={18} /> Paper wallet</Typography>
            {paper?.status === "unavailable" ? unavailable(paper) : paper && <>
              <Typography variant="h4">{value(paper.balance)} <Typography component="small" variant="body2" color="text.secondary">{paper.currency} virtual</Typography></Typography>
              <Typography variant="body2">{paper.openPositions} / {paper.maxPositions} open positions · {paper.state ?? "Unknown state"}</Typography>
              <Typography variant="body2">Allocated: {value(paper.allocatedBalance)} USDT. The reserve is not profit.</Typography>
              <Typography variant="caption" color="text.secondary">{paper.strategy ?? "Unknown strategy"} · {value(paper.closedTrades, 0)} closed trades</Typography>
              {paper.positions.map((position, index) => <Typography variant="body2" key={position.id ?? index}>{position.pair ?? "Unknown pair"} · {value(position.profitUSDT)} USDT unrealized</Typography>)}
              <Accordion variant="outlined" sx={{ mt: 1 }}>
                <AccordionSummary expandIcon={<ChevronDown size={16} />}>Last seven daily results</AccordionSummary>
                <AccordionDetails sx={{ p: 0 }}>
                  <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Date</TableCell><TableCell>Net USDT</TableCell><TableCell>Trades</TableCell></TableRow></TableHead>
                    <TableBody>{paper.daily.map((row, index) => <TableRow key={row.date ?? index}><TableCell>{row.date ?? "Unknown"}</TableCell><TableCell>{value(row.profitUSDT)}</TableCell><TableCell>{value(row.trades, 0)}</TableCell></TableRow>)}</TableBody>
                  </Table></TableContainer>
                </AccordionDetails>
              </Accordion>
              <Button variant="outlined" size="small" disabled={busy} endIcon={<ArrowUpRight size={14} />} sx={{ mt: 1.5 }}
                onClick={() => ask("Read my connected Finance paper status and daily results. Briefly explain the actual activity and distinguish the virtual wallet from allocated capital.")}>
                Review with JARVIS
              </Button>
            </>}
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Locked study</Typography>
            {study?.status === "unavailable" ? unavailable(study) : study && <>
              <Chip size="small" color="warning" label="No qualified candidate" />
              <Typography variant="body2" sx={{ mt: 1 }}>Historical validation · {study.id}</Typography>
              <TableContainer sx={{ mt: 1 }}>
                <Table size="small"><TableHead><TableRow><TableCell>Candidate</TableCell><TableCell>Net USDT</TableCell><TableCell>Wallet DD</TableCell><TableCell>Trades</TableCell></TableRow></TableHead>
                  <TableBody>{study.validation.map((row, index) => <TableRow key={row.label ?? index}><TableCell>{row.epoch === null ? "Baseline" : `Epoch ${row.epoch}`}</TableCell><TableCell>{value(row.netUSDT)}</TableCell><TableCell>{value(row.walletDrawdownUSDT)}</TableCell><TableCell>{row.trades}</TableCell></TableRow>)}</TableBody>
                </Table>
              </TableContainer>
              <Typography variant="body2" sx={{ mt: 1 }}>Smaller losses are not profits. Holdout {study.holdoutEvaluated ? "evaluated" : "not evaluated"}; paper parameters {study.paperParametersChanged ? "changed" : "unchanged"}.</Typography>
              <Typography variant="caption" color="text.secondary">Study verified {date(study.verifiedAt)}</Typography>
              <Box><Button variant="outlined" size="small" disabled={busy} endIcon={<ArrowUpRight size={14} />} sx={{ mt: 1.5 }}
                onClick={() => ask("Read the connected Finance locked study comparison. Explain the baseline versus the best validation candidate, distinguish reduced losses from profit, and report the holdout and promotion status.")}>
                Explain with JARVIS
              </Button></Box>
            </>}
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6">Market data</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Dated daily bars from OpenBB / yfinance. These are not live quotes.</Typography>
            <Box component="form" sx={{ display: "flex", gap: 1, alignItems: "flex-end", flexWrap: "wrap" }} onSubmit={(event) => { event.preventDefault(); void read("market"); }}>
              <FormControl sx={{ minWidth: 160 }}>
                <InputLabel id="market-symbol-label">Market symbol</InputLabel>
                <Select labelId="market-symbol-label" label="Market symbol" value={symbol} onChange={(event) => setSymbol(String(event.target.value))}>
                  {symbols.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                </Select>
              </FormControl>
              <Button variant="contained" type="submit" disabled={reading !== ""}>{reading === "market" ? "Reading…" : "Read daily prices"}</Button>
            </Box>
            {market && <>
              <Typography variant="h4" sx={{ mt: 1.5 }}>{value(market.latestClose)} <Typography component="small" variant="body2" color="text.secondary">{market.quoteCurrency} · {market.symbol}</Typography></Typography>
              <Typography variant="body2">Latest daily close: {market.latestDate}</Typography>
              <TableContainer sx={{ mt: 1 }}>
                <Table size="small"><TableHead><TableRow><TableCell>Bar date</TableCell><TableCell>Close</TableCell></TableRow></TableHead>
                  <TableBody>{market.bars.slice(-5).map((row) => <TableRow key={row.date}><TableCell>{row.date}</TableCell><TableCell>{value(row.close)}</TableCell></TableRow>)}</TableBody>
                </Table>
              </TableContainer>
              <Typography variant="caption" color="text.secondary">Retrieved {date(marketObserved)}</Typography>
            </>}
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Research workbench</Typography>
            {research?.status === "unavailable" ? unavailable(research) : research && <>
              <Typography variant="body2">{research.totalResults} saved historical results · historical server mode</Typography>
              <Box component="ul" sx={{ m: 0, mt: 1, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1 }}>
                {research.results.map((row, index) => (
                  <li key={row.filename ?? index}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.strategy ?? "Unknown strategy"}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{date(row.executedAt)}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{row.filename ?? "Unknown result"}</Typography>
                  </li>
                ))}
              </Box>
            </>}
          </CardContent>
        </Card>
      </Box>
      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
            <Typography variant="h6">Public headlines</Typography>
            <Button variant="outlined" size="small" disabled={reading !== ""} onClick={() => void read("news")}>{reading === "news" ? "Reading…" : "Read BBC headlines"}</Button>
          </Box>
          <Typography variant="body2" color="text.secondary">Source material for research. Headlines do not authorize actions.</Typography>
          {news && <>
            <Box component="ul" sx={{ m: 0, mt: 1, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1 }}>
              {news.headlines.map((item, index) => (
                <li key={item.url ?? index}>
                  {item.url
                    ? <Link href={item.url} target="_blank" rel="noreferrer">{item.title ?? "Untitled"} <ArrowUpRight size={13} /></Link>
                    : <Typography variant="body2">{item.title ?? "Untitled"}</Typography>}
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{date(item.publishedAt)}</Typography>
                </li>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary">Retrieved {date(newsObserved)}</Typography>
          </>}
          {dataError && <Alert severity="error" sx={{ mt: 1.5 }}>{dataError} Any earlier prices/headlines retain their displayed timestamps.</Alert>}
        </CardContent>
      </Card>
    </Box>
  );
}
