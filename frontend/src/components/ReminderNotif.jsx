/**
 * ReminderNotif.jsx
 * Notifikasi reminder otomatis:
 *  1. Setiap Jumat  → "Sudah generate report hari ini?"
 *  2. Tgl 8/16/24/1 → "Sudah Generate Weekly Report Capture OCI week X?"
 *
 * Dismissed state disimpan di localStorage per user per trigger key.
 * Animasi: slide-in dari kanan, dengan stagger jika ada >1 notif.
 */
import React, { useState, useEffect } from "react";
import Icon from "./Icon.jsx";

/* ── CSS animation di-inject sekali ── */
const STYLE_ID = "reminder-notif-style";
if (!document.getElementById(STYLE_ID)) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
@keyframes notifSlideIn {
  from { transform: translateX(120%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
@keyframes notifSlideOut {
  from { transform: translateX(0);    opacity: 1; }
  to   { transform: translateX(120%); opacity: 0; }
}
.notif-card {
  animation: notifSlideIn .45s cubic-bezier(.16,1,.3,1) forwards;
}
.notif-card.leaving {
  animation: notifSlideOut .35s ease-in forwards;
}
  `;
  document.head.appendChild(s);
}

/* ── Helpers ── */
function getTodayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}
function getWeekNum(day) {
  if (day <= 7)  return 1;
  if (day <= 14) return 2; // week2 tgl 8
  if (day <= 21) return 3; // week3 tgl 16
  if (day <= 28) return 4; // week4 tgl 24
  return 1; // tgl 1 → week4 bulan lalu atau week1 baru
}

/**
 * Build list of active reminders for today.
 * Returns [] if nothing to show.
 */
function buildReminders(displayName, dismissedKeys) {
  const now     = new Date();
  const day     = now.getDate();
  const dow     = now.getDay();   // 0=Sun, 5=Fri
  const monthId = now.toISOString().slice(0, 7); // "YYYY-MM"
  const reminders = [];

  // ── 1. Setiap Jumat: reminder generate report ──
  if (dow === 5) {
    const key = `friday_report_${getTodayKey()}`;
    if (!dismissedKeys.has(key)) {
      reminders.push({
        id:    key,
        type:  "friday",
        title: "Weekly report reminder",
        message: `Hi ${displayName}, make sure this week's report has been generated before your shift ends.`,
        icon:  "report",
        color: "var(--accent)",
      });
    }
  }

  // ── 2. Tgl tertentu: reminder weekly capture OCI ──
  const DATE_WEEK_MAP = { 8: 2, 16: 3, 24: 4, 1: 1 };

  if (DATE_WEEK_MAP[day] !== undefined) {
    const weekNum = DATE_WEEK_MAP[day];
    const keyMonth = day === 1 ? (() => {
      const d = new Date(now); d.setMonth(d.getMonth() - 1);
      return d.toISOString().slice(0, 7);
    })() : monthId;
    const key = `weekly_oci_w${weekNum}_${keyMonth}`;
    if (!dismissedKeys.has(key)) {
      reminders.push({
        id:    key,
        type:  "weekly_oci",
        title: `OCI weekly capture — week ${weekNum}`,
        message: `Hi ${displayName}, please confirm that OCI Weekly Capture for week ${weekNum} has been generated and sent.`,
        icon:  "archive",
        color: "var(--blue)",
      });
    }
  }

  return reminders;
}

/* ── Single notification card ── */
function NotifCard({ notif, onDone, onDismiss, index }) {
  const [leaving, setLeaving] = useState(false);

  const close = (action) => {
    setLeaving(true);
    setTimeout(() => {
      if (action === "done") onDone(notif.id);
      else                   onDismiss(notif.id);
    }, 350);
  };

  return (
    <div
      className={`notif-card${leaving ? " leaving" : ""}`}
      style={{
        position:     "relative",
        background:   "var(--bg2)",
        border:       "1px solid var(--border2)",
        borderLeft:   `3px solid ${notif.color}`,
        borderRadius: 10,
        padding:      "14px 16px 13px",
        width:        340,
        boxShadow:    "var(--shadow-pop)",
        marginBottom: 10,
        animationDelay: `${index * 0.12}s`,
        animationFillMode: "both",
        overflow:     "hidden",
      }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:9 }}>
        <div style={{
          width:34, height:34, borderRadius:8,
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          display:"flex", alignItems:"center", justifyContent:"center",
          color: notif.color, flexShrink:0,
        }}><Icon name={notif.icon} size={16}/></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12, fontWeight:650, color:"var(--text)", letterSpacing:"-.01em" }}>
            {notif.title}
          </div>
          <div style={{ fontSize:10, color:"var(--muted)", marginTop:1 }}>
            {new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
          </div>
        </div>
        <button onClick={() => close("dismiss")}
          style={{ display:"flex", background:"none", border:"none", color:"var(--muted3)",
            cursor:"pointer", padding:"3px", flexShrink:0 }}>
          <Icon name="close" size={13}/>
        </button>
      </div>

      {/* Message */}
      <p style={{ fontSize:11.5, color:"var(--text4)", lineHeight:1.6, margin:"0 0 13px" }}>
        {notif.message}
      </p>

      {/* Action buttons */}
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={() => close("done")}
          style={{
            flex:1, background: notif.color, color:"#fff", border:"none",
            fontFamily:"inherit", fontSize:11, fontWeight:600,
            padding:"7px 0", borderRadius:6, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:5,
            transition:"filter .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.filter="brightness(1.08)"}
          onMouseLeave={e => e.currentTarget.style.filter="none"}>
          <Icon name="check" size={11}/> Done
        </button>
        <button onClick={() => close("dismiss")}
          style={{
            flex:1, background:"var(--surface2)", color:"var(--text4)",
            border:"1px solid var(--border2)",
            fontFamily:"inherit", fontSize:11, fontWeight:500,
            padding:"7px 0", borderRadius:6, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:5,
            transition:"background .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background="var(--surface3)"}
          onMouseLeave={e => e.currentTarget.style.background="var(--surface2)"}>
          <Icon name="clock" size={11}/> Remind later
        </button>
      </div>
    </div>
  );
}

/* ── Main component ── */
export default function ReminderNotif() {
  const displayName = sessionStorage.getItem("pr_display") || sessionStorage.getItem("pr_user") || "team";
  const username    = sessionStorage.getItem("pr_user") || "unknown";
  const STORAGE_KEY = `pr_notif_dismissed_${username}`;

  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")); }
    catch { return new Set(); }
  });
  const [active, setActive] = useState([]);

  useEffect(() => {
    const reminders = buildReminders(displayName, dismissed);
    setActive(reminders);
  }, [displayName]);

  const persistDismiss = (key, isDone) => {
    const next = new Set(dismissed);
    if (isDone) {
      // Mark as done — hapus dari active dan simpan ke dismissed
      next.add(key);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch {}
      setDismissed(next);
    }
    // Kalau belum (dismiss) — hilang dari tampilan tapi TIDAK disimpan ke dismissed
    // sehingga akan muncul lagi saat reload
    setActive(prev => prev.filter(n => n.id !== key));
  };

  if (!active.length) return null;

  return (
    <div style={{
      position:   "fixed",
      bottom:     24,
      right:      24,
      zIndex:     9999,
      display:    "flex",
      flexDirection: "column-reverse",
      alignItems: "flex-end",
      pointerEvents: "none",
    }}>
      {active.map((n, i) => (
        <div key={n.id} style={{ pointerEvents:"auto" }}>
          <NotifCard
            notif={n}
            index={i}
            onDone={id    => persistDismiss(id, true)}
            onDismiss={id => persistDismiss(id, false)}
          />
        </div>
      ))}
    </div>
  );
}
