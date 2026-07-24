import React, { useState, useEffect } from "react";

export default function Dashboard({ customers, navigate }) {
  const [history, setHistory] = useState([]);
  useEffect(() => {
    fetch("/api/history").then(r => r.json()).then(setHistory).catch(console.error);
  }, []);

  const totalAuto = customers.reduce((s, c) => s + c.automation_count, 0);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="page-sub">Automation Hub — Pelindo Monitoring</p>
      </div>

      <div className="stats-grid">
        <StatCard label="Customer" value={customers.length} icon="🏢" color="blue" />
        <StatCard label="Total Automation" value={totalAuto} icon="⚙️" color="purple" />
        <StatCard label="Riwayat Run" value={history.length} icon="📋" color="teal" />
        <StatCard label="Aktif" value={customers.filter(c => c.status === "active").length} icon="✅" color="green" />
      </div>

      <div className="section-title">Customers</div>
      <div className="customer-grid">
        {customers.map(c => (
          <div key={c.id} className="customer-card" onClick={() => navigate("customer", c.id)}>
            <div className="cc-top">
              <span className="cc-platform">{c.platform}</span>
              <span className={`badge ${c.status}`}>{c.status}</span>
            </div>
            <div className="cc-name">{c.name}</div>
            <div className="cc-count">{c.automation_count} automation</div>
            <div className="cc-arrow">Lihat detail →</div>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 32 }}>Riwayat Run Terakhir</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Customer</th><th>Automation</th><th>Terakhir Run</th><th>Log</th></tr></thead>
              <tbody>
                {history.slice(0, 10).map((h, i) => (
                  <tr key={i}>
                    <td><span className="chip">{h.customer}</span></td>
                    <td>{h.automation.replace(/_/g, " ")}</td>
                    <td className="mono">{new Date(h.last_run).toLocaleString("id-ID")}</td>
                    <td className="mono">{h.size_kb} KB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color }) {
  return (
    <div className={`stat-card stat-${color}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
