import React, { useState, useEffect } from "react";
import PageShell, { btn, card, badge, ErrorBox } from "../components/PageShell.jsx";

const PLATFORM_COLORS = { OCI: "#F97316", AWS: "#F59E0B", Huawei: "#EF4444" };

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
      title="Customers"
      subtitle="Registered customer environments and their automations"
      actions={<button style={btn} onClick={load}>Refresh</button>}
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
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#B11226"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text2)" }}>{c.name}</div>
                <span style={badge(PLATFORM_COLORS[c.platform] || "#3B82F6")}>{c.platform}</span>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{c.automation_count}</div>
                  <div style={{ fontSize: 10, color: "var(--muted2)" }}>Automations</div>
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: c.status === "active" ? "#22C55E" : "var(--muted)" }}>
                    {c.status}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted2)" }}>Status</div>
                </div>
              </div>
              <div style={{ marginTop: 14, fontSize: 11, color: "#B11226", fontWeight: 600 }}>
                Open automations →
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
