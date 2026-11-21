import React, { useState } from "react";
import Icon from "../components/Icon.jsx";
import { GlassInput, GlassButton } from "../components/Glass.jsx";

/* A restrained product preview — mirrors the real console instead of using
   decorative AI-style gradients or emoji. */
function ConsolePreview() {
  return (
    <div style={V.frame}>
      <div style={V.titlebar}>
        <span style={V.dot}/>
        <span style={V.dot}/>
        <span style={V.dot}/>
        <span style={{flex:1}}/>
        <span style={V.titleText}>Portal Report</span>
      </div>
      <div style={V.body}>
        <div style={V.side}>
          <div style={V.brand}><img src="/ics-mark.svg" alt="" style={{width:18,height:18,borderRadius:4}}/></div>
          {["dashboard","alert","ticket","report","settings"].map((n,i)=>(
            <span key={n} style={{...V.sideItem, ...(i===1?V.sideItemOn:{})}}>
              <Icon name={n} size={11}/>
            </span>
          ))}
        </div>
        <div style={V.main}>
          <div style={V.mainHead}>
            <div>
              <div style={V.h1}>Alert Monitor</div>
              <div style={V.h2}>Grafana · live</div>
            </div>
            <span style={V.live}><span style={V.liveDot}/> Live</span>
          </div>
          <div style={V.stats}>
            {[
              {k:"Firing",v:"12",c:"var(--accent)"},
              {k:"Critical",v:"3",c:"var(--red)"},
              {k:"Resolved",v:"27",c:"var(--green)"},
            ].map(s=>(
              <div key={s.k} style={V.stat}>
                <div style={{...V.statVal,color:s.c}}>{s.v}</div>
                <div style={V.statKey}>{s.k}</div>
              </div>
            ))}
          </div>
          <div style={V.rows}>
            {[
              {n:"Database CPU High",m:"Top SQL · Perf Hub",t:"4m",c:"var(--red)"},
              {n:"ADB Storage 92%",m:"DB System evidence",t:"18m",c:"var(--amber)"},
              {n:"Pod restarts — api",m:"Rancher · pods",t:"31m",c:"var(--blue)"},
              {n:"Health check down",m:"URL probe + TLS",t:"1h",c:"var(--green)"},
            ].map(r=>(
              <div key={r.n} style={V.row}>
                <span style={{...V.rowDot,background:r.c}}/>
                <span style={{flex:1,minWidth:0}}>
                  <span style={V.rowName}>{r.n}</span>
                  <span style={V.rowMeta}>{r.m}</span>
                </span>
                <span style={V.rowTime}>{r.t}</span>
                <Icon name="chevronRight" size={11} style={{color:"var(--muted3)"}}/>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage({ onLogin }) {
  const REMEMBER_KEY = "pr_remember_credentials";
  const BACKEND_VERSION = "2.2";

  // Only usernames may be remembered — never passwords.
  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY) || "{}");
      if (saved.password) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: saved.username || "" }));
      }
    } catch (_) {}
  }, []);

  const savedUsername = (() => {
    try {
      return JSON.parse(localStorage.getItem(REMEMBER_KEY) || "{}").username || "";
    } catch { return ""; }
  })();

  const [username,  setUsername]  = useState(savedUsername);
  const [password,  setPassword]  = useState("");
  const [remember,  setRemember]  = useState(!!savedUsername);
  const [showPwd,   setShowPwd]   = useState(false);
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);

  // Forgot-password request (engineer submits, admin approves).
  const [showReset,    setShowReset]    = useState(false);
  const [resetForm,    setResetForm]    = useState({ username: "", password: "", confirm: "" });
  const [resetError,   setResetError]   = useState("");
  const [resetInfo,    setResetInfo]    = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.ok && data.token) {
        if (remember) {
          localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username }));
        } else {
          localStorage.removeItem(REMEMBER_KEY);
        }
        sessionStorage.setItem("pr_auth",    "1");
        sessionStorage.setItem("pr_token",   data.token);
        sessionStorage.setItem("pr_user",    data.username);
        sessionStorage.setItem("pr_display", data.display);
        sessionStorage.setItem("pr_role",    data.role);
        sessionStorage.setItem("pr_features", JSON.stringify(data.features || []));
        sessionStorage.setItem("pr_login_at", String(Date.now()));
        fetch("/api/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: data.username, display: data.display,
            action: "Login", category: "auth",
            detail: `Logged in as ${data.role}`,
          }),
        }).catch(() => {});
        onLogin();
      } else {
        setError(data.error || "Invalid username or password.");
      }
    } catch (_) {
      setError("Cannot connect to the server. Please try again.");
    }
    setLoading(false);
  };

  const passwordPolicyError = (pw) => {
    if (pw.length < 6) return "Password must be at least 6 characters.";
    if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter.";
    if (!/[a-z]/.test(pw)) return "Password must contain a lowercase letter.";
    if (!/\d/.test(pw)) return "Password must contain a number.";
    if (!/[^A-Za-z0-9]/.test(pw)) return "Password must contain a symbol.";
    return "";
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setResetError(""); setResetInfo("");
    if (resetForm.password !== resetForm.confirm) {
      setResetError("New password and confirmation do not match.");
      return;
    }
    const policyErr = passwordPolicyError(resetForm.password);
    if (policyErr) { setResetError(policyErr); return; }
    setResetLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: resetForm.username.trim(), new_password: resetForm.password }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to send the request.");
      setResetInfo(d.message || "Password reset request sent. An admin must approve it.");
      setResetForm((f) => ({ ...f, password: "", confirm: "" }));
    } catch (err) {
      setResetError(err.message);
    } finally {
      setResetLoading(false);
    }
  };

  const openReset = () => {
    setResetForm({ username, password: "", confirm: "" });
    setResetError(""); setResetInfo("");
    setError("");
    setShowReset(true);
  };

  return (
    <div style={L.root}>
      {/* ── Left: sign-in ── */}
      <div style={L.left}>
        <div style={L.brandRow}>
          <img src="/ics-mark.svg" alt="ICS Compute" style={{width:34,height:34,borderRadius:10,display:"block",boxShadow:"0 0 24px -5px rgba(232,194,122,.65)"}}/>
          <div>
            <div style={L.brandName}>Portal Report</div>
            <div style={L.brandSub}>ICS Compute</div>
          </div>
        </div>

        <div style={L.formBody}>
          <div style={L.formInner}>
            {showReset ? (
              <>
                <h1 style={L.heading}>Reset <span className="hl">password</span></h1>
                <p style={L.subheading}>
                  Submit a new password request. An admin must approve it before it takes effect.
                </p>

                <form onSubmit={handleForgot} style={L.form} noValidate>
                  <div style={L.fieldGroup}>
                    <label style={L.label} htmlFor="reset-username">Username</label>
                    <GlassInput id="reset-username" type="text" value={resetForm.username}
                      onChange={e=>setResetForm(f=>({...f, username:e.target.value}))}
                      autoFocus autoComplete="username" placeholder="Your username"/>
                  </div>
                  <div style={L.fieldGroup}>
                    <label style={L.label} htmlFor="reset-password">New password</label>
                    <GlassInput id="reset-password" type="password" value={resetForm.password}
                      onChange={e=>setResetForm(f=>({...f, password:e.target.value}))}
                      autoComplete="new-password" placeholder="Min. 6 chars, A-Z, 0-9, symbol"/>
                  </div>
                  <div style={L.fieldGroup}>
                    <label style={L.label} htmlFor="reset-confirm">Confirm new password</label>
                    <GlassInput id="reset-confirm" type="password" value={resetForm.confirm}
                      onChange={e=>setResetForm(f=>({...f, confirm:e.target.value}))}
                      autoComplete="new-password" placeholder="Repeat the new password"/>
                  </div>

                  {resetError && (
                    <div style={L.errBox}>
                      <Icon name="warning" size={14}/>
                      <span>{resetError}</span>
                    </div>
                  )}
                  {resetInfo && (
                    <div style={{...L.errBox, color:"var(--green)", borderColor:"var(--border2)"}}>
                      <Icon name="checkCircle" size={14}/>
                      <span>{resetInfo}</span>
                    </div>
                  )}

                  <GlassButton type="submit" variant="primary" style={{
                    width:"100%", padding:"12px", fontSize:13, marginTop:3,
                    opacity:(resetLoading||!resetForm.username||!resetForm.password||!resetForm.confirm)?.45:1,
                    cursor:(resetLoading||!resetForm.username||!resetForm.password||!resetForm.confirm)?"not-allowed":"pointer",
                  }} disabled={resetLoading||!resetForm.username||!resetForm.password||!resetForm.confirm}>
                    {resetLoading
                      ? <><span className="spinner" style={{width:13,height:13,borderWidth:1.6}}/> Sending…</>
                      : <>Send reset request <Icon name="arrowRight" size={14}/></>}
                  </GlassButton>

                  <button type="button" onClick={()=>{ setShowReset(false); setResetError(""); setResetInfo(""); }}
                    style={L.textBtn}>
                    Back to sign in
                  </button>
                </form>
              </>
            ) : (
              <>
                <h1 style={L.heading}>Sign <span className="hl">in</span></h1>
                <p style={L.subheading}>
                  Use your operations account to access the reporting and alert console.
                </p>

                <form onSubmit={handleSubmit} style={L.form} noValidate>
                  <div style={L.fieldGroup}>
                    <label style={L.label} htmlFor="username">Username</label>
                    <GlassInput id="username" type="text" value={username}
                      onChange={e=>setUsername(e.target.value)}
                      autoFocus autoComplete="username" placeholder="e.g. engineer.name"/>
                  </div>

                  <div style={L.fieldGroup}>
                    <label style={L.label} htmlFor="password">Password</label>
                    <div style={{position:"relative"}}>
                      <GlassInput id="password" style={{paddingRight:42}}
                        type={showPwd?"text":"password"} value={password}
                        onChange={e=>setPassword(e.target.value)}
                        autoComplete="current-password" placeholder="Enter your password"/>
                      <button type="button" onClick={()=>setShowPwd(v=>!v)}
                        aria-label={showPwd ? "Hide password" : "Show password"}
                        style={L.eyeBtn}>
                        <Icon name={showPwd ? "eyeOff" : "eye"} size={15}/>
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div style={L.errBox}>
                      <Icon name="warning" size={14}/>
                      <span>{error}</span>
                    </div>
                  )}

                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <input
                      id="remember-me"
                      type="checkbox"
                      checked={remember}
                      onChange={e => setRemember(e.target.checked)}
                      style={{width:14,height:14,cursor:"pointer",accentColor:"var(--accent)"}}
                    />
                    <label htmlFor="remember-me" style={L.rememberLabel}>Remember username</label>
                  </div>

                  <GlassButton type="submit" variant="primary" style={{
                    width:"100%", padding:"12px", fontSize:13, marginTop:3,
                    opacity:(loading||!username||!password)?.45:1,
                    cursor:(loading||!username||!password)?"not-allowed":"pointer",
                  }} disabled={loading||!username||!password}>
                    {loading
                      ? <><span className="spinner" style={{width:13,height:13,borderWidth:1.6}}/> Signing in…</>
                      : <>Sign in <Icon name="arrowRight" size={14}/></>}
                  </GlassButton>

                  <button type="button" onClick={openReset} style={L.textBtn}>
                    Forgot password?
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        <div style={L.footer}>
          <span>ICS Compute · Portal Report · v{BACKEND_VERSION}</span>
          <span style={L.footerMeta}>Asia/Jakarta</span>
        </div>
      </div>

      {/* ── Right: product context ── */}
      <div style={L.right}>
        <div style={L.grid}/>
        <div style={L.rightContent}>
          <div style={L.heroCopy}>
            <div style={L.eyebrow}>OPERATIONS CONSOLE</div>
            <h2 style={L.heroTitle}>Every alert has a next <span className="hl">step.</span></h2>
            <p style={L.heroDesc}>
              Correlate Grafana alerts with database evidence, infrastructure targets,
              and reporting history — in one place your team can act on.
            </p>
          </div>

          <ConsolePreview/>

          <div style={L.features}>
            {[
              {icon:"link",   t:"Direct evidence", d:"Top SQL, Perf Hub, Rancher pods and URL probes open exactly where the engineer needs to look."},
              {icon:"report", t:"Automated reports", d:"Daily and weekly deliverables generated, stored, and ready to share."},
              {icon:"shield", t:"Audit-ready", d:"Every escalation, ticket, and report action is recorded by user."},
            ].map(f=>(
              <div key={f.t} style={L.feature}>
                <span style={L.featureIcon}><Icon name={f.icon} size={16}/></span>
                <div>
                  <div style={L.featureTitle}>{f.t}</div>
                  <div style={L.featureDesc}>{f.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const L = {
  root:       {width:"100vw",height:"100vh",display:"flex",overflow:"hidden",
               background:"transparent",fontFamily:"var(--font)",color:"var(--text)"},
  left:       {width:"42%",minWidth:400,maxWidth:540,
               background:"linear-gradient(165deg, rgba(38,11,17,.72), rgba(10,3,6,.62))",
               borderRight:"1px solid var(--border)",
               backdropFilter:"blur(28px) saturate(150%)",
               WebkitBackdropFilter:"blur(28px) saturate(150%)",
               display:"flex",flexDirection:"column",flexShrink:0,
               boxShadow:"24px 0 80px -50px rgba(0,0,0,.9)"},
  brandRow:   {display:"flex",alignItems:"center",gap:11,padding:"22px 32px"},
  brandName:  {fontSize:13.5,fontWeight:700,letterSpacing:"-.02em",color:"var(--text)",lineHeight:1.2},
  brandSub:   {fontSize:10.5,color:"var(--muted)",marginTop:1,letterSpacing:".04em"},
  formBody:   {flex:1,display:"flex",flexDirection:"column",justifyContent:"center",
               padding:"0 48px 6%",overflow:"hidden"},
  formInner:  {width:"100%",maxWidth:350,margin:"0 auto"},
  heading:    {fontSize:30,fontWeight:750,letterSpacing:"-.04em",color:"var(--text)",marginBottom:8},
  subheading: {fontSize:12.5,color:"var(--muted)",lineHeight:1.65,marginBottom:26},
  form:       {display:"flex",flexDirection:"column",gap:15},
  fieldGroup: {display:"flex",flexDirection:"column"},
  label:      {fontSize:11,fontWeight:600,color:"var(--text4)",marginBottom:6,letterSpacing:".03em"},
  input:      {width:"100%",background:"rgba(255,255,255,.05)",border:"1px solid var(--border2)",
               color:"var(--text)",fontFamily:"inherit",fontSize:13,
               padding:"11px 13px",borderRadius:10,outline:"none",
               boxSizing:"border-box",transition:"border-color .2s,box-shadow .2s"},
  eyeBtn:     {position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",
               background:"none",border:"none",cursor:"pointer",color:"var(--rose)",
               padding:7,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6},
  errBox:     {display:"flex",alignItems:"center",gap:8,fontSize:12,
               background:"rgba(251,113,133,.1)",color:"var(--red)",
               border:"1px solid rgba(251,113,133,.3)",padding:"10px 12px",borderRadius:10},
  rememberLabel:{fontSize:11.5,color:"var(--muted)",cursor:"pointer",userSelect:"none"},
  textBtn:    {background:"none",border:"none",color:"var(--rose)",fontSize:11.5,
               cursor:"pointer",padding:0,alignSelf:"center",fontFamily:"inherit"},
  submitBtn:  {background:"var(--accent-grad)",color:"#fff",border:"1px solid rgba(255,255,255,.14)",
               fontFamily:"inherit",fontSize:13,fontWeight:600,padding:"12px",borderRadius:10,
               display:"flex",alignItems:"center",justifyContent:"center",gap:8,
               marginTop:3,letterSpacing:".01em",
               boxShadow:"0 10px 28px -10px rgba(139,18,38,.6), inset 0 1px 0 rgba(255,255,255,.24)"},
  footer:     {display:"flex",alignItems:"center",justifyContent:"space-between",
               padding:"16px 32px",borderTop:"1px solid var(--border)",
               fontSize:10.5,color:"var(--muted3)"},
  footerMeta: {fontSize:10,color:"var(--muted3)"},

  right:      {flex:1,position:"relative",overflow:"hidden",display:"flex",
               background:"transparent",color:"var(--text)"},
  grid:       {position:"absolute",inset:0,pointerEvents:"none",opacity:.5,
               backgroundImage:"linear-gradient(rgba(232,194,122,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(232,194,122,.07) 1px, transparent 1px)",
               backgroundSize:"56px 56px",
               maskImage:"radial-gradient(ellipse at 60% 35%, #000 30%, transparent 78%)",
               WebkitMaskImage:"radial-gradient(ellipse at 60% 35%, #000 30%, transparent 78%)"},
  rightContent:{position:"relative",zIndex:1,flex:1,display:"flex",flexDirection:"column",
               justifyContent:"center",gap:26,padding:"48px 56px",overflow:"hidden",maxWidth:780,margin:"0 auto"},
  heroCopy:   {maxWidth:560},
  eyebrow:    {fontSize:10,fontWeight:700,letterSpacing:".18em",color:"var(--rose)",marginBottom:10},
  heroTitle:  {fontSize:32,fontWeight:750,letterSpacing:"-.04em",lineHeight:1.12,color:"var(--text)",marginBottom:12},
  heroDesc:   {fontSize:13,color:"var(--muted)",lineHeight:1.7,maxWidth:520},
  features:   {display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:18,
               borderTop:"1px solid var(--border)",paddingTop:22},
  feature:    {display:"flex",gap:10,alignItems:"flex-start"},
  featureIcon:{width:32,height:32,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",
               background:"linear-gradient(145deg, rgba(232,165,152,.18), rgba(232,194,122,.06))",
               border:"1px solid rgba(232,194,122,.26)",
               color:"var(--rose)",flexShrink:0,
               boxShadow:"0 0 22px -8px rgba(232,165,152,.6)"},
  featureTitle:{fontSize:11.5,fontWeight:600,color:"var(--text2)",marginBottom:3},
  featureDesc:{fontSize:10.5,color:"var(--muted)",lineHeight:1.55},
};

const V = {
  frame:      {background:"linear-gradient(160deg, rgba(40,12,18,.7), rgba(12,4,7,.8))",
               border:"1px solid rgba(255,255,255,.14)",borderRadius:18,
               overflow:"hidden",maxWidth:620,
               boxShadow:"0 28px 70px rgba(0,0,0,.55), 0 0 50px -18px rgba(139,18,38,.45), inset 0 1px 0 rgba(255,255,255,.12)",
               backdropFilter:"blur(24px) saturate(150%)",WebkitBackdropFilter:"blur(24px) saturate(150%)"},
  titlebar:   {display:"flex",alignItems:"center",gap:6,padding:"10px 14px",
               borderBottom:"1px solid rgba(255,255,255,.1)",
               background:"linear-gradient(180deg, rgba(255,255,255,.06), transparent)"},
  dot:        {width:7,height:7,borderRadius:"50%",background:"rgba(232,165,152,.5)"},
  titleText:  {fontSize:9.5,color:"var(--muted2)",fontWeight:600,letterSpacing:".04em"},
  body:       {display:"flex",minHeight:250},
  side:       {width:42,borderRight:"1px solid rgba(255,255,255,.08)",padding:"10px 0",
               display:"flex",flexDirection:"column",alignItems:"center",gap:8,
               background:"rgba(0,0,0,.18)"},
  brand:      {marginBottom:6},
  sideItem:   {width:24,height:24,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",
               color:"var(--muted3)"},
  sideItemOn: {background:"rgba(225,29,72,.18)",color:"var(--rose)",
               boxShadow:"inset 0 0 0 1px rgba(232,194,122,.2)"},
  main:       {flex:1,padding:"14px 16px",minWidth:0},
  mainHead:   {display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12},
  h1:         {fontSize:12.5,fontWeight:650,color:"var(--text2)",letterSpacing:"-.01em"},
  h2:         {fontSize:9.5,color:"var(--muted3)",marginTop:2},
  live:       {display:"flex",alignItems:"center",gap:5,fontSize:9.5,fontWeight:600,color:"var(--green)"},
  liveDot:    {width:5,height:5,borderRadius:"50%",background:"var(--green)",boxShadow:"0 0 0 3px var(--green-dim)"},
  stats:      {display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12},
  stat:       {background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"8px 10px"},
  statVal:    {fontSize:15,fontWeight:700,letterSpacing:"-.02em"},
  statKey:    {fontSize:8.5,color:"var(--muted3)",textTransform:"uppercase",letterSpacing:".07em",marginTop:1},
  rows:       {display:"flex",flexDirection:"column",gap:5},
  row:        {display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,.04)",
               border:"1px solid rgba(255,255,255,.08)",borderRadius:7,padding:"7px 9px"},
  rowDot:     {width:5,height:5,borderRadius:"50%",flexShrink:0},
  rowName:    {display:"block",fontSize:10,fontWeight:550,color:"var(--text3)",
               overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
  rowMeta:    {display:"block",fontSize:8.5,color:"var(--muted3)",marginTop:1,
               overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
  rowTime:    {fontSize:8.5,color:"var(--muted3)",flexShrink:0},
};
