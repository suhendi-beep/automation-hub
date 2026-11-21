import React, { useState, useEffect } from "react";
import PageShell, { btn, btnPrimary, btnDanger, input, label, card, ErrorBox } from "../components/PageShell.jsx";
import { clearSession } from "../api.js";
import Icon from "../components/Icon.jsx";

export default function SettingsPage({ currentUser, currentRole, displayName }) {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => {});
  }, []);

  const changePassword = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (form.new_password !== form.confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: form.current_password,
          new_password: form.new_password,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to change password");
      setForm({ current_password: "", new_password: "", confirm: "" });
      if (d.status === "pending") {
        setSuccess("Request sent. An admin must approve the new password before it takes effect.");
      } else {
        if (d.token) sessionStorage.setItem("pr_token", d.token);
        setSuccess("Password changed. Other sessions will be logged out.");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const signOut = () => {
    fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUser,
        display: displayName,
        action: "Logout",
        category: "auth",
        detail: "Signed out from Settings",
      }),
    }).catch(() => {}).finally(clearSession);
  };

  return (
    <PageShell icon="settings" title="Settings" subtitle="Profile, security, and application configuration">
      <ErrorBox message={error} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div style={card}>
          <div style={sectionTitle}>Profile</div>
          <Row label="Username" value={currentUser} />
          <Row label="Display name" value={displayName} />
          <Row label="Role" value={currentRole} />
        </div>

        <div style={card}>
          <div style={sectionTitle}>Appearance</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Current theme: <strong style={{ color: "var(--gold)" }}>Midnight glass</strong>
            </div>
            <span style={{ fontSize: 10.5, color: "var(--rose)", border: "1px solid var(--border3)", padding: "4px 10px", borderRadius: 99 }}>
              Locked
            </span>
          </div>
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 14 }}>
            <button style={btnDanger} onClick={signOut}><Icon name="logout" size={12}/> Sign out</button>
          </div>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={sectionTitle}>Change password</div>
        {success && (
          <div style={{ fontSize: 12, color: "var(--green)", marginBottom: 10 }}>{success}</div>
        )}
        <form onSubmit={changePassword} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
          <div>
            <label style={label}>Current password</label>
            <input
              style={input} type="password" autoComplete="current-password"
              value={form.current_password}
              onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))}
            />
          </div>
          <div>
            <label style={label}>New password</label>
            <input
              style={input} type="password" autoComplete="new-password"
              value={form.new_password}
              onChange={(e) => setForm((f) => ({ ...f, new_password: e.target.value }))}
            />
          </div>
          <div>
            <label style={label}>Confirm</label>
            <input
              style={input} type="password" autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
            />
          </div>
          <button
            type="submit"
            style={btnPrimary}
            disabled={saving || form.new_password.length < 6 || !form.current_password}
          >
            {saving ? "Saving…" : "Update"}
          </button>
        </form>
        <div style={{ fontSize: 10, color: "var(--muted2)", marginTop: 8 }}>
          Min. 6 characters with uppercase, lowercase, number, and symbol. Admin changes apply immediately;
          engineer changes are queued for admin approval.
        </div>
      </div>

      <div style={card}>
        <div style={sectionTitle}>System</div>
        <Row label="Version" value={config?.version || "—"} />
        <Row label="Grafana URL" value={config?.grafana_base_url || "—"} />
        <Row
          label="Grafana credentials"
          value={config ? (config.grafana_configured ? "configured" : "missing") : "—"}
        />
        <Row label="Storage path" value={config?.shared_dir || "—"} />
      </div>
    </PageShell>
  );
}

function Row({ label: l, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
      <span style={{ color: "var(--muted2)" }}>{l}</span>
      <span style={{ color: "var(--text3)", textAlign: "right", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

const sectionTitle = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: ".05em",
  color: "var(--text2)",
  textTransform: "uppercase",
  marginBottom: 8,
};
