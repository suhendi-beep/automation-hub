import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { localISODate } from "../api.js";
import { logActivity } from "../activityLog.js";
import { buildDailyReport, fmtDateForReport, parseBackupStatus } from "../dailyReport.js";

const BACKUP_CUSTOMER   = "pelindo";
const BACKUP_AUTOMATION = "daily_ilcs_status";
const BACKUP_CACHE_KEY  = "pr_backup_status_cache";

function loadCachedBackup() {
  try {
    const cached = localStorage.getItem(BACKUP_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch { return null; }
}

export default function DailyReportPage({ navigate }) {
  const today = localISODate();

  const [tanggal,  setTanggal]  = useState(today);
  const [shift,    setShift]    = useState("malam");
  const [engineer, setEngineer] = useState(
    sessionStorage.getItem("pr_display") || sessionStorage.getItem("pr_user") || ""
  );
  const [copied,       setCopied]       = useState(false);
  const [closedTickets, setClosedTickets] = useState([]);

  const [alerts,        setAlerts]        = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsUpdated, setAlertsUpdated] = useState(null);
  const [alertsError,   setAlertsError]   = useState("");

  const [backupStatus,  setBackupStatus]  = useState(loadCachedBackup);
  const [backupLoading, setBackupLoading] = useState(true);
  const [backupTaskId,  setBackupTaskId]  = useState(null);
  const [backupTaskStatus, setBackupTaskStatus] = useState(null);
  const [backupError,   setBackupError]   = useState("");
  const [logLines,      setLogLines]      = useState([]);
  const logRef = useRef(null);

  const running = !!backupTaskId || ["QUEUED", "STARTED", "PENDING"].includes(backupTaskStatus || "");

  /* ── Grafana alerts ── */
  const loadAlerts = useCallback(() => {
    setAlertsLoading(true);
    fetch("/api/grafana/alerts")
      .then(r => r.json())
      .then(d => {
        setAlerts(Array.isArray(d.alerts) ? d.alerts : []);
        setAlertsError(d.error || "");
        setAlertsUpdated(new Date());
      })
      .catch(() => setAlertsError("Unable to reach the backend"))
      .finally(() => setAlertsLoading(false));
  }, []);

  /* ── Daily backup status log ── */
  const loadBackupLog = useCallback(async (silent = false) => {
    if (!silent) setBackupLoading(true);
    try {
      const d = await fetch(`/api/logs/${BACKUP_CUSTOMER}/${BACKUP_AUTOMATION}`).then(r => r.json());
      const lines = Array.isArray(d.logs) ? d.logs : [];
      setLogLines(lines);
      const parsed = parseBackupStatus(lines);
      if (parsed) {
        setBackupStatus(parsed);
        try { localStorage.setItem(BACKUP_CACHE_KEY, JSON.stringify(parsed)); } catch(_) {}
      }
    } catch (_) {
    } finally {
      if (!silent) setBackupLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAlerts();
    loadBackupLog();
    const iv = setInterval(loadAlerts, 60000);
    return () => clearInterval(iv);
  }, [loadAlerts, loadBackupLog]);

  /* ── Closed tickets on the selected date ── */
  useEffect(() => {
    let cancelled = false;
    const fetchTickets = async () => {
      try {
        const res = await fetch(`/api/tasks?date=${tanggal}`);
        const tasks = await res.json();
        const closed = Array.isArray(tasks)
          ? tasks.filter(t =>
              ["close", "closed"].includes(String(t.status || "").trim().toLowerCase()) &&
              (t.date || "").slice(0, 10) === tanggal
            )
          : [];
        if (!cancelled) setClosedTickets(closed);
      } catch {
        if (!cancelled) setClosedTickets([]);
      }
    };

    fetchTickets();
    return () => { cancelled = true; };
  }, [tanggal]);

  /* ── Poll queued backup check ── */
  useEffect(() => {
    if (!backupTaskId) return;
    const iv = setInterval(async () => {
      try {
        const st = await fetch("/api/status/" + backupTaskId).then(r => r.json());
        setBackupTaskStatus(st.status);
        if (st.status === "SUCCESS" || st.status === "FAILURE") {
          setBackupTaskId(null);
          loadBackupLog(true);
        }
      } catch (_) {}
    }, 2500);
    return () => clearInterval(iv);
  }, [backupTaskId, loadBackupLog]);

  /* ── Live log while the check runs ── */
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => loadBackupLog(true), 3000);
    return () => clearInterval(iv);
  }, [running, loadBackupLog]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  const runBackupCheck = async () => {
    if (running) return;
    setBackupError("");
    setBackupTaskStatus("QUEUED");
    try {
      const d = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: BACKUP_CUSTOMER, automation: BACKUP_AUTOMATION }),
      }).then(r => r.json());
      if (d.task_id) {
        setBackupTaskId(d.task_id);
        logActivity("Run Daily Backup Status", "report", "Daily Backup Status ILCS");
      } else {
        setBackupTaskStatus(null);
        setBackupError(d.error || "Failed to queue the backup check.");
      }
    } catch (e) {
      setBackupTaskStatus(null);
      setBackupError(e.message || "Failed to queue the backup check.");
    }
  };

  const reportText = useMemo(() => buildDailyReport(alerts, {
    tanggal: fmtDateForReport(tanggal),
    shift, engineer, closedTickets, backupStatus,
  }), [alerts, tanggal, shift, engineer, closedTickets, backupStatus]);

  const doCopy = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      logActivity("Copy Daily Report", "report", `Shift ${shift} — ${tanggal}`);
    };
    const fallback = () => {
      const el = document.getElementById("daily-report-textarea");
      if (el) { el.select(); document.execCommand("copy"); done(); }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(reportText).then(done).catch(fallback);
    } else {
      fallback();
    }
  };

  const healthColor = !backupStatus?.health ? "var(--muted)"
    : backupStatus.health === "HEALTHY" ? "var(--green)"
    : backupStatus.health === "WARNING" ? "var(--amber)"
    : "var(--red)";

  return (
    <div style={D.root}>
      <PageHeader
        icon="calendar"
        title="Daily Report"
        subtitle="Generate the daily handover report and check daily backup status"
        actions={
          <>
            <button style={D.btn} onClick={() => navigate("files", BACKUP_CUSTOMER)}>
              <Icon name="history" size={12}/> Report history
            </button>
            <button style={D.btn} onClick={() => { loadAlerts(); loadBackupLog(); }}>
              <span style={{ display:"inline-flex", animation: alertsLoading ? "spin 1s linear infinite" : "none" }}>
                <Icon name="refresh" size={12}/>
              </span>
              Refresh
            </button>
          </>
        }
      />

      <div style={D.content}>
        <div style={D.grid}>

          {/* ── Generate daily report ── */}
          <section className="glass-card" style={D.card}>
            <div style={D.cardHead}>
              <span style={{ ...D.cardIcon, color:"var(--rose)" }}><Icon name="report" size={16}/></span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={D.cardTitle}>Generate daily report</div>
                <div style={D.cardSub}>
                  {alertsLoading && !alerts.length
                    ? "Loading Grafana alerts…"
                    : `${alerts.length} Grafana alert${alerts.length === 1 ? "" : "s"} in the report`}
                  {alertsUpdated && ` · updated ${alertsUpdated.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit", second:"2-digit" })} WIB`}
                </div>
              </div>
            </div>

            {alertsError && (
              <div style={{ ...D.note, color:"var(--amber)", borderColor:"var(--border2)" }}>
                <Icon name="warning" size={12}/> {alertsError}
              </div>
            )}

            <div style={D.formGrid}>
              <div>
                <label className="form-label">Date</label>
                <input className="form-input" type="date" value={tanggal}
                  onChange={e => setTanggal(e.target.value)}/>
              </div>
              <div>
                <label className="form-label">Shift</label>
                <select className="form-input" value={shift} onChange={e => setShift(e.target.value)}>
                  <option value="1">Shift 1 (09:00-21:00)</option>
                  <option value="malam">Shift 2 (21:00-09:00)</option>
                </select>
              </div>
              <div>
                <label className="form-label">Engineer name</label>
                <input className="form-input" value={engineer} placeholder="Engineer name…"
                  onChange={e => setEngineer(e.target.value)}/>
              </div>
            </div>

            <div style={D.chips}>
              <span style={D.chip}>
                Tickets closed on this date: <strong style={{ color:"var(--green)" }}>{closedTickets.length}</strong>
                <span style={{ color:"var(--muted3)", fontSize:9, marginLeft:4 }}>{tanggal}</span>
              </span>
              {backupStatus ? (
                <span style={{ ...D.chip, color:healthColor }}>
                  ILCS backup: {backupStatus.health || "-"} ({backupStatus.success ?? "-"}/{backupStatus.total ?? "-"})
                  {backupStatus.fetchedAt && (
                    <span style={{ color:"var(--muted3)", marginLeft:6, fontSize:9 }}>
                      · {new Date(backupStatus.fetchedAt).toLocaleString("en-GB", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}
                    </span>
                  )}
                </span>
              ) : (
                <span style={D.chip}>ILCS backup: loading…</span>
              )}
            </div>

            <label className="form-label" style={{ marginTop:14 }}>Report preview</label>
            <textarea id="daily-report-textarea" readOnly value={reportText} style={D.preview}/>

            <div style={D.actions}>
              <button className="btn-primary" onClick={doCopy} disabled={backupLoading}
                style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6, padding:"10px 0" }}>
                <Icon name={backupLoading ? "clock" : copied ? "check" : "copy"} size={13}/>
                {backupLoading ? "Loading latest data…" : copied ? "Copied" : "Copy report"}
              </button>
            </div>
          </section>

          {/* ── Check status daily backup ── */}
          <section className="glass-card" style={D.card}>
            <div style={D.cardHead}>
              <span style={{ ...D.cardIcon, color:"var(--blue)" }}><Icon name="database" size={16}/></span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={D.cardTitle}>Check status daily backup</div>
                <div style={D.cardSub}>Daily Backup Status ILCS · OCI CLI</div>
              </div>
              <button className="btn-primary" onClick={runBackupCheck} disabled={running}
                style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 14px" }}>
                {running
                  ? <><span className="spinner" style={{ width:10, height:10, borderWidth:1.6, borderColor:"#fff", borderTopColor:"transparent" }}/> {backupTaskStatus || "Running"}</>
                  : <><Icon name="play" size={12}/> {backupStatus ? "Re-check" : "Check status"}</>}
              </button>
            </div>

            {backupError && (
              <div style={{ ...D.note, color:"var(--red)" }}>
                <Icon name="xCircle" size={12}/> {backupError}
              </div>
            )}

            <div style={D.statusPanel}>
              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                <span style={{ ...D.healthPill, color:healthColor, background:"var(--bg3)" }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background:healthColor }}/>
                  {backupStatus?.health || (backupLoading ? "Loading…" : "No data yet")}
                </span>
                {backupStatus?.period && (
                  <span style={D.meta}>Period: <strong style={{ color:"var(--text3)" }}>{backupStatus.period}</strong></span>
                )}
                {backupStatus?.generated && (
                  <span style={D.meta}>Generated: <strong style={{ color:"var(--text3)" }}>{backupStatus.generated}</strong></span>
                )}
              </div>

              <div style={D.statsGrid}>
                {[
                  { label:"Total",        value: backupStatus?.total,   color:"var(--text)" },
                  { label:"Success",      value: backupStatus?.success, color:"var(--green)" },
                  { label:"Failed",       value: backupStatus?.failed,  color: Number(backupStatus?.failed) > 0 ? "var(--red)" : "var(--text3)" },
                  { label:"Success rate", value: backupStatus?.rate,    color:"var(--amber)" },
                ].map(s => (
                  <div key={s.label} style={D.stat}>
                    <div style={{ ...D.statValue, color:s.color }}>{s.value ?? "—"}</div>
                    <div style={D.statLabel}>{s.label}</div>
                  </div>
                ))}
              </div>

              {backupStatus?.failedItems?.length > 0 && (
                <div style={D.failedList}>
                  <span style={{ color:"var(--red)", fontWeight:600, flexShrink:0 }}>Failed:</span>
                  {backupStatus.failedItems.map(n => (
                    <span key={n} style={D.failedName}>{n}</span>
                  ))}
                </div>
              )}
            </div>

            <div style={D.logHead}>
              <span style={{ fontSize:9, fontWeight:700, letterSpacing:".12em", color:"var(--muted2)", textTransform:"uppercase" }}>
                {running ? "Live log" : "Automation log"}
              </span>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                {running && (
                  <span style={{ fontSize:9, color:"var(--blue)", display:"flex", alignItems:"center", gap:4 }}>
                    <span style={{ width:5, height:5, borderRadius:"50%", background:"var(--blue)", animation:"pulse 1.2s ease-in-out infinite" }}/>
                    LIVE
                  </span>
                )}
                <span style={{ fontSize:9, color:"var(--muted3)", fontFamily:"var(--mono)" }}>{BACKUP_CUSTOMER}_{BACKUP_AUTOMATION}.log</span>
                <button style={D.tinyBtn} title="Refresh log" onClick={() => loadBackupLog()}>
                  <Icon name="refresh" size={10}/>
                </button>
              </div>
            </div>

            <pre style={D.log} ref={logRef}>
              {logLines.length
                ? logLines.slice(-200).join("")
                : "No log yet — run the check to generate the daily backup status."}
            </pre>

            <div style={D.footNote}>
              <Icon name="info" size={11}/>
              Runs the Daily Backup Status ILCS automation and feeds section 3 of the daily report.
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

const D = {
  root: { height:"100%", display:"flex", flexDirection:"column", overflow:"hidden",
          background:"var(--bg)", fontFamily:"var(--font)" },
  content: { flex:1, overflowY:"auto", padding:"22px 28px 40px" },
  grid: { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(400px, 1fr))",
          gap:16, alignItems:"start", maxWidth:1440, margin:"0 auto" },
  card: { padding:"16px 18px", minWidth:0 },

  cardHead: { display:"flex", alignItems:"center", gap:10, marginBottom:14 },
  cardIcon: { width:34, height:34, borderRadius:10, background:"var(--surface2)",
              border:"1px solid var(--border)", display:"flex", alignItems:"center",
              justifyContent:"center", flexShrink:0 },
  cardTitle:{ fontSize:13.5, fontWeight:650, color:"var(--text)" },
  cardSub:  { fontSize:10.5, color:"var(--muted)", marginTop:2 },

  note: { display:"flex", alignItems:"center", gap:7, fontSize:11, padding:"8px 10px",
          borderRadius:7, background:"var(--bg3)", border:"1px solid var(--border)",
          marginBottom:12 },

  formGrid: { display:"grid", gridTemplateColumns:"repeat(3, minmax(0,1fr))", gap:10, marginTop:2 },
  chips: { display:"flex", gap:8, flexWrap:"wrap", marginTop:12 },
  chip: { fontSize:10, color:"var(--muted)", background:"var(--bg3)",
          border:"1px solid var(--border2)", borderRadius:5, padding:"3px 10px" },

  preview: { width:"100%", height:360, background:"var(--bg3)", border:"1px solid var(--border2)",
             borderRadius:8, color:"var(--text3)", fontFamily:"var(--mono)", fontSize:11,
             padding:"10px 12px", resize:"vertical", outline:"none",
             boxSizing:"border-box", lineHeight:1.75 },
  actions: { display:"flex", gap:10, marginTop:12 },

  statusPanel: { background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:9,
                 padding:"12px 14px", marginBottom:14 },
  healthPill: { display:"inline-flex", alignItems:"center", gap:6, fontSize:11, fontWeight:700,
                letterSpacing:".04em", padding:"4px 11px", borderRadius:99,
                border:"1px solid var(--border2)" },
  meta: { fontSize:10.5, color:"var(--muted2)" },
  statsGrid: { display:"grid", gridTemplateColumns:"repeat(4, minmax(0,1fr))", gap:8, marginTop:12 },
  stat: { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:7,
          padding:"8px 10px", minWidth:0 },
  statValue: { fontSize:17, fontWeight:700, letterSpacing:"-.02em" },
  statLabel: { fontSize:9, fontWeight:600, color:"var(--muted)", textTransform:"uppercase",
               letterSpacing:".06em", marginTop:1 },
  failedList: { display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginTop:10,
                fontSize:10.5, color:"var(--muted)" },
  failedName: { background:"var(--red-dim)", color:"var(--red)", border:"1px solid var(--border2)",
                borderRadius:5, padding:"2px 8px", fontFamily:"var(--mono)", fontSize:10 },

  logHead: { display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:7 },
  log: { minHeight:210, maxHeight:320, overflowY:"auto", margin:0, whiteSpace:"pre-wrap",
         wordBreak:"break-word", background:"rgba(10,3,5,.55)", border:"1px solid var(--border)",
         borderRadius:8, padding:"10px 12px", fontFamily:"var(--mono)", fontSize:10,
         lineHeight:1.7, color:"var(--text3)" },
  tinyBtn: { display:"inline-flex", alignItems:"center", justifyContent:"center",
             background:"var(--surface2)", border:"1px solid var(--border2)", color:"var(--muted)",
             padding:"3px 5px", borderRadius:4, cursor:"pointer" },
  footNote: { display:"flex", alignItems:"center", gap:6, marginTop:10, fontSize:10, color:"var(--muted3)" },

  btn: { display:"inline-flex", alignItems:"center", gap:6, background:"var(--bg2)",
         border:"1px solid var(--border2)", color:"var(--text4)", fontFamily:"inherit",
         fontSize:11, padding:"6px 12px", borderRadius:7, cursor:"pointer" },
};
