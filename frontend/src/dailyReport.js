import { localISODate } from "./api.js";

/* Shared between the Alert Monitor and the Daily Report page. */

export function fmtTime(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit"
    });
  } catch { return iso.slice(0,16).replace("T"," "); }
}

export function shortName(name) {
  return (name||"")
    .replace(/^Resource\s+/i, "")
    .replace(/^Uptime\s+-\s+/i, "Uptime - ")
    .replace(/^DatasourceNoData$/i, "Datasource No Data")
    .replace(/^\[ALERT\]\s*/i, "")
    .replace(/\s{2,}/g, " ").trim();
}

/* ─── Ticket number generator ────────────────────────── */
const TICKET_KEY         = "pr_ticket_counter";
const TICKET_MAP_KEY     = "pr_alert_tickets"; // alertKey → ticketNumber
const TICKET_COOLDOWN_KEY = "pr_alert_ticket_cooldown";
const COOLDOWN_MS        = 60 * 60 * 1000; // 1 jam

/** Generate nomor baru INC-YYYYMMDD-XXXX, increment per hari */
function generateTicketNumber() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(TICKET_KEY) || "{}"); } catch { stored = {}; }

  if (stored.date !== today) {
    stored = { date: today, seq: 0 };
  }
  stored.seq = (stored.seq || 0) + 1;
  localStorage.setItem(TICKET_KEY, JSON.stringify(stored));

  return `INC-${today}-${String(stored.seq).padStart(4, "0")}`;
}

/** Cek apakah alert boleh dapat ticket/task baru */
export function canCreateTicket(alertKey) {
  let map = {};
  try { map = JSON.parse(localStorage.getItem(TICKET_COOLDOWN_KEY) || "{}"); } catch {}
  const last = map[alertKey];
  if (!last) return true;
  return (Date.now() - new Date(last).getTime()) > COOLDOWN_MS;
}

/** Catat timestamp pembuatan ticket */
export function recordTicketCreated(alertKey) {
  let map = {};
  try { map = JSON.parse(localStorage.getItem(TICKET_COOLDOWN_KEY) || "{}"); } catch {}
  map[alertKey] = new Date().toISOString();
  localStorage.setItem(TICKET_COOLDOWN_KEY, JSON.stringify(map));
}

/**
 * Ambil ticket untuk alert ini kalau sudah pernah dibuat,
 * atau generate baru dan simpan supaya konsisten dengan Daily Task.
 * Jika alert berulang dalam < 1 jam, kembalikan nomor lama (tidak generate baru).
 */
export function getOrCreateTicket(alertKey) {
  let map = {};
  try { map = JSON.parse(localStorage.getItem(TICKET_MAP_KEY) || "{}"); } catch { map = {}; }
  // Masih dalam cooldown — pakai nomor yang sama
  if (map[alertKey] && !canCreateTicket(alertKey)) return map[alertKey];
  // Sudah > 1 jam atau belum pernah → buat baru
  if (!map[alertKey] || canCreateTicket(alertKey)) {
    const num = generateTicketNumber();
    map[alertKey] = num;
    localStorage.setItem(TICKET_MAP_KEY, JSON.stringify(map));
    recordTicketCreated(alertKey);
    return num;
  }
  return map[alertKey];
}

/* ─── Handover report ────────────────────────────────── */
// Urutan folder sesuai format handover
export const REPORT_FOLDER_ORDER = [
  "OCI-ILCS", "OCI-HO", "GCP", "Huawei",
  "Centralized/OCI - HO", "alerts-BTP", "DMDC", "OCI-ILCS/YMS",
];
export const REPORT_FOLDER_LABELS = {
  "OCI-ILCS":             "OCI ILCS alerts",
  "OCI-HO":               "OCI HO alerts",
  "GCP":                  "GCP alerts",
  "Huawei":               "Huawei alerts",
  "Centralized/OCI - HO": "Non-Prometheus alerts",
  "alerts-BTP":           "EIC alerts",
  "DMDC":                 "DMDC alerts",
  "OCI-ILCS/YMS":         "OCI ILCS/YMS alerts",
};

export function fmtDateForReport(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" });
  } catch { return dateStr; }
}

export function buildDailyReport(alerts, opts) {
  const { tanggal, shift, engineer, closedTickets, backupStatus } = opts;
  const shiftLabel = shift === "1" ? "Shift 1 ( 09:00 - 21:00)" : "Shift 2 ( 21:00 - 09:00)";

  // group by folder
  const byFolder = {};
  for (const a of alerts) {
    if (!byFolder[a.folder]) byFolder[a.folder] = [];
    byFolder[a.folder].push(a);
  }

  // semua folder dari order list
  const allReportFolders = [
    ...REPORT_FOLDER_ORDER,
    ...Object.keys(byFolder).filter(f => !REPORT_FOLDER_ORDER.includes(f)),
  ];

  let detail = "";
  let totalAlert = 0;
  for (const folder of allReportFolders) {
    const label = REPORT_FOLDER_LABELS[folder] || `Alert ${folder}`;
    const items = byFolder[folder] || [];
    totalAlert += items.length;
    detail += `${label}\n`;
    if (items.length === 0) {
      detail += `- (no active alerts)\n`;
    } else {
      for (const a of items) {
        const res  = a.resource && a.resource !== "-" ? a.resource : "";
        const time = a.active_at ? ` [${fmtTime(a.active_at)}]` : "";
        // Ambil nomor ticket — generate jika belum ada
        const alertKey = `${a.name}||${a.resource}||${a.active_at}`;
        const ticketNum = getOrCreateTicket(alertKey);
        const ticketStr = ticketNum ? ` [${ticketNum}]` : "";
        detail += `* ${shortName(a.name)}${res ? " -> " + res : ""}${ticketStr}${time}\n`;
      }
    }
    detail += "\n";
  }

  // ── Ticket Close (count only) ──
  const closedCount = closedTickets?.length || 0;
  const ticketSection = `\n*2. Closed Tickets*\nTotal : ${closedCount}\n`;

  // ── Daily Backup Status ──
  let backupSection = "";
  if (backupStatus) {
    const { total, success, failed, rate, health, period, generated, fetchedAt, failedItems } = backupStatus;
    // Tanggal period yang dicek
    const periodStr = period || (fetchedAt ? localISODate(fetchedAt) : "-");
    // Waktu generate dari log, fallback ke fetchedAt
    const generatedStr = generated || (fetchedAt
      ? new Date(fetchedAt).toLocaleString("en-GB", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" }) + " WIB"
      : "-");
    backupSection = `\n*3. Daily Backup Status*\n`;
    backupSection += `Period       : ${periodStr}\n`;
    backupSection += `Generated    : ${generatedStr}\n`;
    backupSection += `Status       : ${health || "-"}\n`;
    backupSection += `Total        : ${total ?? "-"}\n`;
    backupSection += `Success      : ${success ?? "-"}\n`;
    backupSection += `Failed       : ${failed ?? "-"}\n`;
    backupSection += `Success Rate : ${rate ?? "-"}\n`;
    if (failedItems && failedItems.length > 0) {
      backupSection += `\nFailed Items:\n`;
      for (const name of failedItems) backupSection += `- ${name}\n`;
    }
  } else {
    backupSection = `\n*3. Daily Backup Status*\n- (data not available yet)\n`;
  }

  const sep  = "━━━━━━━━━━━━━━━━";
  const sep2 = "━━━━━━━━━━━";
  return `*Daily Report | Standby Monitoring Handover*
${sep}
Date     : ${tanggal || "(enter date)"}
Shift    : ${shiftLabel}
Engineer : ${engineer || "(enter name)"}
${sep2}
*1. Grafana Alerts*
Total Alerts : ${totalAlert}

Detail:
${detail.trimEnd()}
${ticketSection.trimEnd()}
${backupSection.trimEnd()}
${sep2}`;
}

/** Parse the latest Daily Backup Status summary out of the automation log. */
export function parseBackupStatus(lines) {
  // /api/logs returns lines with their trailing "\n" still attached.
  const full = Array.isArray(lines)
    ? lines.map(l => String(l).replace(/\r?\n$/, "")).join("\n")
    : (lines || "");
  // File log menumpuk terus lintas run (append, bukan overwrite). Ambil hanya
  // blok SUMMARY paling akhir supaya regex tidak menangkap ringkasan run lama.
  const summaryIdx = full.lastIndexOf("DAILY BACKUP REPORT SUMMARY");
  const text = summaryIdx !== -1 ? full.slice(summaryIdx) : full;
  const total   = text.match(/📦 Total\s*:\s*(\d+)/)?.[1]   || text.match(/Total\s*:\s*(\d+)/)?.[1];
  const success = text.match(/✅ Success\s*:\s*(\d+)/)?.[1]  || text.match(/Success\s*:\s*(\d+)/)?.[1];
  const failed  = text.match(/❌ Failed\s*:\s*(\d+)/)?.[1]   || text.match(/Failed\s*:\s*(\d+)/)?.[1];
  const rate    = text.match(/📈 Success Rate\s*:\s*([\d.]+%)/)?.[1] || text.match(/Success Rate\s*:\s*([\d.]+%)/)?.[1];
  const health  = text.match(/\b(HEALTHY|CRITICAL|WARNING)\b/)?.[0];
  const period    = text.match(/Period\s*:\s*(\d{4}-\d{2}-\d{2})/)?.[1]    || null;
  const generated = text.match(/Generated\s*:\s*([\d-]+ [\d:]+ WIB)/)?.[1] || null;
  // Blok "FAILED ───" berisi daftar resource yang gagal (❌ NAMA).
  const failedBlock = text.match(/^\s*FAILED\b[^\n]*\n([\s\S]*?)(?:\n\s*\n|\n\s*STATUS\b|(?![\s\S]))/m)?.[1] || "";
  const failedItems = [...failedBlock.matchAll(/❌\s*([^\n]+)/g)].map(m => m[1].trim());
  if (!total && !success && !failed) return null;
  return {
    total, success, failed, rate, health, period, generated, failedItems,
    fetchedAt: new Date().toISOString(),
  };
}
