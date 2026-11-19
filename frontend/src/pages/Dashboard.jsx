import React, { useState, useEffect, useCallback } from "react";
import { localISODate } from "../api.js";

/* ── helpers ── */
function fmtNowWIB() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date()).replace(",", "");
}
function greetingByHour() {
  const h = new Date().getHours();
  if (h < 11) return "Good Morning,";
  if (h < 15) return "Good Afternoon,";
  if (h < 19) return "Good Evening,";
  return "Good Night,";
}
function timeAgo(iso) {
  if (!iso) return "-";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── Grafana Alerts donut (Critical / Warning / Info) ── */
function AlertDonut({ critical, warning, info }) {
  const total = critical + warning + info;
  const r = 44, cx = 50, cy = 50, stroke = 11;
  const circ = 2 * Math.PI * r;
  const slices = [
    { val: critical, color: "#EF4444" },
    { val: warning,  color: "#F59E0B" },
    { val: info,      color: "#3B82F6" },
  ];
  let offset = 0;
  const paths = slices.map((s, i) => {
    const pct = total ? s.val / total : 0;
    const dash = circ * pct;
    const el = (
      <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={-offset * circ + circ / 4}
        strokeLinecap="butt" opacity={s.val > 0 ? 1 : 0} />
    );
    offset += pct;
    return el;
  });
  return (
    <svg viewBox="0 0 100 100" width="118" height="118">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface3)" strokeWidth={stroke} />
      {paths}
      <text x={cx} y={cy+6} textAnchor="middle" fontSize="24" fontWeight="800" fill="var(--text)" fontFamily="Inter">{total}</text>
    </svg>
  );
}

export default function Dashboard({ customers, navigate, currentUser, darkMode, toggleDark }) {
  const [alerts,       setAlerts]       = useState([]);
  const [alertsError,  setAlertsError]  = useState(null);
  const [history,      setHistory]      = useState([]);
  const [tasks,        setTasks]        = useState([]);
  const [dailySummary, setDailySummary] = useState({ total:null, success:null, failed:null, rate:null, health:null, lastRun:null });
  const [now,          setNow]          = useState(fmtNowWIB());
  const [runningReport,setRunningReport]= useState(null); // {key, taskId}

  const initials = (currentUser || "?").slice(0,1).toUpperCase();

  /* ── fetchers ── */
  const fetchAlerts = useCallback(() => {
    fetch("/api/grafana/alerts")
      .then(r => r.json())
      .then(d => { setAlerts(d.alerts || []); setAlertsError(d.error || null); })
      .catch(() => setAlertsError("Could not reach backend"));
  }, []);

  const fetchHistory = useCallback(() => {
    fetch("/api/history").then(r => r.json()).then(setHistory).catch(() => {});
  }, []);

  const fetchTasks = useCallback(() => {
    fetch("/api/tasks").then(r => r.json()).then(d => { if (Array.isArray(d)) setTasks(d); }).catch(() => {});
  }, []);

  const fetchDailyLog = useCallback(async () => {
    try {
      const d = await fetch("/api/logs/pelindo/daily_ilcs_status").then(r => r.json());
      const text = (d.logs || []).join("\n");
      const total   = text.match(/Total\s+:\s+(\d+)/)?.[1];
      const success = text.match(/Success\s+:\s+(\d+)/)?.[1];
      const failed  = text.match(/Failed\s+:\s+(\d+)/)?.[1];
      const rate    = text.match(/Success Rate\s+:\s+([\d.]+%)/)?.[1];
      const health  = text.match(/\b(HEALTHY|CRITICAL|WARNING)\b/)?.[0];
      if (total || success || failed) {
        setDailySummary({
          total: total ? parseInt(total) : null,
          success: success ? parseInt(success) : null,
          failed: failed ? parseInt(failed) : null,
          rate: rate || null,
          health: health || null,
          lastRun: null,
        });
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchAlerts(); fetchHistory(); fetchTasks(); fetchDailyLog();
    const ivAlerts = setInterval(fetchAlerts, 30000);
    const ivRest   = setInterval(() => { fetchHistory(); fetchTasks(); fetchDailyLog(); }, 60000);
    const ivClock  = setInterval(() => setNow(fmtNowWIB()), 30000);
    return () => { clearInterval(ivAlerts); clearInterval(ivRest); clearInterval(ivClock); };
  }, [fetchAlerts, fetchHistory, fetchTasks, fetchDailyLog]);

  // Poll running report task status
  useEffect(() => {
    if (!runningReport) return;
    const iv = setInterval(async () => {
      try {
        const d = await fetch("/api/status/" + runningReport.taskId).then(r => r.json());
        if (d.status === "SUCCESS" || d.status === "FAILURE") {
          setRunningReport(null);
          fetchHistory();
        }
      } catch (_) {}
    }, 2500);
    return () => clearInterval(iv);
  }, [runningReport, fetchHistory]);

  /* ── derived data ── */
  const critical = alerts.filter(a => a.severity === "critical").length;
  const warning  = alerts.filter(a => a.severity === "warning").length;
  const info     = alerts.filter(a => !["critical", "warning"].includes(a.severity)).length;
  const activeAlerts = alerts;

  const lastDailyRun = history.find(h => h.automation === "daily_ilcs_status");
  const dailyOk = lastDailyRun ? lastDailyRun.size_kb > 0 : null;

  const lastWeeklyRuns = history.filter(h => h.automation === "grafana_capture" || h.automation.startsWith("oci_"));
  const weeklyAvailable = lastWeeklyRuns.length;

  const alertOnlyTasks = tasks.filter(t => (t.description || "").startsWith("[ALERT]"));
  const todayStr = localISODate();
  const ticketsToday  = alertOnlyTasks.filter(t => (t.date || "").slice(0,10) === todayStr).length;
  const ticketsClosed = alertOnlyTasks.filter(t => t.status === "Close").length;

  const servicesHealthy = dailySummary.rate ? dailySummary.rate : (dailySummary.total ? `${Math.round((dailySummary.success/dailySummary.total)*100)}%` : "—");

  const runReport = async (automationId) => {
    if (runningReport) return;
    try {
      const d = await fetch("/api/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: "pelindo", automation: automationId, args: {} }),
      }).then(r => r.json());
      if (d.task_id) setRunningReport({ key: automationId, taskId: d.task_id });
      else navigate("generate-report");
    } catch (_) { navigate("generate-report"); }
  };

  const weeklyShortcuts = [
    { id: "infra_summary",  label: "Infrastructure\nSummary",  icon: "📈", kind: "run",    automation: "grafana_capture" },
    { id: "resource_util",  label: "Resource\nUtilization",    icon: "🗄",  kind: "run",    automation: "grafana_capture" },
    { id: "cost_overview",  label: "Cost\nOverview",           icon: "💲", kind: "soon" },
    { id: "security",       label: "Security\nOverview",       icon: "🛡",  kind: "soon" },
    { id: "ticket_summary", label: "Ticket\nSummary",          icon: "🎫", kind: "info",   value: `${ticketsClosed}/${alertOnlyTasks.length}` },
    { id: "incident_report",label: "Incident\nReport",         icon: "📅", kind: "info",   value: `${ticketsToday} today` },
  ];

  return (
    <div style={S.root}>
      {/* ── TOPBAR ── */}
      <header style={S.topbar}>
        <div>
          <div style={S.greetSmall}>{greetingByHour()}</div>
          <div style={S.greetTitle}>Monitoring Overview</div>
          <div style={S.greetSub}>Keep your infrastructure healthy and reports up to date.</div>
        </div>
        <div style={S.topbarRight}>
          <div style={S.clockBlock}>
            <span style={S.clockIcon}>🕐</span>
            <span>{now} WIB</span>
          </div>
          <div style={S.liveBadge}><span style={S.liveDot}/> Live</div>
          <div style={S.avatar}>{initials}</div>
        </div>
      </header>

      <div style={S.content}>
        {/* ── KPI ROW ── */}
        <div style={S.kpiRow}>
          <div style={S.kpiCard} onClick={() => navigate("alert-monitor")}>
            <div style={{...S.kpiIcon, background:"rgba(59,130,246,.13)", color:"#3B82F6"}}>🔔</div>
            <div>
              <div style={S.kpiLabel}>Active Alerts</div>
              <div style={S.kpiVal}>{alertsError ? "—" : activeAlerts.length}</div>
              <div style={{...S.kpiTrend, color: critical>0 ? "var(--red)" : "var(--green)"}}>
                {critical>0 ? `↑ ${critical} critical` : "↓ all clear"}
              </div>
            </div>
          </div>

          <div style={S.kpiCard}>
            <div style={{...S.kpiIcon, background:"rgba(34,197,94,.13)", color:"#22C55E"}}>✓</div>
            <div>
              <div style={S.kpiLabel}>Healthy Services</div>
              <div style={S.kpiVal}>{servicesHealthy}</div>
              <div style={{...S.kpiTrend, color:"var(--green)"}}>
                {dailySummary.health === "HEALTHY" ? "↑ all systems normal" : dailySummary.health ? `⚠ ${dailySummary.health}` : "— no data yet"}
              </div>
            </div>
          </div>

          <div style={S.kpiCard} onClick={() => navigate("daily-task")}>
            <div style={{...S.kpiIcon, background:"rgba(139,92,246,.14)", color:"#8B5CF6"}}>🗒</div>
            <div>
              <div style={S.kpiLabel}>Today's Report</div>
              <div style={{...S.kpiVal, fontSize:16}}>{dailyOk===null ? "Pending" : dailyOk ? "Completed" : "Failed"}</div>
              <div style={S.kpiTrend}>
                {lastDailyRun ? `Last update ${new Date(lastDailyRun.last_run).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}` : "No run yet"}
                {dailyOk && " ✓"}
              </div>
            </div>
          </div>

          <div style={S.kpiCard} onClick={() => navigate("generate-report")}>
            <div style={{...S.kpiIcon, background:"rgba(245,158,11,.14)", color:"#F59E0B"}}>📄</div>
            <div>
              <div style={S.kpiLabel}>Weekly Reports</div>
              <div style={S.kpiVal}>{weeklyAvailable}+</div>
              <div style={S.kpiTrend}>Available types</div>
            </div>
          </div>
        </div>

        {/* ── MIDDLE ROW: Grafana Alerts + Daily Report ── */}
        <div style={S.midRow}>
          {/* Grafana Alerts */}
          <div style={S.card}>
            <div style={S.cardHead}>
              <div style={S.cardTitleRow}>
                <span style={{fontSize:16}}>🟠</span>
                <span style={S.cardTitle}>Grafana Alerts</span>
              </div>
              <button style={S.viewAllLink} onClick={() => navigate("alert-monitor")}>View All →</button>
            </div>

            {alertsError ? (
              <div style={S.emptyState}>⚠ {alertsError}</div>
            ) : (
              <div style={{display:"flex", alignItems:"center", gap:20}}>
                <AlertDonut critical={critical} warning={warning} info={info}/>
                <div style={{flex:1, display:"flex", flexDirection:"column", gap:8}}>
                  <div style={S.legendRow}>
                    <span style={{...S.legendDot, background:"#EF4444"}}/>
                    <span style={S.legendLabel}>Critical</span>
                    <span style={S.legendVal}>{critical}</span>
                  </div>
                  <div style={S.legendRow}>
                    <span style={{...S.legendDot, background:"#F59E0B"}}/>
                    <span style={S.legendLabel}>Warning</span>
                    <span style={S.legendVal}>{warning}</span>
                  </div>
                  <div style={S.legendRow}>
                    <span style={{...S.legendDot, background:"#3B82F6"}}/>
                    <span style={S.legendLabel}>Info</span>
                    <span style={S.legendVal}>{info}</span>
                  </div>
                </div>
                <div style={{flex:1.3, display:"flex", flexDirection:"column", gap:6, borderLeft:"1px solid var(--border)", paddingLeft:16}}>
                  {activeAlerts.length === 0 ? (
                    <div style={S.emptyState}>No active alerts</div>
                  ) : activeAlerts.slice(0,3).map((a, i) => (
                    <div key={i} style={S.alertRow}>
                      <span style={{...S.alertDot, background: a.severity==="critical"?"#EF4444":a.severity==="warning"?"#F59E0B":"#3B82F6"}}/>
                      <span style={S.alertName} title={a.name}>{a.name}</span>
                      <span style={S.alertTime}>{timeAgo(a.active_at)} ›</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Daily Report */}
          <div style={S.card}>
            <div style={S.cardHead}>
              <div style={S.cardTitleRow}>
                <span style={{fontSize:16}}>📘</span>
                <span style={S.cardTitle}>Daily Report</span>
              </div>
              <button style={S.viewAllLink} onClick={() => navigate("daily-task")}>View Detail →</button>
            </div>
            <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:8, padding:"8px 0"}}>
              <div style={{...S.statusCircle, background: dailyOk===false ? "var(--red-dim)" : "var(--green-dim)",
                color: dailyOk===false ? "var(--red)" : "var(--green)"}}>
                <span style={{fontSize:28}}>{dailyOk===false ? "✕" : "✓"}</span>
              </div>
              <div style={{fontWeight:700, fontSize:14, color: dailyOk===false ? "var(--red)" : "var(--green)"}}>
                {dailyOk===null ? "No Report Yet" : dailyOk ? "Report Completed" : "Report Failed"}
              </div>
              <div style={{fontSize:11, color:"var(--muted2)"}}>
                {lastDailyRun
                  ? `Today, ${new Date(lastDailyRun.last_run).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})} • ${new Date(lastDailyRun.last_run).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})} WIB`
                  : "Run Daily Backup Status to generate"}
              </div>
              <button style={S.downloadBtn} onClick={() => navigate("daily-task")}>
                ↓ Download Report
              </button>
            </div>
          </div>
        </div>

        {/* ── WEEKLY REPORTS ── */}
        <div style={S.weeklyCard}>
          <div style={S.cardHead}>
            <div style={S.cardTitleRow}>
              <span style={{fontSize:16}}>📊</span>
              <div>
                <div style={S.cardTitle}>Weekly Reports</div>
                <div style={{fontSize:10.5, color:"var(--muted2)", marginTop:1}}>Generate and download your weekly reports</div>
              </div>
            </div>
            <button style={S.genReportBtn} onClick={() => navigate("generate-report")}
              disabled={!!runningReport}>
              {runningReport ? "⏳ Running…" : "▶ Generate Report"}
            </button>
          </div>

          <div style={S.weeklyGrid}>
            {weeklyShortcuts.map(w => (
              <div key={w.id} style={{...S.weeklyTile, ...(w.kind==="soon" ? S.weeklyTileDisabled : {})}}
                onClick={() => {
                  if (w.kind === "run") runReport(w.automation);
                  else if (w.kind === "info") navigate("daily-task");
                }}>
                <div style={S.weeklyIcon}>{w.icon}</div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={S.weeklyLabel}>{w.label.split("\n").map((l,i)=><div key={i}>{l}</div>)}</div>
                  {w.kind === "soon" && <div style={S.soonTag}>Coming Soon</div>}
                  {w.kind === "info" && <div style={S.infoTag}>{w.value}</div>}
                </div>
                {w.kind !== "soon" && <span style={S.weeklyArrow}>›</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   STYLES — theme-aware (light/dark) via global CSS variables
══════════════════════════════════════════════════════════ */
const S = {
  root:   {height:"100%", display:"flex", flexDirection:"column", overflow:"hidden",
           background:"var(--bg)", fontFamily:"'Inter',system-ui,sans-serif", color:"var(--text)"},

  topbar: {display:"flex", alignItems:"flex-start", justifyContent:"space-between",
           padding:"20px 24px 16px", flexShrink:0},
  greetSmall: {fontSize:12.5, color:"var(--muted)", fontWeight:500},
  greetTitle:{fontSize:24, fontWeight:800, letterSpacing:"-.02em", color:"var(--text)", marginTop:2},
  greetSub:  {fontSize:12, color:"var(--muted2)", marginTop:4},
  topbarRight:{display:"flex", alignItems:"center", gap:14, marginTop:4},
  clockBlock:{display:"flex", alignItems:"center", gap:6, fontSize:12, color:"var(--text4)", fontWeight:500},
  clockIcon: {fontSize:13},
  liveBadge: {display:"flex", alignItems:"center", gap:6, fontSize:11.5, fontWeight:600, color:"var(--green)"},
  liveDot:   {width:7, height:7, borderRadius:"50%", background:"var(--green)", boxShadow:"0 0 0 3px var(--green-dim)"},
  avatar:    {width:32, height:32, borderRadius:"50%", background:"var(--maroon)", color:"#fff",
              fontSize:13, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center"},

  content: {flex:1, overflowY:"auto", padding:"4px 24px 24px", minHeight:0},

  kpiRow: {display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:16},
  kpiCard:{background:"var(--surface)", border:"1px solid var(--border)", borderRadius:14, padding:"16px 18px",
           display:"flex", alignItems:"center", gap:12, cursor:"pointer",
           boxShadow:"var(--shadow-card)"},
  kpiIcon:{width:42, height:42, borderRadius:11, display:"flex", alignItems:"center",
           justifyContent:"center", fontSize:18, flexShrink:0},
  kpiLabel:{fontSize:11.5, color:"var(--muted)", fontWeight:500},
  kpiVal:  {fontSize:21, fontWeight:800, color:"var(--text)", letterSpacing:"-.02em", marginTop:1},
  kpiTrend:{fontSize:10.5, color:"var(--green)", marginTop:2, whiteSpace:"nowrap"},

  midRow: {display:"grid", gridTemplateColumns:"1.3fr 1fr", gap:16, marginBottom:16},
  card:   {background:"var(--surface)", border:"1px solid var(--border)", borderRadius:14, padding:"18px 20px",
           boxShadow:"var(--shadow-card)"},
  cardHead:{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16},
  cardTitleRow:{display:"flex", alignItems:"center", gap:8},
  cardTitle:{fontSize:14, fontWeight:700, color:"var(--text)"},
  viewAllLink:{background:"none", border:"none", color:"var(--accent)", fontSize:11.5, fontWeight:600,
           cursor:"pointer", fontFamily:"inherit"},

  legendRow:{display:"flex", alignItems:"center", gap:7},
  legendDot:{width:8, height:8, borderRadius:"50%", flexShrink:0},
  legendLabel:{fontSize:11.5, color:"var(--text4)", flex:1},
  legendVal:{fontSize:12, fontWeight:700, color:"var(--text)"},

  alertRow:{display:"flex", alignItems:"center", gap:8, padding:"4px 0", cursor:"pointer"},
  alertDot:{width:6, height:6, borderRadius:"50%", flexShrink:0},
  alertName:{fontSize:11.5, color:"var(--text2)", flex:1, minWidth:0, overflow:"hidden",
           textOverflow:"ellipsis", whiteSpace:"nowrap"},
  alertTime:{fontSize:10, color:"var(--muted3)", flexShrink:0, whiteSpace:"nowrap"},

  statusCircle:{width:56, height:56, borderRadius:"50%", display:"flex", alignItems:"center",
           justifyContent:"center", color:"var(--green)"},
  downloadBtn:{marginTop:8, background:"var(--surface)", border:"1.5px solid var(--accent)", color:"var(--accent)",
           fontFamily:"inherit", fontSize:11.5, fontWeight:600, padding:"8px 18px",
           borderRadius:20, cursor:"pointer"},

  emptyState:{fontSize:11.5, color:"var(--muted3)", fontStyle:"italic", padding:"10px 0"},

  weeklyCard:{background:"var(--surface)", border:"1px solid var(--border)", borderRadius:14, padding:"18px 20px",
           boxShadow:"var(--shadow-card)"},
  genReportBtn:{background:"var(--accent)", color:"#fff", border:"none", fontFamily:"inherit",
           fontSize:12, fontWeight:600, padding:"9px 18px", borderRadius:20, cursor:"pointer",
           display:"flex", alignItems:"center", gap:6, whiteSpace:"nowrap"},

  weeklyGrid:{display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:12},
  weeklyTile:{background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:11, padding:"14px 12px",
           display:"flex", flexDirection:"column", gap:10, cursor:"pointer", minHeight:84,
           transition:"border-color .15s"},
  weeklyTileDisabled:{cursor:"default", opacity:.6},
  weeklyIcon:{fontSize:18},
  weeklyLabel:{fontSize:11.5, fontWeight:600, color:"var(--text2)", lineHeight:1.3},
  weeklyArrow:{alignSelf:"flex-end", color:"var(--muted3)", fontSize:14, marginTop:-18},
  soonTag:{fontSize:9, fontWeight:700, color:"var(--muted2)", background:"var(--surface3)",
           display:"inline-block", padding:"2px 6px", borderRadius:4, marginTop:4},
  infoTag:{fontSize:9.5, fontWeight:700, color:"var(--accent)", marginTop:2},
};
