import React, { useState, useEffect, useRef } from "react";
import { localISODate } from "../api.js";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import OciCredModal from "../components/OciCredModal.jsx";

export default function CustomerPage({
  customerId, navigate, ociSession,
  running, setRunning, statuses, setStatuses,
  logs, setLogs, activeLog, setActiveLog
}) {
  const [customer,     setCustomer]     = useState(null);
  const [argsModal,    setArgsModal]    = useState(null);
  const [credModal,    setCredModal]    = useState(null);
  const [history,      setHistory]      = useState([]);
  const logRef = useRef(null);
  const scrolled = useRef(false);

  const fetchHistory = () =>
    fetch("/api/history").then(r=>r.json()).then(setHistory).catch(()=>{});

  useEffect(() => {
    fetch("/api/customers/"+customerId).then(r=>r.json()).then(setCustomer).catch(()=>{});
    fetchHistory();
  }, [customerId]);

  useEffect(() => { scrolled.current = false; }, [activeLog]);
  useEffect(() => {
    if (logRef.current && !scrolled.current && logs[activeLog]) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
      scrolled.current = true;
    }
  }, [logs, activeLog]);

  // poll task status
  useEffect(() => {
    const entries = Object.entries(running||{});
    if (!entries.length) return;
    const iv = setInterval(async () => {
      for (const [aid, tid] of entries) {
        try {
          const d = await fetch("/api/status/"+tid).then(r=>r.json());
          if (d.status==="SUCCESS"||d.status==="FAILURE") {
            setStatuses(p=>({...p,[aid]:d.status}));
            setRunning(p=>{ const n={...p}; delete n[aid]; return n; });
            fetchLogs(aid); fetchHistory();
          } else { setStatuses(p=>({...p,[aid]:d.status})); }
        } catch(_) {}
      }
    }, 2500);
    return () => clearInterval(iv);
  }, [running]);

  // live log refresh
  useEffect(() => {
    if (!activeLog || !Object.keys(running||{}).includes(activeLog)) return;
    const iv = setInterval(() => fetchLogs(activeLog), 3000);
    return () => clearInterval(iv);
  }, [activeLog, running]);

  const fetchLogs = async (aid) => {
    try {
      const d = await fetch(`/api/logs/${customerId}/${aid}`).then(r=>r.json());
      setLogs(p=>({...p,[aid]:(d.logs||[]).join("")}));
    } catch(_) {}
  };

  const copyLog = () => {
    const t = logs[activeLog]||"";
    navigator.clipboard.writeText(t).catch(()=>{
      const ta = document.createElement("textarea"); ta.value=t;
      document.body.appendChild(ta); ta.select(); document.execCommand("copy");
      document.body.removeChild(ta);
    });
  };

  const handleRun = async (auto, args, creds) => {
    args = args||{};
    if (auto.requires_oci_login && !auto.requires_oci_credentials && !ociSession?.logged_in) {
      alert("This automation requires OCI login. Use the sidebar OCI button first.");
      return;
    }
    if (auto.args?.length && !Object.keys(args).length) { setArgsModal(auto); return; }
    // OCI Backup jobs support inline login: ask for credentials when there is
    // no active cookie session yet.
    if (auto.requires_oci_credentials && !creds && !ociSession?.logged_in) {
      setCredModal({ auto, args });
      return;
    }
    setStatuses(p=>({...p,[auto.id]:"QUEUED"}));
    setActiveLog(auto.id);
    try {
      if (!creds) {
        const d = await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({customer:customerId,automation:auto.id,args})}).then(r=>r.json());
        if (d.need_credentials) {
          setStatuses(p=>{const n={...p};delete n[auto.id];return n;});
          setCredModal({auto,args}); return;
        }
        if (d.task_id) { setRunning(p=>({...p,[auto.id]:d.task_id})); setTimeout(()=>fetchLogs(auto.id),1000); }
        return;
      }
      const d = await fetch("/api/run_with_credentials",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({customer:customerId,automation:auto.id,args,...creds})}).then(r=>r.json());
      if (d.task_id) {
        setRunning(p=>({...p,[auto.id]:d.task_id}));
        setCredModal(prev=>prev?{...prev,taskId:d.task_id}:null);
        setTimeout(()=>fetchLogs(auto.id),1000);
      }
    } catch(_) {}
  };

  if (!customer) return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--muted3)",fontFamily:"var(--font)"}}>
      <span className="spinner" style={{width:20,height:20,borderColor:"var(--muted3)",borderTopColor:"transparent",marginRight:10}}/> Loading…
    </div>
  );

  // Jobs with hidden:true are surfaced elsewhere (e.g. Daily Report), not here.
  const visibleAutos = customer.automations.filter(a => !a.hidden);

  return (
    <div style={C.root}>

      {/* ── TOPBAR ── */}
      <PageHeader
        icon="layers"
        title={customer.name}
        subtitle={`${customer.platform} · ${visibleAutos.length} automations${history.length>0 ? " · Last run: "+new Date(history[0].last_run).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : ""}`}
        actions={
          <>
            <button style={C.backBtn} onClick={()=>navigate("dashboard")}>
              <Icon name="arrowLeft" size={13}/> Dashboard
            </button>
            <button style={C.iconBtn} onClick={()=>fetchHistory()} title="Refresh history">
              <Icon name="refresh" size={12}/> Refresh
            </button>
          </>
        }
      />

      {/* ── BODY ── */}
      <div style={C.body}>

        {/* LEFT: automation list */}
        <div style={C.left}>
          <div style={C.secHead}>
            <span style={C.secLabel}>Automation Jobs</span>
            <span style={{fontSize:11,color:"var(--muted)"}}>{visibleAutos.length} jobs</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10,overflowY:"auto",flex:1,paddingRight:2}}>
            {visibleAutos.map(auto => {
              const st     = statuses[auto.id];
              const isRun  = !!(running||{})[auto.id];
              const showLog= activeLog === auto.id;
              const noAuth = auto.requires_oci_login && !auto.requires_oci_credentials && !ociSession?.logged_in;
              const ICON   = {pptx:"archive",docx:"file",report:"report"}[auto.output_type]||"file";
              const ST_STYLE = {
                QUEUED:  {bg:"var(--amber-dim)", c:"var(--amber)"},
                STARTED: {bg:"var(--blue-dim)",  c:"var(--blue)"},
                PENDING: {bg:"var(--blue-dim)",  c:"var(--blue)"},
                SUCCESS: {bg:"var(--green-dim)", c:"var(--green)"},
                FAILURE: {bg:"var(--red-dim)",   c:"var(--red)"},
                ERROR:   {bg:"var(--red-dim)",   c:"var(--red)"},
              };
              const ss = ST_STYLE[st] || {};

              return (
                <div key={auto.id} style={{
                  ...C.jobCard,
                  ...(showLog ? {borderColor:"var(--border3)"} : {}),
                  ...(noAuth  ? {opacity:.55} : {}),
                }}>
                  {/* header row */}
                  <div style={C.jobHeader}>
                    <div style={C.jobMark}><Icon name={ICON} size={15}/></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:"var(--text)",marginBottom:3,lineHeight:1.3}}>{auto.name}</div>
                      <div style={{fontSize:11,color:"var(--muted)",marginBottom:7,lineHeight:1.5}}>{auto.description}</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        <Tag>{auto.schedule}</Tag>
                        <Tag>{auto.output_type}</Tag>
                        <Tag mono>{auto.id}</Tag>
                        {auto.requires_oci_credentials && (
                          <Tag color="amber"><Icon name="key" size={10}/> OCI credentials</Tag>
                        )}
                        {auto.requires_oci_login && (
                          <Tag color={ociSession?.logged_in?"green":"amber"}>
                            <Icon name={ociSession?.logged_in?"unlock":"lock"} size={10}/>
                            {ociSession?.logged_in ? "OCI ready" : "OCI required"}
                          </Tag>
                        )}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:7,flexShrink:0,marginLeft:8}}>
                      {st && (
                        <span style={{fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:99,
                          textTransform:"uppercase",letterSpacing:".04em",
                          background:ss.bg||"var(--surface2)",color:ss.c||"var(--muted)",
                          display:"flex",alignItems:"center",gap:5}}>
                          {isRun && <span className="spinner" style={{width:8,height:8,borderWidth:1.5,borderColor:ss.c,borderTopColor:"transparent"}}/>}
                          {st}
                        </span>
                      )}
                      <button style={{
                        ...C.runBtn,
                        ...(isRun||noAuth ? {opacity:.4,cursor:"not-allowed"} : {}),
                      }} disabled={isRun||noAuth} onClick={()=>handleRun(auto)}>
                        {isRun
                          ? <><span className="spinner" style={{width:8,height:8,borderWidth:1.5,borderColor:"#fff",borderTopColor:"transparent"}}/> Running</>
                          : <><Icon name="play" size={11}/> Run</>}
                      </button>
                      <button style={{...C.logBtn,...(showLog?C.logBtnOn:{})}}
                        onClick={()=>{ setActiveLog(showLog?null:auto.id); if(!showLog) fetchLogs(auto.id); }}>
                        {showLog ? <Icon name="close" size={11}/> : <><Icon name="terminal" size={11}/> Log</>}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: log viewer */}
        <div style={C.right}>
          <div style={C.secHead}>
            <span style={C.secLabel}>
              {activeLog
                ? <span style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--text4)",textTransform:"none",letterSpacing:0}}>{customerId}_{activeLog}.log</span>
                : "Log viewer"
              }
            </span>
            {activeLog && (
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {(running||{})[activeLog] && (
                  <span style={{fontSize:10,color:"var(--blue)",display:"flex",alignItems:"center",gap:4}}>
                    <span className="spinner" style={{width:8,height:8,borderWidth:1.5,borderColor:"var(--blue)",borderTopColor:"transparent"}}/> live
                  </span>
                )}
                <button style={C.tinyBtn} onClick={copyLog} title="Copy log"><Icon name="copy" size={11}/></button>
                <button style={C.tinyBtn} onClick={()=>fetchLogs(activeLog)} title="Refresh log"><Icon name="refresh" size={11}/></button>
                <button style={C.tinyBtn} onClick={()=>setActiveLog(null)} title="Close log"><Icon name="close" size={11}/></button>
              </div>
            )}
          </div>
          {activeLog ? (
            <pre style={C.logPre} ref={logRef}>
              {logs[activeLog] || "Waiting for logs…"}
            </pre>
          ) : (
            <div style={C.logEmpty}>
              <div style={{color:"var(--border3)",marginBottom:14}}><Icon name="terminal" size={30}/></div>
              <div style={{fontSize:12,color:"var(--muted3)",lineHeight:1.7}}>
                Select <strong style={{color:"var(--muted)"}}>Log</strong> on any automation<br/>to view its output here.
              </div>
            </div>
          )}
        </div>
      </div>

      {argsModal && (
        <ArgsModal auto={argsModal}
          onClose={()=>setArgsModal(null)}
          onRun={args=>{ setArgsModal(null); handleRun(argsModal,args); }}/>
      )}
      {credModal && (
        <OciCredModal
          auto={credModal.auto} args={credModal.args}
          taskId={credModal.taskId} customerId={customerId}
          onClose={()=>setCredModal(null)}
          onSubmit={creds=>handleRun(credModal.auto,credModal.args,creds)}/>
      )}
    </div>
  );
}

function Tag({ children, color, mono }) {
  const p = {
    green: {bg:"var(--green-dim)",c:"var(--green)",b:"transparent"},
    amber: {bg:"var(--amber-dim)",c:"var(--amber)",b:"transparent"},
    red:   {bg:"var(--red-dim)",  c:"var(--red)",  b:"transparent"},
  }[color] || {bg:"var(--surface2)",c:"var(--muted)",b:"var(--border)"};
  return (
    <span style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:p.bg,color:p.c,
      border:`1px solid ${p.b}`,fontFamily:mono?"var(--mono)":"inherit",fontWeight:600,
      display:"inline-flex",alignItems:"center",gap:4}}>
      {children}
    </span>
  );
}

const C = {
  root:    {height:"100%",display:"flex",flexDirection:"column",background:"var(--bg)",fontFamily:"var(--font)",overflow:"hidden"},
  topbar:  {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 24px",borderBottom:"1px solid var(--border)",flexShrink:0,background:"var(--bg2)"},
  backBtn: {display:"inline-flex",alignItems:"center",gap:6,background:"var(--bg2)",border:"1px solid var(--border2)",color:"var(--text4)",fontFamily:"var(--font)",fontSize:12,padding:"6px 13px",borderRadius:7,cursor:"pointer",transition:"all .15s"},
  iconBtn: {display:"inline-flex",alignItems:"center",gap:6,background:"var(--bg2)",border:"1px solid var(--border2)",color:"var(--text4)",fontFamily:"var(--font)",fontSize:11,padding:"6px 11px",borderRadius:7,cursor:"pointer"},
  divider: {width:1,height:24,background:"var(--border)"},
  body:    {flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",overflow:"hidden",minHeight:0},
  left:    {display:"flex",flexDirection:"column",padding:"18px 14px 20px 28px",overflow:"hidden",borderRight:"1px solid var(--border)"},
  right:   {display:"flex",flexDirection:"column",padding:"18px 28px 20px 14px",overflow:"hidden",background:"var(--bg3)"},
  secHead: {display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexShrink:0},
  secLabel:{fontSize:11,fontWeight:650,textTransform:"uppercase",letterSpacing:".09em",color:"var(--muted3)"},

  jobCard: {background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",transition:"border-color .18s",flexShrink:0},
  jobHeader:{display:"flex",alignItems:"flex-start",gap:11,padding:"14px 15px"},
  jobMark: {width:34,height:34,borderRadius:8,background:"var(--surface2)",border:"1px solid var(--border)",color:"var(--muted)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},
  runBtn:  {display:"inline-flex",alignItems:"center",gap:5,background:"var(--accent)",color:"#fff",border:"none",fontFamily:"var(--font)",fontSize:11,fontWeight:600,padding:"6px 14px",borderRadius:6,cursor:"pointer",whiteSpace:"nowrap",transition:"opacity .15s"},
  logBtn:  {display:"inline-flex",alignItems:"center",gap:5,background:"var(--bg2)",color:"var(--text4)",border:"1px solid var(--border2)",fontFamily:"var(--font)",fontSize:11,padding:"5px 12px",borderRadius:6,cursor:"pointer",whiteSpace:"nowrap"},
  logBtnOn:{background:"var(--surface3)",color:"var(--text)"},

  tinyBtn: {display:"inline-flex",alignItems:"center",justifyContent:"center",background:"var(--bg2)",border:"1px solid var(--border2)",color:"var(--muted)",padding:"4px 6px",borderRadius:5,cursor:"pointer",fontFamily:"var(--font)"},

  logPre:  {flex:1,overflowY:"auto",background:"rgba(10,3,5,.55)",border:"1px solid var(--border)",borderRadius:9,fontFamily:"var(--mono)",fontSize:11,lineHeight:1.75,color:"var(--text3)",padding:"14px 16px",margin:0,whiteSpace:"pre-wrap",wordBreak:"break-word"},
  logEmpty:{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",padding:32},
};

/* ── ArgsModal ── */
function ArgsModal({ auto, onClose, onRun }) {
  const today = localISODate();
  const [vals, setVals] = useState(() => {
    const init = {};
    (auto.args||[]).forEach(a => {
      init[a.key] = a.default || (a.type==="date" ? today : a.type==="select" ? (a.options?.[0]?.value||"") : "");
    });
    return init;
  });

  const handleChange = (key, value) => {
    // Kalau month berubah, reset week_num ke "1" (week selalu 1-4 per bulan)
    if (key === "month_num") {
      setVals(p => ({ ...p, [key]: value, week_num: "1" }));
    } else {
      setVals(p => ({ ...p, [key]: value }));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <span style={{display:"flex",alignItems:"center",gap:8}}>
            <Icon name="settings" size={14}/> {auto.name}
          </span>
          <button className="modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={14}/></button>
        </div>
        <div className="modal-body">
          <p className="modal-note">Set parameters before running:</p>
          {(auto.args||[]).map(arg => (
            <div key={arg.key}>
              <label className="form-label">{arg.label}</label>
              {arg.type === "select" ? (
                <select
                  className="form-input"
                  value={vals[arg.key] || ""}
                  onChange={e => handleChange(arg.key, e.target.value)}
                  style={{appearance:"auto"}}
                >
                  {(arg.options||[]).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="form-input"
                  type={arg.type||"text"}
                  value={vals[arg.key]||""}
                  onChange={e => handleChange(arg.key, e.target.value)}
                />
              )}
            </div>
          ))}
          <button className="btn-primary" style={{marginTop:16,display:"inline-flex",alignItems:"center",gap:6}} onClick={()=>onRun(vals)}>
            <Icon name="play" size={12}/> Run now
          </button>
        </div>
      </div>
    </div>
  );
}
