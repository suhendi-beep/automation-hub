import React, { useState } from "react";
import Icon from "./Icon.jsx";

export default function OciModal({ loggedIn, savedAt, onClose, onDone }) {
  const [json, setJson] = useState("");
  const [st, setSt] = useState("idle");
  const [msg, setMsg] = useState("");

  const save = async () => {
    if (!json.trim()) return;
    setSt("loading"); setMsg("Saving…");
    try {
      const d = await fetch("/api/oci/save_cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: json }),
      }).then((r) => r.json());
      if (d.status === "ok") {
        setSt("done"); setMsg(`${d.count} cookies saved`);
        setTimeout(onDone, 1500);
      } else {
        setSt("error"); setMsg("Error: " + (d.error || "unknown"));
      }
    } catch (e) {
      setSt("error"); setMsg(e.message);
    }
  };

  const logout = async () => {
    await fetch("/api/oci/logout", { method: "POST" });
    onDone();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="cloud" size={15} /> OCI session
          </span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>
        {loggedIn ? (
          <div className="modal-body">
            <div className="oci-status-ok" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="checkCircle" size={14} /> Session active
            </div>
            {savedAt && <div className="oci-saved">Saved: {new Date(savedAt).toLocaleString()}</div>}
            <button className="btn-danger" onClick={logout}>Disconnect</button>
          </div>
        ) : (
          <div className="modal-body">
            <p className="modal-note" style={{ fontWeight: 600 }}>How to connect OCI:</p>
            <ol style={{ fontSize: 11, color: "var(--muted)", paddingLeft: 16, lineHeight: 2.2 }}>
              <li>Install <strong style={{ color: "var(--text2)" }}>EditThisCookie</strong> in Chrome</li>
              <li>Login at <a href="https://cloud.oracle.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>cloud.oracle.com</a></li>
              <li>Export cookies → Paste below</li>
            </ol>
            <label className="form-label">Cookies JSON</label>
            <textarea
              className="form-input"
              style={{ height: 80, resize: "vertical", fontFamily: "var(--mono)", fontSize: 10 }}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder='[{"name":"..."}]'
              disabled={st === "loading"}
            />
            {msg && <div className={"form-msg " + st}>{msg}</div>}
            <button className="btn-primary" onClick={save} disabled={st === "loading" || !json.trim()}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {st === "loading" ? "Saving…" : (<><Icon name="check" size={13} /> Save &amp; connect</>)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
