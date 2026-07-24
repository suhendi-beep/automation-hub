import React, { useState, useEffect, useRef } from "react";

export default function CustomerPage({
  customerId, navigate, ociSession,
  running, setRunning, statuses, setStatuses,
  logs, setLogs, activeLog, setActiveLog
}) {
  const [customer, setCustomer] = useState(null);
  const [argsModal, setArgsModal] = useState(null);
  const [ociCredModal, setOciCredModal] = useState(null); // untuk automation yg butuh login inline
  const [files, setFiles] = useState([]);
  const logRef = useRef(null);
  const hasAutoScrolled = useRef(false);

  const fetchFiles = () => {
    fetch("/api/files/" + customerId)
      .then(r => r.json())
      .then(d => setFiles([...(d.reports || []), ...(d.screenshots || [])]))
      .catch(console.error);
  };

  useEffect(() => {
    fetch("/api/customers/" + customerId)
      .then(r => r.json()).then(setCustomer).catch(console.error);
    fetchFiles();
  }, [customerId]);

  // Auto scroll ke bawah hanya sekali saat log pertama kali dibuka
  useEffect(() => {
    hasAutoScrolled.current = false;
  }, [activeLog]);

  useEffect(() => {
    if (logRef.current && !hasAutoScrolled.current && logs[activeLog]) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
      hasAutoScrolled.current = true;
    }
  }, [logs, activeLog]);

  // Refresh files setiap kali halaman dimuat atau activeLog berubah
  useEffect(() => {
    fetchFiles();
  }, [customerId]);

  const handleCopyLog = () => {
    const text = logs[activeLog] || "";
    navigator.clipboard.writeText(text).then(() => {
      alert("Log berhasil dicopy!");
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      alert("Log berhasil dicopy!");
    });
  };

  // Poll status task
  useEffect(() => {
    const entries = Object.entries(running || {});
    if (!entries.length) return;
    const iv = setInterval(async () => {
      for (const [aid, taskId] of entries) {
        try {
          const r = await fetch("/api/status/" + taskId);
          const d = await r.json();
          if (d.status === "SUCCESS" || d.status === "FAILURE") {
            setStatuses(p => ({ ...p, [aid]: d.status }));
            setRunning(p => { const n = { ...p }; delete n[aid]; return n; });
            fetchLogs(aid);
            fetchFiles();
          } else {
            setStatuses(p => ({ ...p, [aid]: d.status }));
          }
        } catch (_) {}
      }
    }, 2500);
    return () => clearInterval(iv);
  }, [running]);

  // Auto refresh log setiap 3 detik jika ada yang running
  useEffect(() => {
    if (!activeLog) return;
    const isRunning = Object.keys(running || {}).includes(activeLog);
    if (!isRunning) return;

    const iv = setInterval(() => {
      fetchLogs(activeLog);
    }, 3000);
    return () => clearInterval(iv);
  }, [activeLog, running]);

  const fetchLogs = async (aid) => {
    try {
      const r = await fetch("/api/logs/" + customerId + "/" + aid);
      const d = await r.json();
      setLogs(p => ({ ...p, [aid]: (d.logs || []).join("") }));
    } catch (_) {}
  };

  const handleRun = async (auto, args, ociCreds) => {
    args = args || {};
    if (auto.requires_oci_login && !ociSession?.logged_in) {
      alert("Automation ini butuh OCI session. Klik tombol OCI di sidebar untuk login dulu.");
      return;
    }
    if (auto.args && auto.args.length > 0 && Object.keys(args).length === 0) {
      setArgsModal(auto);
      return;
    }

    setStatuses(p => ({ ...p, [auto.id]: "QUEUED" }));
    setActiveLog(auto.id);

    try {
      // Kalau butuh credentials inline — tampilkan modal
      if (!ociCreds) {
        const check = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customer: customerId, automation: auto.id, args }),
        });
        const checkData = await check.json();
        if (checkData.need_credentials) {
          setStatuses(p => { const n = {...p}; delete n[auto.id]; return n; });
          setOciCredModal({ auto, args });
          return;
        }
        if (checkData.task_id) {
          setRunning(p => ({ ...p, [auto.id]: checkData.task_id }));
          setTimeout(() => fetchLogs(auto.id), 1000);
        }
        return;
      }

      // Ada credentials — kirim ke endpoint with credentials
      const body = { customer: customerId, automation: auto.id, args, ...ociCreds };
      const r = await fetch("/api/run_with_credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.task_id) {
        setRunning(p => ({ ...p, [auto.id]: d.task_id }));
        // Update ociCredModal dengan taskId untuk OTP polling
        setOciCredModal(prev => prev ? { ...prev, taskId: d.task_id } : null);
        setTimeout(() => fetchLogs(auto.id), 1000);
      }
    } catch (_) {}
  };

  const getFilesForAuto = (autoId) => {
    return files.filter(f => {
      const n = f.name.toLowerCase();
      if (autoId === "grafana_capture")    return n.includes("grafana");
      if (autoId === "oci_ilcs_backup")    return n.includes("ilcs") && !n.includes("status");
      if (autoId === "oci_pelindo_backup") return n.includes("oci_pelindo");
      if (autoId === "daily_ilcs_status")  return n.includes("status") || n.includes("daily");
      return false;
    }).slice(0, 5);
  };

  const getAllFiles = () => files.slice(0, 5);

  if (!customer) return <div className="page"><div className="loading">Memuat...</div></div>;

  return (
    <div className="page page-wide">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate("dashboard")}>← Back</button>
        <div>
          <h1>{customer.name}</h1>
          <p className="page-sub">
            Platform: <strong>{customer.platform}</strong>
            &nbsp;|&nbsp;
            {customer.automations.length} automation
          </p>
        </div>
      </div>

      <div className="customer-layout">
        <div className="automation-list">
          {customer.automations.map(function(auto) {
            const status    = statuses[auto.id];
            const isRunning = !!(running || {})[auto.id];
            const showLog   = activeLog === auto.id;
            const needLogin = auto.requires_oci_login && !ociSession?.logged_in;
            const autoFiles = getFilesForAuto(auto.id);

            return (
              <div key={auto.id} className={"automation-card" + (needLogin ? " locked" : "") + (showLog ? " card-active" : "")}>
                <div className="auto-header">
                  <div className="auto-info">
                    <div className="auto-name">{auto.name}</div>
                    <div className="auto-desc">{auto.description}</div>
                    <div className="auto-meta">
                      <span className="meta-tag">{auto.schedule}</span>
                      <span className="meta-tag">{auto.output_type}</span>
                      <span className="meta-tag mono">{auto.id}</span>
                      {auto.requires_oci_login && (
                        <span className={"meta-tag " + (ociSession?.logged_in ? "tag-ok" : "tag-warn")}>
                          {ociSession?.logged_in ? "🔓 OCI Ready" : "🔒 OCI Required"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="auto-actions">
                    {status && (
                      <span className={"status-badge status-" + status.toLowerCase()}>
                        {isRunning && <span className="spinner" />}
                        {status}
                      </span>
                    )}
                    <button className="btn-run" disabled={isRunning || needLogin}
                      onClick={() => handleRun(auto)}>
                      {isRunning ? "Running…" : "▶ Run"}
                    </button>
                    <button className={"btn-log" + (showLog ? " active" : "")}
                      onClick={() => {
                        setActiveLog(showLog ? null : auto.id);
                        if (!showLog) fetchLogs(auto.id);
                      }}>
                      {showLog ? "✕ Log" : "📄 Log"}
                    </button>
                  </div>
                </div>

                {files.length > 0 && (
                  <div className="file-list">
                    <div className="file-list-title">
                      📁 Output Files
                      <button className="btn-refresh-files" onClick={fetchFiles} title="Refresh files">↻</button>
                    </div>
                    {getFilesForAuto(auto.id).map(function(f, i) {
                      return (
                        <div key={i} className="file-item">
                          <span className="file-icon">
                            {f.name.endsWith(".pptx") ? "📊" : f.name.endsWith(".docx") ? "📝" : "📄"}
                          </span>
                          <span className="file-name" title={f.name}>{f.name}</span>
                          <span className="file-size">{f.size_kb} KB</span>
                          <a className="btn-download"
                            href={"/api/download/reports/" + f.name}
                            download={f.name}>
                            ⬇ Download
                          </a>
                        </div>
                      );
                    })}
                    {getFilesForAuto(auto.id).length === 0 && (
                      <div style={{fontSize:"12px",color:"var(--text3)",padding:"6px 0"}}>Tidak ada file untuk automation ini.</div>
                    )}
                  </div>
                )}
                {files.length === 0 && (
                  <div className="file-list">
                    <div className="file-list-title">
                      📁 Output Files
                      <button className="btn-refresh-files" onClick={fetchFiles} title="Refresh files">↻</button>
                    </div>
                    <div style={{fontSize:"12px",color:"var(--text3)",padding:"6px 0"}}>Klik ↻ untuk refresh.</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="log-sidebar">
          {activeLog ? (
            <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
              <div className="log-topbar">
                <span className="mono">{customerId}_{activeLog}.log</span>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  {(running || {})[activeLog] && (
                    <span style={{fontSize:"11px",color:"var(--blue)",display:"flex",alignItems:"center",gap:4}}>
                      <span className="spinner" /> live
                    </span>
                  )}
                  <button className="btn-refresh" title="Copy log" onClick={handleCopyLog}>⎘</button>
                  <button className="btn-refresh" onClick={() => fetchLogs(activeLog)}>↻</button>
                  <button className="btn-refresh" onClick={() => setActiveLog(null)}>✕</button>
                </div>
              </div>
              <pre className="log-content log-content-full" ref={logRef}>
                {logs[activeLog] || "Menunggu log..."}
              </pre>
            </div>
          ) : (
            <div className="log-empty">
              <div className="log-empty-icon">📄</div>
              <div className="log-empty-text">
                Klik tombol <strong>Log</strong> untuk melihat output di sini
              </div>
            </div>
          )}
        </div>
      </div>

      {argsModal && (
        <ArgsModal
          auto={argsModal}
          onClose={() => setArgsModal(null)}
          onRun={(args) => { setArgsModal(null); handleRun(argsModal, args); }}
        />
      )}
      {ociCredModal && (
        <OciCredModal
          auto={ociCredModal.auto}
          args={ociCredModal.args}
          taskId={ociCredModal.taskId}
          customerId={customerId}
          onClose={() => setOciCredModal(null)}
          onSubmit={(creds) => {
            handleRun(ociCredModal.auto, ociCredModal.args, creds);
          }}
        />
      )}
    </div>
  );
}

function ArgsModal({ auto, onClose, onRun }) {
  const today = new Date().toISOString().split("T")[0];
  const [vals, setVals] = useState(function() {
    const init = {};
    (auto.args || []).forEach(function(a) {
      init[a.key] = a.default || (a.type === "date" ? today : "");
    });
    return init;
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={function(e) { e.stopPropagation(); }}>
        <div className="modal-header">
          <span>⚙️ {auto.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="modal-note">Isi parameter sebelum menjalankan:</p>
          {(auto.args || []).map(function(arg) {
            return (
              <div key={arg.key}>
                <label className="form-label">{arg.label}</label>
                <input className="form-input" type={arg.type || "text"}
                  value={vals[arg.key] || ""}
                  onChange={function(e) {
                    const val = e.target.value;
                    setVals(function(p) { return { ...p, [arg.key]: val }; });
                  }} />
              </div>
            );
          })}
          <button className="btn-primary" style={{marginTop:16}}
            onClick={() => onRun(vals)}>
            ▶ Jalankan
          </button>
        </div>
      </div>
    </div>
  );
}

const OCI_HISTORY_KEY = "oci_cred_history";
const MAX_HISTORY     = 5;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(OCI_HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(tenancy, username) {
  const prev = loadHistory().filter(h => !(h.tenancy === tenancy && h.username === username));
  const next = [{ tenancy, username }, ...prev].slice(0, MAX_HISTORY);
  localStorage.setItem(OCI_HISTORY_KEY, JSON.stringify(next));
}

function OciCredModal({ auto, args, taskId: initialTaskId, customerId, onClose, onSubmit }) {
  const history = loadHistory();

  const [tenancy,     setTenancy]     = useState(history[0]?.tenancy  || "");
  const [username,    setUsername]    = useState(history[0]?.username || "");
  const [password,    setPassword]    = useState("");
  const [showPwd,     setShowPwd]     = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [otp,         setOtp]         = useState("");
  const [taskId,      setTaskId]      = useState(initialTaskId || null);
  const [step,        setStep]        = useState("credentials");
  const [msg,         setMsg]         = useState("");

  // Update taskId kalau props berubah
  React.useEffect(() => {
    if (initialTaskId && !taskId) setTaskId(initialTaskId);
  }, [initialTaskId]);

  // Poll login state
  React.useEffect(() => {
    if (!taskId || step === "done" || step === "error" || step === "credentials") return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch("/api/oci/login_state/" + taskId);
        const d = await r.json();
        if (d.state === "otp_required" && step !== "otp") {
          setStep("otp");
          setMsg("OTP dikirim ke email. Masukkan kode OTP:");
        } else if (d.state === "running") {
          setStep("running");
          setMsg("Login berhasil, sedang proses capture...");
        } else if (d.state === "success") {
          clearInterval(iv);
          setStep("done");
          setMsg("Selesai! File sedang dibuat...");
          setTimeout(onClose, 2000);
        } else if (d.state === "error") {
          clearInterval(iv);
          setStep("error");
          setMsg("Error: " + (d.msg || "Unknown").substring(0, 200));
        }
      } catch (_) {}
    }, 2000);
    return () => clearInterval(iv);
  }, [taskId, step]);

  const handleSubmit = () => {
    if (!username || !password) return;
    saveHistory(tenancy, username);
    setStep("running");
    setMsg("Sedang mengirim OTP ke Email...");
    onSubmit({ tenancy, username, password });
  };

  const handleOtp = async () => {
    if (!otp || !taskId) return;
    setStep("running");
    setMsg("Mengirim OTP...");
    await fetch("/api/oci/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, otp }),
    });
    setMsg("OTP dikirim, menunggu verifikasi...");
  };

  const selectHistory = (h) => {
    setTenancy(h.tenancy);
    setUsername(h.username);
    setShowHistory(false);
  };

  return (
    <div className="modal-overlay" onClick={step === "credentials" ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>🔐 Login OCI — {auto.name}</span>
          {step === "credentials" && <button className="modal-close" onClick={onClose}>✕</button>}
        </div>
        <div className="modal-body">
          {step === "credentials" && (
            <>
              <p className="modal-note">Masukkan kredensial OCI untuk menjalankan automation ini.</p>

              {/* Tenancy dengan history */}
              <label className="form-label">Tenancy Name</label>
              <div style={{position:"relative"}}>
                <input className="form-input" value={tenancy}
                  onChange={e => setTenancy(e.target.value)}
                  placeholder="nama-tenancy"
                  style={{paddingRight: history.length ? 36 : undefined}} />
                {history.length > 0 && (
                  <button
                    onClick={() => setShowHistory(v => !v)}
                    style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",
                      background:"none",border:"none",cursor:"pointer",fontSize:14,
                      color:"var(--text3)",padding:"2px 4px"}}
                    title="Riwayat">▾</button>
                )}
                {showHistory && history.length > 0 && (
                  <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:100,
                    background:"var(--bg2,#1e1e2e)",border:"1px solid var(--border,#333)",
                    borderRadius:6,boxShadow:"0 4px 16px rgba(0,0,0,0.4)",overflow:"hidden"}}>
                    {history.map((h, i) => (
                      <div key={i}
                        onClick={() => selectHistory(h)}
                        style={{padding:"8px 12px",cursor:"pointer",fontSize:13,
                          borderBottom: i < history.length-1 ? "1px solid var(--border,#333)" : "none",
                          display:"flex",flexDirection:"column",gap:2}}
                        onMouseEnter={e => e.currentTarget.style.background="var(--hover,#2a2a3e)"}
                        onMouseLeave={e => e.currentTarget.style.background=""}>
                        <span style={{color:"var(--text1,#fff)",fontWeight:500}}>{h.tenancy || <em style={{color:"var(--text3)"}}>—</em>}</span>
                        <span style={{color:"var(--text3,#888)",fontSize:11}}>{h.username}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Username */}
              <label className="form-label" style={{marginTop:10}}>Username / Email</label>
              <input className="form-input" value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="user@email.com" />

              {/* Password dengan toggle show/hide */}
              <label className="form-label" style={{marginTop:10}}>Password</label>
              <div style={{position:"relative"}}>
                <input className="form-input" type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Password"
                  style={{paddingRight:40}} />
                <button
                  onClick={() => setShowPwd(v => !v)}
                  style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",
                    background:"none",border:"none",cursor:"pointer",fontSize:16,
                    color:"var(--text3)",padding:"2px 4px",lineHeight:1}}
                  title={showPwd ? "Sembunyikan password" : "Lihat password"}>
                  {showPwd ? "🙈" : "👁"}
                </button>
              </div>

              <button className="btn-primary" style={{marginTop:16}}
                onClick={handleSubmit}
                disabled={!username || !password}>
                ▶ Login & Jalankan
              </button>
            </>
          )}
          {step === "otp" && (
            <>
              <p className="modal-note">{msg}</p>
              <label className="form-label">Kode OTP (dari email)</label>
              <input className="form-input" type="text" value={otp}
                onChange={e => setOtp(e.target.value)}
                placeholder="6 digit OTP" autoFocus />
              <button className="btn-primary" style={{marginTop:16}}
                onClick={handleOtp}
                disabled={!otp}>
                Submit OTP
              </button>
            </>
          )}
          {step === "running" && (
            <div style={{textAlign:"center", padding:"20px 0"}}>
              <div className="spinner" style={{width:24,height:24,margin:"0 auto 12px"}} />
              <p className="modal-note">{msg || "Sedang proses..."}</p>
            </div>
          )}
          {step === "done" && (
            <div className="oci-status-ok" style={{textAlign:"center",padding:"20px 0"}}>✅ {msg}</div>
          )}
          {step === "error" && (
            <div style={{color:"var(--red)",padding:"10px 0",fontSize:"12px"}}>{msg}
              <br/><button className="btn-refresh" style={{marginTop:8}} onClick={onClose}>Tutup</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}