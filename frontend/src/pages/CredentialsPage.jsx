import React, { useState, useEffect } from "react";
import PageShell, {
  btn, btnPrimary, btnDanger, input, label, card, table, th, td, badge, ErrorBox, fmtDate,
} from "../components/PageShell.jsx";
import OciModal from "../components/OciModal.jsx";

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
      title="Credentials"
      subtitle="OCI session and application user accounts"
      actions={isAdmin ? <button style={btnPrimary} onClick={() => setModal({ mode: "add", username: "", display: "", password: "", role: "engineer" })}>+ Add user</button> : null}
    >
      <ErrorBox message={error} />

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>OCI Session</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
              {ociSession?.logged_in
                ? `Connected (${ociSession.count || 0} cookies, saved ${fmtDate(ociSession.saved_at)})`
                : "Not connected — backup automations requiring OCI login will be blocked."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {ociSession?.logged_in ? (
              <>
                <button style={btn} onClick={() => setShowOci(true)}>Manage</button>
                <button style={btnDanger} onClick={disconnectOci}>Disconnect</button>
              </>
            ) : (
              <button style={btnPrimary} onClick={() => setShowOci(true)}>Connect OCI</button>
            )}
          </div>
        </div>
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>Application Users</div>
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
                <td style={{ ...td, color: "var(--text2)", fontWeight: 600 }}>
                  {u.username}
                  {u.username === currentUser && (
                    <span style={{ ...badge("#22C55E"), marginLeft: 8 }}>you</span>
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
                    <span style={badge(u.role === "admin" ? "#B11226" : "#3B82F6")}>{u.role}</span>
                  )}
                </td>
                {isAdmin && (
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button style={{ ...btn, marginRight: 6 }} onClick={() => setModal({ mode: "reset", username: u.username, password: "" })}>
                      Reset password
                    </button>
                    {u.username !== currentUser && (
                      <button style={btnDanger} onClick={() => removeUser(u)}>Delete</button>
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
              <span>{modal.mode === "add" ? "Add user" : `Reset password — ${modal.username}`}</span>
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
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
                {saving ? "Saving…" : modal.mode === "add" ? "Create user" : "Reset password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
