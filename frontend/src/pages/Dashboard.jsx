import React, { useState, useEffect, useCallback } from "react";
import Icon from "../components/Icon.jsx";
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
  if (h < 11) return "Good morning";
  if (h < 15) return "Good afternoon";
  if (h < 19) return "Good evening";
  return "Good evening";
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
function severityStyle(sev) {
  const s = (sev || "").toLowerCase();
  if (s.includes("critical") || s.includes("high")) return { color: "var(--red)", background: "var(--red-dim)", borderColor: "var(--red-dim)" };
  if (s.includes("warning") || s.includes("medium")) return { color: "var(--amber)", background: "var(--amber-dim)", borderColor: "var(--amber-dim)" };
  if (s.includes("info") || s.includes("low")) return { color: "var(--blue)", background: "var(--blue-dim)", borderColor: "var(--blue-dim)" };
  return { color: "var(--muted)", background: "var(--surface3)", borderColor: "var(--border)" };
}

/* ── Grafana Alerts donut ── */
function AlertDonut({ critical, warning, info }) {
  const total = critical + warning + info;
  const r = 44, cx = 50, cy = 50, stroke = 10;
  const circ = 2 * Math.PI * r;
  const slices = [
    { val: critical, color: "var(--red)" },
    { val: warning,  color: "var(--amber)" },
    { val: info,     color: "var(--blue)" },
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
      <text x={cx} y={cy+2} textAnchor="middle" fontSize="23" fontWeight="700" fill="var(--text)" fontFamily="Inter">{total}</text>
      <text x={cx} y={cy+14} textAnchor="middle" fontSize="7.5" fill="var(--muted)" fontFamily="Inter" letterSpacing=".8">FIRING</text>
    </svg>
  );
}

export default function Dashboard({ customers, navigate, currentUser }) {
  const [alerts,       setAlerts]       = useState([]);
  const [alertsError,  setAlertsError]  = useState(null);
  const [history,      setHistory]      = useState([]);
  const [tasks,        setTasks]        = useState([]);
  const [dailySummary, setDailySummary] = useState({ total:null, success:null, failed:null, rate:null, health:null, lastRun:null });
  const [now,          setNow]          = useState(fmtNowWIB());
  const [runningReport,setRunningReport]= useState(null);

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

  const alertOnlyTasks = tasks.filter(t => (t.description || "").startsWith("[ALERT]"));
  const todayStr = localISODate();
  const ticketsToday  = alertOnlyTasks.filter(t => (t.date || "").slice(0,10) === todayStr).length;
  const ticketsClosed = alertOnlyTasks.filter(t => t.status === "Close").length;

  const servicesHealthy = dailySummary.rate ? dailySummary.rate : (dailySummary.total ? `${Math.round((dailySummary.success/dailySummary.total)*100)}%` : "—");

  // Top alert incidents from the last 30 days of alert tickets.
  // Grouped by alert name + resource so each recurring incident stays traceable.
  const incidentWindowStart = localISODate(new Date(Date.now() - 29 * 86400000));
  const incidentMap = new Map();
  alertOnlyTasks.forEach(t => {
    const date = (t.date || "").slice(0, 10);
    if (!date || date < incidentWindowStart) return;

    const body = (t.description || "").replace(/^\[ALERT\]\s*/, "");
    const [namePart, ...rest] = body.split(" → ");
    const name = namePart.trim();
    const resource = rest.join(" → ").trim();
    if (!name) return;

    const detail = t.detail || "";
    const severity = (/Severity:\s*([^\n]+)/.exec(detail)?.[1] || "").trim();
    const folder   = (/Folder:\s*([^\n]+)/.exec(detail)?.[1] || "").trim();
    const ticket   = (/Ticket:\s*([^\n]+)/.exec(detail)?.[1] || "").trim();
    const seenAt   = t.createdAt || date;

    const key = `${name}||${resource}`;
    const cur = incidentMap.get(key) || {
      name, resource, count: 0, lastSeen: "", severity: "", folder: "", ticket: "",
    };
    cur.count += 1;
    if (!cur.lastSeen || new Date(seenAt) >= new Date(cur.lastSeen)) {
      cur.lastSeen = seenAt;
      if (severity && severity !== "-") cur.severity = severity;
      if (folder) cur.folder = folder;
      if (ticket) cur.ticket = ticket;
    }
    incidentMap.set(key, cur);
  });
  const topIncidents = [...incidentMap.values()]
    .sort((a, b) => b.count - a.count || new Date(b.lastSeen) - new Date(a.lastSeen))
    .slice(0, 5);
  const incidentTotal = [...incidentMap.values()].reduce((s, v) => s + v.count, 0);
  const maxIncidentCount = topIncidents[0]?.count || 1;

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
    { id: "infra_summary",  label: "Infrastructure summary", icon: "grafana",  kind: "run",    automation: "grafana_capture" },
    { id: "resource_util",  label: "Resource utilization",   icon: "server",   kind: "run",    automation: "grafana_capture" },
    { id: "cost_overview",  label: "Cost overview",          icon: "accounts", kind: "soon" },
    { id: "security",       label: "Security overview",      icon: "shield",   kind: "soon" },
    { id: "ticket_summary", label: "Ticket summary",         icon: "ticket",   kind: "info",   value: `${ticketsClosed}/${alertOnlyTasks.length} closed` },
    { id: "incident_report",label: "Incident report",        icon: "calendar", kind: "info",   value: `${ticketsToday} today` },
  ];

  return (
    <div style={S.root}>
      <div style={S.content}>
        {/* ── HERO ── */}
        <section style={S.hero}>
          <span style={S.heroGlow}/>
          <div style={S.heroLeft}>
            <div style={S.heroEyebrow}>{greetingByHour()}, {currentUser || "team"}</div>
            <h1 style={S.heroTitle}>Operations overview</h1>
            <div style={S.heroSub}>
              Infrastructure health, alerting, and recurring reporting across the Pelindo workspace.
            </div>
            <div style={S.heroActions}>
              <button style={S.heroPrimary} onClick={() => navigate("generate-report")} disabled={!!runningReport}>
                {runningReport
                  ? <><span className="spinner" style={{width:11,height:11,borderWidth:1.6}}/> Running…</>
                  : <><Icon name="play" size={12}/> Generate report</>}
              </button>
              <button style={S.heroGhost} onClick={() => navigate("alert-monitor")}>
                <Icon name="alert" size={13}/> Open alert center
              </button>
            </div>
          </div>
          <div style={S.heroRight}>
            <div style={S.heroLive}><span style={S.liveDot}/> Live monitoring</div>
            <div style={S.heroClock}>{now} <span style={{color:"var(--muted3)",fontSize:10}}>WIB</span></div>
            <div style={S.heroMeta}>
              {activeAlerts.length} active alert{activeAlerts.length === 1 ? "" : "s"} · {ticketsToday} ticket{ticketsToday === 1 ? "" : "s"} today
            </div>
          </div>
        </section>

        {/* ── KPI GRID ── */}
        <div style={S.kpiRow}>
          <button style={S.kpiCard} onClick={() => navigate("alert-monitor")}>
            <div style={S.kpiTop}>
              <span style={{...S.kpiIcon, color:"var(--red)", background:"var(--red-dim)"}}>
                <Icon name="bell" size={18}/>
              </span>
              <Icon name="chevronRight" size={14} style={S.kpiArrow}/>
            </div>
            <div style={S.kpiVal}>{alertsError ? "—" : activeAlerts.length}</div>
            <div style={S.kpiLabel}>Active alerts</div>
            <div style={{...S.kpiTrend, color: critical>0 ? "var(--red)" : "var(--green)"}}>
              {critical>0 ? `${critical} critical` : "All clear"}
            </div>
          </button>

          <div style={{...S.kpiCard, cursor:"default"}}>
            <div style={S.kpiTop}>
              <span style={{...S.kpiIcon, color:"var(--green)", background:"var(--green-dim)"}}>
                <Icon name="shield" size={18}/>
              </span>
            </div>
            <div style={S.kpiVal}>{servicesHealthy}</div>
            <div style={S.kpiLabel}>Healthy services</div>
            <div style={{...S.kpiTrend, color: dailySummary.health === "CRITICAL" ? "var(--red)" : "var(--green)"}}>
              {dailySummary.health === "HEALTHY" ? "All systems normal" : dailySummary.health || "No data yet"}
            </div>
          </div>

          <button style={S.kpiCard} onClick={() => navigate("daily-task")}>
            <div style={S.kpiTop}>
              <span style={{...S.kpiIcon, color:"var(--blue)", background:"var(--blue-dim)"}}>
                <Icon name="report" size={18}/>
              </span>
              <Icon name="chevronRight" size={14} style={S.kpiArrow}/>
            </div>
            <div style={S.kpiVal}>{dailyOk===null ? "Pending" : dailyOk ? "Completed" : "Failed"}</div>
            <div style={S.kpiLabel}>Today's report</div>
            <div style={S.kpiTrend}>
              {lastDailyRun ? `Updated ${new Date(lastDailyRun.last_run).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}` : "No run yet"}
            </div>
          </button>

          <button style={S.kpiCard} onClick={() => navigate("daily-task")}>
            <div style={S.kpiTop}>
              <span style={{...S.kpiIcon, color:"var(--amber)", background:"var(--amber-dim)"}}>
                <Icon name="ticket" size={18}/>
              </span>
              <Icon name="chevronRight" size={14} style={S.kpiArrow}/>
            </div>
            <div style={S.kpiVal}>{ticketsToday}</div>
            <div style={S.kpiLabel}>Tickets today</div>
            <div style={S.kpiTrend}>{ticketsClosed} closed overall</div>
          </button>
        </div>

        {/* ── BENTO: alerts + daily report ── */}
        <div style={S.bentoWide}>
          <div style={S.card}>
            <div style={S.cardHead}>
              <div style={S.cardTitleRow}>
                <span style={{...S.cardIcon, color:"var(--red)"}}><Icon name="alert" size={15}/></span>
                <span style={S.cardTitle}>Grafana alerts</span>
              </div>
              <button style={S.viewAllLink} onClick={() => navigate("alert-monitor")}>
                View all <Icon name="arrowRight" size={12}/>
              </button>
            </div>

            {alertsError ? (
              <div style={S.emptyState}><Icon name="warning" size={14}/> {alertsError}</div>
            ) : (
              <div style={S.alertBody}>
                <AlertDonut critical={critical} warning={warning} info={info}/>
                <div style={S.legend}>
                  {[
                    {label:"Critical", val:critical, color:"var(--red)"},
                    {label:"Warning",  val:warning,  color:"var(--amber)"},
                    {label:"Info",     val:info,     color:"var(--blue)"},
                  ].map(l => (
                    <div key={l.label} style={S.legendRow}>
                      <span style={{...S.legendDot, background:l.color}}/>
                      <span style={S.legendLabel}>{l.label}</span>
                      <span style={S.legendVal}>{l.val}</span>
                    </div>
                  ))}
                </div>
                <div style={S.latest}>
                  <div style={S.listLabel}>LATEST</div>
                  {activeAlerts.length === 0 ? (
                    <div style={S.emptyState}>No active alerts</div>
                  ) : activeAlerts.slice(0,4).map((a, i) => (
                    <div key={i} style={S.alertRow}>
                      <span style={{...S.alertDot, background: a.severity==="critical"?"var(--red)":a.severity==="warning"?"var(--amber)":"var(--blue)"}}/>
                      <span style={S.alertName} title={a.name}>{a.name}</span>
                      <span style={S.alertTime}>{timeAgo(a.active_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={S.card}>
            <div style={S.cardHead}>
              <div style={S.cardTitleRow}>
                <span style={{...S.cardIcon, color:"var(--blue)"}}><Icon name="report" size={15}/></span>
                <span style={S.cardTitle}>Daily report</span>
              </div>
              <button style={S.viewAllLink} onClick={() => navigate("daily-task")}>
                Details <Icon name="arrowRight" size={12}/>
              </button>
            </div>
            <div style={S.dailyBody}>
              <div style={{...S.statusCircle,
                background: dailyOk===false ? "var(--red-dim)" : dailyOk ? "var(--green-dim)" : "var(--surface2)",
                color: dailyOk===false ? "var(--red)" : dailyOk ? "var(--green)" : "var(--muted)"}}>
                <Icon name={dailyOk===false ? "xCircle" : dailyOk ? "checkCircle" : "clock"} size={28}/>
              </div>
              <div style={{fontWeight:600, fontSize:14, color: dailyOk===false ? "var(--red)" : dailyOk ? "var(--text)" : "var(--muted)"}}>
                {dailyOk===null ? "No report yet" : dailyOk ? "Report completed" : "Report failed"}
              </div>
              <div style={{fontSize:11.5, color:"var(--muted)", textAlign:"center", lineHeight:1.6}}>
                {lastDailyRun
                  ? `${new Date(lastDailyRun.last_run).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})} · ${new Date(lastDailyRun.last_run).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})} WIB`
                  : "Run Daily Backup Status to generate"}
              </div>
              <button style={S.downloadBtn} onClick={() => navigate("daily-task")}>
                <Icon name="download" size={13}/> Download report
              </button>
            </div>
          </div>
        </div>

        {/* ── BENTO: workspace + recent deliverables ── */}
        <div style={S.bentoWide}>
          <div style={S.card}>
            <div style={S.cardHead}>
              <div style={S.cardTitleRow}>
                <span style={{...S.cardIcon, color:"var(--amber)"}}><Icon name="layers" size={15}/></span>
                <div>
                  <div style={S.cardTitle}>Reporting workspace</div>
                  <div style={{fontSize:11, color:"var(--muted)", marginTop:2}}>Generate, retrieve, and share recurring deliverables.</div>
                </div>
              </div>
              <button style={S.genReportBtn} onClick={() => navigate("generate-report")} disabled={!!runningReport}>
                {runningReport
                  ? <><span className="spinner" style={{width:11,height:11,borderWidth:1.6}}/> Running…</>
                  : <><Icon name="play" size={12}/> Generate report</>}
              </button>
            </div>

            <div style={S.weeklyGrid}>
              {weeklyShortcuts.map(w => (
                <button key={w.id} style={{...S.weeklyTile, ...(w.kind==="soon" ? S.weeklyTileDisabled : {})}}
                  disabled={w.kind==="soon"}
                  onClick={() => {
                    if (w.kind === "run") runReport(w.automation);
                    else if (w.kind === "info") navigate("daily-task");
                  }}>
                  <span style={S.weeklyIcon}><Icon name={w.icon} size={17}/></span>
                  <span style={{flex:1, minWidth:0, textAlign:"left"}}>
                    <span style={S.weeklyLabel}>{w.label}</span>
                    {w.kind === "soon" && <span style={S.soonTag}>Coming soon</span>}
                    {w.kind === "info" && <span style={S.infoTag}>{w.value}</span>}
                  </span>
                  {w.kind !== "soon" && <Icon name="chevronRight" size={13} style={{color:"var(--muted3)"}}/>}
                </button>
              ))}
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardHead}>
              <div style={S.cardTitleRow}>
                <span style={{...S.cardIcon, color:"var(--red)"}}><Icon name="alert" size={15}/></span>
                <div>
                  <div style={S.cardTitle}>Top alert incidents</div>
                  <div style={{fontSize:11, color:"var(--muted)", marginTop:2}}>
                    Last 30 days · {incidentTotal} incident{incidentTotal === 1 ? "" : "s"} from alert tickets
                  </div>
                </div>
              </div>
              <button style={S.viewAllLink} onClick={() => navigate("alert-monitor")}>
                Alerts <Icon name="arrowRight" size={12}/>
              </button>
            </div>
            {topIncidents.length === 0 ? (
              <div style={S.emptyState}>No alert incidents in the last 30 days</div>
            ) : (
              <div style={S.incidentList}>
                {topIncidents.map((it, i) => (
                  <div key={`${it.name}||${it.resource}`} style={S.incidentRow}
                    title={`${it.name}${it.resource ? ` · ${it.resource}` : ""}${it.ticket ? `\nTicket: ${it.ticket}` : ""}${it.folder ? `\nFolder: ${it.folder}` : ""}\nOccurrences: ${it.count} · last seen ${timeAgo(it.lastSeen)}`}>
                    <span style={{...S.incidentRank, color: i === 0 ? "var(--accent)" : "var(--muted3)"}}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{display:"flex", alignItems:"center", gap:7, minWidth:0}}>
                        <span style={S.incidentName}>{it.name}</span>
                        {it.severity && (
                          <span style={{...S.severityBadge, ...severityStyle(it.severity)}}>
                            {it.severity}
                          </span>
                        )}
                      </div>
                      <div style={S.incidentMeta}>
                        {it.resource && <span style={S.incidentResource} title={it.resource}>{it.resource}</span>}
                        {it.folder && <span style={S.incidentMetaItem}>{it.folder}</span>}
                        {it.ticket && <span style={S.incidentTicket}>{it.ticket}</span>}
                      </div>
                      <div style={S.incidentBarTrack}>
                        <div style={{...S.incidentBarFill, width:`${Math.max(6, (it.count / maxIncidentCount) * 100)}%`,
                          background: i === 0 ? "var(--accent)" : "var(--muted3)"}}/>
                      </div>
                    </div>
                    <div style={{textAlign:"right", flexShrink:0}}>
                      <span style={S.incidentCount}>{it.count}<span style={S.incidentUnit}>×</span></span>
                      <div style={S.incidentLast}>{timeAgo(it.lastSeen)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const S = {
  root:   {height:"100%", display:"flex", flexDirection:"column", overflow:"hidden",
           background:"var(--bg)", fontFamily:"var(--font)", color:"var(--text)"},
  content:{flex:1, overflowY:"auto", padding:"22px 26px 36px", minHeight:0},

  hero:  {position:"relative", overflow:"hidden", display:"flex", alignItems:"flex-end",
          justifyContent:"space-between", gap:24, flexWrap:"wrap",
          background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:14,
          padding:"26px 28px", marginBottom:16, boxShadow:"var(--shadow-card)"},
  heroGlow:{position:"absolute", inset:0, pointerEvents:"none",
          background:"radial-gradient(620px 180px at 100% 0%, var(--accent-soft), transparent 72%)"},
  heroLeft:{position:"relative", minWidth:0},
  heroEyebrow:{fontSize:11.5, fontWeight:600, color:"var(--muted)", letterSpacing:".01em"},
  heroTitle:{fontSize:26, fontWeight:700, letterSpacing:"-.035em", color:"var(--text)", marginTop:5, lineHeight:1.15},
  heroSub:{fontSize:12.5, color:"var(--muted)", marginTop:7, maxWidth:620, lineHeight:1.6},
  heroActions:{display:"flex", gap:9, marginTop:18, flexWrap:"wrap"},
  heroPrimary:{display:"inline-flex", alignItems:"center", gap:6, background:"var(--accent)", color:"#fff",
          border:"none", fontFamily:"inherit", fontSize:12, fontWeight:600, padding:"9px 16px",
          borderRadius:7, cursor:"pointer"},
  heroGhost:{display:"inline-flex", alignItems:"center", gap:6, background:"var(--surface2)",
          border:"1px solid var(--border2)", color:"var(--text4)", fontFamily:"inherit",
          fontSize:12, fontWeight:500, padding:"9px 16px", borderRadius:7, cursor:"pointer"},
  heroRight:{position:"relative", textAlign:"right", minWidth:180},
  heroLive:{display:"inline-flex", alignItems:"center", gap:7, fontSize:11.5, fontWeight:600, color:"var(--green)"},
  heroClock:{fontSize:15, fontWeight:650, color:"var(--text2)", marginTop:8, fontFamily:"var(--mono)", letterSpacing:"-.01em"},
  heroMeta:{fontSize:11, color:"var(--muted)", marginTop:4},
  liveDot:{width:7, height:7, borderRadius:"50%", background:"var(--green)", boxShadow:"0 0 0 3px var(--green-dim)"},

  kpiRow:{display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:14, marginBottom:16},
  kpiCard:{display:"flex", flexDirection:"column", gap:2, background:"var(--bg2)",
          border:"1px solid var(--border)", borderRadius:12, padding:"16px 18px",
          cursor:"pointer", textAlign:"left", fontFamily:"inherit", color:"inherit",
          boxShadow:"var(--shadow-card)", transition:"border-color .15s, box-shadow .15s"},
  kpiTop:{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12},
  kpiIcon:{width:36, height:36, borderRadius:9, display:"flex", alignItems:"center",
          justifyContent:"center", flexShrink:0},
  kpiArrow:{color:"var(--muted3)", flexShrink:0},
  kpiVal:{fontSize:24, fontWeight:700, color:"var(--text)", letterSpacing:"-.035em", lineHeight:1.15},
  kpiLabel:{fontSize:11.5, color:"var(--muted)", fontWeight:500, marginTop:1},
  kpiTrend:{fontSize:10.5, color:"var(--muted)", marginTop:5, whiteSpace:"nowrap",
          overflow:"hidden", textOverflow:"ellipsis"},

  bentoWide:{display:"grid", gridTemplateColumns:"1.5fr 1fr", gap:16, marginBottom:16},
  card:   {background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"18px 20px",
          boxShadow:"var(--shadow-card)", minWidth:0},
  cardHead:{display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:16},
  cardTitleRow:{display:"flex", alignItems:"center", gap:9, minWidth:0},
  cardIcon:{display:"flex", alignItems:"center", justifyContent:"center"},
  cardTitle:{fontSize:13.5, fontWeight:650, color:"var(--text)", whiteSpace:"nowrap"},
  viewAllLink:{display:"inline-flex",alignItems:"center",gap:4,background:"none", border:"none",
          color:"var(--text4)", fontSize:11.5, fontWeight:500, cursor:"pointer", fontFamily:"inherit",
          whiteSpace:"nowrap"},
  listLabel:{fontSize:9, fontWeight:700, letterSpacing:".1em", color:"var(--muted3)", marginBottom:6},

  alertBody:{display:"flex", alignItems:"center", gap:20},
  legend:{flex:1, display:"flex", flexDirection:"column", gap:9, minWidth:110},
  legendRow:{display:"flex", alignItems:"center", gap:8},
  legendDot:{width:7, height:7, borderRadius:"50%", flexShrink:0},
  legendLabel:{fontSize:11.5, color:"var(--text4)", flex:1},
  legendVal:{fontSize:12, fontWeight:600, color:"var(--text)"},
  latest:{flex:1.5, display:"flex", flexDirection:"column", gap:2,
          borderLeft:"1px solid var(--border)", paddingLeft:20, minHeight:110, minWidth:0},
  alertRow:{display:"flex", alignItems:"center", gap:8, padding:"6px 0",
          borderBottom:"1px solid var(--border)"},
  alertDot:{width:6, height:6, borderRadius:"50%", flexShrink:0},
  alertName:{fontSize:11.5, color:"var(--text3)", flex:1, minWidth:0, overflow:"hidden",
          textOverflow:"ellipsis", whiteSpace:"nowrap"},
  alertTime:{fontSize:9.5, color:"var(--muted3)", flexShrink:0, whiteSpace:"nowrap"},

  dailyBody:{display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:"12px 0 4px"},
  statusCircle:{width:58, height:58, borderRadius:"50%", display:"flex", alignItems:"center",
          justifyContent:"center", color:"var(--green)"},
  downloadBtn:{marginTop:4, display:"inline-flex", alignItems:"center", gap:6,
          background:"var(--bg2)", border:"1px solid var(--border2)", color:"var(--text4)",
          fontFamily:"inherit", fontSize:11.5, fontWeight:500, padding:"7px 16px",
          borderRadius:7, cursor:"pointer"},

  emptyState:{display:"flex", alignItems:"center", gap:6, fontSize:11.5, color:"var(--muted3)", padding:"8px 0"},

  genReportBtn:{display:"inline-flex", alignItems:"center", gap:6,
          background:"var(--accent)", color:"#fff", border:"none", fontFamily:"inherit",
          fontSize:11.5, fontWeight:600, padding:"8px 16px", borderRadius:7, cursor:"pointer",
          whiteSpace:"nowrap"},

  weeklyGrid:{display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:10},
  weeklyTile:{display:"flex", alignItems:"center", gap:12, background:"var(--bg3)",
          border:"1px solid var(--border)", borderRadius:9, padding:"12px 14px",
          cursor:"pointer", minHeight:60, transition:"border-color .15s, background .15s",
          fontFamily:"inherit", color:"inherit"},
  weeklyTileDisabled:{cursor:"default", opacity:.6},
  weeklyIcon:{width:32, height:32, borderRadius:8, background:"var(--surface2)",
          border:"1px solid var(--border)", display:"flex", alignItems:"center",
          justifyContent:"center", color:"var(--text4)", flexShrink:0},
  weeklyLabel:{display:"block",fontSize:11.5, fontWeight:550, color:"var(--text2)", lineHeight:1.3},
  soonTag:{display:"inline-block",fontSize:9, fontWeight:600, color:"var(--muted3)",
          background:"var(--surface3)", padding:"1px 6px", borderRadius:4, marginTop:4},
  infoTag:{display:"block",fontSize:9.5, fontWeight:600, color:"var(--muted)", marginTop:3},

  incidentList:{display:"flex", flexDirection:"column", gap:2},
  incidentRow:{display:"flex", alignItems:"center", gap:12, padding:"9px 0",
          borderBottom:"1px solid var(--border)"},
  incidentRank:{fontSize:11, fontWeight:700, fontFamily:"var(--mono)", letterSpacing:".02em",
          flexShrink:0, width:20},
  incidentName:{fontSize:11.5, fontWeight:550, color:"var(--text2)",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0},
  severityBadge:{fontSize:8.5, fontWeight:700, letterSpacing:".05em", textTransform:"uppercase",
          padding:"1px 6px", borderRadius:4, border:"1px solid transparent", flexShrink:0,
          lineHeight:1.5},
  incidentMeta:{display:"flex", alignItems:"center", gap:8, marginTop:2, minWidth:0,
          overflow:"hidden", whiteSpace:"nowrap"},
  incidentResource:{fontSize:9.5, fontFamily:"var(--mono)", color:"var(--text4)",
          overflow:"hidden", textOverflow:"ellipsis", maxWidth:150},
  incidentMetaItem:{fontSize:9.5, color:"var(--muted3)", overflow:"hidden",
          textOverflow:"ellipsis", maxWidth:130},
  incidentTicket:{fontSize:9, fontFamily:"var(--mono)", fontWeight:600, color:"var(--muted2)",
          background:"var(--surface2)", border:"1px solid var(--border)", padding:"0 5px",
          borderRadius:4, flexShrink:0},
  incidentBarTrack:{marginTop:6, height:4, borderRadius:2, background:"var(--surface3)", overflow:"hidden"},
  incidentBarFill:{height:"100%", borderRadius:2, transition:"width .4s"},
  incidentCount:{fontSize:14, fontWeight:700, color:"var(--text)", letterSpacing:"-.02em"},
  incidentUnit:{fontSize:9.5, color:"var(--muted2)", marginLeft:1},
  incidentLast:{fontSize:9.5, color:"var(--muted3)", marginTop:1, whiteSpace:"nowrap"},
};
