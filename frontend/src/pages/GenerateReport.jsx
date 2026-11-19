import React, { useState, useEffect, useRef } from "react";

import { logActivity } from "../activityLog.js";

/* â”€â”€ WIB time helper â”€â”€ */
function timeNowWIB() {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour:     "2-digit",
    minute:   "2-digit",
  }).format(new Date());
}
function todayWIB() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year:  "numeric",
    month: "2-digit",
    day:   "2-digit",
  }).format(new Date());
}

export default function GenerateReport({ customers, navigate }) {
  const [selCust,   setSelCust]   = useState("");
  const [selAuto,   setSelAuto]   = useState("");
  const [args,      setArgs]      = useState({});
  const [otpModal,  setOtpModal]  = useState(false);
  const [otp,       setOtp]       = useState("");
  const [taskId,    setTaskId]    = useState(null);
  const [dailyTaskId, setDailyTaskId] = useState(null);
  const [otpSubmitted, setOtpSubmitted] = useState(false);
  const [step,      setStep]      = useState("idle");
  const [resultMsg, setResultMsg] = useState("");
  const [logLines,  setLogLines]  = useState([]);
  const [custDetail,setCustDetail]= useState(null); // full customer with automations
  const logRef = useRef(null);

  // Use custDetail.automations if available, else fallback to prop
  const customer  = custDetail || customers.find(c=>c.id===selCust);
  const autos     = customer?.automations || [];
  const auto      = autos.find(a=>a.id===selAuto);

  const today = todayWIB();

  const loadLog = async (cid, aid) => {
    const c = cid || selCust;
    const a = aid || selAuto;
    if (!c || !a) return;
    try {
      const d = await fetch(`/api/logs/${c}/${a}`).then(r=>r.json());
      if (d.logs && d.logs.length > 0) setLogLines(d.logs);
    } catch(_){}
  };

  const loadAllLogs = async (cid) => {
    // Load all available logs for this customer combined
    if (!cid) return;
    try {
      const custD = await fetch("/api/customers/"+cid).then(r=>r.json());
      const autos = custD.automations || [];
      let combined = [];
      for (const a of autos) {
        try {
          const d = await fetch(`/api/logs/${cid}/${a.id}`).then(r=>r.json());
          if (d.logs && d.logs.length > 0) {
            combined.push(`\n── ${a.name} ──────────────────────`);
            combined = combined.concat(d.logs.slice(-30));
          }
        } catch(_){}
      }
      if (combined.length > 0) setLogLines(combined);
    } catch(_){}
  };

  // Load log when automation changes
  useEffect(() => {
    if (!selCust || !selAuto) {
      // Saat customer dipilih tapi automation belum — load semua log yang ada
      if (selCust && !selAuto) {
        loadAllLogs(selCust);
      } else {
        setLogLines([]);
      }
      return;
    }
    loadLog(selCust, selAuto);
  }, [selCust, selAuto]);

  // Load customer detail when customer changes
  useEffect(() => {
    if (!selCust) { setCustDetail(null); return; }
    fetch("/api/customers/"+selCust)
      .then(r=>r.json()).then(setCustDetail).catch(()=>{});
  }, [selCust]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  // Poll Live Log immediately when Generate Report starts
  useEffect(() => {
    if (step !== "running") return;
    const pollLogs = async () => {
      try {
        if (selCust && selAuto) {
          const d = await fetch(`/api/logs/${selCust}/${selAuto}`).then(r=>r.json());
          if (d.logs) setLogLines(d.logs);
        }
      } catch (_) {}
    };

    pollLogs();
    const iv = setInterval(pollLogs, 1000);

    return () => clearInterval(iv);
  }, [step, selCust, selAuto]);

  // Poll task status while running
  useEffect(() => {
    if (!taskId || step !== "running") return;
    const iv = setInterval(async()=>{
      try {
        if (selCust && selAuto) {
          const d = await fetch(`/api/logs/${selCust}/${selAuto}`).then(r=>r.json());
          if (d.logs) setLogLines(d.logs);
        }
        const st = await fetch("/api/status/"+taskId).then(r=>r.json());
        if (st.status==="SUCCESS") {
          if (dailyTaskId) {
            try {
              await fetch("/api/tasks/" + dailyTaskId, {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({status: "Close", end: timeNowWIB()})
              });
            } catch (_) {}
          }
          setStep("done"); clearInterval(iv);
          logActivity(
            "Generate Report",
            "report",
            `${auto?.name || selAuto} | Customer: ${selCust} | ${todayWIB()}`
          );
        } else if (st.status==="FAILURE") {
          if (dailyTaskId) {
            try {
              await fetch("/api/tasks/" + dailyTaskId, {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({status: "Cancelled", end: timeNowWIB()})
              });
            } catch (_) {}
          }
          setStep("error"); clearInterval(iv);
        }
        // Poll OCI login state for creds flow
        if (auto?.requires_oci_credentials) {
          const ls = await fetch("/api/oci/login_state/"+taskId).then(r=>r.json());
          if (ls.state==="otp_required" && !otpModal && !otpSubmitted) setOtpModal(true);
          else if (["running","success"].includes(ls.state)) setOtpModal(false);
          else if (ls.state==="error") { setStep("error"); clearInterval(iv); }
        }
      } catch(_){}
    }, 2500);
    return () => clearInterval(iv);
  }, [taskId, step]);

  const handleGenerate = async () => {
    // Jangan izinkan Generate Report baru jika masih ada proses berjalan.
    if (step === "running") return;
    if (!selCust||!selAuto) return;
    setOtpSubmitted(false);
    setResultMsg("");
    setStep("running"); setLogLines([]);
    setDailyTaskId(null);
    try {
      // Buat Daily Task saat Generate Report dimulai.
      const taskResp = await fetch("/api/tasks", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          customer: selCust,
          description: auto?.name || selAuto,
          detail: auto?.name || selAuto,
          date: todayWIB(),
          start: timeNowWIB(),
          pic: sessionStorage.getItem("pr_display") || sessionStorage.getItem("pr_user") || "",
          status: "In Progress",
          generateReport: true
        })
      });

      if (!taskResp.ok) {
        const errText = await taskResp.text();
        throw new Error(`Create Daily Task failed: ${taskResp.status} ${errText}`);
      }

      const taskData = await taskResp.json();
      if (!taskData.id) {
        throw new Error("Create Daily Task returned no task id");
      }

      setDailyTaskId(taskData.id);
      const createdTaskId = taskData.id;

      const d = await fetch("/api/run",{method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({customer:selCust,automation:selAuto,args,manual_generate:true})}).then(r=>r.json());
      setOtpSubmitted(false);

      if (d.task_id) {
        setTaskId(d.task_id);
        try {
          const lg = await fetch(`/api/logs/${selCust}/${selAuto}`).then(r=>r.json());
          if (lg.logs) setLogLines(lg.logs);
        } catch (_) {}
      } else {
        // Don't leave an orphaned "In Progress" daily task behind.
        await fetch("/api/tasks/" + createdTaskId, {
          method: "PUT",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ status: "Cancelled", end: timeNowWIB() }),
        }).catch(() => {});
        setResultMsg(d.error || "Automation gagal dijalankan.");
        setStep("error");
      }
    } catch(e) {
      setResultMsg(e.message || "Automation gagal dijalankan.");
      setStep("error");
    }
  };

  const handleOtpSubmit  = async () => {
    await fetch("/api/oci/otp",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({task_id:taskId,otp})});
    setOtpModal(false); setOtp(""); setOtpSubmitted(true);
  };

  const logColor = (l) => {
    if (/error|fail|FAIL/i.test(l))             return "#F87171";
    if (/done|success|DONE|berhasil/i.test(l))  return "#4ADE80";
    if (/warn/i.test(l))                         return "#FBBF24";
    if (/===\s*START|CHECKING|opening/i.test(l)) return "#60A5FA";
    return "var(--muted)";
  };

  return (
    <div style={G.root}>

      {/* ── TOPBAR ── */}
      <div style={G.topbar}>
        <div>
          <h1 style={G.title}>Generate Report</h1>
          <p style={G.sub}>Select customer, report type and parameters to generate</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          {selCust&&selAuto&&(
            <button style={G.refreshBtn} onClick={()=>loadLog(selCust,selAuto)}>↻ Refresh</button>
          )}
        </div>
      </div>

      {/* ── MAIN 2-COLUMN LAYOUT ── */}
      <div style={G.layout}>

        {/* ── COL 1: Form ── */}
        <div style={G.formCol}>
          <div style={G.sectionLabel}>REPORT CONFIGURATION</div>

          {/* Customer */}
          <div style={G.field}>
            <label style={G.label}>Customer</label>
            <select style={G.select} value={selCust}
              onChange={e=>{ setSelCust(e.target.value); setSelAuto(""); setArgs({}); setLogLines([]); setStep("idle"); }}>
              <option value="">— Select Customer —</option>
              {customers.map(c=>(
                <option key={c.id} value={c.id}>{c.name} ({c.platform})</option>
              ))}
            </select>
          </div>

          {/* Report Type */}
          <div style={G.field}>
            <label style={G.label}>Report Type</label>
            <select style={G.select} value={selAuto}
              onChange={e=>{ setSelAuto(e.target.value); setArgs({}); setLogLines([]); setStep("idle"); }}>
              <option value="">— Select Report —</option>
              {autos.map(a=>(
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Dynamic args */}
          {auto?.args?.map(arg=>(
            <div key={arg.key} style={G.field}>
              <label style={G.label}>{arg.label.toUpperCase()}</label>
              <input type={arg.type||"text"} style={G.input}
                value={args[arg.key]||arg.default||(arg.type==="date"?today:arg.type==="month"?today.slice(0,7):"")}
                onChange={e=>setArgs(p=>({...p,[arg.key]:e.target.value}))}
                placeholder={arg.label}/>
            </div>
          ))}

          {/* Auto info box */}
          {auto && (
            <div style={G.infoBox}>
              <div style={{fontSize:9,color:"#363636",textTransform:"uppercase",
                letterSpacing:".08em",marginBottom:6}}>AUTOMATION INFO</div>
              <div style={{fontSize:11,color:"var(--muted)",lineHeight:1.6,marginBottom:8}}>{auto.description}</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {[auto.schedule, auto.output_type.toUpperCase(), auto.id].map(t=>(
                  <span key={t} style={G.tag}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* Status indicator */}
          {step!=="idle" && (
            <div style={{padding:"8px 12px",borderRadius:7,fontSize:11,
              background:step==="done"?"rgba(34,197,94,.08)":step==="error"?"rgba(239,68,68,.08)":"rgba(177,18,38,.08)",
              border:`1px solid ${step==="done"?"rgba(34,197,94,.2)":step==="error"?"rgba(239,68,68,.2)":"rgba(177,18,38,.2)"}`,
              color:step==="done"?"#4ADE80":step==="error"?"#F87171":"var(--text2)",
              display:"flex",alignItems:"center",gap:8}}>
              {step==="running"&&<span className="spinner" style={{width:10,height:10,borderWidth:1.5,borderColor:"currentColor",borderTopColor:"transparent"}}/>}
              {step==="done"?"✅ Report generated successfully!":
               step==="error"?(resultMsg ? `❌ ${resultMsg}` : "❌ Generation failed — check log"):
               "⏳ Generating report..."}
            </div>
          )}

          {/* Generate button */}
          <button
            style={{...G.genBtn,...(!selCust||!selAuto||step==="running"?{opacity:.45,cursor:"not-allowed"}:{})}}
            disabled={!selCust||!selAuto||step==="running"}
            onClick={handleGenerate}>
            {step==="running"
              ? <><span className="spinner" style={{width:12,height:12,borderWidth:2,borderColor:"#fff",borderTopColor:"transparent"}}/> Generating…</>
              : "⚡ Generate Report"}
          </button>

          {(step==="done"||step==="error") && (
            <button style={G.resetBtn} onClick={()=>{ setStep("idle"); setTaskId(null); setOtpSubmitted(false); }}>
              ← New Report
            </button>
          )}
        </div>

        {/* ── COL 2: Live Log ── */}
        <div style={G.logCol}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
            marginBottom:12,flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:".12em",color:"#363636",
                textTransform:"uppercase"}}>
                {step==="running" ? "LIVE LOG" : logLines.length>0 ? "LOG HISTORY" : "LIVE LOG"}
              </div>
              {step==="running" && (
                <span style={{fontSize:8,fontWeight:700,padding:"2px 6px",borderRadius:3,
                  background:"rgba(177,18,38,.15)",color:"#B11226",letterSpacing:".08em",
                  border:"1px solid rgba(177,18,38,.3)"}}>● LIVE</span>
              )}
              {step!=="running" && logLines.length>0 && (
                <span style={{fontSize:9,color:"#363636",fontFamily:"monospace"}}>
                  {selCust}_{selAuto}.log
                </span>
              )}
            </div>
            <div style={{display:"flex",gap:6}}>
              {selCust&&selAuto&&(
                <button style={G.smallBtn} onClick={()=>loadLog(selCust,selAuto)}>↻</button>
              )}
              <button style={G.smallBtn} onClick={()=>setLogLines([])}>Clear</button>
            </div>
          </div>

          <div style={G.logBox} ref={logRef}>
            {logLines.length===0 ? (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",
                justifyContent:"center",height:"100%",color:"var(--border2)",gap:8}}>
                <div style={{fontSize:28,opacity:.15}}>📋</div>
                <div style={{fontSize:11,fontStyle:"italic"}}>
                  {!selCust
                    ? "Select a customer to view logs"
                    : "No log history found"}
                </div>
                {selCust && !selAuto && (
                  <button style={{...G.smallBtn,marginTop:4,color:"#B11226",borderColor:"rgba(177,18,38,.3)"}}
                    onClick={()=>loadAllLogs(selCust)}>
                    ↻ Load All Logs
                  </button>
                )}
              </div>
            ) : (
              logLines.map((l,i)=>(
                <div key={i} style={{
                  fontSize:10,lineHeight:1.8,
                  color: l.startsWith("──")?"#B11226":logColor(l),
                  fontWeight: l.startsWith("──")?"700":"400",
                  borderBottom: l.startsWith("──")?"1px solid var(--border)":"1px solid rgba(255,255,255,.02)",
                  paddingBottom:1,wordBreak:"break-all",
                  paddingTop: l.startsWith("──")?6:0,
                  marginTop: l.startsWith("──")?4:0,
                }}>
                  {l}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── OTP Modal ── */}
      {otpModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header"><span>📧 OTP Verification</span></div>
            <div className="modal-body">
              <p className="modal-note">OTP has been sent to your email. Enter the code below:</p>
              <label className="form-label">OTP Code</label>
              <input className="form-input" type="text" value={otp}
                onChange={e=>setOtp(e.target.value)} placeholder="6-digit OTP" autoFocus/>
              <button className="btn-primary" style={{marginTop:12}}
                onClick={handleOtpSubmit} disabled={!otp}>
                ✓ Verify & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const G = {
  root:      {height:"100%",display:"flex",flexDirection:"column",overflow:"hidden",
              background:"var(--bg)",fontFamily:"'Inter',system-ui,sans-serif"},
  topbar:    {display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"16px 24px 12px",borderBottom:"1px solid var(--border)",flexShrink:0,
              background:"var(--bg2)"},
  title:     {fontSize:18,fontWeight:700,letterSpacing:"-.02em",color:"var(--text)"},
  sub:       {fontSize:11,color:"var(--muted2)",marginTop:2},
  layout:    {flex:1,display:"grid",gridTemplateColumns:"300px 1fr",gap:0,
              overflow:"hidden",borderTop:"1px solid var(--border)"},
  sectionLabel:{fontSize:9,fontWeight:700,letterSpacing:".12em",color:"var(--muted3)",
               textTransform:"uppercase"},

  /* Form column */
  formCol:   {padding:"18px 20px",borderRight:"1px solid var(--border)",
              display:"flex",flexDirection:"column",gap:12,overflowY:"auto",
              background:"var(--bg2)"},
  field:     {display:"flex",flexDirection:"column",gap:5},
  label:     {fontSize:9,fontWeight:700,letterSpacing:".08em",color:"var(--muted2)"},
  select:    {background:"var(--surface2)",border:"1px solid var(--border2)",color:"var(--text)",
              fontFamily:"inherit",fontSize:12,padding:"9px 12px",borderRadius:7,
              outline:"none",cursor:"pointer",transition:"border-color .15s"},
  input:     {background:"var(--surface2)",border:"1px solid var(--border2)",color:"var(--text)",
              fontFamily:"inherit",fontSize:12,padding:"9px 12px",borderRadius:7,
              outline:"none",transition:"border-color .15s"},
  infoBox:   {background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"11px"},
  tag:       {fontSize:9,fontWeight:600,padding:"2px 7px",borderRadius:3,
              background:"var(--surface2)",color:"var(--muted)",border:"1px solid var(--border)"},
  genBtn:    {background:"#B11226",color:"#fff",border:"none",fontFamily:"inherit",
              fontSize:12,fontWeight:600,padding:"11px",borderRadius:8,cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"center",gap:8,
              transition:"background .15s",letterSpacing:".02em"},
  resetBtn:  {background:"none",border:"1px solid var(--border2)",color:"var(--muted)",
              fontFamily:"inherit",fontSize:11,padding:"8px",borderRadius:7,
              cursor:"pointer",textAlign:"center"},

  /* Log column */
  logCol:    {padding:"18px 18px",display:"flex",flexDirection:"column",overflow:"hidden"},
  logBox:    {flex:1,minHeight:0,fontFamily:"'JetBrains Mono','Fira Code',monospace",
              fontSize:10,overflowY:"auto",background:"var(--bg3)",
              border:"1px solid var(--border)",borderRadius:8,
              padding:"10px 12px",lineHeight:1.7},

  refreshBtn:{background:"none",border:"1px solid var(--border2)",color:"var(--muted)",
              fontFamily:"inherit",fontSize:11,padding:"5px 12px",borderRadius:5,cursor:"pointer"},
  smallBtn:  {background:"none",border:"1px solid var(--border)",color:"var(--muted2)",
              fontFamily:"inherit",fontSize:10,padding:"3px 9px",borderRadius:4,cursor:"pointer"},
};
