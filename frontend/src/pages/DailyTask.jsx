import React, { useState, useEffect, useCallback } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { logActivity } from "../activityLog.js";
import { localISODate } from "../api.js";

/* ── Constants ── */
const OLD_STORAGE_KEY = "portal_report_daily_tasks";
const STATUS_OPTIONS  = ["In Progress", "Close", "Pending", "Cancelled"];
const STATUS_STYLE    = {
  "Close":       { bg:"var(--green-dim)", text:"var(--green)", border:"var(--border2)" },
  "In Progress": { bg:"var(--blue-dim)",  text:"var(--blue)",  border:"var(--border2)" },
  "Pending":     { bg:"var(--amber-dim)", text:"var(--amber)", border:"var(--border2)" },
  "Cancelled":   { bg:"var(--red-dim)",   text:"var(--red)",   border:"var(--border2)" },
};

/* ── API helpers ── */
const apiGet    = ()            => fetch("/api/tasks").then(r => r.json());
const apiCreate = (task)        => fetch("/api/tasks",            { method:"POST",   headers:{"Content-Type":"application/json"}, body:JSON.stringify(task)   }).then(r => r.json());
const apiUpdate = (id, changes) => fetch(`/api/tasks/${id}`,      { method:"PUT",    headers:{"Content-Type":"application/json"}, body:JSON.stringify(changes)}).then(r => r.json());
const apiDelete = (id)          => fetch(`/api/tasks/${id}`,      { method:"DELETE" }).then(r => r.json());
const apiRequestDelete  = (id, user) => fetch(`/api/tasks/${id}/request-delete`,  { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(user)  }).then(r => r.json());
const apiApproveDelete  = (id, action) => fetch(`/api/tasks/${id}/approve-delete`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action}) }).then(r => r.json());
const apiPendingDeletes = ()    => fetch("/api/tasks/pending-deletes").then(r => r.json());

/* ── One-time migration: DISABLED — data lama sudah dibersihkan ── */
async function migrateLocalStorage() {
  localStorage.removeItem("pr_tasks_migrated"); // reset flag juga
}

/* ── Export CSV ── */
function exportCSV(tasks, label) {
  const headers = ["No","Customer","Description","Date","Start","End","PIC","Status","Detail"];
  const rows    = tasks.map((t,i) => [
    i+1, t.customer||"", t.description||"", t.date||"",
    t.start||"", t.end||"", t.pic||"", t.status||"",
    (t.detail||"").replace(/\n/g," | "),
  ]);
  const csv  = [headers,...rows].map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8;"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href=url; a.download=`tickets_${label}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* ── Download Modal ── */
function DownloadModal({ tasks, onClose }) {
  const now  = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`);
  const [mode,  setMode]  = useState("month");
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const filtered  = mode==="all" ? tasks : tasks.filter(t=>(t.date||"").startsWith(month));
  const monthLabel= mode==="all" ? "all" : (()=>{ const [y,m]=month.split("-"); return `${MONTH_NAMES[parseInt(m)-1]}_${y}`; })();

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
      <div style={{background:"var(--surface)",border:"1px solid var(--border2)",borderRadius:10,width:400,overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 18px",borderBottom:"1px solid var(--border)"}}>
          <span style={{width:30,height:30,borderRadius:7,background:"var(--surface2)",color:"var(--text4)",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Icon name="download" size={15}/>
          </span>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:650,color:"var(--text)"}}>Download tickets</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>Export the current ticket data to CSV.</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",padding:4}}>
            <Icon name="close" size={15}/>
          </button>
        </div>
        <div style={{padding:"16px"}}>
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {[["month","By month"],["all","All data"]].map(([v,l])=>(
              <button key={v} onClick={()=>setMode(v)} style={{flex:1,padding:"7px 0",borderRadius:6,cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,background:mode===v?"var(--accent)":"var(--surface2)",border:mode===v?"1px solid var(--accent)":"1px solid var(--border2)",color:mode===v?"#fff":"var(--muted)"}}>{l}</button>
            ))}
          </div>
          {mode==="month" && (
            <div style={{marginBottom:14}}>
              <label style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".06em"}}>Select month</label>
              <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text3)",fontSize:11,padding:"6px 10px",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
            </div>
          )}
          <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 14px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:11,color:"var(--muted)"}}>Total tickets</span>
            <span style={{fontSize:16,fontWeight:700,color:"var(--text2)"}}>{filtered.length}</span>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            {[{label:"Close",val:filtered.filter(t=>t.status==="Close").length,c:"var(--green)"},{label:"In Progress",val:filtered.filter(t=>t.status==="In Progress").length,c:"var(--blue)"},{label:"Pending",val:filtered.filter(t=>t.status==="Pending").length,c:"var(--amber)"},{label:"Cancelled",val:filtered.filter(t=>t.status==="Cancelled").length,c:"var(--red)"}].map(s=>(
              <div key={s.label} style={{flex:1,textAlign:"center",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:6,padding:"6px 4px"}}>
                <div style={{fontSize:15,fontWeight:700,color:s.c}}>{s.val}</div>
                <div style={{fontSize:9,color:"var(--muted2)",marginTop:2}}>{s.label}</div>
              </div>
            ))}
          </div>
          <button disabled={filtered.length===0} onClick={()=>{exportCSV(filtered,monthLabel);onClose();}} style={{width:"100%",background:filtered.length===0?"var(--surface2)":"var(--accent)",border:"none",borderRadius:6,color:filtered.length===0?"var(--muted)":"#fff",fontFamily:"inherit",fontSize:12,fontWeight:600,padding:"10px 0",cursor:filtered.length===0?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            <Icon name="download" size={12}/>
            {filtered.length===0?"No data available":`Download CSV (${filtered.length} tickets)`}
          </button>
        </div>
      </div>
    </div>
  );
}

const makeEmptyForm = () => ({
  customer:"", description:"", date:"", start:"", end:"",
  pic: sessionStorage.getItem("pr_display") || sessionStorage.getItem("pr_user") || "",
  status:"In Progress", detail:""
});

export default function DailyTask({ customers }) {
  const role    = sessionStorage.getItem("pr_role") || "engineer";
  const isAdmin = role === "admin" || (sessionStorage.getItem("pr_user") || "") === "admin";
  const currentUser    = sessionStorage.getItem("pr_user")    || "";
  const currentDisplay = sessionStorage.getItem("pr_display") || currentUser;

  const [tasks,          setTasks]          = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [showModal,      setShowModal]      = useState(false);
  const [editId,         setEditId]         = useState(null);
  const [form,           setForm]           = useState(makeEmptyForm);
  const [filterDate,     setFilterDate]     = useState("");
  const [filterCust,     setFilterCust]     = useState("");
  const [filterSt,       setFilterSt]       = useState("");
  const [search,         setSearch]         = useState("");
  const [viewTask,       setViewTask]       = useState(null);
  const [showDownload,   setShowDownload]   = useState(false);
  const [pendingDeletes, setPendingDeletes] = useState([]); // [{task_id, task_desc, requested_by, ...}]
  const [showPending,    setShowPending]    = useState(false);

  const today = localISODate();

  /* ── Load tasks dari API ── */
  const loadTasks = useCallback(async () => {
    try {
      const data = await apiGet();
      setTasks(Array.isArray(data) ? data : []);
    } catch(_) {}
    setLoading(false);
  }, []);

  const loadPendingDeletes = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await apiPendingDeletes();
      setPendingDeletes(Array.isArray(data) ? data : []);
    } catch(_) {}
  }, [isAdmin]);

  useEffect(() => {
    migrateLocalStorage().then(() => loadTasks());
    loadPendingDeletes();
    const iv = setInterval(() => { loadTasks(); loadPendingDeletes(); }, 30000);
    return () => clearInterval(iv);
  }, [loadTasks, loadPendingDeletes]);

  /* ── Create / Edit ── */
  const openCreate = () => {
    setEditId(null);
    setForm({ ...makeEmptyForm(), date: today });
    setShowModal(true);
  };
  const openEdit = (t) => { setEditId(t.id); setForm({...t}); setShowModal(true); };

  const handleSubmit = async () => {
    if (!form.customer || !form.description) return;
    if (editId) {
      await apiUpdate(editId, form);
      logActivity("Edit Ticket", "task", `${form.description} — ${form.customer}`);
    } else {
      await apiCreate({ ...form, createdAt: new Date().toISOString() });
      logActivity("Create Ticket", "task", `[${form.customer}] ${form.description}${form.detail ? " — "+form.detail.slice(0,80):""}`);
    }
    setShowModal(false);
    setEditId(null);
    loadTasks();
  };

  const handleDelete = async (id) => {
    const t = tasks.find(t => t.id === id);
    if (isAdmin) {
      // Admin langsung hapus
      if (!window.confirm(`Delete ticket ${t?.taskNo || id}?`)) return;
      await apiDelete(id);
      if (viewTask?.id === id) setViewTask(null);
      loadTasks();
      loadPendingDeletes();
    } else {
      // Engineer kirim request
      if (!window.confirm(`Request deletion for ticket ${t?.taskNo || id}?\nAdmin will need to approve.`)) return;
      const res = await apiRequestDelete(id, { username: currentUser, display: currentDisplay });
      if (res.status === "already_requested") {
        alert("Delete request already sent. Waiting for admin approval.");
      } else {
        alert("Delete request sent. Admin will review your request.");
        logActivity("Request Delete Ticket", "task", `${t?.description || id} (${t?.taskNo || ""})`);
      }
    }
  };

  const handleApproveDelete = async (taskId, action) => {
    await apiApproveDelete(taskId, action);
    loadTasks();
    loadPendingDeletes();
  };

  const handleStatusChange = async (id, status) => {
    const t = tasks.find(t => t.id === id);
    await apiUpdate(id, { status });
    if (t) logActivity("Update Ticket Status", "task", `${t.description} → ${status}`);
    // Optimistic update
    setTasks(p => p.map(x => x.id===id ? {...x,status} : x));
  };

  /* ── Filtered ── */
  const query = search.trim().toLowerCase();
  const filtered = tasks.filter(t => {
    if (query) {
      const hay = `${t.taskNo||""} ${t.customer||""} ${t.description||""} ${t.detail||""} ${t.pic||""} ${t.status||""} ${t.date||""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (filterDate && t.date !== filterDate) return false;
    if (filterCust && t.customer !== filterCust) return false;
    if (filterSt   && t.status  !== filterSt)   return false;
    return true;
  });

  const total      = tasks.length;
  const done       = tasks.filter(t=>t.status==="Close").length;
  const inProg     = tasks.filter(t=>t.status==="In Progress").length;
  const pending    = tasks.filter(t=>t.status==="Pending").length;
  const todayTasks = tasks.filter(t=>t.date===today).length;
  const allCustomers = [...new Set(tasks.map(t=>t.customer).filter(Boolean))];

  return (
    <div style={T.root}>

      {/* ── HEADER ── */}
      <PageHeader
        icon="ticket"
        title="Tickets"
        subtitle={`${new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}${todayTasks > 0 ? ` · ${todayTasks} ticket${todayTasks>1?"s":""} today` : ""}`}
        actions={
          <>
            <button onClick={loadTasks} style={{...T.addBtn,background:"var(--surface2)",border:"1px solid var(--border2)",color:"var(--text4)"}} title="Refresh">
              <Icon name="refresh" size={13}/>
            </button>
            <button style={{...T.addBtn,background:"var(--surface2)",border:"1px solid var(--border2)",color:"var(--text4)"}} onClick={()=>setShowDownload(true)}>
              <Icon name="download" size={13}/> Download
            </button>
            {isAdmin && pendingDeletes.length > 0 && (
              <button onClick={()=>setShowPending(true)} style={{
                ...T.addBtn, background:"var(--red-dim)",
                border:"1px solid var(--border2)", color:"var(--red)",
              }}>
                <Icon name="trash" size={13}/> Delete requests
                <span style={{background:"var(--red)",color:"#fff",fontSize:10,fontWeight:700,
                  padding:"1px 6px",borderRadius:10,lineHeight:1.4}}>
                  {pendingDeletes.length}
                </span>
              </button>
            )}
            <button style={T.addBtn} onClick={openCreate}>
              <Icon name="plus" size={13}/> Create ticket
            </button>
          </>
        }
      />

      {/* ── STAT CARDS ── */}
      <div style={T.statRow}>
        {[
          {label:"Total tickets",  val:total,      c:"var(--text)",   icon:"ticket"},
          {label:"Closed",         val:done,       c:"var(--green)",  icon:"checkCircle"},
          {label:"In progress",    val:inProg,     c:"var(--blue)",   icon:"clock"},
          {label:"Pending",        val:pending,    c:"var(--amber)",  icon:"warning"},
          {label:"Today's tickets",val:todayTasks, c:"var(--accent)", icon:"calendar"},
        ].map((s,i)=>(
          <div key={i} style={T.statCard}>
            <span style={{...T.statIcon, color:s.c}}><Icon name={s.icon} size={15}/></span>
            <div style={{minWidth:0}}>
              <div style={{...T.statVal, color:s.c}}>{s.val}</div>
              <div style={T.statLabel}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── FILTERS ── */}
      <div style={T.filterRow}>
        <div style={T.filterLabel}>FILTER:</div>
        <div style={T.searchWrap}>
          <span style={T.searchIcon}><Icon name="search" size={12}/></span>
          <input
            type="text"
            style={T.searchInput}
            value={search}
            onChange={e=>setSearch(e.target.value)}
            placeholder="Search ticket no, customer, description…"
            aria-label="Search tickets"
          />
          {search && <button style={T.searchClear} onClick={()=>setSearch("")} title="Clear search">
            <Icon name="close" size={11}/>
          </button>}
        </div>
        <input type="date" style={T.filterInput} value={filterDate} onChange={e=>setFilterDate(e.target.value)}/>
        <select style={T.filterInput} value={filterCust} onChange={e=>setFilterCust(e.target.value)}>
          <option value="">All Customers</option>
          {[...customers.map(c=>c.name),...allCustomers].filter((v,i,a)=>a.indexOf(v)===i).map(c=><option key={c}>{c}</option>)}
        </select>
        <select style={T.filterInput} value={filterSt} onChange={e=>setFilterSt(e.target.value)}>
          <option value="">All Status</option>
          {STATUS_OPTIONS.map(s=><option key={s}>{s}</option>)}
        </select>
        {(search||filterDate||filterCust||filterSt) && (
          <button style={T.clearFilterBtn} onClick={()=>{setSearch("");setFilterDate("");setFilterCust("");setFilterSt("");}}>× Clear</button>
        )}
        <span style={{fontSize:10,color:"var(--muted3)",marginLeft:"auto"}}>{filtered.length} of {total} tickets</span>
      </div>

      {/* ── TABLE ── */}
      <div style={T.tableWrap}>
        {loading ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"40px",color:"var(--muted)",gap:10}}>
            <span className="spinner" style={{width:16,height:16}}/>Loading tickets…
          </div>
        ) : (
          <table style={T.table}>
            <thead>
              <tr>{["No Ticket","Customer","Ticket Description","Date","Start","End","PIC","Status","Actions"].map(h=>(
                <th key={h} style={T.th}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {filtered.length===0 ? (
                <tr><td colSpan={9} style={{textAlign:"center",padding:"32px",color:"var(--muted3)",fontSize:12,fontStyle:"italic"}}>
                  {tasks.length===0 ? 'No tickets yet — click "Create ticket" to add one' : "No tickets match the current filter"}
                </td></tr>
              ) : filtered.map((t,i)=>(
                <tr key={t.id}
                  style={{background:i%2===0?"transparent":"var(--row-alt)",transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--row-hover)"}
                  onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":"var(--row-alt)"}>
                  <td style={{...T.td,fontFamily:"var(--mono)",color:"var(--accent)",fontWeight:600}}>{t.taskNo}</td>
                  <td style={T.td}>
                    <span style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:4,background:"var(--accent-soft)",color:"var(--accent)",border:"1px solid var(--border)"}}>{t.customer||"—"}</span>
                  </td>
                  <td style={{...T.td,maxWidth:220}}>
                    <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:11,color:"var(--text3)"}} title={t.description}>{t.description}</div>
                    {t.detail && <div style={{fontSize:9,color:"var(--muted2)",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={t.detail}>{t.detail}</div>}
                  </td>
                  <td style={{...T.td,fontFamily:"var(--mono)",fontSize:10,color:"var(--muted)"}}>{t.date||"—"}</td>
                  <td style={{...T.td,fontFamily:"var(--mono)",fontSize:10,color:"var(--muted)"}}>{t.start||"—"}</td>
                  <td style={{...T.td,fontFamily:"var(--mono)",fontSize:10,color:"var(--muted)"}}>{t.end||"—"}</td>
                  <td style={{...T.td,fontSize:11,color:"var(--text4)"}}>{t.pic||"—"}</td>
                  <td style={T.td}>
                    <select value={t.status} onChange={e=>handleStatusChange(t.id,e.target.value)}
                      style={{background:STATUS_STYLE[t.status]?.bg||"var(--surface2)",color:STATUS_STYLE[t.status]?.text||"var(--text4)",border:`1px solid ${STATUS_STYLE[t.status]?.border||"var(--border2)"}`,fontFamily:"inherit",fontSize:10,fontWeight:600,padding:"3px 8px",borderRadius:5,cursor:"pointer",outline:"none"}}>
                      {STATUS_OPTIONS.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={T.td}>
                    <div style={{display:"flex",gap:5}}>
                      <button style={T.editBtn} onClick={()=>openEdit(t)} title="Edit">
                        <Icon name="edit" size={12}/>
                      </button>
                      <button style={T.viewBtn} onClick={()=>setViewTask(t)} title="View">
                        <Icon name="eye" size={12}/>
                      </button>
                      {pendingDeletes.some(p => p.task_id === t.id) ? (
                        <span style={{...T.delBtn,cursor:"default",opacity:.6,fontSize:9,
                          width:"auto",padding:"0 5px",whiteSpace:"nowrap"}}
                          title="Waiting for admin approval">Pending</span>
                      ) : (
                        <button
                          style={{...T.delBtn,
                            ...(isAdmin ? {} : {background:"var(--amber-dim)",color:"var(--amber)"})
                          }}
                          onClick={()=>handleDelete(t.id)}
                          title={isAdmin ? "Delete" : "Request deletion"}>
                          <Icon name={isAdmin ? "trash" : "warning"} size={12}/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── CREATE/EDIT MODAL ── */}
      {showModal && (
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" style={{width:540,maxWidth:"95vw"}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span style={{display:"inline-flex",alignItems:"center",gap:7}}>
                <Icon name={editId ? "edit" : "plus"} size={14}/>
                {editId ? "Edit ticket" : "Create ticket"}
              </span>
              <button className="modal-close" onClick={()=>setShowModal(false)}>
                <Icon name="close" size={14}/>
              </button>
            </div>
            <div className="modal-body" style={{gap:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <label className="form-label">Customer *</label>
                  <select className="form-input" value={form.customer} onChange={e=>setForm(p=>({...p,customer:e.target.value}))}>
                    <option value="">— Select —</option>
                    {customers.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">PIC</label>
                  <select className="form-input" value={form.pic} onChange={e=>setForm(p=>({...p,pic:e.target.value}))}>
                    <option value="">— Select —</option>
                    {["Admin","Suhendi","Priyanto","Neal Hotama","Nazran Hisyami"].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="form-label">Ticket Description *</label>
                <input className="form-input" value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="Brief ticket description"/>
              </div>
              <div>
                <label className="form-label">Detail / Notes</label>
                <textarea className="form-input" style={{height:64,resize:"vertical",fontFamily:"inherit",fontSize:12}} value={form.detail} onChange={e=>setForm(p=>({...p,detail:e.target.value}))} placeholder="Additional details..."/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                <div><label className="form-label">Date</label><input className="form-input" type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
                <div><label className="form-label">Start Time</label><input className="form-input" type="time" value={form.start} onChange={e=>setForm(p=>({...p,start:e.target.value}))}/></div>
                <div><label className="form-label">End Time</label><input className="form-input" type="time" value={form.end} onChange={e=>setForm(p=>({...p,end:e.target.value}))}/></div>
              </div>
              <div>
                <label className="form-label">Status</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {STATUS_OPTIONS.map(s=>(
                    <button key={s} onClick={()=>setForm(p=>({...p,status:s}))} style={{background:form.status===s?STATUS_STYLE[s].bg:"rgba(255,255,255,.03)",color:form.status===s?STATUS_STYLE[s].text:"var(--muted)",border:`1px solid ${form.status===s?STATUS_STYLE[s].border:"var(--border2)"}`,fontFamily:"inherit",fontSize:11,fontWeight:600,padding:"5px 14px",borderRadius:6,cursor:"pointer",transition:"all .15s"}}>{s}</button>
                  ))}
                </div>
              </div>
              <button className="btn-primary" onClick={handleSubmit} disabled={!form.customer||!form.description}>
                <Icon name="check" size={12}/>
                {editId ? "Save changes" : "Create ticket"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW DETAIL MODAL ── */}
      {viewTask && (
        <div className="modal-overlay" onClick={()=>setViewTask(null)}>
          <div className="modal" style={{width:480}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span style={{fontFamily:"var(--mono)",color:"var(--accent)"}}>{viewTask.taskNo}</span>
              <button className="modal-close" onClick={()=>setViewTask(null)}>
                <Icon name="close" size={14}/>
              </button>
            </div>
            <div className="modal-body">
              {[["Customer",viewTask.customer],["Description",viewTask.description],["Date",viewTask.date],["Start",viewTask.start],["End",viewTask.end],["PIC",viewTask.pic],["Status",viewTask.status]].map(([k,v])=>v?(
                <div key={k} style={{display:"flex",gap:12,padding:"7px 0",borderBottom:"1px solid var(--border)"}}>
                  <span style={{fontSize:10,fontWeight:700,color:"var(--muted2)",textTransform:"uppercase",letterSpacing:".06em",minWidth:90,flexShrink:0}}>{k}</span>
                  <span style={{fontSize:11,color:"var(--text3)"}}>{v}</span>
                </div>
              ):null)}
              {viewTask.detail && (
                <div style={{marginTop:10}}>
                  <div style={{fontSize:10,fontWeight:700,color:"var(--muted2)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>DETAIL / NOTES</div>
                  <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.7,background:"var(--bg3)",padding:"10px 12px",borderRadius:6}}>{viewTask.detail}</div>
                </div>
              )}
              <div style={{display:"flex",gap:8,marginTop:4}}>
                <button className="btn-primary" style={{flex:1}} onClick={()=>{setViewTask(null);openEdit(viewTask);}}>
                  <Icon name="edit" size={12}/> Edit ticket
                </button>
                <button style={{flex:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:5,background:"var(--red-dim)",color:"var(--red)",border:"1px solid var(--border2)",fontFamily:"inherit",fontSize:12,fontWeight:500,padding:"9px",borderRadius:6,cursor:"pointer"}} onClick={()=>handleDelete(viewTask.id)}>
                  <Icon name="trash" size={12}/> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDownload && <DownloadModal tasks={tasks} onClose={()=>setShowDownload(false)}/>}

      {/* ── Pending Delete Requests Modal (admin only) ── */}
      {showPending && isAdmin && (
        <div className="modal-overlay" onClick={()=>setShowPending(false)}>
          <div className="modal" style={{width:560,maxWidth:"95vw"}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span style={{display:"inline-flex",alignItems:"center",gap:7}}>
                <Icon name="trash" size={14}/> Delete requests
              </span>
              <button className="modal-close" onClick={()=>setShowPending(false)}>
                <Icon name="close" size={14}/>
              </button>
            </div>
            <div className="modal-body" style={{gap:8,padding:"14px 16px"}}>
              {pendingDeletes.length === 0 ? (
                <div style={{textAlign:"center",padding:"20px",color:"var(--muted)",fontSize:12,fontStyle:"italic"}}>
                  No pending delete requests
                </div>
              ) : pendingDeletes.map((req, i) => (
                <div key={req.task_id} style={{
                  display:"flex",alignItems:"center",gap:12,padding:"10px 12px",
                  background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,
                }}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:600,color:"var(--text3)"}}>
                      <span style={{fontFamily:"var(--mono)",color:"var(--accent)",marginRight:6}}>{req.task_no}</span>
                      {req.task_desc}
                    </div>
                    <div style={{fontSize:10,color:"var(--muted)",marginTop:3}}>
                      Requested by <strong style={{color:"var(--text4)"}}>{req.requested_by}</strong>
                      {" · "}{req.requested_at ? new Date(req.requested_at).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : ""}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    <button
                      onClick={async()=>{ await handleApproveDelete(req.task_id,"approve"); setShowPending(false); }}
                      style={{display:"inline-flex",alignItems:"center",gap:5,
                        background:"var(--green-dim)",color:"var(--green)",border:"1px solid var(--border2)",
                        fontFamily:"inherit",fontSize:11,fontWeight:600,padding:"5px 12px",
                        borderRadius:6,cursor:"pointer"}}>
                      <Icon name="check" size={11}/> Approve
                    </button>
                    <button
                      onClick={async()=>{ await handleApproveDelete(req.task_id,"reject"); loadPendingDeletes(); }}
                      style={{display:"inline-flex",alignItems:"center",gap:5,
                        background:"var(--red-dim)",color:"var(--red)",border:"1px solid var(--border2)",
                        fontFamily:"inherit",fontSize:11,fontWeight:600,padding:"5px 12px",
                        borderRadius:6,cursor:"pointer"}}>
                      <Icon name="close" size={11}/> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const T = {
  root:      {height:"100%",display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--bg)",fontFamily:"var(--font)"},
  header:    {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 24px 12px",borderBottom:"1px solid var(--border)",flexShrink:0,background:"var(--bg2)"},
  title:     {fontSize:18,fontWeight:650,letterSpacing:"-.02em",color:"var(--text)"},
  sub:       {fontSize:11.5,color:"var(--muted)",marginTop:2},
  addBtn:    {display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,
              background:"var(--accent)",color:"#fff",border:"none",fontFamily:"inherit",fontSize:12,
              fontWeight:600,padding:"8px 16px",borderRadius:7,cursor:"pointer",transition:"background .15s"},
  statRow:   {display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,padding:"12px 24px 4px",flexShrink:0},
  statCard:  {display:"flex",alignItems:"center",gap:11,background:"var(--bg2)",border:"1px solid var(--border)",
              borderRadius:10,padding:"12px 14px",boxShadow:"var(--shadow-card)",minWidth:0},
  statIcon:  {width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",
              background:"var(--surface2)",border:"1px solid var(--border)",flexShrink:0},
  statVal:   {fontSize:20,fontWeight:700,letterSpacing:"-.03em",lineHeight:1.15},
  statLabel: {fontSize:9.5,color:"var(--muted2)",marginTop:2,fontWeight:600,textTransform:"uppercase",
              letterSpacing:".05em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},
  filterRow: {display:"flex",alignItems:"center",gap:8,padding:"10px 24px",borderBottom:"1px solid var(--border)",flexShrink:0,flexWrap:"wrap"},
  filterLabel:{fontSize:9,fontWeight:700,letterSpacing:".1em",color:"var(--muted3)",textTransform:"uppercase",flexShrink:0},
  searchWrap:{position:"relative",display:"flex",alignItems:"center",flexShrink:0},
  searchIcon:{position:"absolute",left:9,display:"flex",alignItems:"center",color:"var(--muted2)",pointerEvents:"none"},
  searchInput:{width:250,background:"var(--bg2)",border:"1px solid var(--border2)",color:"var(--text3)",fontFamily:"inherit",fontSize:11,padding:"5px 26px 5px 28px",borderRadius:5,outline:"none",boxSizing:"border-box"},
  searchClear:{position:"absolute",right:4,display:"flex",alignItems:"center",background:"none",border:"none",color:"var(--muted2)",cursor:"pointer",padding:"2px 5px"},
  filterInput:{background:"var(--bg2)",border:"1px solid var(--border2)",color:"var(--text4)",fontFamily:"inherit",fontSize:11,padding:"5px 10px",borderRadius:5,outline:"none",cursor:"pointer"},
  clearFilterBtn:{background:"none",border:"1px solid var(--border2)",color:"var(--muted)",fontFamily:"inherit",fontSize:10,padding:"4px 10px",borderRadius:4,cursor:"pointer"},
  tableWrap: {flex:1,overflowY:"auto",margin:"12px 24px 20px",background:"var(--bg2)",
              border:"1px solid var(--border)",borderRadius:12,boxShadow:"var(--shadow-card)"},
  table:     {width:"100%",borderCollapse:"collapse",tableLayout:"fixed"},
  th:        {textAlign:"left",padding:"10px 12px",fontSize:9,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--muted3)",borderBottom:"1px solid var(--border)",background:"var(--bg3)",whiteSpace:"nowrap",position:"sticky",top:0,zIndex:1},
  td:        {padding:"8px 12px",fontSize:11,color:"var(--text4)",borderBottom:"1px solid var(--border)",verticalAlign:"middle"},
  editBtn:   {background:"var(--blue-dim)",color:"var(--blue)",border:"1px solid var(--border)",fontSize:11,width:26,height:26,borderRadius:5,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
  viewBtn:   {background:"var(--surface2)",color:"var(--muted)",border:"1px solid var(--border)",fontSize:11,width:26,height:26,borderRadius:5,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
  delBtn:    {background:"var(--red-dim)",color:"var(--red)",border:"1px solid var(--border)",fontSize:11,width:26,height:26,borderRadius:5,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
};
