import { createTheme } from "@mui/material/styles";

// JARVIS Command Center — professional Material Design theme.
// Dark ops console first (emerald on near-black), light workspace supported.
// Every screen is styled from these tokens; no hand-written component CSS.
export function makeJarvisTheme(mode: "dark" | "light") {
  const dark = mode === "dark";
  return createTheme({
    palette: {
      mode,
      primary: {
        light: "#6ee7b7",
        main: "#10b981",
        dark: "#059669",
        contrastText: dark ? "#04120c" : "#ffffff",
      },
      secondary: {
        light: "#7dd3fc",
        main: "#0284c7",
        dark: "#075985",
        contrastText: "#ffffff",
      },
      background: dark
        ? { default: "#0a0f1a", paper: "#0f1622" }
        : { default: "#eef2f6", paper: "#ffffff" },
      success: { main: "#10b981" },
      warning: { main: "#f59e0b" },
      error: { main: "#f87171" },
      info: { main: "#38bdf8" },
    },
    typography: {
      fontFamily:
        "'IBM Plex Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      h1: { fontWeight: 700, fontSize: "1.75rem", lineHeight: 1.2 },
      h2: { fontWeight: 700, fontSize: "1.35rem", lineHeight: 1.25 },
      h3: { fontWeight: 600, fontSize: "1.1rem", lineHeight: 1.3 },
      h4: { fontWeight: 600, fontSize: "1rem", lineHeight: 1.35 },
      h5: { fontWeight: 600, fontSize: "0.95rem", lineHeight: 1.4 },
      h6: { fontWeight: 600, fontSize: "0.9rem", lineHeight: 1.4 },
      button: { textTransform: "none", fontWeight: 600 },
    },
    shape: { borderRadius: 12 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 10 } },
      },
      MuiIconButton: {
        styleOverrides: { root: { borderRadius: 10 } },
      },
      MuiCard: {
        styleOverrides: { root: { borderRadius: 14 } },
      },
      MuiPaper: {
        styleOverrides: { rounded: { borderRadius: 14 } },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: 16 } },
      },
      MuiChip: {
        styleOverrides: { root: { fontWeight: 600 } },
      },
      MuiTextField: {
        defaultProps: { size: "small", fullWidth: true },
      },
      MuiFormControl: {
        defaultProps: { size: "small", fullWidth: true },
      },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 700, textTransform: "uppercase", fontSize: "0.72rem", letterSpacing: "0.06em" },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: { borderRight: "none" },
        },
      },
    },
  });
}
