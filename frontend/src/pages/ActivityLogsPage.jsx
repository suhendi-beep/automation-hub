import React, { useState, useEffect } from "react";
import PageShell, { btn, input, label, card, table, th, td, badge, ErrorBox, fmtDate } from "../components/PageShell.jsx";
import Icon from "../components/Icon.jsx";

const CATEGORY_COLORS = {
  auth: "var(--green)",
  task: "var(--blue)",
  alert: "var(--red)",
  automation: "var(--amber)",
  general: "var(--muted)",
};
const CATEGORY_BG = {
  auth: "var(--green-dim)",
  task: "var(--blue-dim)",
  alert: "var(--red-dim)",
  automation: "var(--amber-dim)",
  general: "var(--surface2)",
};

export default function ActivityLogsPage() {
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ user: "", from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/users")
      .then((r) => r.json())
      .then((d) => setUsers(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.user) params.set("user", filters.user);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    setLoading(true);
    setError("");
    fetch(`/api/activity${params.toString() ? "?" + params.toString() : ""}`)
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setEntries(list.slice().reverse());
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [filters]);

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  return (
    <PageShell
      icon="logs"
      title="Activity Logs"
      subtitle={`${entries.length} entr${entries.length === 1 ? "y" : "ies"} (newest first)`}
      actions={
        <button
          style={btn}
          onClick={() => setFilters((f) => ({ ...f }))}
        >
          <Icon name="refresh" size={12}/> Refresh
        </button>
      }
    >
      <ErrorBox message={error} />

      <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ minWidth: 180 }}>
          <label style={label}>User</label>
          <select style={input} value={filters.user} onChange={set("user")}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.username} value={u.username}>{u.display} ({u.username})</option>
            ))}
          </select>
        </div>
        <div>
          <label style={label}>From</label>
          <input style={input} type="date" value={filters.from} onChange={set("from")} />
        </div>
        <div>
          <label style={label}>To</label>
          <input style={input} type="date" value={filters.to} onChange={set("to")} />
        </div>
        {(filters.user || filters.from || filters.to) && (
          <button style={btn} onClick={() => setFilters({ user: "", from: "", to: "" })}><Icon name="close" size={11}/> Clear filters</button>
        )}
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 12, padding: 20 }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ ...card, fontSize: 12, color: "var(--muted)" }}>No activity for the selected filters.</div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Time</th>
                <th style={th}>User</th>
                <th style={th}>Action</th>
                <th style={th}>Category</th>
                <th style={th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 500).map((e) => (
                <tr key={e.id}>
                  <td style={{ ...td, whiteSpace: "nowrap", fontSize: 11, fontFamily: "var(--mono)", color: "var(--muted)" }}>{fmtDate(e.ts)}</td>
                  <td style={{ ...td, color: "var(--text)", fontWeight: 600 }}>{e.display || e.username}</td>
                  <td style={td}>{e.action}</td>
                  <td style={td}>
                    <span style={badge(CATEGORY_COLORS[e.category] || "var(--muted)", CATEGORY_BG[e.category])}>{e.category}</span>
                  </td>
                  <td style={{ ...td, color: "var(--muted)", fontSize: 11 }}>{e.detail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries.length > 500 && (
        <div style={{ fontSize: 10, color: "var(--muted3)", marginTop: 8 }}>
          Showing the latest 500 entries. Narrow the filters to see older activity.
        </div>
      )}
    </PageShell>
  );
}
