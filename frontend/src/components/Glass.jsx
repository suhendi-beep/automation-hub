import React from "react";
import Icon from "./Icon.jsx";

/* Reusable midnight-glass primitives. */

export function GlassCard({ chamfer = false, className = "", style, children, ...rest }) {
  if (chamfer) {
    return (
      <div className={`chamfer-wrap ${className}`} style={style} {...rest}>
        <div className="glass-card chamfer">{children}</div>
        <span className="shard tr" />
        <span className="shard bl" />
      </div>
    );
  }
  return (
    <div className={`glass-card ${className}`} style={style} {...rest}>
      {children}
    </div>
  );
}

export function GlassButton({ variant = "secondary", icon, className = "", style, children, ...rest }) {
  const cls = variant === "primary" ? "glass-btn-primary" : "glass-btn-secondary";
  return (
    <button className={`${cls} ${className}`} style={style} {...rest}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </button>
  );
}

export function GlassInput({ className = "", style, ...rest }) {
  return <input className={`form-input ${className}`} style={style} {...rest} />;
}

export function GlassSidebar({ className = "", style, children, ...rest }) {
  return (
    <aside className={`app-sidebar ${className}`} style={style} {...rest}>
      {children}
    </aside>
  );
}

export function GlassModal({ open = true, title, onClose, width = 480, children, footer }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{title}</span>
          {onClose && (
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-body" style={{ paddingTop: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}
