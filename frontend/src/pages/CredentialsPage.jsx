import React, { useState, useEffect } from "react";
import PageShell, {
  btn, btnPrimary, btnDanger, input, label, card, table, th, td, badge, ErrorBox, fmtDate,
} from "../components/PageShell.jsx";
import OciModal from "../components/OciModal.jsx";
import Icon from "../components/Icon.jsx";

export default function CredentialsPage({ currentRole, currentUser, ociSession, onOciChange }) {
  const isAdmin = currentRole === "admin";
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [showOci, setShowOci] = useState(false);
  const [modal, setModal] = useState(null); // { mode:"add"|"reset", username, display, password, role }
  const [saving, setSaving] = useState(false);

  const loadUsers = () => {
    fetch("/api/auth/users")
      .then((r) => r.json())
      .then((d) => setUsers(Array.isArray(d) ? d : []))
      .catch((e) => setError(e.message));
  };

  useEffect(loadUsers, []);

  const disconnectOci = async () => {
    await fetch("/api/oci/logout", { method: "POST" });
    onOciChange();
  };

  const saveUser = async () => {
    if (!modal) return;
    setSaving(true);
    setError("");
    try {
      if (modal.mode === "add") {
        const res = await fetch("/api/auth/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: modal.username,
            display: modal.display,
            password: modal.password,
            role: modal.role,
          }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Failed to create user");
      } else {
        const res = await fetch(`/api/auth/users/${encodeURIComponent(modal.username)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: modal.password }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Failed to reset password");
      }
      setModal(null);
      loadUsers();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setRole = async (user, role) => {
    const res = await fetch(`/api/auth/users/${encodeURIComponent(user.username)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to update role");
      return;
    }
    loadUsers();
  };

  const removeUser = async (user) => {
    if (!window.confirm(`Delete user "${user.username}"?`)) return;
    const res = await fetch(`/api/auth/users/${encodeURIComponent(user.username)}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to delete user");
      return;
    }
    loadUsers();
  };

  const field = (key) => ({
    value: modal?.[key] ?? "",
    onChange: (e) => setModal((m) => ({ ...m, [key]: e.target.value })),
  });

  return (
    <PageShell
      icon="key"
      title="Credentials"
      subtitle="OCI session and application user accounts"
      actions={isAdmin ? <button style={btnPrimary} onClick={() => setModal({ mode: "add", username: "", display: "", password: "", role: "engineer" })}><Icon name="plus" size={12}/> Add user</button> : null}
    >
      <ErrorBox message={error} />

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="cloud" size={16}/>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>OCI session</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                {ociSession?.logged_in
                  ? `Connected — ${ociSession.count || 0} cookies, saved ${fmtDate(ociSession.saved_at)}`
                  : "Not connected. Backup automations requiring OCI login will be blocked."}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {ociSession?.logged_in ? (
              <>
                <button style={btn} onClick={() => setShowOci(true)}><Icon name="settings" size={12}/> Manage</button>
                <button style={btnDanger} onClick={disconnectOci}><Icon name="logout" size={12}/> Disconnect</button>
              </>
            ) : (
              <button style={btnPrimary} onClick={() => setShowOci(true)}><Icon name="link" size={12}/> Connect OCI</button>
            )}
          </div>
        </div>
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Application users</div>
          <div style={{ fontSize: 10, color: "var(--muted2)" }}>
            {isAdmin ? "Admin actions enabled" : "Read-only — admin access required to modify users"}
          </div>
        </div>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Username</th>
              <th style={th}>Display</th>
              <th style={th}>Role</th>
              {isAdmin && <th style={th} />}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username}>
                <td style={{ ...td, color: "var(--text)", fontWeight: 600 }}>
                  {u.username}
                  {u.username === currentUser && (
                    <span style={{ ...badge("var(--green)", "var(--green-dim)"), marginLeft: 8 }}>you</span>
                  )}
                </td>
                <td style={td}>{u.display}</td>
                <td style={td}>
                  {isAdmin ? (
                    <select
                      style={{ ...input, width: 130, padding: "5px 8px" }}
                      value={u.role}
                      onChange={(e) => setRole(u, e.target.value)}
                    >
                      <option value="engineer">engineer</option>
                      <option value="admin">admin</option>
                    </select>
                  ) : (
                    <span style={badge(u.role === "admin" ? "var(--accent)" : "var(--blue)", u.role === "admin" ? "var(--accent-soft)" : "var(--blue-dim)")}>{u.role}</span>
                  )}
                </td>
                {isAdmin && (
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button style={{ ...btn, marginRight: 6 }} onClick={() => setModal({ mode: "reset", username: u.username, password: "" })}>
                      <Icon name="key" size={11}/> Reset password
                    </button>
                    {u.username !== currentUser && (
                      <button style={btnDanger} onClick={() => removeUser(u)}><Icon name="trash" size={11}/> Delete</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showOci && (
        <OciModal
          loggedIn={ociSession?.logged_in}
          savedAt={ociSession?.saved_at}
          onClose={() => setShowOci(false)}
          onDone={() => { setShowOci(false); onOciChange(); }}
        />
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name={modal.mode === "add" ? "user" : "key"} size={14}/>
                {modal.mode === "add" ? "Add user" : `Reset password — ${modal.username}`}
              </span>
              <button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><Icon name="close" size={14}/></button>
            </div>
            <div className="modal-body">
              {modal.mode === "add" && (
                <>
                  <div>
                    <label style={label}>Username</label>
                    <input style={input} {...field("username")} placeholder="engineer.name" />
                  </div>
                  <div>
                    <label style={label}>Display name</label>
                    <input style={input} {...field("display")} placeholder="Engineer Name" />
                  </div>
                  <div>
                    <label style={label}>Role</label>
                    <select style={input} {...field("role")}>
                      <option value="engineer">engineer</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                </>
              )}
              <div>
                <label style={label}>{modal.mode === "add" ? "Password" : "New password"}</label>
                <input style={input} type="password" {...field("password")} placeholder="Minimum 8 characters" />
              </div>
              <button
                style={{ ...btnPrimary, width: "100%" }}
                onClick={saveUser}
                disabled={saving || modal.password.length < 8 || (modal.mode === "add" && !modal.username.trim())}
              >
                <Icon name="check" size={12}/> {saving ? "Saving…" : modal.mode === "add" ? "Create user" : "Reset password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
