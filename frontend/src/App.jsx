import React, { useState, useEffect } from "react";
import Dashboard    from "./pages/Dashboard.jsx";
import GenerateReport from "./pages/GenerateReport.jsx";
import DailyTask    from "./pages/DailyTask.jsx";
import CustomerPage from "./pages/CustomerPage.jsx";
import FilesPage    from "./pages/FilesPage.jsx";
import LoginPage    from "./pages/LoginPage.jsx";
import AlertPage    from "./pages/AlertPage.jsx";
import EngineerActivity from "./pages/EngineerActivity.jsx";
import CustomersPage from "./pages/CustomersPage.jsx";
import AccountsPage from "./pages/AccountsPage.jsx";
import GrafanaPage from "./pages/GrafanaPage.jsx";
import CredentialsPage from "./pages/CredentialsPage.jsx";
import SchedulesPage from "./pages/SchedulesPage.jsx";
import ActivityLogsPage from "./pages/ActivityLogsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ReminderNotif from "./components/ReminderNotif.jsx";
import AlertWatcher  from "./components/AlertWatcher.jsx";
import OciModal from "./components/OciModal.jsx";
import Icon from "./components/Icon.jsx";
import { clearSession } from "./api.js";
import "./styles.css";

// Auto-logout after this many ms of no user activity (mouse/keyboard/click/scroll).
const IDLE_LOGOUT_MS = 3 * 60 * 60 * 1000; // 3 hours

const PAGE_META = {
  dashboard:           { group: "Monitoring",     label: "Dashboard" },
  "alert-monitor":     { group: "Monitoring",     label: "Grafana Alerts" },
  "daily-task":        { group: "Workflow",       label: "Tickets" },
  "generate-report":   { group: "Workflow",       label: "Weekly Reports" },
  files:               { group: "Workflow",       label: "Report History" },
  customer:            { group: "Workflow",       label: "Automation Jobs" },
  "engineer-activity": { group: "Insights",       label: "Engineer Activity" },
  "logs-page":         { group: "Insights",       label: "Activity Logs" },
  schedules:           { group: "Platform",       label: "Schedules" },
  grafana:             { group: "Platform",       label: "Grafana Dashboards" },
  customers:           { group: "Administration", label: "Customers" },
  accounts:            { group: "Administration", label: "Accounts" },
  credentials:         { group: "Administration", label: "Credentials" },
  settings:            { group: "Administration", label: "Settings" },
};

const NAV_GROUPS = [
  { section: "Monitoring", items: [
    { key: "dashboard",       icon: "dashboard", label: "Dashboard" },
    { key: "alert-monitor",   icon: "alert",     label: "Grafana Alerts" },
  ]},
  { section: "Workflow", items: [
    { key: "daily-task",      icon: "ticket",    label: "Tickets" },
    { key: "generate-report", icon: "report",    label: "Weekly Reports" },
    { key: "files",           icon: "history",   label: "Report History" },
  ]},
  { section: "Insights", items: [
    { key: "engineer-activity", icon: "activity", label: "Engineer Activity" },
    { key: "logs-page",         icon: "logs",     label: "Activity Logs" },
  ]},
  { section: "Platform", items: [
    { key: "schedules", icon: "schedule", label: "Schedules" },
    { key: "grafana",   icon: "grafana",  label: "Dashboards" },
  ]},
  { section: "Administration", items: [
    { key: "customers",   icon: "users",    label: "Customers" },
    { key: "accounts",    icon: "accounts", label: "Accounts" },
    { key: "credentials", icon: "key",      label: "Credentials" },
    { key: "settings",    icon: "settings", label: "Settings" },
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
  const [page,     setPage]     = useState(() => sessionStorage.getItem("pr_page") || "dashboard");
  const [custId,   setCustId]   = useState(() => sessionStorage.getItem("pr_custid") || null);
  const [customers,setCustomers]= useState([]);
  const [ociSess,  setOciSess]  = useState(null);
  const [running,  setRunning]  = useState({});
  const [statuses, setStatuses] = useState({});
  const [logs,     setLogs]     = useState({});
  const [activeLog,setActiveLog]= useState(null);
  const [authed,   setAuthed]   = useState(() => !!(sessionStorage.getItem("pr_auth") && sessionStorage.getItem("pr_token")));
  const [fullCust, setFullCust] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    try {
      // One-time reset: every page shares one theme, defaulting to light.
      if (localStorage.getItem("pr_theme_v") !== "v2") {
        localStorage.setItem("pr_theme", "light");
        localStorage.setItem("pr_theme_v", "v2");
      }
      return localStorage.getItem("pr_theme") === "dark";
    } catch { return false; }
  });
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

  // ── Idle auto-logout: no user activity for IDLE_LOGOUT_MS → sign out. ──
  React.useEffect(() => {
    if (!authed) return;

    let idleTimer = null;

    const doLogout = () => {
      const u = sessionStorage.getItem("pr_user");
      const d = sessionStorage.getItem("pr_display");
      if (u) {
        fetch("/api/activity", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: u, display: d || u, action: "Logout", category: "auth", detail: "Auto-logout after 3h idle" }),
        }).catch(() => {});
      }
      clearSession();
    };

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(doLogout, IDLE_LOGOUT_MS);
    };

    const activityEvents = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    activityEvents.forEach(ev => window.addEventListener(ev, resetIdleTimer, { passive: true }));
    resetIdleTimer();

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      activityEvents.forEach(ev => window.removeEventListener(ev, resetIdleTimer));
    };
  }, [authed]);

  // Apply theme class to <body> whenever darkMode changes
  useEffect(() => {
    document.body.classList.toggle("light", !darkMode);
  }, [darkMode]);

  const toggleDark = () => {
    const next = !darkMode;
    setDarkMode(next);
    try { localStorage.setItem("pr_theme", next ? "dark" : "light"); } catch {}
  };

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

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const meta = PAGE_META[page] || PAGE_META.dashboard;

  return (
    <div style={{display:"flex",height:"100vh",overflow:"hidden",
      background:"var(--bg)",fontFamily:"var(--font)"}}>
      <Sidebar
        customers={customers} page={page} navigate={navigate}
        custId={custId} ociSess={ociSess} onOciChange={refreshOci}
        currentUser={currentUser} displayName={displayName}
        currentRole={currentRole} darkMode={darkMode} toggleDark={toggleDark}
        collapsed={collapsed}
      />
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
      <Topbar
        meta={meta} ociSess={ociSess} navigate={navigate}
        darkMode={darkMode} toggleDark={toggleDark}
        collapsed={collapsed} onToggleCollapsed={toggleCollapsed}
      />
      <main style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",minWidth:0}}>
        {page==="dashboard"       && <Dashboard customers={customers} navigate={navigate} currentUser={currentUser} darkMode={darkMode} toggleDark={toggleDark}/>}
        {page==="generate-report" && <GenerateReport customers={customers} navigate={navigate} darkMode={darkMode}/>}
        {page==="daily-task"      && <DailyTask customers={customers} navigate={navigate} darkMode={darkMode}/>}
        {page==="alert-monitor"   && <AlertPage darkMode={darkMode}/>}
        {page==="engineer-activity" && <EngineerActivity navigate={navigate}/>}
        {page==="customer"  && custId && <CustomerPage customerId={custId} navigate={navigate} ociSession={ociSess} running={running} setRunning={setRunning} statuses={statuses} setStatuses={setStatuses} logs={logs} setLogs={setLogs} activeLog={activeLog} setActiveLog={setActiveLog} darkMode={darkMode}/>}
        {page==="files"     && custId && <FilesPage customer={fullCust} navigate={navigate} darkMode={darkMode}/>}
        {page==="customers" && <CustomersPage navigate={navigate}/>}
        {page==="accounts"  && <AccountsPage currentRole={currentRole}/>}
        {page==="grafana"   && <GrafanaPage/>}
        {page==="credentials" && <CredentialsPage currentRole={currentRole} currentUser={currentUser} ociSession={ociSess} onOciChange={refreshOci}/>}
        {page==="schedules" && <SchedulesPage currentRole={currentRole}/>}
        {page==="logs-page" && <ActivityLogsPage/>}
        {page==="settings"  && <SettingsPage darkMode={darkMode} toggleDark={toggleDark} currentUser={currentUser} currentRole={currentRole} displayName={displayName}/>}
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
  currentUser, displayName, currentRole, darkMode, toggleDark, collapsed }) {
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
            {collapsed && <div style={SB.rule}/>}
            {g.items.map((it) => (
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

        <button className="sb-foot-btn" style={SB.themeBtn} onClick={toggleDark}
          title={darkMode ? "Switch to light theme" : "Switch to dark theme"}>
          <Icon name={darkMode ? "sun" : "moon"} size={15}/>
          {!collapsed && (
            <span style={{flex:1,textAlign:"left"}}>{darkMode ? "Light theme" : "Dark theme"}</span>
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

function Topbar({ meta, ociSess, navigate,
  darkMode, toggleDark, collapsed, onToggleCollapsed }) {
  const [clock, setClock] = useState(fmtClock);

  useEffect(() => {
    const id = setInterval(() => setClock(fmtClock()), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <header style={TB.root}>
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
        <button className="tb-icon" style={TB.iconBtn} onClick={toggleDark}
          title={darkMode ? "Switch to light theme" : "Switch to dark theme"}>
          <Icon name={darkMode ? "sun" : "moon"} size={15}/>
        </button>
      </div>
    </header>
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
  logoMark:    {width:34,height:34,borderRadius:9,display:"block",flexShrink:0},
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
                height:16,borderRadius:2,background:"var(--accent)"},

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
  avatar:      {width:30,height:30,borderRadius:"50%",background:"var(--accent)",color:"#fff",
                fontSize:10.5,fontWeight:700,display:"flex",alignItems:"center",
                justifyContent:"center",flexShrink:0,letterSpacing:".02em",border:"none",cursor:"pointer"},
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
