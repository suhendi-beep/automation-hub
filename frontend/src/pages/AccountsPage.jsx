import React, { useState, useEffect } from "react";
import PageShell, {
  btn, btnPrimary, btnDanger, input, label, card, table, th, td, badge, ErrorBox, fmtDate,
} from "../components/PageShell.jsx";
import Icon from "../components/Icon.jsx";

const EMPTY = { name: "", platform: "OCI", tenancy: "", region: "", notes: "" };

export default function AccountsPage({ currentRole }) {
  const isAdmin = currentRole === "admin";
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // { id?, form }
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d) => { setAccounts(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  };

  useEffect(load, []);

  const openAdd = () => setModal({ form: { ...EMPTY } });
  const openEdit = (a) => setModal({ id: a.id, form: { ...a } });

  const save = async () => {
    if (!modal) return;
    setSaving(true);
    setError("");
    const isEdit = !!modal.id;
    try {
      const res = await fetch(isEdit ? `/api/accounts/${modal.id}` : "/api/accounts", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modal.form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save account");
      setModal(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a) => {
    if (!window.confirm(`Delete account "${a.name}"?`)) return;
    const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to delete account");
      return;
    }
    load();
  };

  const field = (key) => ({
    value: modal?.form?.[key] ?? "",
    onChange: (e) => setModal((m) => ({ ...m, form: { ...m.form, [key]: e.target.value } })),
  });

  return (
    <PageShell
      icon="accounts"
      title="Accounts"
      subtitle="Cloud accounts used by automations (tenancy / account IDs)"
      actions={
        <>
          <button style={btn} onClick={load}><Icon name="refresh" size={12}/> Refresh</button>
          {isAdmin && <button style={btnPrimary} onClick={openAdd}><Icon name="plus" size={12}/> Add account</button>}
        </>
      }
    >
      <ErrorBox message={error} />

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 12, padding: 20 }}>Loading…</div>
      ) : accounts.length === 0 ? (
        <div style={{ ...card, fontSize: 12, color: "var(--muted)" }}>
          No accounts yet.{isAdmin ? " Use “Add account” to register one." : " Ask an admin to add one."}
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Platform</th>
                <th style={th}>Tenancy / Account</th>
                <th style={th}>Region</th>
                <th style={th}>Created</th>
                {isAdmin && <th style={th} />}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...td, color: "var(--text2)", fontWeight: 600 }}>{a.name}</td>
                  <td style={td}><span style={badge("var(--blue)", "var(--blue-dim)")}>{a.platform}</span></td>
                  <td style={{ ...td, fontFamily: "var(--mono)", fontSize: 11 }}>{a.tenancy || "—"}</td>
                  <td style={td}>{a.region || "—"}</td>
                  <td style={td}>{fmtDate(a.createdAt)}</td>
                  {isAdmin && (
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <button style={{ ...btn, marginRight: 6 }} onClick={() => openEdit(a)}><Icon name="edit" size={11}/> Edit</button>
                      <button style={btnDanger} onClick={() => remove(a)}><Icon name="trash" size={11}/> Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="accounts" size={14}/> {modal.id ? "Edit account" : "Add account"}
              </span>
              <button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><Icon name="close" size={14}/></button>
            </div>
            <div className="modal-body">
              <div>
                <label style={label}>Name</label>
                <input style={input} {...field("name")} placeholder="e.g. Pelindo Production" />
              </div>
              <div>
                <label style={label}>Platform</label>
                <select style={input} {...field("platform")}>
                  <option>OCI</option>
                  <option>AWS</option>
                  <option>Huawei</option>
                </select>
              </div>
              <div>
                <label style={label}>Tenancy / Account ID</label>
                <input style={input} {...field("tenancy")} placeholder="ocid1.tenancy.oc1..…" />
              </div>
              <div>
                <label style={label}>Region</label>
                <input style={input} {...field("region")} placeholder="ap-southeast-1" />
              </div>
              <div>
                <label style={label}>Notes</label>
                <textarea style={{ ...input, height: 64, resize: "vertical" }} {...field("notes")} />
              </div>
              <button style={{ ...btnPrimary, width: "100%" }} onClick={save} disabled={saving || !modal.form.name.trim()}>
                <Icon name="check" size={12}/> {saving ? "Saving…" : "Save account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
