// Shared screen kit — thin wrappers over real MUI components.
// Styling comes from the theme (src/theme.ts); nothing hand-rolled here.
import { memo } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

export function PageHeader({ kicker, title, subtitle, actions }: {
  kicker: string; title: string; subtitle: string; actions?: ReactNode;
}) {
  return (
    <Box sx={{ mb: 3, display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 2 }}>
      <Box>
        <Typography variant="caption" color="primary" sx={{ fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>
          {kicker}
        </Typography>
        <Typography variant="h1" sx={{ mt: 0.5 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography>
      </Box>
      {actions && <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>{actions}</Box>}
    </Box>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
          {label}
        </Typography>
        <Typography variant="h4" sx={{ mt: 0.5 }}>{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

export function DataTable({ headers, rows, empty }: {
  headers: string[]; rows: ReactNode[][]; empty: string;
}) {
  if (!rows.length)
    return <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>{empty}</Typography>;
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            {headers.map((head) => <TableCell key={head}>{head}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((cells, index) => (
            <TableRow key={index} hover>
              {cells.map((cell, cellIndex) => <TableCell key={cellIndex} sx={{ verticalAlign: "top" }}>{cell}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function LoadingRow({ text }: { text: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, py: 8 }} role="status">
      <CircularProgress size={20} />
      <Typography variant="body2" color="text.secondary">{text}</Typography>
    </Box>
  );
}

export function NoticeBanner({ kind, text }: { kind: "demo" | "error"; text: string }) {
  if (kind === "demo")
    return <Alert severity="warning" sx={{ mb: 2.5 }}><strong>Demo. </strong>{text}</Alert>;
  return <Alert severity="error" sx={{ mb: 2.5 }}>{text}</Alert>;
}

export function PrimaryButton({ children, onClick, disabled, type, startIcon }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit"; startIcon?: ReactNode;
}) {
  return (
    <Button variant="contained" color="primary" onClick={onClick} disabled={disabled} type={type} startIcon={startIcon}>
      {children}
    </Button>
  );
}

export function toneColor(tone: string): "default" | "success" | "warning" | "info" | "error" {
  if (tone === "green") return "success";
  if (tone === "amber") return "warning";
  if (tone === "blue") return "info";
  if (tone === "red") return "error";
  return "default";
}

export function EmptyState({ icon, title, children }: {
  icon?: React.ComponentType<{ size?: number | string }>;
  title: string;
  children: ReactNode;
}) {
  const Icon = icon;
  return (
    <Paper variant="outlined" sx={{ p: 4, textAlign: "center", maxWidth: 560, mx: "auto" }}>
      {Icon && (
        <Avatar sx={{ width: 56, height: 56, mx: "auto", bgcolor: "action.hover" }}>
          <Icon size={30} />
        </Avatar>
      )}
      <Typography variant="h5" sx={{ mt: 2 }}>{title}</Typography>
      <Box sx={{ mt: 1 }}>{children}</Box>
    </Paper>
  );
}

const markdownSx = {
  wordBreak: "break-word",
  "& p": { my: 1 },
  "& a": { color: "primary.light" },
  "& pre": {
    bgcolor: "rgba(0,0,0,0.35)",
    border: 1,
    borderColor: "divider",
    borderRadius: 2,
    p: 1.5,
    overflowX: "auto",
    fontSize: "0.8rem",
  },
  "& code": { fontFamily: "monospace", fontSize: "0.85em" },
  "& table": { borderCollapse: "collapse", width: "100%", my: 1 },
  "& th, & td": { border: 1, borderColor: "divider", px: 1, py: 0.5, textAlign: "left" },
  "& blockquote": { ml: 0, pl: 2, borderLeft: 3, borderColor: "primary.main", color: "text.secondary" },
  "& ul, & ol": { pl: 2.5 },
} as const;

export const RichText = memo(function RichText({ text }: { text: string }) {
  return (
    <Box sx={markdownSx}>
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
    </Box>
  );
});
