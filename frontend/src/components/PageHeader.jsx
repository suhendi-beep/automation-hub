import React from "react";
import Icon from "./Icon.jsx";

function renderTitle(title) {
  if (typeof title !== "string") return title;
  const words = title.trim().split(/\s+/);
  if (words.length < 2) return <span className="hl">{title}</span>;
  const last = words.pop();
  return <>{words.join(" ")} <span className="hl">{last}</span></>;
}

export default function PageHeader({ icon, eyebrow, title, subtitle, actions }) {
  return (
    <header className="page-header" style={H.root}>
      <div style={H.main}>
        {icon && (
          <span className="ph-icon" style={H.iconWrap}>
            <Icon name={icon} size={19} strokeWidth={1.9} />
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          {eyebrow && <div style={H.eyebrow}>{eyebrow}</div>}
          <h1 style={H.title}>{renderTitle(title)}</h1>
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
    gap: 18, padding: "20px 28px",
    borderBottom: "1px solid var(--border)", flexShrink: 0,
  },
  main: { display: "flex", alignItems: "center", gap: 14, minWidth: 0 },
  iconWrap: {
    width: 42, height: 42, borderRadius: 14, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  eyebrow: {
    fontSize: 9.5, fontWeight: 700, letterSpacing: ".16em",
    textTransform: "uppercase", color: "var(--rose)", marginBottom: 3,
  },
  title: {
    fontSize: 21, fontWeight: 750, color: "var(--text)",
    letterSpacing: "-.035em", lineHeight: 1.2,
  },
  subtitle: { fontSize: 12.5, color: "var(--muted)", marginTop: 4, letterSpacing: "-.005em" },
  actions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
};
