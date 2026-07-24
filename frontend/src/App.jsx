import React, { useState, useEffect } from "react";
import Dashboard from "./pages/Dashboard.jsx";
import CustomerPage from "./pages/CustomerPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import "./styles.css";

export default function App() {
  const [page, setPage]             = useState("dashboard");
  const [customerId, setCustomerId] = useState(null);
  const [customers, setCustomers]   = useState([]);
  const [ociSession, setOciSession] = useState(null);
  const [running, setRunning]       = useState({});
  const [statuses, setStatuses]     = useState({});
  const [logs, setLogs]             = useState({});
  const [activeLog, setActiveLog]   = useState(null);
  const [authed, setAuthed]         = useState(!!sessionStorage.getItem("pr_auth"));

  useEffect(() => {
    if (!authed) return;
    fetch("/api/customers").then(r => r.json()).then(setCustomers).catch(console.error);
    checkOciSession();
  }, [authed]);

  const checkOciSession = () => {
    fetch("/api/oci/session").then(r => r.json()).then(setOciSession).catch(console.error);
  };

  const navigate = (p, id) => {
    setPage(p);
    setCustomerId(id || null);
  };

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  return (
    <div className="app">
      <Sidebar
        customers={customers}
        page={page}
        navigate={navigate}
        ociSession={ociSession}
        onOciChange={checkOciSession}
        running={running}
      />
      <main className="main">
        {page === "dashboard" && (
          <Dashboard customers={customers} navigate={navigate} />
        )}
        {page === "customer" && customerId && (
          <CustomerPage
            customerId={customerId}
            navigate={navigate}
            ociSession={ociSession}
            running={running}
            setRunning={setRunning}
            statuses={statuses}
            setStatuses={setStatuses}
            logs={logs}
            setLogs={setLogs}
            activeLog={activeLog}
            setActiveLog={setActiveLog}
          />
        )}
      </main>
    </div>
  );
}

function Sidebar({ customers, page, navigate, ociSession, onOciChange, running }) {
  const [showOciModal, setShowOciModal] = useState(false);
  const totalRunning = Object.keys(running || {}).length;

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src="/logo.svg" alt="ICS Compute" className="logo-img" />
        <div className="logo-text">Portal<br /><strong>Report</strong></div>
      </div>

      <nav className="sidebar-nav">
        <button className={"nav-item " + (page === "dashboard" ? "active" : "")}
          onClick={() => navigate("dashboard")}>
          <span className="nav-icon">◈</span> Dashboard
        </button>
        <div className="nav-section">CUSTOMERS</div>
        {customers.map(function(c) {
          return (
            <button key={c.id}
              className={"nav-item " + (page === "customer" ? "active" : "")}
              onClick={() => navigate("customer", c.id)}>
              <span className="nav-icon">
                {c.platform === "OCI" ? "🔶" : c.platform === "AWS" ? "🟠" : "🔷"}
              </span>
              {c.name}
              <span className={"nav-badge " + c.status}>{c.status}</span>
            </button>
          );
        })}
      </nav>

      {totalRunning > 0 && (
        <div className="running-bar">
          <span className="spinner" /> {totalRunning} automation berjalan...
        </div>
      )}

      <div className="oci-bar" onClick={() => setShowOciModal(true)}>
        <span className={"oci-dot " + (ociSession?.logged_in ? "on" : "off")}></span>
        <span className="oci-label">
          {ociSession?.logged_in ? "OCI Session Aktif" : "OCI Belum Login"}
        </span>
        <span className="oci-action">
          {ociSession?.logged_in ? "Logout" : "Login →"}
        </span>
      </div>

      <div className="sidebar-footer">
        <span className="footer-dot"></span> System Online
        <button style={{marginLeft:"auto",background:"none",border:"none",color:"var(--text3)",
          fontSize:11,cursor:"pointer"}}
          onClick={() => { sessionStorage.removeItem("pr_auth"); window.location.reload(); }}>
          Logout
        </button>
      </div>

      {showOciModal && (
        <OciModal
          loggedIn={ociSession?.logged_in}
          savedAt={ociSession?.saved_at}
          onClose={() => setShowOciModal(false)}
          onDone={() => { setShowOciModal(false); onOciChange(); }}
        />
      )}
    </aside>
  );
}

function OciModal({ loggedIn, savedAt, onClose, onDone }) {
  const [cookieJson, setCookieJson] = useState("");
  const [status,     setStatus]     = useState("idle");
  const [msg,        setMsg]         = useState("");

  const handleSave = async () => {
    if (!cookieJson.trim()) return;
    setStatus("loading");
    setMsg("Menyimpan cookies...");
    try {
      const r = await fetch("/api/oci/save_cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: cookieJson }),
      });
      const d = await r.json();
      if (d.status === "ok") {
        setStatus("done");
        setMsg(`✅ ${d.count} cookies tersimpan!`);
        setTimeout(onDone, 1500);
      } else {
        setStatus("error");
        setMsg("Gagal: " + (d.error || "Unknown error"));
      }
    } catch (e) {
      setStatus("error");
      setMsg("Error: " + e.message);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/oci/logout", { method: "POST" });
    onDone();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{width: 520, maxWidth: "95vw"}} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>🔶 OCI Session</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {loggedIn ? (
          <div className="modal-body">
            <div className="oci-status-ok">✅ Session aktif</div>
            {savedAt && <div className="oci-saved">Disimpan: {new Date(savedAt).toLocaleString("id-ID")}</div>}
            <p className="modal-note">Cookies OCI tersimpan dan siap digunakan.</p>
            <button className="btn-danger" onClick={handleLogout}>Logout OCI</button>
          </div>
        ) : (
          <div className="modal-body">
            <p className="modal-note" style={{fontWeight:600,marginBottom:4}}>Cara mendapatkan cookies OCI:</p>
            <ol style={{fontSize:12,color:"var(--text2)",paddingLeft:16,lineHeight:2}}>
              <li>Install ekstensi <strong>EditThisCookie</strong> di Chrome</li>
              <li>Buka <a href="https://cloud.oracle.com" target="_blank" rel="noreferrer" style={{color:"var(--blue)"}}>cloud.oracle.com</a> dan login OCI</li>
              <li>Klik ikon EditThisCookie → klik tombol <strong>Export</strong> (ikon panah keluar)</li>
              <li>Paste hasil export di bawah ini</li>
            </ol>
            <label className="form-label" style={{marginTop:8}}>Paste Cookies JSON</label>
            <textarea
              className="form-input"
              style={{height:120, resize:"vertical", fontFamily:"var(--mono)", fontSize:11}}
              value={cookieJson}
              onChange={e => setCookieJson(e.target.value)}
              placeholder='[{"name":"...","value":"...","domain":"..."}]'
              disabled={status === "loading"}
            />
            {msg && <div className={"form-msg " + status}>{msg}</div>}
            <button className="btn-primary" style={{marginTop:8}}
              onClick={handleSave}
              disabled={status === "loading" || !cookieJson.trim()}>
              {status === "loading" ? "Menyimpan..." : "💾 Simpan Cookies"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
