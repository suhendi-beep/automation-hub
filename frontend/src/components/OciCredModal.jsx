import React, { useState, useEffect } from "react";
import Icon from "./Icon.jsx";

const OCI_KEY = "oci_cred_hist";
const loadHist = () => { try { return JSON.parse(localStorage.getItem(OCI_KEY)||"[]"); } catch { return []; } };
const saveHist = (t,u) => { const p=loadHist().filter(h=>!(h.tenancy===t&&h.username===u)); localStorage.setItem(OCI_KEY,JSON.stringify([{tenancy:t,username:u},...p].slice(0,5))); };

export default function OciCredModal({ auto, taskId:initTid, onClose, onSubmit }) {
  const hist = loadHist();
  const [tenancy,  setTenancy]  = useState(hist[0]?.tenancy||"");
  const [username, setUsername] = useState(hist[0]?.username||"");
  const [password, setPassword] = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [showHist, setShowHist] = useState(false);
  const [otp,      setOtp]      = useState("");
  const [taskId,   setTaskId]   = useState(initTid||null);
  const [step,     setStep]     = useState("creds"); // creds|otp|running|done|error
  const [msg,      setMsg]      = useState("");

  useEffect(() => { if (initTid && !taskId) setTaskId(initTid); }, [initTid]);

  useEffect(() => {
    if (!taskId || ["done","error","creds"].includes(step)) return;
    const iv = setInterval(async () => {
      try {
        const d = await fetch("/api/oci/login_state/"+taskId).then(r=>r.json());
        if (d.state==="otp_required" && step!=="otp") { setStep("otp"); setMsg("OTP sent to email. Enter the code:"); }
        else if (d.state==="running")  { setStep("running"); setMsg("Login OK — capturing screenshots…"); }
        else if (d.state==="success")  { clearInterval(iv); setStep("done"); setMsg("Done! File is ready."); setTimeout(onClose,2000); }
        else if (d.state==="error")    { clearInterval(iv); setStep("error"); setMsg((d.msg||"Unknown error").slice(0,250)); }
      } catch(_) {}
    }, 2000);
    return () => clearInterval(iv);
  }, [taskId, step]);

  const submit = () => {
    if (!username||!password) return;
    saveHist(tenancy,username); setStep("running"); setMsg("Submitting credentials…");
    onSubmit({tenancy,username,password});
  };

  const submitOtp = async () => {
    if (!otp||!taskId) return;
    setStep("running"); setMsg("Verifying OTP…");
    await fetch("/api/oci/otp",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({task_id:taskId,otp})});
    setMsg("OTP submitted — waiting for verification…");
  };

  return (
    <div className="modal-overlay" onClick={step==="creds"?onClose:undefined}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <span style={{display:"flex",alignItems:"center",gap:8}}>
            <Icon name="key" size={14}/> OCI login — {auto.name}
          </span>
          {step==="creds" && <button className="modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={14}/></button>}
        </div>
        <div className="modal-body">

          {step==="creds" && (<>
            <p className="modal-note">Sign in with your own OCI account to run this automation.</p>
            <label className="form-label">Tenancy Name</label>
            <div style={{position:"relative"}}>
              <input className="form-input" value={tenancy} onChange={e=>setTenancy(e.target.value)}
                placeholder="tenancy-name" style={{paddingRight:hist.length?36:undefined}}/>
              {hist.length>0 && (
                <button onClick={()=>setShowHist(v=>!v)} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--muted)",display:"flex",padding:2}} aria-label="Recent tenancies">
                  <Icon name="chevronDown" size={14}/>
                </button>
              )}
              {showHist && (
                <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:100,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,overflow:"hidden",boxShadow:"var(--shadow-pop)"}}>
                  {hist.map((h,i) => (
                    <div key={i} onClick={()=>{setTenancy(h.tenancy);setUsername(h.username);setShowHist(false);}}
                      style={{padding:"8px 13px",cursor:"pointer",fontSize:12,borderBottom:i<hist.length-1?"1px solid var(--border)":"none"}}
                      onMouseEnter={e=>e.currentTarget.style.background="var(--surface2)"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                      <div style={{color:"var(--text)",fontWeight:500}}>{h.tenancy||"—"}</div>
                      <div style={{color:"var(--muted)",fontSize:10}}>{h.username}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <label className="form-label" style={{marginTop:10}}>Username / Email</label>
            <input className="form-input" value={username} onChange={e=>setUsername(e.target.value)} placeholder="user@example.com"/>
            <label className="form-label" style={{marginTop:10}}>Password</label>
            <div style={{position:"relative"}}>
              <input className="form-input" type={showPwd?"text":"password"} value={password}
                onChange={e=>setPassword(e.target.value)} placeholder="••••••••" style={{paddingRight:40}}/>
              <button onClick={()=>setShowPwd(v=>!v)} style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--muted)",display:"flex",padding:2}} aria-label={showPwd?"Hide password":"Show password"}>
                <Icon name={showPwd?"eyeOff":"eye"} size={14}/>
              </button>
            </div>
            <button className="btn-primary" style={{marginTop:16,display:"inline-flex",alignItems:"center",gap:6}} onClick={submit} disabled={!username||!password}>
              <Icon name="unlock" size={12}/> Login &amp; run
            </button>
          </>)}

          {step==="otp" && (<>
            <p className="modal-note">{msg}</p>
            <label className="form-label">OTP Code</label>
            <input className="form-input" type="text" value={otp} onChange={e=>setOtp(e.target.value)}
              placeholder="6-digit OTP" autoFocus/>
            <button className="btn-primary" style={{marginTop:16,display:"inline-flex",alignItems:"center",gap:6}} onClick={submitOtp} disabled={!otp}>
              <Icon name="check" size={12}/> Verify OTP
            </button>
          </>)}

          {step==="running" && (
            <div style={{textAlign:"center",padding:"24px 0"}}>
              <span className="spinner" style={{width:24,height:24,margin:"0 auto 14px",display:"block",borderWidth:2.5}}/>
              <p className="modal-note">{msg||"Processing…"}</p>
            </div>
          )}

          {step==="done" && (
            <div style={{textAlign:"center",padding:"20px 0",fontSize:13,fontWeight:600,color:"var(--green)",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              <Icon name="checkCircle" size={16}/> {msg}
            </div>
          )}

          {step==="error" && (
            <div>
              <div style={{color:"var(--red)",fontSize:12,padding:"8px 0",lineHeight:1.6}}>{msg}</div>
              <button className="btn-danger" style={{marginTop:12}} onClick={onClose}>Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
