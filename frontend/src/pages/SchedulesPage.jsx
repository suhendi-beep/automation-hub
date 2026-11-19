import React, { useState, useEffect } from "react";
import PageShell, { btn, btnPrimary, card, badge, ErrorBox, fmtDate } from "../components/PageShell.jsx";

export default function SchedulesPage({ currentRole }) {
  const isAdmin = currentRole === "admin";
  const [schedules, setSchedules] = useState([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState({});
  const [messages, setMessages] = useState({});

  const load = () => {
    fetch("/api/schedules")
      .then((r) => r.json())
      .then((d) => setSchedules(Array.isArray(d) ? d : []))
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  const runNow = async (s) => {
    setRunning((prev) => ({ ...prev, [s.id]: true }));
    setMessages((prev) => ({ ...prev, [s.id]: "" }));
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(s.id)}/run`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to queue task");
      setMessages((prev) => ({ ...prev, [s.id]: `Queued (task ${d.task_id})` }));
    } catch (e) {
      setMessages((prev) => ({ ...prev, [s.id]: e.message }));
    } finally {
      setRunning((prev) => ({ ...prev, [s.id]: false }));
    }
  };

  return (
    <PageShell
      title="Schedules"
      subtitle="Automated reports executed by the Celery beat service"
      actions={<button style={btn} onClick={load}>Refresh</button>}
    >
      <ErrorBox message={error} />

      {schedules.length === 0 ? (
        <div style={{ ...card, fontSize: 12, color: "var(--muted)" }}>
          No schedules configured. Define them in BEAT_SCHEDULE inside backend/celery_worker.py.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {schedules.map((s) => (
            <div key={s.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>{s.label}</span>
                    <span style={badge("#22C55E")}>active</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{s.description}</div>
                  <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 8 }}>
                    <strong style={{ color: "var(--muted2)" }}>Schedule:</strong> {s.cron || "—"}
                    <span style={{ margin: "0 10px", color: "var(--border2)" }}>|</span>
                    <strong style={{ color: "var(--muted2)" }}>Last run:</strong> {fmtDate(s.last_run)}
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 10, color: "var(--muted3)", marginTop: 6 }}>{s.task}</div>
                </div>
                {isAdmin && (
                  <button style={btnPrimary} onClick={() => runNow(s)} disabled={running[s.id]}>
                    {running[s.id] ? "Queueing…" : "Run now"}
                  </button>
                )}
              </div>
              {messages[s.id] && (
                <div style={{ fontSize: 11, color: "#86efac", marginTop: 10 }}>{messages[s.id]}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ ...card, marginTop: 14, fontSize: 11, color: "var(--muted)", lineHeight: 1.7 }}>
        The beat container evaluates these schedules in Asia/Jakarta time. Reports are emailed to the
        addresses configured in EMAIL_TO. Use “Run now” to trigger a report manually.
      </div>
    </PageShell>
  );
}
