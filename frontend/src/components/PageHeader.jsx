import React from "react";
import Icon from "./Icon.jsx";

export default function PageHeader({ icon, eyebrow, title, subtitle, actions }) {
  return (
    <header style={H.root}>
      <div style={H.main}>
        {icon && (
          <span style={H.iconWrap}>
            <Icon name={icon} size={19} strokeWidth={1.9} />
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          {eyebrow && <div style={H.eyebrow}>{eyebrow}</div>}
          <h1 style={H.title}>{title}</h1>
          {subtitle && <div style={H.subtitle}>{subtitle}</div>}
        </div>
      </div>
      {actions && <div style={H.actions}>{actions}</div>}
    </header>
  );
}

const H = {
  root: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 18, padding: "20px 28px", background: "var(--bg2)",
    borderBottom: "1px solid var(--border)", flexShrink: 0,
  },
  main: { display: "flex", alignItems: "center", gap: 14, minWidth: 0 },
  iconWrap: {
    width: 40, height: 40, borderRadius: 11, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "var(--accent-soft)", color: "var(--accent)",
    border: "1px solid var(--border)",
  },
  eyebrow: {
    fontSize: 9.5, fontWeight: 650, letterSpacing: ".12em",
    textTransform: "uppercase", color: "var(--muted3)", marginBottom: 3,
  },
  title: {
    fontSize: 20, fontWeight: 700, color: "var(--text)",
    letterSpacing: "-.028em", lineHeight: 1.2,
  },
  subtitle: { fontSize: 12.5, color: "var(--muted)", marginTop: 4 },
  actions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
};
