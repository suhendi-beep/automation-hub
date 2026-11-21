import React, { useState, useEffect } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";

// Map automation ID → folder name
const FOLDER_MAP = {
  grafana_capture:    "Weekly Capture Grafana HO",
  oci_ilcs_backup:    "Weekly Backup Report OCI ILCS",
  oci_pelindo_backup: "Weekly Backup Report OCI Pelindo",
};

const FILE_FILTER = {
  grafana_capture:    n => n.includes("grafana"),
  oci_ilcs_backup:    n => n.includes("oci_ilcs") || (n.includes("ilcs") && !n.includes("status")),
  oci_pelindo_backup: n => n.includes("oci_pelindo"),
};

// Daily Backup Status now reports only through its live log, not an output file.
const LEGACY_DAILY_STATUS_FILE = /pelindo_daily_status/i;

function fileIcon(name) {
  if (name.endsWith(".pptx")) return "archive";
  if (name.endsWith(".docx")) return "file";
  if (name.endsWith(".zip"))  return "archive";
  return "file";
}

function fmtSize(kb) {
  if (kb >= 1024) return (kb/1024).toFixed(1) + " MB";
  return kb + " KB";
}

export default function FilesPage({ customer, navigate }) {
  const [files,    setFiles]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [openFolder, setOpenFolder] = useState(null); // aid or null = all open

  useEffect(() => {
    if (!customer) return;
    setLoading(true);
    fetch("/api/files/" + customer.id)
      .then(r => r.json())
      .then(d => {
        const all = [...(d.reports||[]), ...(d.screenshots||[])]
          .filter(f => !LEGACY_DAILY_STATUS_FILE.test(f.name))
          .sort((a,b) => new Date(b.created) - new Date(a.created));
        setFiles(all);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [customer?.id]);

  const downloadFile = async (f) => {
    try {
      const res = await fetch(f.download || `/api/download/reports/${encodeURIComponent(f.name)}`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (_) {
      // The global fetch wrapper already handles 401/expired sessions.
    }
  };

  if (!customer) return null;

  // Build folder structure
  const automations = (customer.automations || []).filter(a => a.id !== "daily_ilcs_status");
  const folders = automations.map(auto => {
    const filter = FILE_FILTER[auto.id] || (() => false);
    const folderFiles = files.filter(f => filter(f.name.toLowerCase()));
    return { auto, files: folderFiles };
  });

  // "Other" — files that don't match any folder
  const matched = new Set(folders.flatMap(f => f.files.map(fi => fi.name)));
  const otherFiles = files.filter(f => !matched.has(f.name));

  const totalFiles = files.length;
  const totalSize  = files.reduce((s,f) => s + f.size_kb, 0);

  return (
    <div style={F.root}>
      {/* ── TOPBAR ── */}
      <PageHeader
        icon="folder"
        title="Output files"
        subtitle={`${customer.name} · ${totalFiles} file${totalFiles!==1?"s":""} · ${fmtSize(totalSize)}`}
        actions={
          <>
            <button style={F.backBtn} onClick={() => navigate("customer", customer.id)}>
              <Icon name="arrowLeft" size={13}/> Back
            </button>
            <button style={F.iconBtn} onClick={() => {
              setLoading(true);
              fetch("/api/files/"+customer.id).then(r=>r.json())
                .then(d => {
                  const all=[...(d.reports||[]),...(d.screenshots||[])].sort((a,b)=>new Date(b.created)-new Date(a.created));
                  setFiles(all); setLoading(false);
                }).catch(()=>setLoading(false));
            }}><Icon name="refresh" size={12}/> Refresh</button>
          </>
        }
      />

      {/* ── CONTENT ── */}
      <div style={F.content}>
        {loading ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",flex:1,gap:10,color:"var(--muted3)"}}>
            <span className="spinner" style={{width:18,height:18,borderColor:"var(--muted3)",borderTopColor:"transparent"}}/>
            Loading files…
          </div>
        ) : (
          <div style={F.folderGrid}>
            {folders.map(({ auto, files: fFiles }) => {
              const isOpen = openFolder === null || openFolder === auto.id;
              const folderName = FOLDER_MAP[auto.id] || auto.name;
              return (
                <div key={auto.id} style={F.folderCard}>
                  {/* Folder header */}
                  <div style={F.folderHeader} onClick={() =>
                    setOpenFolder(prev => prev === auto.id ? null : auto.id)
                  }>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span style={{display:"flex",color:"var(--muted)"}}>
                        <Icon name={fFiles.length > 0 ? "folderOpen" : "folder"} size={18}/>
                      </span>
                      <div>
                        <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{folderName}</div>
                        <div style={{fontSize:10,color:"var(--muted)",marginTop:1}}>
                          {auto.output_type.toUpperCase()} · {fFiles.length} file{fFiles.length!==1?"s":""}
                          {fFiles.length > 0 && " · " + fmtSize(fFiles.reduce((s,f)=>s+f.size_kb,0))}
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {fFiles.length > 0 && (
                        <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:4,
                          background:"var(--surface2)",color:"var(--muted)",
                          border:"1px solid var(--border)"}}>
                          {fFiles.length}
                        </span>
                      )}
                      <span style={{display:"flex",color:"var(--muted3)",transition:"transform .2s",
                        transform: isOpen?"rotate(90deg)":"rotate(0deg)"}}>
                        <Icon name="chevronRight" size={13}/>
                      </span>
                    </div>
                  </div>

                  {/* File list */}
                  {isOpen && (
                    <div style={F.fileList}>
                      {fFiles.length === 0 ? (
                        <div style={F.emptyFolder}>
                          <span style={{display:"flex",color:"var(--border3)"}}><Icon name="folderOpen" size={18}/></span>
                          <span>No files yet. Run the automation first.</span>
                        </div>
                      ) : (
                        fFiles.map((f, i) => {
                          const ext = f.name.split(".").pop();
                          const extColors = {pptx:"var(--amber)",docx:"var(--blue)",pdf:"var(--red)"};
                          const extColor = extColors[ext] || "var(--muted)";
                          return (
                            <div key={i} style={{
                              ...F.fileRow,
                              borderBottom: i < fFiles.length-1 ? "1px solid var(--border)" : "none",
                            }}>
                              <span style={{display:"flex",color:"var(--muted)",flexShrink:0}}>
                                <Icon name={fileIcon(f.name)} size={16}/>
                              </span>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:12,color:"var(--text3)",fontFamily:"var(--mono)",
                                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                                  title={f.name}>{f.name}</div>
                                <div style={{display:"flex",gap:10,marginTop:2}}>
                                  <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",
                                    letterSpacing:".04em",color:extColor}}>{ext}</span>
                                  <span style={{fontSize:9,color:"var(--muted3)"}}>
                                    {new Date(f.created).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}
                                  </span>
                                </div>
                              </div>
                              <span style={{fontSize:11,color:"var(--muted)",flexShrink:0,minWidth:65,textAlign:"right"}}>
                                {fmtSize(f.size_kb)}
                              </span>
                              <button onClick={() => downloadFile(f)} style={F.dlBtn}
                                onMouseEnter={e=>{e.currentTarget.style.background="var(--accent-strong)"}}
                                onMouseLeave={e=>{e.currentTarget.style.background="var(--accent)"}}>
                                <Icon name="download" size={11}/> Download
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Other folder */}
            {otherFiles.length > 0 && (
              <div style={F.folderCard}>
                <div style={F.folderHeader} onClick={() =>
                  setOpenFolder(prev => prev === "other" ? null : "other")
                }>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{display:"flex",color:"var(--muted)"}}><Icon name="folderOpen" size={18}/></span>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>Other files</div>
                      <div style={{fontSize:10,color:"var(--muted)",marginTop:1}}>
                        {otherFiles.length} file{otherFiles.length!==1?"s":""}
                        {" · " + fmtSize(otherFiles.reduce((s,f)=>s+f.size_kb,0))}
                      </div>
                    </div>
                  </div>
                  <span style={{display:"flex",color:"var(--muted3)",
                    transform:(openFolder==="other")?"rotate(90deg)":"rotate(0deg)"}}>
                    <Icon name="chevronRight" size={13}/>
                  </span>
                </div>
                {(openFolder === null || openFolder === "other") && (
                  <div style={F.fileList}>
                    {otherFiles.map((f,i) => (
                      <div key={i} style={{...F.fileRow,borderBottom:i<otherFiles.length-1?"1px solid var(--border)":"none"}}>
                        <span style={{display:"flex",color:"var(--muted)",flexShrink:0}}>
                          <Icon name={fileIcon(f.name)} size={16}/>
                        </span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,color:"var(--text3)",fontFamily:"var(--mono)",
                            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                          <div style={{fontSize:9,color:"var(--muted3)",marginTop:2}}>
                            {new Date(f.created).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}
                          </div>
                        </div>
                        <span style={{fontSize:11,color:"var(--muted)",flexShrink:0,minWidth:65,textAlign:"right"}}>
                          {fmtSize(f.size_kb)}
                        </span>
                        <button onClick={() => downloadFile(f)} style={F.dlBtn}
                          onMouseEnter={e=>{e.currentTarget.style.background="var(--accent-strong)"}}
                          onMouseLeave={e=>{e.currentTarget.style.background="var(--accent)"}}>
                          <Icon name="download" size={11}/> Download
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {folders.every(f=>f.files.length===0) && otherFiles.length===0 && (
              <div style={{gridColumn:"1/-1",textAlign:"center",padding:"60px 0",color:"var(--muted3)"}}>
                <div style={{display:"flex",justifyContent:"center",marginBottom:16,color:"var(--border3)"}}>
                  <Icon name="folderOpen" size={40}/>
                </div>
                <div style={{fontSize:14,fontWeight:600,marginBottom:6,color:"var(--muted)"}}>No output files yet</div>
                <div style={{fontSize:12}}>Run an automation from the Jobs page to generate output files.</div>
                <button className="btn-primary" style={{marginTop:16,display:"inline-flex",alignItems:"center",gap:6}} onClick={()=>navigate("customer",customer.id)}>
                  Go to automation jobs <Icon name="arrowRight" size={12}/>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const F = {
  root:    {height:"100%",display:"flex",flexDirection:"column",background:"var(--bg)",fontFamily:"var(--font)",overflow:"hidden"},
  topbar:  {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 24px",borderBottom:"1px solid var(--border)",flexShrink:0,background:"var(--bg2)"},
  backBtn: {display:"inline-flex",alignItems:"center",gap:6,background:"var(--bg2)",border:"1px solid var(--border2)",color:"var(--text4)",fontFamily:"var(--font)",fontSize:12,padding:"6px 13px",borderRadius:7,cursor:"pointer"},
  iconBtn: {display:"inline-flex",alignItems:"center",gap:6,background:"var(--bg2)",border:"1px solid var(--border2)",color:"var(--text4)",fontFamily:"var(--font)",fontSize:11,padding:"6px 11px",borderRadius:7,cursor:"pointer"},
  content: {flex:1,overflowY:"auto",padding:"24px 28px 36px"},
  folderGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(430px,1fr))",gap:14,alignItems:"start",maxWidth:1300},
  folderCard:{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",boxShadow:"var(--shadow-card)"},
  folderHeader:{display:"flex",alignItems:"center",justifyContent:"space-between",
    padding:"14px 18px",cursor:"pointer",transition:"background .15s",
    userSelect:"none"},
  fileList:{padding:"0 18px 10px",borderTop:"1px solid var(--border)"},
  emptyFolder:{display:"flex",alignItems:"center",gap:10,padding:"16px 0",
    fontSize:11,color:"var(--muted3)",fontStyle:"italic"},
  fileRow: {display:"flex",alignItems:"center",gap:12,padding:"10px 0"},
  dlBtn:   {display:"inline-flex",alignItems:"center",gap:5,background:"var(--accent)",color:"#fff",
    border:"none",fontFamily:"var(--font)",fontSize:11,fontWeight:600,padding:"5px 12px",borderRadius:5,
    textDecoration:"none",flexShrink:0,whiteSpace:"nowrap",cursor:"pointer",transition:"background .15s"},
};
