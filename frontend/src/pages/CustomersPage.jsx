import React, { useState, useEffect } from "react";
import PageShell, { btn, card, badge, ErrorBox } from "../components/PageShell.jsx";
import Icon from "../components/Icon.jsx";

export default function CustomersPage({ navigate }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    fetch("/api/customers")
      .then((r) => r.json())
      .then((data) => { setCustomers(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  };

  useEffect(load, []);

  return (
    <PageShell
      icon="users"
      title="Customers"
      subtitle="Registered customer environments and their automations"
      actions={<button style={btn} onClick={load}><Icon name="refresh" size={12}/> Refresh</button>}
    >
      <ErrorBox message={error} />
      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 12, padding: 20 }}>Loading…</div>
      ) : customers.length === 0 ? (
        <div style={{ ...card, color: "var(--muted)", fontSize: 12 }}>
          No customers registered. Add an entry to REGISTRY in backend/app.py.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
          {customers.map((c) => (
            <div
              key={c.id}
              style={{ ...card, cursor: "pointer", transition: "border-color .15s" }}
              onClick={() => navigate("customer", c.id)}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 650, color: "var(--text)" }}>{c.name}</div>
                <span style={badge("var(--blue)", "var(--blue-dim)")}>{c.platform}</span>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{c.automation_count}</div>
                  <div style={{ fontSize: 10, color: "var(--muted2)" }}>Automations</div>
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: c.status === "active" ? "var(--green)" : "var(--muted)" }}>
                    {c.status}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted2)" }}>Status</div>
                </div>
              </div>
              <div style={{ marginTop: 14, fontSize: 11, color: "var(--accent)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                Open automations <Icon name="arrowRight" size={11}/>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
