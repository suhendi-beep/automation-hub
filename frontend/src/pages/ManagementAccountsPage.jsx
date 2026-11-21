import React, { useCallback, useEffect, useState } from "react";
import PageShell, {
  btn, btnPrimary, btnDanger, input, label, card, table, th, td, badge,
  ErrorBox, EmptyState, fmtDate,
} from "../components/PageShell.jsx";
import Icon from "../components/Icon.jsx";

const FEATURE = "account-management";

const FEATURE_LABEL = {
  "engineer-activity": "Engineer Activity",
  "account-management": "Management Accounts",
};

const EMPTY_ACCOUNT = { name: "", platform: "OCI", tenancy: "", region: "", notes: "" };

function typeLabel(type) {
  return type === "password" ? "Password change" : "Access request";
}

function StatusBadge({ status }) {
  const map = {
    pending:  { c: "var(--amber)", b: "var(--amber-dim)" },
    approved: { c: "var(--green)", b: "var(--green-dim)" },
    rejected: { c: "var(--red)",   b: "var(--red-dim)" },
  };
  const s = map[status] || map.pending;
  return <span style={badge(s.c, s.b)}>{status}</span>;
}

export default function ManagementAccountsPage({ navigate }) {
  const [access, setAccess] = useState("checking");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");

  const [tab, setTab] = useState(() => {
    try {
      const t = sessionStorage.getItem("pr_mgmt_tab");
      if (t) sessionStorage.removeItem("pr_mgmt_tab");
      return t === "cloud" ? "cloud" : "approvals";
    } catch (_) {
      return "approvals";
    }
  });

  const [reqTab, setReqTab] = useState("pending");
  const [requests, setRequests] = useState([]);
  const [reqLoading, setReqLoading] = useState(true);
  const [reqError, setReqError] = useState("");
  const [acting, setActing] = useState("");

  const [accounts, setAccounts] = useState([]);
  const [accLoading, setAccLoading] = useState(true);
  const [accError, setAccError] = useState("");
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetch("/api/auth/me").then(r => r.json());
        const granted = me.role === "admin" || (me.features || []).includes(FEATURE);
        if (granted) {
          if (!cancelled) setAccess("granted");
          return;
        }
        const mine = await fetch("/api/requests/mine").then(r => r.json());
        const pending = Array.isArray(mine) && mine.some(
          r => r.type === "access" && r.feature === FEATURE && r.status === "pending"
        );
        if (!cancelled) setAccess(pending ? "pending" : "denied");
      } catch (_) {
        if (!cancelled) setAccess("denied");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const requestAccess = async () => {
    setRequestBusy(true);
    setRequestError("");
    try {
      const res = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: FEATURE }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to send the request");
      setAccess("pending");
    } catch (e) {
      setRequestError(e.message);
    } finally {
      setRequestBusy(false);
    }
  };

  const loadRequests = useCallback(() => {
    setReqLoading(true);
    setReqError("");
    fetch(`/api/requests?status=${reqTab}`)
      .then(r => r.json())
      .then(d => {
        if (d && d.error) throw new Error(d.error);
        setRequests(Array.isArray(d) ? d : []);
      })
      .catch(e => setReqError(e.message))
      .finally(() => setReqLoading(false));
  }, [reqTab]);

  const loadAccounts = useCallback(() => {
    setAccLoading(true);
    setAccError("");
    fetch("/api/accounts")
      .then(r => r.json())
      .then(d => {
        if (d && d.error) throw new Error(d.error);
        setAccounts(Array.isArray(d) ? d : []);
      })
      .catch(e => setAccError(e.message))
      .finally(() => setAccLoading(false));
  }, []);

  useEffect(() => {
    if (access !== "granted") return;
    loadRequests();
  }, [access, loadRequests]);

  useEffect(() => {
    if (access !== "granted") return;
    loadAccounts();
  }, [access, loadAccounts]);

  const review = async (id, action) => {
    setActing(id + action);
    setReqError("");
    try {
      const res = await fetch(`/api/requests/${id}/${action}`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to review the request");
      loadRequests();
    } catch (e) {
      setReqError(e.message);
    } finally {
      setActing("");
    }
  };

  const openAdd = () => setModal({ form: { ...EMPTY_ACCOUNT } });
  const openEdit = (a) => setModal({ id: a.id, form: { ...a } });

  const saveAccount = async () => {
    if (!modal) return;
    setSaving(true);
    setAccError("");
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
      loadAccounts();
    } catch (e) {
      setAccError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const removeAccount = async (a) => {
    if (!window.confirm(`Delete account "${a.name}"?`)) return;
    const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setAccError(d.error || "Failed to delete account");
      return;
    }
    loadAccounts();
  };

  const refresh = () => {
    if (tab === "approvals") loadRequests();
    else loadAccounts();
  };

  const field = (key) => ({
    value: modal?.form?.[key] ?? "",
    onChange: (e) => setModal((m) => ({ ...m, form: { ...m.form, [key]: e.target.value } })),
  });

  if (access === "checking") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12 }}>
        Checking access…
      </div>
    );
  }

  if (access !== "granted") {
    const pending = access === "pending";
    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: "var(--bg)", fontFamily: "var(--font)",
        gap: 16, padding: 40, textAlign: "center",
      }}>
        <div style={{ color: "var(--border3)" }}><Icon name={pending ? "clock" : "lock"} size={40}/></div>
        <div style={{ fontSize: 18, fontWeight: 650, color: "var(--text)" }}>
          {pending ? "Access request pending" : "Access restricted"}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 420, lineHeight: 1.7 }}>
          {pending
            ? "Your request is waiting for admin approval. You will get access after it is approved."
            : "Management Accounts is restricted to administrators. You can request access and an admin will review it."}
        </div>
        {requestError && (
          <div style={{ fontSize: 12, color: "var(--red)" }}>{requestError}</div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={() => navigate("dashboard")} style={{
            background: "var(--bg2)", border: "1px solid var(--border2)",
            borderRadius: 7, color: "var(--text4)", fontSize: 12, padding: "8px 14px",
            cursor: "pointer", fontFamily: "inherit", display: "inline-flex",
            alignItems: "center", gap: 6,
          }}>
            <Icon name="arrowLeft" size={12}/> Dashboard
          </button>
          {!pending && access !== "checking" && (
            <button onClick={requestAccess} className="btn-primary" disabled={requestBusy}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px" }}>
              <Icon name="mail" size={12}/> {requestBusy ? "Sending…" : "Request access"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const tabBtn = (key, text) => (
    <button key={key} onClick={() => setTab(key)}
      style={{
        ...btn, border: "none",
        background: tab === key ? "var(--surface3)" : "transparent",
        color: tab === key ? "var(--text)" : "var(--muted)",
        padding: "5px 12px",
      }}>
      {text}
    </button>
  );

  return (
    <PageShell
      icon="accounts"
      title="Management Accounts"
      subtitle="Approvals and cloud account registry"
      actions={
        <>
          <div style={{ display: "flex", gap: 4, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 7, padding: 3 }}>
            {tabBtn("approvals", "Approvals")}
            {tabBtn("cloud", "Cloud Accounts")}
          </div>
          <button style={btn} onClick={refresh}><Icon name="refresh" size={12}/> Refresh</button>
          {tab === "cloud" && (
            <button style={btnPrimary} onClick={openAdd}><Icon name="plus" size={12}/> Add account</button>
          )}
        </>
      }
    >
      {tab === "approvals" ? (
        <>
          <ErrorBox message={reqError} />

          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted2)" }}>
                {reqTab === "pending" ? "Pending requests" : "All requests"}
              </span>
              <div style={{ display: "flex", gap: 4, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 7, padding: 3 }}>
                {[["pending", "Pending"], ["all", "All"]].map(([k, l]) => (
                  <button key={k} onClick={() => setReqTab(k)}
                    style={{
                      ...btn, border: "none",
                      background: reqTab === k ? "var(--surface3)" : "transparent",
                      color: reqTab === k ? "var(--text)" : "var(--muted)",
                      padding: "5px 12px",
                    }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {reqLoading ? (
              <div style={{ color: "var(--muted)", fontSize: 12, padding: 20 }}>Loading…</div>
            ) : requests.length === 0 ? (
              <EmptyState icon="checkCircle" title="No requests">
                {reqTab === "pending" ? "Nothing waiting for approval." : "No requests have been submitted yet."}
              </EmptyState>
            ) : (
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Type</th>
                    <th style={th}>User</th>
                    <th style={th}>Detail</th>
                    <th style={th}>Requested</th>
                    <th style={th}>Status</th>
                    <th style={{ ...th, textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(it => (
                    <tr key={it.id}>
                      <td style={td}>{typeLabel(it.type)}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: "var(--text3)" }}>{it.display || it.username}</div>
                        <div style={{ fontSize: 10, color: "var(--muted2)" }}>{it.username}</div>
                      </td>
                      <td style={td}>
                        {it.type === "access"
                          ? FEATURE_LABEL[it.feature] || it.feature || "—"
                          : "New password"}
                      </td>
                      <td style={{ ...td, fontSize: 11, color: "var(--muted)" }}>{fmtDate(it.requested_at)}</td>
                      <td style={td}>
                        <StatusBadge status={it.status}/>
                        {it.reviewed_by && (
                          <div style={{ fontSize: 9.5, color: "var(--muted3)", marginTop: 3 }}>by {it.reviewed_by}</div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {it.status === "pending" ? (
                          <div style={{ display: "inline-flex", gap: 6 }}>
                            <button className="btn-primary" disabled={acting === it.id + "approve"}
                              onClick={() => review(it.id, "approve")}
                              style={{ fontSize: 11, padding: "5px 12px" }}>
                              {acting === it.id + "approve" ? "Approving…" : "Approve"}
                            </button>
                            <button style={{ ...btn, color: "var(--red)" }} disabled={acting === it.id + "reject"}
                              onClick={() => review(it.id, "reject")}>
                              {acting === it.id + "reject" ? "Rejecting…" : "Reject"}
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 10.5, color: "var(--muted3)" }}>{fmtDate(it.reviewed_at)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ fontSize: 10.5, color: "var(--muted2)", marginTop: 10, lineHeight: 1.6 }}>
              Approving a password request replaces the engineer's password immediately (they must sign in again).
              Approving an access request grants the feature the next time they open the page.
            </div>
          </div>
        </>
      ) : (
        <>
          <ErrorBox message={accError} />

          {accLoading ? (
            <div style={{ color: "var(--muted)", fontSize: 12, padding: 20 }}>Loading…</div>
          ) : accounts.length === 0 ? (
            <div style={{ ...card, fontSize: 12, color: "var(--muted)" }}>
              No accounts yet. Use “Add account” to register one.
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
                    <th style={th} />
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
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        <button style={{ ...btn, marginRight: 6 }} onClick={() => openEdit(a)}><Icon name="edit" size={11}/> Edit</button>
                        <button style={btnDanger} onClick={() => removeAccount(a)}><Icon name="trash" size={11}/> Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
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
              <button style={{ ...btnPrimary, width: "100%" }} onClick={saveAccount} disabled={saving || !modal.form.name.trim()}>
                <Icon name="check" size={12}/> {saving ? "Saving…" : "Save account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
