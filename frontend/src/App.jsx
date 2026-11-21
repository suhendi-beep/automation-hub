import React, { useState, useEffect, useRef } from "react";
import Dashboard    from "./pages/Dashboard.jsx";
import GenerateReport from "./pages/GenerateReport.jsx";
import DailyTask    from "./pages/DailyTask.jsx";
import CustomerPage from "./pages/CustomerPage.jsx";
import FilesPage    from "./pages/FilesPage.jsx";
import LoginPage    from "./pages/LoginPage.jsx";
import AlertPage    from "./pages/AlertPage.jsx";
import DailyReportPage from "./pages/DailyReportPage.jsx";
import EngineerActivity from "./pages/EngineerActivity.jsx";
import CustomersPage from "./pages/CustomersPage.jsx";
import ManagementAccountsPage from "./pages/ManagementAccountsPage.jsx";
import CredentialsPage from "./pages/CredentialsPage.jsx";
import SchedulesPage from "./pages/SchedulesPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ReminderNotif from "./components/ReminderNotif.jsx";
import AlertWatcher  from "./components/AlertWatcher.jsx";
import OciModal from "./components/OciModal.jsx";
import AmbientBackground from "./components/AmbientBackground.jsx";
import Icon from "./components/Icon.jsx";
import { clearSession } from "./api.js";
import "./styles.css";

// Hard session limit: 12 hours after login, regardless of activity.
const SESSION_MS = 12 * 60 * 60 * 1000;

const PAGE_META = {
  dashboard:           { group: "Monitoring",     label: "Dashboard" },
  "alert-monitor":     { group: "Monitoring",     label: "Grafana Alerts" },
  "daily-report":      { group: "Workflow",       label: "Daily Report" },
  "daily-task":        { group: "Workflow",       label: "Tickets" },
  "generate-report":   { group: "Workflow",       label: "Weekly Reports" },
  files:               { group: "Workflow",       label: "Report History" },
  customer:            { group: "Workflow",       label: "Automation Jobs" },
  "engineer-activity": { group: "Insights",       label: "Engineer Activity" },
  schedules:           { group: "Platform",       label: "Schedules" },
  customers:           { group: "Administration", label: "Customers" },
  "management-accounts":{ group: "Administration", label: "Management Accounts" },
  credentials:         { group: "Administration", label: "Credentials" },
  settings:            { group: "Administration", label: "Settings" },
};

const NAV_GROUPS = [
  { section: "Monitoring", items: [
    { key: "dashboard",       icon: "dashboard", label: "Dashboard" },
    { key: "alert-monitor",   icon: "alert",     label: "Grafana Alerts" },
  ]},
  { section: "Workflow", items: [
    { key: "daily-report",    icon: "calendar",  label: "Daily Report" },
    { key: "daily-task",      icon: "ticket",    label: "Tickets" },
    { key: "generate-report", icon: "report",    label: "Weekly Reports" },
    { key: "files",           icon: "history",   label: "Report History" },
  ]},
  { section: "Insights", items: [
    { key: "engineer-activity", icon: "activity", label: "Engineer Activity" },
  ]},
  { section: "Platform", items: [
    { key: "schedules", icon: "schedule", label: "Schedules" },
  ]},
  { section: "Administration", items: [
    { key: "customers",           icon: "users",    label: "Customers" },
    { key: "management-accounts", icon: "accounts", label: "Management Accounts" },
    { key: "credentials",         icon: "key",      label: "Credentials" },
    { key: "settings",            icon: "settings", label: "Settings" },
  ]},
];

function fmtClock() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    weekday: "short", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date()).replace(",", "");
}

export default function App() {
  // ── One-time cleanup of old localStorage keys (task data now lives in backend) ──
  React.useEffect(() => {
    const KEYS_TO_CLEAR = [
      "portal_report_daily_tasks",
      "pr_tasks_migrated",
      "pr_daily_tasks",
      // Keep pr_alert_tickets, pr_alert_task_ids, pr_alert_ticket_cooldown:
      // they still track alert ticket numbers.
    ];
    KEYS_TO_CLEAR.forEach(k => { try { localStorage.removeItem(k); } catch(_) {} });
  }, []);

  // ── Persist page state across browser refresh ──
  const [page,     setPage]     = useState(() => {
    let saved = sessionStorage.getItem("pr_page") || "dashboard";
    if (saved === "accounts" || saved === "requests") saved = "management-accounts";
    if (!PAGE_META[saved]) saved = "dashboard";
    return saved;
  });
  const [custId,   setCustId]   = useState(() => sessionStorage.getItem("pr_custid") || null);
  const [customers,setCustomers]= useState([]);
  const [ociSess,  setOciSess]  = useState(null);
  const [running,  setRunning]  = useState({});
  const [statuses, setStatuses] = useState({});
  const [logs,     setLogs]     = useState({});
  const [activeLog,setActiveLog]= useState(null);
  const [authed,   setAuthed]   = useState(() => !!(sessionStorage.getItem("pr_auth") && sessionStorage.getItem("pr_token")));
  const [fullCust, setFullCust] = useState(null);
  const darkMode = true; // Midnight glass is the only theme
  const currentUser = sessionStorage.getItem("pr_user")    || "admin";
  const currentRole = sessionStorage.getItem("pr_role")    || "engineer";
  const displayName = sessionStorage.getItem("pr_display") || currentUser;

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("pr_sidebar") === "1"; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed((v) => {
    const next = !v;
    try { localStorage.setItem("pr_sidebar", next ? "1" : "0"); } catch {}
    return next;
  });

  // ── Session limit: force sign-out 12h after login, regardless of activity. ──
  React.useEffect(() => {
    if (!authed) return;

    let started = 0;
    try { started = Number(sessionStorage.getItem("pr_login_at")) || 0; } catch (_) {}
    if (!started) {
      started = Date.now();
      try { sessionStorage.setItem("pr_login_at", String(started)); } catch (_) {}
    }

    const remaining = started + SESSION_MS - Date.now();
    if (remaining <= 0) {
      clearSession();
      return;
    }

    const timer = setTimeout(() => {
      const u = sessionStorage.getItem("pr_user");
      const d = sessionStorage.getItem("pr_display");
      if (u) {
        fetch("/api/activity", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: u, display: d || u, action: "Logout", category: "auth", detail: "Auto-logout after 12h session" }),
        }).catch(() => {});
      }
      clearSession();
    }, remaining);

    return () => clearTimeout(timer);
  }, [authed]);

  // Midnight glass is the only theme.
  useEffect(() => {
    document.body.classList.remove("light");
    try { localStorage.setItem("pr_theme", "dark"); } catch {}
  }, []);

  // Cursor spotlight on the glass.
  useEffect(() => {
    let raf = 0;
    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const root = document.documentElement;
        root.style.setProperty("--mx", e.clientX + "px");
        root.style.setProperty("--my", e.clientY + "px");
        raf = 0;
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!authed) return;
    fetch("/api/customers").then(r=>r.json()).then(setCustomers).catch(()=>{});
    fetch("/api/oci/session").then(r=>r.json()).then(setOciSess).catch(()=>{});
  }, [authed]);

  useEffect(() => {
    if (!custId) return;
    fetch("/api/customers/"+custId).then(r=>r.json()).then(setFullCust).catch(()=>{});
  }, [custId]);

  const navigate = (p, id) => {
    setPage(p);
    setCustId(id||null);
    sessionStorage.setItem("pr_page", p);
    if (id) sessionStorage.setItem("pr_custid", id);
    else sessionStorage.removeItem("pr_custid");
  };
  const refreshOci = () => fetch("/api/oci/session").then(r=>r.json()).then(setOciSess).catch(()=>{});

  if (!authed) return (
    <>
      <AmbientBackground />
      <LoginPage onLogin={() => setAuthed(true)} />
    </>
  );

  const meta = PAGE_META[page] || PAGE_META.dashboard;

  return (
    <div style={{display:"flex",height:"100vh",overflow:"hidden",
      background:"transparent",fontFamily:"var(--font)"}}>
      <AmbientBackground />
      <Sidebar
        customers={customers} page={page} navigate={navigate}
        custId={custId} ociSess={ociSess} onOciChange={refreshOci}
        currentUser={currentUser} displayName={displayName}
        currentRole={currentRole}
        collapsed={collapsed}
      />
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
      <Topbar
        meta={meta} ociSess={ociSess} navigate={navigate}
        currentRole={currentRole}
        collapsed={collapsed} onToggleCollapsed={toggleCollapsed}
      />
      <main className="app-main" style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",minWidth:0}}>
        {page==="dashboard"       && <Dashboard customers={customers} navigate={navigate} currentUser={currentUser} darkMode={darkMode}/>}
        {page==="generate-report" && <GenerateReport customers={customers} navigate={navigate} darkMode={darkMode}/>}
        {page==="daily-task"      && <DailyTask customers={customers} navigate={navigate} darkMode={darkMode}/>}
        {page==="alert-monitor"   && <AlertPage darkMode={darkMode}/>}
        {page==="daily-report"    && <DailyReportPage navigate={navigate}/>}
        {page==="engineer-activity" && <EngineerActivity navigate={navigate}/>}
        {page==="customer"  && custId && <CustomerPage customerId={custId} navigate={navigate} ociSession={ociSess} running={running} setRunning={setRunning} statuses={statuses} setStatuses={setStatuses} logs={logs} setLogs={setLogs} activeLog={activeLog} setActiveLog={setActiveLog} darkMode={darkMode}/>}
        {page==="files"     && custId && <FilesPage customer={fullCust} navigate={navigate} darkMode={darkMode}/>}
        {page==="customers" && <CustomersPage navigate={navigate}/>}
        {page==="management-accounts" && <ManagementAccountsPage navigate={navigate}/>}
        {page==="credentials" && <CredentialsPage currentRole={currentRole} currentUser={currentUser} ociSession={ociSess} onOciChange={refreshOci}/>}
        {page==="schedules" && <SchedulesPage currentRole={currentRole}/>}
        {page==="settings"  && <SettingsPage currentUser={currentUser} currentRole={currentRole} displayName={displayName}/>}
      </main>
      </div>
      {/* Global reminder notifications — shown on all pages */}
      {authed && <ReminderNotif />}
      {/* Global alert ringtone + new-alert toasts — active on every page */}
      {authed && <AlertWatcher />}
    </div>
  );
}

function Sidebar({ customers, page, navigate, custId, ociSess, onOciChange,
  currentUser, displayName, currentRole, collapsed }) {
  const [showOci, setShowOci] = useState(false);
  const initials = (displayName || currentUser || "?").slice(0,2).toUpperCase();
  const roleLabel = currentRole === "admin" ? "Administrator" : "Engineer";

  const signOut = () => {
    const u = sessionStorage.getItem("pr_user");
    const d = sessionStorage.getItem("pr_display");
    if (u) {
      fetch("/api/activity", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, display: d || u, action: "Logout", category: "auth", detail: "" }),
      }).catch(() => {});
    }
    sessionStorage.removeItem("pr_auth");
    sessionStorage.removeItem("pr_user");
    sessionStorage.removeItem("pr_display");
    sessionStorage.removeItem("pr_role");
    sessionStorage.removeItem("pr_token");
    clearSession();
  };

  const go = (key) => {
    if (key === "files") navigate("files", custId || customers[0]?.id || "pelindo");
    else navigate(key);
  };

  return (
    <aside style={{...SB.root, width: collapsed ? 74 : 252}} className="app-sidebar">
      <div style={{...SB.brand, justifyContent: collapsed ? "center" : "flex-start"}}>
        <img src="/ics-mark.svg" alt="ICS Compute" style={SB.logoMark}/>
        {!collapsed && (
          <div style={{minWidth:0}}>
            <div style={SB.logoName}>Portal Report</div>
            <div style={SB.logoSub}>ICS Compute</div>
          </div>
        )}
      </div>

      {!collapsed && (
        <div style={SB.workspace}>
          <div style={SB.wsLabel}>Workspace</div>
          <div style={SB.wsName}>Pelindo Production</div>
          <div style={SB.wsMeta}>
            {Math.max(customers.length, 1)} environment{customers.length === 1 ? "" : "s"} · Asia/Jakarta
          </div>
        </div>
      )}

      <nav style={SB.nav}>
        {NAV_GROUPS.map((g) => (
          <div key={g.section}>
            {!collapsed && <div style={SB.section}>{g.section}</div>}
            {collapsed && <div className="sb-rule" style={SB.rule}/>}
            {g.items
              .filter((it) => !it.adminOnly || currentRole === "admin")
              .map((it) => (
                <NavItem key={it.key} icon={it.icon} label={it.label}
                  active={page === it.key} collapsed={collapsed} onClick={() => go(it.key)}/>
              ))}
          </div>
        ))}
      </nav>

      <div style={SB.footer}>
        <button className="sb-foot-btn"
          style={{...SB.ociBtn, ...(collapsed ? SB.ociBtnCollapsed : {})}}
          onClick={() => setShowOci(true)} title="OCI session">
          <span style={{...SB.ociDot,
            background: ociSess?.logged_in ? "var(--green)" : "var(--side-muted)",
            boxShadow: ociSess?.logged_in ? "0 0 0 3px var(--green-dim)" : "none"}}/>
          {!collapsed && (
            <>
              <span style={{flex:1,minWidth:0}}>
                <span style={SB.ociTitle}>OCI Console</span>
                <span style={SB.ociSub}>
                  {ociSess?.logged_in ? "Session connected" : "Not connected"}
                </span>
              </span>
              <Icon name={ociSess?.logged_in ? "checkCircle" : "link"} size={14}
                style={{color: ociSess?.logged_in ? "var(--green)" : "var(--side-muted)"}}/>
            </>
          )}
        </button>

        {!collapsed ? (
          <div style={SB.user}>
            <span style={SB.avatar}>{initials}</span>
            <span style={{flex:1,minWidth:0}}>
              <span style={SB.userName}>{displayName || currentUser}</span>
              <span style={SB.userRole}>{roleLabel}</span>
            </span>
            <button onClick={signOut} style={SB.signOut} title="Sign out">
              <Icon name="logout" size={15}/>
            </button>
          </div>
        ) : (
          <button onClick={signOut} style={{...SB.avatar, alignSelf:"center", marginTop:6}}
            title={`${displayName || currentUser} · ${roleLabel} — Sign out`}>
            {initials}
          </button>
        )}
      </div>

      {showOci && (
        <OciModal loggedIn={ociSess?.logged_in} savedAt={ociSess?.saved_at}
          onClose={()=>setShowOci(false)}
          onDone={()=>{ setShowOci(false); onOciChange(); }}/>
      )}
    </aside>
  );
}

function Topbar({ meta, ociSess, navigate, currentRole, collapsed, onToggleCollapsed }) {
  const [clock, setClock] = useState(fmtClock);

  useEffect(() => {
    const id = setInterval(() => setClock(fmtClock()), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="app-topbar" style={TB.root}>
      <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
        <button className="tb-icon" style={TB.iconBtn} onClick={onToggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16}/>
        </button>
        <div style={TB.crumbs}>
          <span style={TB.crumbMuted}>Workspace</span>
          <span style={TB.crumbSep}>/</span>
          <span style={TB.crumbMuted}>{meta.group}</span>
          <span style={TB.crumbSep}>/</span>
          <span style={TB.crumbActive}>{meta.label}</span>
        </div>
      </div>

      <div style={TB.right}>
        <div style={TB.clock} title="Asia/Jakarta">
          <Icon name="clock" size={13}/>
          {clock}
          <span style={{color:"var(--muted3)",fontSize:10}}>WIB</span>
        </div>
        <button className="tb-pill" style={TB.pill} onClick={()=>navigate("credentials")}
          title="Manage OCI session">
          <span style={{...TB.pillDot,
            background: ociSess?.logged_in ? "var(--green)" : "var(--muted3)",
            boxShadow: ociSess?.logged_in ? "0 0 0 3px var(--green-dim)" : "none"}}/>
          OCI {ociSess?.logged_in ? "connected" : "offline"}
        </button>
        {currentRole === "admin" && <NotificationBell navigate={navigate}/>}
      </div>
    </header>
  );
}

const FEATURE_LABEL = {
  "engineer-activity": "Engineer Activity",
  "account-management": "Management Accounts",
};

function fmtNotifDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function NotificationBell({ navigate }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef(null);

  const load = () => {
    setLoading(true);
    fetch("/api/requests?status=pending")
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d)) throw new Error(d?.error || "Failed to load notifications");
        setItems(d);
        setError("");
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const openApprovals = () => {
    try { sessionStorage.setItem("pr_mgmt_tab", "approvals"); } catch (_) {}
    navigate("management-accounts");
    setOpen(false);
  };

  const count = items.length;

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button className="tb-icon"
        style={{ ...TB.iconBtn, position: "relative", borderColor: open ? "var(--border2)" : "transparent" }}
        onClick={() => { setOpen(v => !v); if (!open) load(); }}
        title={count ? `${count} pending approval${count === 1 ? "" : "s"}` : "Notifications"}
        aria-label="Notifications">
        <Icon name="bell" size={16}/>
        {count > 0 && (
          <span style={{
            position: "absolute", top: 2, right: 2, minWidth: 14, height: 14, padding: "0 3px",
            borderRadius: 99, background: "var(--red)", color: "#fff", fontSize: 9, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
            border: "1px solid var(--bg2)",
          }}>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 8px)", width: 320, maxHeight: 360,
          overflow: "auto", background: "var(--bg2)", border: "1px solid var(--border2)",
          borderRadius: 10, zIndex: 120, boxShadow: "0 16px 40px rgba(0,0,0,.45)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px",
            borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg2)",
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted2)" }}>
              Notifications
            </span>
            <span style={{ fontSize: 10, color: "var(--muted3)" }}>{count} pending</span>
          </div>
          {loading && items.length === 0 ? (
            <div style={{ padding: 16, fontSize: 11.5, color: "var(--muted)" }}>Loading…</div>
          ) : error ? (
            <div style={{ padding: 16, fontSize: 11.5, color: "var(--red)" }}>{error}</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 20, fontSize: 11.5, color: "var(--muted)", textAlign: "center" }}>
              No pending approvals
            </div>
          ) : (
            items.map(it => (
              <button key={it.id} onClick={openApprovals}
                style={{
                  display: "block", width: "100%", textAlign: "left", background: "transparent",
                  border: "none", borderBottom: "1px solid var(--border)", padding: "10px 12px",
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                <div style={{ fontSize: 11.5, color: "var(--text3)", fontWeight: 600 }}>
                  {it.type === "password" ? "Password change" : "Access request"}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
                  {it.display || it.username}
                  {it.type === "access" ? ` · ${FEATURE_LABEL[it.feature] || it.feature}` : ""}
                </div>
                <div style={{ fontSize: 9.5, color: "var(--muted3)", marginTop: 2 }}>
                  {fmtNotifDate(it.requested_at)}
                </div>
              </button>
            ))
          )}
          <button onClick={openApprovals}
            style={{
              display: "block", width: "100%", background: "transparent", border: "none",
              padding: "10px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 11,
              fontWeight: 600, color: "var(--accent)", textAlign: "center",
            }}>
            Open Management Accounts
          </button>
        </div>
      )}
    </div>
  );
}

function NavItem({ icon, label, active, collapsed, onClick }) {
  return (
    <button
      className="sb-item"
      style={{...SB.item, ...(active ? SB.itemActive : {}), ...(collapsed ? SB.itemCollapsed : {})}}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}>
      <span style={SB.itemIcon}>
        <Icon name={icon} size={17} strokeWidth={active ? 2 : 1.75}/>
      </span>
      {!collapsed && <span style={{flex:1,textAlign:"left"}}>{label}</span>}
      {active && <span style={SB.itemMark}/>}
    </button>
  );
}

const SB = {
  root:        {background:"var(--side-bg)",borderRight:"1px solid var(--side-border)",
                display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden",
                transition:"width .18s ease"},
  brand:       {display:"flex",alignItems:"center",gap:11,padding:"17px 16px 14px"},
  logoMark:    {width:34,height:34,borderRadius:10,display:"block",flexShrink:0,
                boxShadow:"0 0 22px -4px rgba(232,194,122,.55)"},
  logoName:    {fontSize:13.5,fontWeight:700,letterSpacing:"-.02em",color:"var(--side-strong)",
                lineHeight:1.2,whiteSpace:"nowrap"},
  logoSub:     {fontSize:10,color:"var(--side-muted)",marginTop:2,letterSpacing:".01em",
                whiteSpace:"nowrap"},

  workspace:   {margin:"0 12px 6px",padding:"11px 12px",borderRadius:9,
                background:"var(--side-field)",border:"1px solid var(--side-border)"},
  wsLabel:     {fontSize:9,fontWeight:650,letterSpacing:".12em",textTransform:"uppercase",
                color:"var(--side-muted)"},
  wsName:      {fontSize:12,fontWeight:600,color:"var(--side-strong)",marginTop:3,
                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},
  wsMeta:      {fontSize:10,color:"var(--side-text)",marginTop:2,
                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},

  nav:         {flex:1,padding:"4px 10px 10px",overflowY:"auto",overflowX:"hidden"},
  section:     {fontSize:9,fontWeight:650,letterSpacing:".12em",color:"var(--side-muted)",
                padding:"16px 10px 6px",textTransform:"uppercase",whiteSpace:"nowrap"},
  rule:        {height:1,background:"var(--side-border)",margin:"9px 8px"},

  item:        {position:"relative",display:"flex",alignItems:"center",gap:10,width:"100%",
                background:"transparent",border:"none",fontFamily:"inherit",fontSize:12.5,
                fontWeight:500,color:"var(--side-text)",padding:"8px 10px",borderRadius:7,
                cursor:"pointer",textAlign:"left",transition:"background .13s, color .13s",
                marginBottom:1},
  itemActive:  {background:"var(--side-active)",color:"var(--side-strong)",fontWeight:600},
  itemCollapsed:{justifyContent:"center",padding:"9px 0"},
  itemIcon:    {display:"flex",alignItems:"center",justifyContent:"center",width:18,flexShrink:0},
  itemMark:    {position:"absolute",left:0,top:"50%",transform:"translateY(-50%)",width:2.5,
                height:16,borderRadius:2,background:"linear-gradient(180deg, var(--gold), var(--rose))"},

  footer:      {borderTop:"1px solid var(--side-border)",padding:"10px",
                display:"flex",flexDirection:"column",gap:6},
  ociBtn:      {display:"flex",alignItems:"center",gap:9,padding:"8px 10px",
                border:"1px solid var(--side-border)",borderRadius:8,background:"transparent",
                cursor:"pointer",fontFamily:"inherit",transition:"background .15s"},
  ociBtnCollapsed:{justifyContent:"center",padding:"9px 0"},
  ociDot:      {width:7,height:7,borderRadius:"50%",flexShrink:0,transition:"all .2s"},
  ociTitle:    {display:"block",fontSize:11,fontWeight:600,color:"var(--side-strong)",lineHeight:1.3},
  ociSub:      {display:"block",fontSize:9.5,color:"var(--side-muted)"},

  themeBtn:    {display:"flex",alignItems:"center",justifyContent:"center",gap:9,width:"100%",
                background:"transparent",border:"none",borderRadius:7,padding:"8px 10px",
                cursor:"pointer",fontFamily:"inherit",fontSize:11.5,color:"var(--side-text)",
                transition:"background .15s, color .15s"},
  user:        {display:"flex",alignItems:"center",gap:9,marginTop:4,padding:"10px 8px 2px",
                borderTop:"1px solid var(--side-border)"},
  avatar:      {width:30,height:30,borderRadius:"50%",background:"var(--accent-grad)",color:"#fff",
                fontSize:10.5,fontWeight:700,display:"flex",alignItems:"center",
                justifyContent:"center",flexShrink:0,letterSpacing:".02em",border:"none",cursor:"pointer",
                boxShadow:"0 0 0 1px rgba(232,194,122,.35), 0 0 18px -4px rgba(139,18,38,.6)"},
  userName:    {display:"block",fontSize:11.5,fontWeight:600,color:"var(--side-strong)",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.3},
  userRole:    {display:"block",fontSize:9.5,color:"var(--side-muted)",marginTop:1},
  signOut:     {display:"inline-flex",alignItems:"center",justifyContent:"center",
                background:"none",border:"none",color:"var(--side-muted)",cursor:"pointer",
                padding:5,borderRadius:6,transition:"color .15s, background .15s"},
};

const TB = {
  root:        {display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,
                height:58,flexShrink:0,padding:"0 20px",background:"var(--bg2)",
                borderBottom:"1px solid var(--border)",transition:"background .2s"},
  iconBtn:     {display:"inline-flex",alignItems:"center",justifyContent:"center",width:30,height:30,
                background:"transparent",border:"1px solid transparent",borderRadius:7,
                color:"var(--muted)",cursor:"pointer",flexShrink:0,transition:"all .15s"},
  crumbs:      {display:"flex",alignItems:"center",gap:7,minWidth:0,fontSize:12,whiteSpace:"nowrap"},
  crumbMuted:  {color:"var(--muted2)"},
  crumbSep:    {color:"var(--muted3)",fontSize:11},
  crumbActive: {color:"var(--text)",fontWeight:600},
  right:       {display:"flex",alignItems:"center",gap:8},
  clock:       {display:"inline-flex",alignItems:"center",gap:6,fontSize:11.5,color:"var(--muted)",
                fontFamily:"var(--mono)",padding:"5px 9px",borderRadius:7,background:"var(--surface2)",
                whiteSpace:"nowrap"},
  pill:        {display:"inline-flex",alignItems:"center",gap:7,fontSize:11.5,fontWeight:500,
                color:"var(--text3)",background:"transparent",border:"1px solid var(--border2)",
                borderRadius:99,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",
                whiteSpace:"nowrap",transition:"all .15s"},
  pillDot:     {width:6,height:6,borderRadius:"50%",flexShrink:0},
};
