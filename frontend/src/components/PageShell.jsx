import React from "react";
import Icon from "./Icon.jsx";
import PageHeader from "./PageHeader.jsx";

export default function PageShell({ title, subtitle, actions, children, eyebrow, icon }) {
  return (
    <div style={P.root}>
      <PageHeader
        icon={icon}
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
        actions={actions}
      />
      <div style={P.content}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>{children}</div>
      </div>
    </div>
  );
}

export const card = {
  background: "var(--bg2)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "16px 18px",
  boxShadow: "var(--shadow-card)",
};

export const btn = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  background: "var(--bg2)",
  border: "1px solid var(--border2)",
  color: "var(--text4)",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 500,
  padding: "7px 13px",
  borderRadius: 7,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const btnPrimary = {
  ...btn,
  background: "var(--accent)",
  borderColor: "var(--accent)",
  color: "#fff",
  fontWeight: 600,
};

export const btnDanger = {
  ...btn,
  color: "var(--red)",
  borderColor: "var(--border2)",
  background: "var(--red-dim)",
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
  transition: "border-color .15s, box-shadow .15s",
};

export const label = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: ".02em",
  color: "var(--muted)",
  marginBottom: 6,
  display: "block",
};

export const table = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};

export const th = {
  textAlign: "left",
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  background: "var(--bg3)",
  whiteSpace: "nowrap",
};

export const td = {
  padding: "11px 14px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text3)",
  verticalAlign: "middle",
};

export const badge = (color, bg) => {
  const isHex = typeof color === "string" && color.startsWith("#");
  return {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 99,
    background: bg || (isHex ? `${color}14` : "var(--surface2)"),
    color,
    border: `1px solid ${isHex ? `${color}2e` : "var(--border)"}`,
    whiteSpace: "nowrap",
    lineHeight: 1.6,
  };
};

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
      display: "flex", alignItems: "flex-start", gap: 8,
      background: "var(--red-dim)", color: "var(--red)",
      border: "1px solid var(--border2)",
      borderRadius: 8, padding: "10px 12px", fontSize: 12, marginBottom: 12,
    }}>
      <Icon name="warning" size={14} style={{ marginTop: 1 }} />
      <span>{message}</span>
    </div>
  );
}

export function EmptyState({ icon = "folder", title, children, action }) {
  return (
    <div style={{ ...card, textAlign: "center", padding: "48px 24px" }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12, margin: "0 auto 12px",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--surface2)", color: "var(--muted3)", border: "1px solid var(--border)",
      }}>
        <Icon name={icon} size={20} />
      </div>
      {title && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>{title}</div>}
      {children && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.6 }}>{children}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

const P = {
  root: {
    height: "100%", display: "flex", flexDirection: "column",
    background: "var(--bg)", overflow: "hidden",
    fontFamily: "var(--font)",
  },
  content: { flex: 1, overflowY: "auto", padding: "24px 28px 40px" },
};
