import React, { useState } from "react";

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
        setSt("done"); setMsg(`✅ ${d.count} cookies saved`);
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
          <span>🔶 OCI Session</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {loggedIn ? (
          <div className="modal-body">
            <div className="oci-status-ok">✓ Session Active</div>
            {savedAt && <div className="oci-saved">Saved: {new Date(savedAt).toLocaleString()}</div>}
            <button className="btn-danger" onClick={logout}>Disconnect</button>
          </div>
        ) : (
          <div className="modal-body">
            <p className="modal-note" style={{ fontWeight: 600 }}>How to connect OCI:</p>
            <ol style={{ fontSize: 11, color: "var(--muted)", paddingLeft: 16, lineHeight: 2.2 }}>
              <li>Install <strong style={{ color: "var(--text2)" }}>EditThisCookie</strong> in Chrome</li>
              <li>Login at <a href="https://cloud.oracle.com" target="_blank" rel="noreferrer" style={{ color: "#B11226" }}>cloud.oracle.com</a></li>
              <li>Export cookies → Paste below</li>
            </ol>
            <label className="form-label">Cookies JSON</label>
            <textarea
              className="form-input"
              style={{ height: 80, resize: "vertical", fontFamily: "monospace", fontSize: 10 }}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder='[{"name":"..."}]'
              disabled={st === "loading"}
            />
            {msg && <div className={"form-msg " + st}>{msg}</div>}
            <button className="btn-primary" onClick={save} disabled={st === "loading" || !json.trim()}>
              {st === "loading" ? "Saving…" : "💾 Save & Connect"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
