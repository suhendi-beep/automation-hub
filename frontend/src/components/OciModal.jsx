import React, { useState } from "react";
import Icon from "./Icon.jsx";

export const OCI_SIGNIN_URL = "https://www.oracle.com/cloud/sign-in.html?redirect_uri=https%3A%2F%2Fcloud.oracle.com%2F";

const linkBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 14px", textDecoration: "none", fontFamily: "inherit", fontSize: 12,
};

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
            <Icon name="cloud" size={15} /> OCI Console
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
            <p className="modal-note" style={{ marginTop: 10 }}>
              OCI links (Top SQL, DB Systems, Performance Hub) use the account signed in
              to this browser. Sign in with your own Oracle Cloud account.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <a className="btn-primary" href={OCI_SIGNIN_URL} target="_blank" rel="noreferrer" style={linkBtn}>
                <Icon name="externalLink" size={13} /> Open OCI Console
              </a>
              <button className="btn-danger" onClick={logout}>Disconnect</button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <a className="btn-primary" href={OCI_SIGNIN_URL} target="_blank" rel="noreferrer"
              style={{ ...linkBtn, width: "100%", justifyContent: "center" }}>
              <Icon name="externalLink" size={13} /> Sign in to OCI with your account
            </a>
            <p className="modal-note" style={{ marginTop: 10 }}>
              Opens the Oracle Cloud sign-in page in a new tab. Use your own account so
              Top SQL and other OCI console links open with your session.
            </p>
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <p className="modal-note" style={{ fontWeight: 600 }}>Browser sign-in vs app status</p>
              <p className="modal-note" style={{ marginTop: 4 }}>
                Signing in above only affects this browser (Top SQL and other OCI links).
                The app status stays offline until the OCI session is connected below.
              </p>
            </div>
            <p className="modal-note" style={{ fontWeight: 600, marginTop: 12 }}>
              To run server-side OCI reports (weekly backup):
            </p>
            <ol style={{ fontSize: 11, color: "var(--muted)", paddingLeft: 16, lineHeight: 2.2 }}>
              <li>Sign in at the link above</li>
              <li>Install <strong style={{ color: "var(--text2)" }}>EditThisCookie</strong> in Chrome</li>
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
