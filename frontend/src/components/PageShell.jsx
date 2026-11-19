import React from "react";

export default function PageShell({ title, subtitle, actions, children }) {
  return (
    <div style={P.root}>
      <header style={P.header}>
        <div style={{ minWidth: 0 }}>
          <div style={P.title}>{title}</div>
          {subtitle && <div style={P.subtitle}>{subtitle}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {actions}
        </div>
      </header>
      <div style={P.content}>
        <div style={{ maxWidth: 1100 }}>{children}</div>
      </div>
    </div>
  );
}

export const card = {
  background: "var(--bg2)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "16px 18px",
};

export const btn = {
  background: "var(--surface2)",
  border: "1px solid var(--border2)",
  color: "var(--text4)",
  fontFamily: "inherit",
  fontSize: 12,
  padding: "6px 13px",
  borderRadius: 6,
  cursor: "pointer",
};

export const btnPrimary = {
  ...btn,
  background: "#B11226",
  borderColor: "#B11226",
  color: "#fff",
  fontWeight: 600,
};

export const btnDanger = {
  ...btn,
  color: "#ef4444",
  borderColor: "rgba(239,68,68,.35)",
};

export const input = {
  width: "100%",
  background: "var(--surface2)",
  border: "1px solid var(--border2)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 12,
  padding: "9px 12px",
  borderRadius: 7,
  outline: "none",
  boxSizing: "border-box",
};

export const label = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".08em",
  color: "var(--muted2)",
  textTransform: "uppercase",
  marginBottom: 5,
  display: "block",
};

export const table = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};

export const th = {
  textAlign: "left",
  padding: "9px 10px",
  borderBottom: "1px solid var(--border2)",
  color: "var(--muted2)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
};

export const td = {
  padding: "10px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text3)",
  verticalAlign: "middle",
};

export const badge = (color) => ({
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 8px",
  borderRadius: 99,
  background: `${color}1a`,
  color,
  border: `1px solid ${color}33`,
  whiteSpace: "nowrap",
});

export function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <div style={{
      background: "var(--red-dim)", color: "#fca5a5",
      border: "1px solid rgba(239,68,68,.25)",
      borderRadius: 8, padding: "10px 12px", fontSize: 12, marginBottom: 12,
    }}>
      {message}
    </div>
  );
}

const P = {
  root: {
    height: "100%", display: "flex", flexDirection: "column",
    background: "var(--bg)", overflow: "hidden",
    fontFamily: "Inter,system-ui,sans-serif",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 12, padding: "13px 24px", borderBottom: "1px solid var(--border)",
    background: "var(--bg2)", flexShrink: 0,
  },
  title: { fontSize: 16, fontWeight: 700, color: "var(--text2)", letterSpacing: "-.01em" },
  subtitle: { fontSize: 11, color: "var(--muted)", marginTop: 2 },
  content: { flex: 1, overflowY: "auto", padding: "20px 24px" },
};
