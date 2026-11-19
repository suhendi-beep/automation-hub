import React, { useState, useEffect } from "react";
import PageShell, { btn, card, badge, ErrorBox } from "../components/PageShell.jsx";

export default function GrafanaPage() {
  const [dashboards, setDashboards] = useState([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([
      fetch("/api/grafana/dashboards").then((r) => r.json()),
      fetch("/api/grafana/alerts").then((r) => r.json()).catch(() => ({ alerts: [] })),
    ])
      .then(([d, a]) => {
        setDashboards(d.dashboards || []);
        setBaseUrl(d.base_url || "");
        setAlerts(Array.isArray(a.alerts) ? a.alerts : []);
        setError(d.error || a.error || "");
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  };

  useEffect(load, []);

  return (
    <PageShell
      title="Grafana Dashboards"
      subtitle={baseUrl ? `Source: ${baseUrl}` : "Connected Grafana instance"}
      actions={
        <>
          {baseUrl && (
            <a href={baseUrl} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: "none" }}>
              Open Grafana
            </a>
          )}
          <button style={btn} onClick={load}>Refresh</button>
        </>
      }
    >
      <ErrorBox message={error} />

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <div style={{ ...card, flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{dashboards.length}</div>
          <div style={{ fontSize: 10, color: "var(--muted2)" }}>Dashboards</div>
        </div>
        <div style={{ ...card, flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: alerts && alerts.length ? "#EF4444" : "#22C55E" }}>
            {alerts === null ? "—" : alerts.length}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted2)" }}>Firing alerts</div>
        </div>
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 12, padding: 20 }}>Loading dashboards…</div>
      ) : dashboards.length === 0 ? (
        <div style={{ ...card, fontSize: 12, color: "var(--muted)" }}>
          No dashboards returned. Verify GRAFANA_USER/GRAFANA_PASS and GRAFANA_URL.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 10 }}>
          {dashboards.map((d) => (
            <a
              key={d.uid || d.id}
              href={d.url}
              target="_blank"
              rel="noreferrer"
              style={{ ...card, textDecoration: "none", color: "inherit" }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>{d.title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                <span style={badge("#3B82F6")}>{d.folder}</span>
                {(d.tags || []).slice(0, 2).map((t) => (
                  <span key={t} style={badge("#8B5CF6")}>{t}</span>
                ))}
              </div>
            </a>
          ))}
        </div>
      )}
    </PageShell>
  );
}
