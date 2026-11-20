import React, { useState } from "react";
import Icon from "../components/Icon.jsx";

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
              {k:"Critical",v:"3",c:"#F97066"},
              {k:"Resolved",v:"27",c:"#3DD68C"},
            ].map(s=>(
              <div key={s.k} style={V.stat}>
                <div style={{...V.statVal,color:s.c}}>{s.v}</div>
                <div style={V.statKey}>{s.k}</div>
              </div>
            ))}
          </div>
          <div style={V.rows}>
            {[
              {n:"Database CPU High",m:"Top SQL · Perf Hub",t:"4m",c:"#F97066"},
              {n:"ADB Storage 92%",m:"DB System evidence",t:"18m",c:"#FDB022"},
              {n:"Pod restarts — api",m:"Rancher · pods",t:"31m",c:"#84ADFF"},
              {n:"Health check down",m:"URL probe + TLS",t:"1h",c:"#3DD68C"},
            ].map(r=>(
              <div key={r.n} style={V.row}>
                <span style={{...V.rowDot,background:r.c}}/>
                <span style={{flex:1,minWidth:0}}>
                  <span style={V.rowName}>{r.n}</span>
                  <span style={V.rowMeta}>{r.m}</span>
                </span>
                <span style={V.rowTime}>{r.t}</span>
                <Icon name="chevronRight" size={11} style={{color:"#5B6675"}}/>
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

  return (
    <div style={L.root}>
      {/* ── Left: sign-in ── */}
      <div style={L.left}>
        <div style={L.brandRow}>
          <img src="/ics-mark.svg" alt="ICS Compute" style={{width:34,height:34,borderRadius:8,display:"block"}}/>
          <div>
            <div style={L.brandName}>Portal Report</div>
            <div style={L.brandSub}>ICS Compute</div>
          </div>
        </div>

        <div style={L.formBody}>
          <div style={L.formInner}>
            <h1 style={L.heading}>Sign in</h1>
            <p style={L.subheading}>
              Use your operations account to access the reporting and alert console.
            </p>

            <form onSubmit={handleSubmit} style={L.form} noValidate>
              <div style={L.fieldGroup}>
                <label style={L.label} htmlFor="username">Username</label>
                <input id="username" style={L.input} type="text" value={username}
                  onChange={e=>setUsername(e.target.value)}
                  autoFocus autoComplete="username" placeholder="e.g. engineer.name"/>
              </div>

              <div style={L.fieldGroup}>
                <label style={L.label} htmlFor="password">Password</label>
                <div style={{position:"relative"}}>
                  <input id="password" style={{...L.input,paddingRight:42}}
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

              <button type="submit" style={{
                ...L.submitBtn,
                opacity:(loading||!username||!password)?.45:1,
                cursor:(loading||!username||!password)?"not-allowed":"pointer",
              }} disabled={loading||!username||!password}>
                {loading
                  ? <><span className="spinner" style={{width:13,height:13,borderWidth:1.6}}/> Signing in…</>
                  : <>Sign in <Icon name="arrowRight" size={14}/></>}
              </button>
            </form>
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
            <h2 style={L.heroTitle}>Every alert has a next step.</h2>
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
               background:"var(--bg)",fontFamily:"var(--font)",color:"var(--text)"},
  left:       {width:"42%",minWidth:380,maxWidth:520,background:"var(--bg2)",
               borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column",flexShrink:0},
  brandRow:   {display:"flex",alignItems:"center",gap:11,padding:"22px 32px"},
  brandName:  {fontSize:13.5,fontWeight:700,letterSpacing:"-.02em",color:"var(--text)",lineHeight:1.2},
  brandSub:   {fontSize:10.5,color:"var(--muted)",marginTop:1},
  formBody:   {flex:1,display:"flex",flexDirection:"column",justifyContent:"center",
               padding:"0 48px 6%",overflow:"hidden"},
  formInner:  {width:"100%",maxWidth:340,margin:"0 auto"},
  heading:    {fontSize:26,fontWeight:700,letterSpacing:"-.035em",color:"var(--text)",marginBottom:8},
  subheading: {fontSize:12.5,color:"var(--muted)",lineHeight:1.65,marginBottom:26},
  form:       {display:"flex",flexDirection:"column",gap:15},
  fieldGroup: {display:"flex",flexDirection:"column"},
  label:      {fontSize:11,fontWeight:600,color:"var(--text4)",marginBottom:6},
  input:      {width:"100%",background:"var(--surface2)",border:"1px solid var(--border2)",
               color:"var(--text)",fontFamily:"inherit",fontSize:13,
               padding:"11px 13px",borderRadius:8,outline:"none",
               boxSizing:"border-box",transition:"border-color .15s,box-shadow .15s"},
  eyeBtn:     {position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",
               background:"none",border:"none",cursor:"pointer",color:"var(--muted)",
               padding:7,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6},
  errBox:     {display:"flex",alignItems:"center",gap:8,fontSize:12,
               background:"var(--red-dim)",color:"var(--red)",
               border:"1px solid var(--border2)",padding:"10px 12px",borderRadius:8},
  rememberLabel:{fontSize:11.5,color:"var(--muted)",cursor:"pointer",userSelect:"none"},
  submitBtn:  {background:"var(--accent)",color:"#fff",border:"none",fontFamily:"inherit",
               fontSize:13,fontWeight:600,padding:"12px",borderRadius:8,
               display:"flex",alignItems:"center",justifyContent:"center",gap:8,
               transition:"background .15s",marginTop:3,letterSpacing:".01em"},
  footer:     {display:"flex",alignItems:"center",justifyContent:"space-between",
               padding:"16px 32px",borderTop:"1px solid var(--border)",
               fontSize:10.5,color:"var(--muted3)"},
  footerMeta: {fontSize:10,color:"var(--muted3)"},

  right:      {flex:1,position:"relative",overflow:"hidden",display:"flex",
               background:"#0B0D11",color:"#F2F4F7"},
  grid:       {position:"absolute",inset:0,pointerEvents:"none",opacity:.55,
               backgroundImage:"linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)",
               backgroundSize:"56px 56px",
               maskImage:"radial-gradient(ellipse at 60% 35%, #000 30%, transparent 78%)",
               WebkitMaskImage:"radial-gradient(ellipse at 60% 35%, #000 30%, transparent 78%)"},
  rightContent:{position:"relative",zIndex:1,flex:1,display:"flex",flexDirection:"column",
               justifyContent:"center",gap:26,padding:"48px 56px",overflow:"hidden",maxWidth:760,margin:"0 auto"},
  heroCopy:   {maxWidth:540},
  eyebrow:    {fontSize:10,fontWeight:700,letterSpacing:".16em",color:"#8D99AC",marginBottom:10},
  heroTitle:  {fontSize:30,fontWeight:700,letterSpacing:"-.035em",lineHeight:1.15,color:"#F7F8FA",marginBottom:12},
  heroDesc:   {fontSize:13,color:"#98A2B3",lineHeight:1.7,maxWidth:500},
  features:   {display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:18,
               borderTop:"1px solid rgba(255,255,255,.08)",paddingTop:22},
  feature:    {display:"flex",gap:10,alignItems:"flex-start"},
  featureIcon:{width:30,height:30,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",
               background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",
               color:"#C7CED9",flexShrink:0},
  featureTitle:{fontSize:11.5,fontWeight:600,color:"#E4E7EC",marginBottom:3},
  featureDesc:{fontSize:10.5,color:"#8D99AC",lineHeight:1.55},
};

const V = {
  frame:      {background:"#12161C",border:"1px solid #2A323D",borderRadius:12,
               overflow:"hidden",boxShadow:"0 28px 70px rgba(0,0,0,.45)",maxWidth:620},
  titlebar:   {display:"flex",alignItems:"center",gap:6,padding:"10px 14px",
               borderBottom:"1px solid #222A34",background:"#0F1318"},
  dot:        {width:7,height:7,borderRadius:"50%",background:"#3A4451"},
  titleText:  {fontSize:9.5,color:"#667085",fontWeight:600,letterSpacing:".02em"},
  body:       {display:"flex",minHeight:250},
  side:       {width:42,borderRight:"1px solid #222A34",padding:"10px 0",
               display:"flex",flexDirection:"column",alignItems:"center",gap:8,background:"#0F1318"},
  brand:      {marginBottom:6},
  sideItem:   {width:24,height:24,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",
               color:"#5B6675"},
  sideItemOn: {background:"rgba(229,72,77,.14)",color:"#F97066"},
  main:       {flex:1,padding:"14px 16px",minWidth:0},
  mainHead:   {display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12},
  h1:         {fontSize:12.5,fontWeight:650,color:"#E4E7EC",letterSpacing:"-.01em"},
  h2:         {fontSize:9.5,color:"#667085",marginTop:2},
  live:       {display:"flex",alignItems:"center",gap:5,fontSize:9.5,fontWeight:600,color:"#3DD68C"},
  liveDot:    {width:5,height:5,borderRadius:"50%",background:"#3DD68C",boxShadow:"0 0 0 3px rgba(61,214,140,.12)"},
  stats:      {display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12},
  stat:       {background:"#171C23",border:"1px solid #232B35",borderRadius:7,padding:"8px 10px"},
  statVal:    {fontSize:15,fontWeight:700,letterSpacing:"-.02em"},
  statKey:    {fontSize:8.5,color:"#667085",textTransform:"uppercase",letterSpacing:".06em",marginTop:1},
  rows:       {display:"flex",flexDirection:"column",gap:5},
  row:        {display:"flex",alignItems:"center",gap:8,background:"#171C23",
               border:"1px solid #232B35",borderRadius:6,padding:"7px 9px"},
  rowDot:     {width:5,height:5,borderRadius:"50%",flexShrink:0},
  rowName:    {display:"block",fontSize:10,fontWeight:550,color:"#D0D5DD",
               overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
  rowMeta:    {display:"block",fontSize:8.5,color:"#667085",marginTop:1,
               overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
  rowTime:    {fontSize:8.5,color:"#667085",flexShrink:0},
};
