import React, { useState, useEffect, useCallback, useMemo } from "react";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { logActivity } from "../activityLog.js";
import { isAlertMuted, setAlertMuted, onAlertMuteChange } from "../alertMute.js";
import { localISODate } from "../api.js";
import { fmtTime, shortName, canCreateTicket, recordTicketCreated, getOrCreateTicket } from "../dailyReport.js";

/* ─── helpers ─────────────────────────────────────────── */
function fmtDur(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function shortInstance(inst) {
  if (!inst || inst === "-") return "-";
  return inst.replace(/:\d+$/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

/* ─── folder display map ─────────────────────────────── */
const FOLDER_DISPLAY = {
  "DMDC":                 "DMDC",
  "OCI-ILCS":             "OCI-ILCS",
  "OCI-ILCS/YMS":         "OCI-ILCS/YMS",
  "Centralized/OCI - HO": "Centralized/OCI - HO",
  "alerts-BTP":           "alerts-BTP",
  "OCI-HO":               "OCI-HO",
  "GCP":                  "GCP",
  "Huawei":               "Huawei",
};
function folderDisplay(f) { return FOLDER_DISPLAY[f] || f; }

const FOLDER_COLORS = {
  "DMDC":                 "var(--amber)",
  "OCI-ILCS":             "var(--blue)",
  "OCI-ILCS/YMS":         "var(--blue)",
  "Centralized/OCI - HO": "var(--muted)",
  "alerts-BTP":           "var(--muted)",
  "OCI-HO":               "var(--muted)",
  "GCP":                  "var(--green)",
  "Huawei":               "var(--amber)",
};
function folderColor(f) { return FOLDER_COLORS[f] || "var(--muted)"; }

/* ─── OCI Database Management deep link ──────────────── */
const OCI_CONSOLE_URL = "https://cloud.oracle.com";
const GRAFANA_BASE_URL = "https://monitoring.ilcs.co.id";

function ocidOf(a) {
  const labels = a.labels || {};
  return String(labels.resourceId || labels.unique_id || "").trim();
}

// Databases covered by the Daily Backup Status check (name + OCID + region).
// Alerts that mention one of these DBs are investigated with Top SQL and the
// Grafana chart even when Grafana only reports a hostname (e.g. db-pancala-1).
let BACKUP_DBS = [];
function setBackupDatabases(list) {
  BACKUP_DBS = Array.isArray(list) ? list : [];
}
function tokenizeName(value) {
  return String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function compactName(value) {
  return tokenizeName(value).join("");
}
function dbNameAliases(name) {
  const n = compactName(name);
  const aliases = [n];
  // dbtoshub -> toshub, dbtosblw -> tosblw (hosts often drop the "db" prefix)
  if (n.startsWith("db") && n.length > 6) aliases.push(n.slice(2));
  return aliases;
}
function backupDbFor(a) {
  if (!BACKUP_DBS.length || !a) return null;
  const labels = a.labels || {};
  // Explicit DB labels / alert names ("Process DB Ayodya") are strong hints.
  const strongTokens = new Set(tokenizeName(
    [labels.resourceName, labels.db, a.name].filter(Boolean).join(" | ")
  ));
  const strongFlat = compactName(
    [labels.resourceName, labels.db, a.name].filter(Boolean).join(" | ")
  );
  // Hostnames only count when they look like DB hosts (db-pancala-1, toshub-db),
  // so ELK/app servers such as ptosm-elk are not treated as databases.
  const hostTokens = new Set(tokenizeName(
    [labels.nodename, labels.hostname, labels.instance, labels.node, labels.vm, a.resource]
      .filter(Boolean).join(" | ")
  ));
  const hostFlat = compactName(
    [labels.nodename, labels.hostname, labels.instance, labels.node, labels.vm, a.resource]
      .filter(Boolean).join(" | ")
  );
  const isDbHost = [...hostTokens].some((t) => t === "db" || t === "database" || /^db(?!\d)|db$/.test(t));
  let best = null;
  for (const db of BACKUP_DBS) {
    const hit = dbNameAliases(db.name).some((alias) => {
      if (!alias) return false;
      const strongHit = strongTokens.has(alias) || (alias.length >= 5 && strongFlat.includes(alias));
      const hostHit = isDbHost && (hostTokens.has(alias) || (alias.length >= 5 && hostFlat.includes(alias)));
      return strongHit || hostHit;
    });
    // Prefer the most specific name (gatepass over gate).
    if (hit && (!best || String(db.name).length > String(best.name).length)) best = db;
  }
  return best;
}
function dbOcid(a) {
  const ocid = ocidOf(a);
  if (/^ocid1\.database\./i.test(ocid)) return ocid;
  const db = backupDbFor(a);
  return db ? db.ocid : null;
}
function dbRegion(a) {
  const region = (a.labels || {}).region;
  if (region) return region;
  const db = backupDbFor(a);
  return db?.region || "ap-singapore-1";
}
function dbSystemOcid(a) {
  const ocid = ocidOf(a);
  return /^ocid1\.dbsystem\./i.test(ocid) ? ocid : null;
}

// ASM/DB alerts sometimes only carry a DB System OCID (e.g. Parama) and no
// namespace/cluster labels. Detect them explicitly so they never route to Rancher.
const DB_ALERT_NAME_RE = /(^|\s)(ASM|Tablespace|Data Guard|RMAN|Archive Log|Listener|FRA|DB System|Oracle Database)(\s|$)|Session DB|Process DB|Database (CPU|Memory|Session)/i;
function isDbAlert(a) {
  if (dbOcid(a) || dbSystemOcid(a)) return true;
  const name = String(a.name || "");
  if (/datasource/i.test(name)) return false;
  return DB_ALERT_NAME_RE.test(name);
}

// DB System alerts can at least open the DB Systems page in the same region.
function dbConsoleUrl(a) {
  if (!dbSystemOcid(a)) return null;
  const region = (a.labels || {}).region || "ap-singapore-1";
  return `${OCI_CONSOLE_URL}/db/db-systems?region=${encodeURIComponent(region)}`;
}

// OCI Database Management Performance Hub (Top SQL lives here). Opened in a
// new tab so the engineer's own OCI session is used; OCI asks for login when
// the session is missing and lands on Top SQL directly when it is still valid.
function ociTopSqlUrl(a) {
  const region = encodeURIComponent(dbRegion(a));
  const dbId = dbOcid(a);
  if (dbId) {
    return `${OCI_CONSOLE_URL}/dbmgmt-ui/perfhub?region=${region}`
      + `&ocid=${encodeURIComponent(dbId)}`;
  }
  const sysOcid = dbSystemOcid(a);
  if (sysOcid) {
    return `${OCI_CONSOLE_URL}/db/db-systems/${encodeURIComponent(sysOcid)}`
      + `/performance-hub?region=${region}`;
  }
  return null;
}

function rawInstance(a) {
  const labels = a.labels || {};
  return labels.instance || a.resource || "";
}

function extractUrl(value) {
  const m = String(value || "").match(/https?:\/\/[^\s"'\]\)]+/i);
  return m ? m[0].replace(/\/$/, "") : "";
}
function healthUrl(a) {
  const labels = a.labels || {};
  return extractUrl(labels.instance) || extractUrl(a.resource) || extractUrl(labels.url);
}

// Alert health check = probe URL (blackbox), bukan database/node metric.
function isHealthCheckAlert(a) {
  if (isDbAlert(a)) return false;
  return Boolean(healthUrl(a));
}

function nodeHost(a) {
  const labels = a.labels || {};
  return labels.nodename || labels.hostname || labels.node
    || labels.vm || shortInstance(rawInstance(a)) || "-";
}

// Plain node_exporter/windows_exporter alerts are VM/host alerts, not Rancher.
function isNodeAlert(a) {
  if (isDbAlert(a) || isHealthCheckAlert(a)) return false;
  const labels = a.labels || {};
  const job = String(labels.job || "").toLowerCase();
  const inst = rawInstance(a);
  return /:9100$|:9182$/.test(inst)
    || /node[-_]?exporter|windows[-_]?exporter|^vm$|kubernetes-service-endpoints/.test(job)
    || Boolean(labels.nodename || labels.hostname || labels.mountpoint || labels.volume);
}

/* ─── Rancher deep links (static routing metadata, no credentials) ─── */
const RANCHER_BASE = "https://rancher.ilcs.co.id";
const RANCHER_HOME_URL = `${RANCHER_BASE}/dashboard/home`;

const RANCHER_CLUSTERS = {
  "mch-uat": "c-m-2djvkhcz",
  "ali-phinnisi": "c-m-5bhpxrw4",
  "praya-belawan": "c-m-5bpgndcf",
  "ptos-pk": "c-m-5wv9pbr6",
  "praya-tbr-batam": "c-m-666dx54r",
  "phinnisi-v3": "c-m-6tqvsnm8",
  "cluster-apps-huawei": "c-m-75km629q",
  "gcp-data-analytic": "c-m-7jzdqqvz",
  "back-office-2": "c-m-8pgmjz8f",
  "yms": "c-m-9p99np2b",
  "praya-tpm-batam": "c-m-b7xwm9jg",
  "qa-cluster-batam": "c-m-bg9rzj82",
  "mch-dev-new": "c-m-bm7wrxvc",
  "praya-tpm-new": "c-m-bphjc44v",
  "prod-yms": "c-m-bs5j6qrb",
  "praya-009-batam": "c-m-btrjrscb",
  "phinnisi-priok": "c-m-hbkjdpnf",
  "ptos-c": "c-m-hk6cq2gz",
  "auto-gate": "c-m-j27bwbhk",
  "servant": "c-m-jwzb27lz",
  "prod-ptosm": "c-m-l52ztk8x",
  "dev-ptos": "c-m-l55t522t",
  "portaverse-onprem": "c-m-lqk646b9",
  "gcp-cluster-mgs-ai": "c-m-mg2lxr94",
  "cluster-portverse-dev": "c-m-mxfqxtnk",
  "phns-new": "c-m-n66crzcq",
  "qa-ho": "c-m-ncrqtcvx",
  "prod-mch": "c-m-nxr8p9xm",
  "parama-batam": "c-m-pj24ck6p",
  "oke-jipe": "c-m-pkqqkqxw",
  "prod-redis": "c-m-qkkkmqwc",
  "ptos-r": "c-m-qxk5svzz",
  "praya-009": "c-m-s6k7jwhh",
  "drc-mch": "c-m-sg8gvprr",
  "phinnisi-idn": "c-m-sx4ttrg5",
  "back-office-new": "c-m-t7vv57hl",
  "portaverse-huawei-prod": "c-m-tbm7h5tw",
  "qa-cluster": "c-m-tpfld6vh",
  "dev-tosnus-cluster": "c-m-vb6dn6pc",
  "praya-tpk1": "c-m-vfqm2ccc",
  "k8s-devops": "c-m-vtvn9bgg",
  "parama": "c-m-wcr9xwb2",
  "drc-ptosm": "c-m-wd6zhmq7",
  "btp-is": "c-m-x9ns74m7",
  "payment-gcp": "c-m-xcwh6jpz",
  "parama-new": "c-m-xrmccv4s",
  "dev-tuks": "c-m-zdcthm6h",
  "praya-belawan-batam": "c-m-zwg4xpq9",
};

const RANCHER_ALIASES = {
  "priok": "phinnisi-priok",
  "mch-dev": "mch-dev-new",
  "mch-prod": "prod-mch",
  "yms-dev": "yms",
  "yms-prod": "prod-yms",
  "gcp-data-analytics": "gcp-data-analytic",
  "backoffice": "back-office-2",
};

// Only known Kubernetes nodes; never use these for generic VM alerts.
const NODE_CLUSTER_HINTS = {
  "10.93.1.41": "praya-tpm-new",
  "tpm-praya-newnode01": "praya-tpm-new",
  "10.95.111.87": "mch-uat",
  "10.95.111.67": "mch-uat",
  "10.95.111.120": "mch-uat",
};

function clusterKey(name) {
  return String(name || "").trim().toLowerCase()
    .replace(/\s+/g, "-").replace(/_/g, "-");
}
function resolveRancherCluster(a) {
  const labels = a.labels || {};
  const direct = labels.cluster || labels.kube_cluster || labels.cluster_name;
  if (direct) {
    const raw = String(direct).trim();
    if (/^c-m-[a-z0-9]+$/i.test(raw)) return { id: raw, name: raw };
    const key = clusterKey(raw);
    const name = RANCHER_ALIASES[key] || key;
    return { id: RANCHER_CLUSTERS[name] || null, name };
  }
  const host = String(nodeHost(a) || "").toLowerCase();
  const hinted = NODE_CLUSTER_HINTS[host];
  if (hinted) return { id: RANCHER_CLUSTERS[hinted], name: hinted };
  return { id: null, name: "" };
}

function isK8sAlert(a) {
  if (isDbAlert(a) || isHealthCheckAlert(a)) return false;
  const labels = a.labels || {};
  if (labels.cluster || labels.kube_cluster || labels.cluster_name) return true;
  if (labels.pod || labels.deployment || labels.statefulset || labels.daemonset) return true;
  if (NODE_CLUSTER_HINTS[String(nodeHost(a) || "").toLowerCase()]) return true;
  const job = String(labels.job || "");
  if (/^kubernetes/i.test(job) && (labels.node || labels.nodename || labels.pod)) return true;
  return /^(CRITICAL|WARNING)?_?Kube/i.test(a.name || "");
}

function rancherTarget(a) {
  if (!isK8sAlert(a)) return null;
  const cluster = resolveRancherCluster(a);
  if (!cluster.id) return null;
  const labels = a.labels || {};
  const ns = labels.namespace || "";
  const enc = encodeURIComponent;
  const base = `${RANCHER_BASE}/dashboard/c/${cluster.id}/explorer`;

  const workload = labels.deployment
    ? { type: "apps.deployment", kind: "deployment", name: labels.deployment }
    : labels.statefulset
      ? { type: "apps.statefulset", kind: "statefulset", name: labels.statefulset }
      : labels.daemonset
        ? { type: "apps.daemonset", kind: "daemonset", name: labels.daemonset }
        : null;

  // A pod-specific alert goes to that pod. Workload alarms can also carry a
  // `pod` label for the exporter (e.g. kube-state-metrics), so workload wins.
  if (labels.pod && ns && (!workload || /pod/i.test(a.name || ""))) {
    return { url: `${base}/pod/${enc(ns)}/${enc(labels.pod)}`, label: "Rancher: Pod",
      kind: "pod", object: labels.pod, namespace: ns, cluster };
  }
  if (workload && ns) {
    return { url: `${base}/${workload.type}/${enc(ns)}/${enc(workload.name)}#pods`,
      label: "Rancher: Pods", kind: workload.kind,
      object: workload.name, namespace: ns, cluster };
  }
  const host = String(nodeHost(a) || "").toLowerCase();
  const node = labels.node || labels.nodename
    || (NODE_CLUSTER_HINTS[host] ? host : "");
  if (node && /^[a-z0-9][a-z0-9._-]*$/i.test(node)) {
    return { url: `${base}/node/${enc(node)}#pods`, label: "Rancher: Pods",
      kind: "node", object: node, namespace: "", cluster };
  }
  if (ns) {
    return { url: `${base}/pod?q=${enc(ns)}`, label: "Rancher: Pods",
      kind: "pods", object: ns, namespace: ns, cluster };
  }
  return { url: base, label: "Rancher: Cluster", kind: "cluster",
    object: cluster.name || cluster.id, namespace: "", cluster };
}

/* ─── Grafana evidence (dashboard panel / alert rule / Explore) ─── */
const FOLDER_DATASOURCE = {
  "OCI-ILCS": "bdy31xghxyh34d",
  "OCI-ILCS/MCH Adhara": "bdy31xghxyh34d",
  "OCI-ILCS/YMS": "bdy31xghxyh34d",
  "OCI-HO": "deyx07ukt7nk0e",
  "Centralized/OCI - HO": "deyx07ukt7nk0e",
  "GCP": "eey4rwzgb9ibke",
  "Huawei": "eey51w20ssn40e",
  "DMDC": "bff2mv1aq26m8a",
};

function promQuote(v) {
  return String(v || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function exploreExpr(a) {
  const labels = a.labels || {};
  const instance = labels.instance || "";
  if (labels.deployment && labels.namespace) {
    const ns = promQuote(labels.namespace);
    const dep = promQuote(labels.deployment);
    return `kube_deployment_status_replicas_unavailable{namespace="${ns}",deployment="${dep}"} `
      + `or kube_pod_status_ready{namespace="${ns}",pod=~"${dep}-.*",condition="true"} == 0`;
  }
  if (instance && /:9182$/.test(instance)) {
    return `100 * (1 - windows_logical_disk_free_bytes{instance="${promQuote(instance)}"} `
      + `/ windows_logical_disk_size_bytes{instance="${promQuote(instance)}"})`;
  }
  if (instance) {
    const i = promQuote(instance);
    return `(100 - avg(rate(node_cpu_seconds_total{mode="idle",instance="${i}"}[5m])) * 100) `
      + `or (100 * (1 - node_memory_MemAvailable_bytes{instance="${i}"} `
      + `/ node_memory_MemTotal_bytes{instance="${i}"})) `
      + `or (100 * (1 - node_filesystem_avail_bytes{instance="${i}"} `
      + `/ node_filesystem_size_bytes{instance="${i}"}))`;
  }
  const name = labels.alertname || a.name || "";
  return name ? `ALERTS{alertname="${promQuote(name)}"}` : "";
}

function grafanaExploreUrl(a) {
  const uid = (a.labels || {}).datasource_uid || a.datasource_uid || FOLDER_DATASOURCE[a.folder];
  const expr = exploreExpr(a);
  if (!uid || !expr) return null;
  const pane = {
    A: {
      datasource: uid,
      queries: [{ refId: "A", expr, instant: false, range: true }],
      range: { from: "now-6h", to: "now" },
    },
  };
  return `${GRAFANA_BASE_URL}/explore?orgId=1&schemaVersion=1`
    + `&panes=${encodeURIComponent(JSON.stringify(pane))}`;
}

function grafanaEvidenceUrl(a) {
  const ann = a.annotations || {};
  const dash = ann.__dashboardUid__;
  if (dash) {
    const q = new URLSearchParams({ from: "now-6h", to: "now" });
    if (ann.__panelId__) q.set("viewPanel", ann.__panelId__);
    if (ann.__orgId__) q.set("orgId", ann.__orgId__);
    return `${GRAFANA_BASE_URL}/d/${encodeURIComponent(dash)}?${q}`;
  }
  const rule = (a.labels || {}).__alert_rule_uid__;
  if (rule) return `${GRAFANA_BASE_URL}/alerting/grafana/${encodeURIComponent(rule)}/view`;
  return grafanaExploreUrl(a);
}

function grafanaRuleUid(a) {
  return String((a.labels || {}).__alert_rule_uid__ || "").trim();
}

const TARGET_LABEL_PRIORITY = ["instance", "hostName", "nodename", "hostname",
  "node", "resourceName", "service"];

function alertTarget(a) {
  const labels = a.labels || {};
  for (const key of TARGET_LABEL_PRIORITY) {
    const value = String(labels[key] || "").trim();
    if (value) return { key, value };
  }
  return null;
}

const CHART_COLORS = ["#E8C27A", "#E11D48", "#E8A598", "#93C5FD", "#4ADE80", "#C4B5FD"];
const CHART_RANGES = [["1h", "1h"], ["6h", "6h"], ["24h", "24h"]];

function fmtAxisValue(v) {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (abs >= 10) return v.toFixed(0);
  return Number(v.toFixed(2)).toString();
}

/* Lightweight SVG history chart for a Grafana alert rule query. */
function AlertLineChart({ series, from, to }) {
  const W = 960, H = 300, PL = 56, PR = 18, PT = 14, PB = 30;
  const bounds = useMemo(() => {
    const points = series.flatMap(s => s.points);
    if (!points.length) return null;
    let minX = from, maxX = to, minY = Infinity, maxY = -Infinity;
    points.forEach(([ts, v]) => {
      if (ts < minX) minX = ts;
      if (ts > maxX) maxX = ts;
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    });
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) return null;
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
    const pad = (maxY - minY) * 0.12 || Math.max(Math.abs(maxY) * 0.05, 1);
    let lo = minY - pad, hi = maxY + pad;
    if (minY >= 0 && maxY <= 100) {
      lo = 0;
      hi = Math.min(105, Math.max(hi, 100));
    }
    return { minX, maxX, minY: lo, maxY: hi };
  }, [series, from, to]);

  if (!bounds) return null;

  const sx = ts => PL + ((ts - bounds.minX) / (bounds.maxX - bounds.minX)) * (W - PL - PR);
  const sy = v => PT + ((bounds.maxY - v) / (bounds.maxY - bounds.minY)) * (H - PT - PB);
  const yTicks = [0, 1, 2, 3, 4].map(i => bounds.minY + ((bounds.maxY - bounds.minY) * i) / 4);
  const xTicks = [0, 1, 2, 3, 4].map(i =>
    Math.round(bounds.minX + ((bounds.maxX - bounds.minX) * i) / 4));
  const fmtTime = ts => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
      role="img" aria-label="Grafana alert history">
      {yTicks.map((v, i) => (
        <g key={`y${i}`}>
          <line x1={PL} x2={W - PR} y1={sy(v)} y2={sy(v)}
            stroke="rgba(255,255,255,.07)" strokeWidth="1"/>
          <text x={PL - 8} y={sy(v) + 3} textAnchor="end"
            style={{ fontSize: 9.5, fill: "var(--muted2)" }}>{fmtAxisValue(v)}</text>
        </g>
      ))}
      {xTicks.map((ts, i) => (
        <text key={`x${i}`} x={sx(ts)} y={H - 10}
          textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
          style={{ fontSize: 9.5, fill: "var(--muted2)" }}>{fmtTime(ts)}</text>
      ))}
      {series.map((s, i) => {
        const color = CHART_COLORS[i % CHART_COLORS.length];
        const path = s.points.map(([ts, v], idx) =>
          `${idx ? "L" : "M"}${sx(ts).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
        return (
          <path key={s.name + i} d={path} fill="none" stroke={color}
            strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round"
            style={{ filter: "drop-shadow(0 0 4px rgba(225,29,72,.25))" }}/>
        );
      })}
    </svg>
  );
}

function GrafanaChartModal({ alert, onClose }) {
  const ruleUid = grafanaRuleUid(alert);
  const openUrl = grafanaEvidenceUrl(alert);
  const target = alertTarget(alert);
  const promDs = String(alert.datasource_uid || "").trim();
  const promInstance = String((alert.labels || {}).instance || "").trim();
  const source = ruleUid ? "rule" : (promDs && promInstance ? "metrics" : "");
  const targetKey = target ? `${target.key}=${target.value}` : "";
  const [range, setRange] = useState("6h");
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ loading: true, error: "", code: "", data: null });

  useEffect(() => {
    if (!source) {
      setState({ loading: false, code: "no_source", data: null,
        error: "This alert has no linked Grafana rule or Prometheus datasource to chart." });
      return;
    }
    const ctrl = new AbortController();
    setState(s => ({ loading: true, error: "", code: "", data: s.data }));
    const qs = new URLSearchParams({ range, v: String(nonce) });
    if (source === "rule") {
      qs.set("ruleUid", ruleUid);
      if (target) qs.set("labels", JSON.stringify({ [target.key]: target.value }));
    } else {
      qs.set("datasourceUid", promDs);
      qs.set("instance", promInstance);
    }
    const endpoint = source === "rule" ? "alert-graph" : "alert-metrics";
    fetch(`/api/grafana/${endpoint}?${qs}`, { signal: ctrl.signal })
      .then(r => r.json().then(d => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        if (!httpOk || d.ok === false) {
          setState({ loading: false, error: d.error || "Failed to load the Grafana chart.",
            code: d.code || "", data: null });
        } else {
          setState({ loading: false, error: "", code: "", data: d });
        }
      })
      .catch(e => {
        if (e.name !== "AbortError") {
          setState({ loading: false, error: "Unable to reach the backend.", code: "", data: null });
        }
      });
    return () => ctrl.abort();
  }, [source, ruleUid, promDs, promInstance, targetKey, range, nonce]);

  const chip = on => ({
    fontSize: 10.5, fontWeight: 600, padding: "4px 11px", borderRadius: 999,
    border: `1px solid ${on ? "var(--border3)" : "var(--border2)"}`,
    background: on ? "rgba(139,18,38,.30)" : "var(--surface2)",
    color: on ? "var(--rose)" : "var(--muted)",
    cursor: "pointer", fontFamily: "inherit",
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ width: 1040, maxWidth: "94vw", maxHeight: "92vh" }}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Icon name="grafana" size={16} style={{ color: "var(--rose)", flexShrink: 0 }}/>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 650, color: "var(--text)" }}>
                Grafana chart
              </span>
              <span style={{ display: "block", fontSize: 10.5, color: "var(--muted)", marginTop: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {shortName(alert.name)} · {folderDisplay(alert.folder)} · {fmtDur(alert.duration_min || 0)}
              </span>
            </span>
          </span>
          <button className="modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={14}/></button>
        </div>

        <div className="modal-body" style={{ gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {CHART_RANGES.map(([key, label]) => (
              <button key={key} onClick={() => setRange(key)} style={chip(range === key)}>{label}</button>
            ))}
            <span style={{ flex: 1 }}/>
            <button onClick={() => setNonce(n => n + 1)} disabled={state.loading}
              style={{ ...MINI_BTN, opacity: state.loading ? .5 : 1, cursor: state.loading ? "default" : "pointer" }}>
              <Icon name="refresh" size={10}/> Refresh
            </button>
            {openUrl && (
              <a href={openUrl} target="_blank" rel="noreferrer"
                style={{ ...MINI_BTN, textDecoration: "none" }}>
                Open in Grafana <Icon name="external" size={9}/>
              </a>
            )}
          </div>

          <div style={{ background: "rgba(10,3,5,.55)", border: "1px solid var(--border2)",
            borderRadius: 12, padding: "10px 12px", minHeight: 220 }}>
            {state.loading && !state.data ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8, height: 210, color: "var(--muted)", fontSize: 12 }}>
                <span className="spinner" style={{ width: 16, height: 16 }}/> Querying Grafana…
              </div>
            ) : state.error ? (
              <div style={{ padding: "26px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 12.5, fontWeight: 650, color: "var(--red)", marginBottom: 6 }}>
                  {state.code === "rule_missing" ? "Grafana alert rule not found"
                    : state.code === "no_query" ? "No chartable query in this rule"
                    : state.code === "no_source" ? "No chart source linked"
                    : "Could not load the Grafana chart"}
                </div>
                <div style={{ fontSize: 11, color: "var(--text4)", lineHeight: 1.6 }}>
                  {state.error}
                </div>
                {openUrl && (
                  <a href={openUrl} target="_blank" rel="noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 12,
                      fontSize: 11, color: "var(--blue)", textDecoration: "none" }}>
                    Open the alert in Grafana <Icon name="external" size={10}/>
                  </a>
                )}
              </div>
            ) : (state.data?.series || []).length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
                height: 210, color: "var(--muted)", fontSize: 12, textAlign: "center", padding: "0 20px" }}>
                {state.data?.warning || "No data points returned for this time range."}
              </div>
            ) : (
              <>
                <AlertLineChart series={state.data.series}
                  from={state.data.from} to={state.data.to}/>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 8 }}>
                  {state.data.series.map((s, i) => {
                    const last = s.points[s.points.length - 1];
                    return (
                      <span key={s.name + i} title={s.name}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5,
                          fontSize: 10, color: "var(--muted)", maxWidth: 300 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0,
                          background: CHART_COLORS[i % CHART_COLORS.length] }}/>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap" }}>{s.name}</span>
                        <b style={{ color: "var(--text3)", fontWeight: 600 }}>
                          {last ? fmtAxisValue(last[1]) : "—"}
                        </b>
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div style={{ fontSize: 9.5, color: "var(--muted)", lineHeight: 1.55 }}>
            {source === "metrics"
              ? `Utilization is queried from the alert's Prometheus datasource for ${promInstance} only (last ${range}).`
              : target
                ? `History is scoped to this alert's own target (${target.key}=${target.value}) using the linked Grafana alert rule (last ${range}).`
                : `History is queried from the same Grafana alert rule that fired this alert (last ${range}).`}
          </div>
        </div>
      </div>
    </div>
  );
}

function alertValues(a) {
  const ann = a.annotations || {};
  try {
    const vals = JSON.parse(ann.__values__ || "{}");
    return Object.entries(vals).map(([k, v]) => [k, String(v)]);
  } catch {
    return [];
  }
}

function evidenceKind(a) {
  if (isDbAlert(a)) return dbSystemOcid(a) ? "db-system" : "db";
  if (isHealthCheckAlert(a)) return "health";
  if (isK8sAlert(a)) {
    const labels = a.labels || {};
    if (labels.pod || labels.deployment || labels.statefulset || labels.daemonset) return "k8s";
    return "k8s-node";
  }
  if (isNodeAlert(a)) return "node";
  return "generic";
}

const MINI_BTN = {
  display:"inline-flex", alignItems:"center", gap:3,
  border:"1px solid var(--border2)", borderRadius:5,
  color:"var(--text3)", background:"var(--surface2)",
  fontFamily:"inherit", fontSize:10, fontWeight:600,
  padding:"4px 9px", cursor:"pointer", whiteSpace:"nowrap",
  boxShadow:"var(--shadow-btn)",
};

function copyToClipboard(text, done) {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch {}
    document.body.removeChild(ta);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
}

function getSeverity(name, sev) {
  // pakai severity dari label Prometheus kalau ada
  if (sev && sev !== "-") {
    const s = sev.toLowerCase();
    if (s.includes("critical")) return "critical";
    if (s.includes("warn"))     return "warning";
    if (s.includes("high"))     return "high";
    return s;
  }
  // fallback: detect dari nama alert
  const n = (name||"").toLowerCase();
  if (n.includes("critical") || n.includes("down") || n.includes("disk")) return "critical";
  if (n.includes("high") || n.includes("cpu") || n.includes("ram") || n.includes("memory")) return "high";
  if (n.includes("warn") || n.includes("utilization") || n.includes("uptime")) return "warning";
  return "info";
}
const SEV_COLOR = { critical:"var(--red)", high:"var(--red)", warning:"var(--amber)", info:"var(--muted)" };

function buildTemplate(a, ticketNum) {
  const sev      = getSeverity(a.name, a.severity);
  const inst     = a.resource && a.resource !== "-" ? a.resource : (a.labels?.instance || "-");
  const nodename = a.labels?.nodename || a.labels?.node || a.labels?.hostname || "-";
  const cluster  = a.labels?.cluster  || a.labels?.kubernetes_cluster || a.labels?.k8s_cluster || "-";
  const namespace= a.labels?.namespace || "-";
  const job      = a.labels?.job       || "-";

  // Bangun baris detail — hanya tampilkan yang ada nilainya (tidak "-")
  const lines = [
    `Folder     : ${folderDisplay(a.folder)}`,
    `Alertname  : ${shortName(a.name)}`,
    inst      !== "-" ? `Instance   : ${inst}`      : null,
    cluster   !== "-" ? `Cluster    : ${cluster}`   : null,
    `Severity   : ${sev.toUpperCase()}`,
    `Duration   : ${fmtDur(a.duration_min)}`,
    nodename  !== "-" ? `Nodename   : ${nodename}`  : null,
    namespace !== "-" ? `Namespace  : ${namespace}` : null,
    job       !== "-" ? `Job        : ${job}`        : null,
  ].filter(Boolean).join("\n");

  return `Hi team, please be advised that the following alert is currently active.

#Ticket     : ${ticketNum}

${lines}

Please follow up as soon as possible. Thank you.`;
}

/* ─── Laporkan Modal ─────────────────────────────────── */
function LaporkanModal({ alert, alreadyEskalasi, onClose, onEskalasi }) {
  const [copied,   setCopied]   = useState(false);
  // Ambil/buat ticket yang konsisten untuk alert ini
  const [ticket,   setTicket]   = useState(() => getOrCreateTicket(alert._key));
  // Klik "Copy Template" berkali-kali dalam satu sesi modal yang sama harus
  // tetap bisa menyalin teksnya, tapi eskalasi + log activity hanya boleh
  // tercatat SEKALI — tanpa guard ini, "Alerts Escalated" di Engineer
  // Activity jadi lebih besar dari jumlah tiket unik yang benar-benar ada.
  const loggedRef = React.useRef(alreadyEskalasi);

  const text = buildTemplate(alert, ticket);

  const markDoneOnce = () => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    onEskalasi(alert._key, alert);
    logActivity(
      "Report Alert",
      "alert",
      [
        `Ticket: ${ticket}`,
        `Alert: ${shortName(alert.name)}`,
        `Folder: ${folderDisplay(alert.folder)}`,
        alert.resource && alert.resource !== "-" ? `Instance: ${alert.resource}` : null,
        (alert.labels?.nodename || alert.labels?.node) ? `Nodename: ${alert.labels?.nodename || alert.labels?.node}` : null,
        (alert.labels?.cluster || alert.labels?.kubernetes_cluster) ? `Cluster: ${alert.labels?.cluster || alert.labels?.kubernetes_cluster}` : null,
        `Severity: ${getSeverity(alert.name, alert.severity).toUpperCase()}`,
      ].filter(Boolean).join(" | ")
    );
  };

  const doCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      markDoneOnce();
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const el = document.getElementById("laporkan-textarea");
      if (el) { el.select(); document.execCommand("copy"); }
      setCopied(true);
      markDoneOnce();
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)",
      display:"flex", alignItems:"center", justifyContent:"center",
      zIndex:1000, padding:20 }}
      onClick={onClose}>
      <div style={{ background:"var(--surface)", border:"1px solid var(--border2)", borderRadius:10,
        width:"100%", maxWidth:520, padding:0, overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>

        {/* header */}
        <div style={{ display:"flex", alignItems:"center", gap:10,
          padding:"14px 18px", borderBottom:"1px solid var(--border)" }}>
          <span style={{ width:30, height:30, borderRadius:7, background:"var(--accent-soft)",
            color:"var(--accent)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <Icon name="alert" size={15}/>
          </span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:650, color:"var(--text)" }}>Report alert</div>
            <div style={{ fontSize:11, color:"var(--muted)", marginTop:1 }}>Copy the template and send it to the team.</div>
          </div>
          <button onClick={onClose}
            style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", padding:4 }}>
            <Icon name="close" size={15}/>
          </button>
        </div>

        {/* alert info strip */}
        <div style={{ padding:"10px 18px", background:"var(--accent-soft)",
          borderBottom:"1px solid var(--border)", display:"flex", gap:10, flexWrap:"wrap",
          alignItems:"center" }}>
          <span style={{ fontSize:10, color:folderColor(alert.folder), fontWeight:600,
            background:"var(--surface2)", border:"1px solid var(--border)", padding:"2px 8px", borderRadius:4 }}>
            {folderDisplay(alert.folder)}
          </span>
          <span style={{ fontSize:11, color:"var(--text3)", flex:1, minWidth:0,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {shortName(alert.name)}
          </span>
          <span style={{ display:"inline-flex", alignItems:"center", gap:4,
            fontSize:10, color:"var(--accent)", fontWeight:600, flexShrink:0 }}>
            <Icon name="clock" size={11}/> {fmtDur(alert.duration_min)}
          </span>
        </div>

        {/* ticket number row */}
        <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--border)",
          display:"flex", alignItems:"center", gap:10 }}>
          <label style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:".07em", flexShrink:0, fontWeight:600 }}>
            Ticket no.
          </label>
          <input
            value={ticket}
            onChange={e => setTicket(e.target.value)}
            spellCheck={false}
            style={{ flex:1, background:"var(--bg3)", border:"1px solid var(--border2)",
              borderRadius:6, color:"var(--text)", fontFamily:"var(--mono)",
              fontSize:12, fontWeight:600, padding:"6px 10px", outline:"none",
              letterSpacing:".03em" }}
          />
          <button
            onClick={() => {
              const num = generateTicketNumber();
              // Simpan ke map supaya task juga update kalau di-sync ulang
              let map = {};
              try { map = JSON.parse(localStorage.getItem(TICKET_MAP_KEY) || "{}"); } catch {}
              map[alert._key] = num;
              localStorage.setItem(TICKET_MAP_KEY, JSON.stringify(map));
              setTicket(num);
            }}
            title="Generate a new ticket number"
            style={{ background:"var(--surface2)", border:"1px solid var(--border2)", borderRadius:5,
              color:"var(--muted)", padding:"5px 9px", cursor:"pointer",
              flexShrink:0, display:"flex", alignItems:"center" }}>
            <Icon name="refresh" size={12}/>
          </button>
        </div>

        {/* template text */}
        <div style={{ padding:"14px 18px" }}>
          <div style={{ fontSize:10, color:"var(--muted)", marginBottom:6,
            textTransform:"uppercase", letterSpacing:".07em", fontWeight:600 }}>Message template</div>
          <textarea id="laporkan-textarea" readOnly value={text}
            style={{ width:"100%", height:210, background:"var(--bg3)",
              border:"1px solid var(--border2)", borderRadius:6, color:"var(--text3)",
              fontFamily:"var(--mono)", fontSize:11,
              padding:"10px 12px", resize:"none", outline:"none",
              boxSizing:"border-box", lineHeight:1.75 }}/>
        </div>

        {/* actions */}
        <div style={{ display:"flex", gap:10, padding:"0 18px 18px", alignItems:"center" }}>
          <button onClick={doCopy}
            style={{ flex:1, background: copied ? "var(--green)" : "var(--accent)",
              border:"none", borderRadius:6, color:"#fff",
              fontFamily:"inherit", fontSize:12, fontWeight:600,
              padding:"9px 0", cursor:"pointer", transition:"background .2s",
              display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            <Icon name={copied ? "check" : "copy"} size={13}/>
            {copied ? "Copied" : "Copy template"}
          </button>
          <button onClick={onClose}
            style={{ background:"var(--surface2)", border:"1px solid var(--border2)",
              borderRadius:6, color:"var(--text4)", fontFamily:"inherit",
              fontSize:12, padding:"9px 16px", cursor:"pointer" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Top SQL page (OCI AWR) ─────────────────────────── */
function TopSqlPage({ alert, onClose }) {
  const ocid = dbOcid(alert);
  const sysOcid = dbSystemOcid(alert);
  const backupDb = backupDbFor(alert);
  const requestOcid = ocid || sysOcid;
  const consoleUrl = ociTopSqlUrl(alert);
  const consoleLabel = "Open Top SQL in OCI Console";
  const grafanaUrl = grafanaEvidenceUrl(alert);
  const [state, setState] = useState({ loading: true, error: "", code: "", data: null });
  const [copied, setCopied] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!requestOcid) {
      setState({ loading: false, error: "This alert has no database or DB System OCID.", code: "", data: null });
      return;
    }
    const ctrl = new AbortController();
    setState({ loading: true, error: "", code: "", data: null });
    const qs = `ocid=${encodeURIComponent(requestOcid)}${nonce ? "&refresh=1" : ""}`;
    fetch(`/api/oci/dbm/top-sql?${qs}`, { signal: ctrl.signal })
      .then(r => r.json().then(d => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        if (!httpOk || d.ok === false) {
          setState({ loading: false, error: d.error || "Failed to load AWR data.", code: d.code || "", data: null });
        } else {
          setState({ loading: false, error: "", code: "", data: d });
        }
      })
      .catch(e => {
        if (e.name !== "AbortError") {
          setState({ loading: false, error: "Unable to reach the backend.", code: "", data: null });
        }
      });
    return () => ctrl.abort();
  }, [requestOcid, nonce]);

  const titleForCode = {
    not_managed: "Database is not registered in OCI Database Management",
    db_system_no_access: "Top SQL / AWR is unavailable for this DB System",
    db_system_no_database: "The database on this DB System cannot be read",
    invalid_ocid: "Invalid database or DB System OCID",
  };

  const fallbackCopy = (text, done) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch {}
    document.body.removeChild(ta);
  };
  const doCopy = (text, tag) => {
    const done = () => { setCopied(tag); setTimeout(() => setCopied(""), 2000); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  };

  const copyBtn = (tag, text, label) => (
    <button onClick={() => doCopy(text, tag)}
      style={{ background:"var(--surface2)", border:"1px solid var(--border2)",
        borderRadius:5, color: copied === tag ? "var(--green)" : "var(--muted)",
        fontFamily:"inherit", fontSize:10, fontWeight:600, padding:"3px 8px",
        cursor:"pointer", whiteSpace:"nowrap" }}>
      {copied === tag ? "Copied" : label}
    </button>
  );

  return (
    <div style={{ position:"fixed", inset:0, zIndex:1000, background:"var(--bg)",
      display:"flex", flexDirection:"column" }}>
      <div style={{ width:"100%", height:"100%", display:"flex",
        flexDirection:"column", background:"var(--bg)", overflow:"hidden" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 24px",
          borderBottom:"1px solid var(--border)", background:"var(--bg2)", flexShrink:0 }}>
          <button onClick={onClose}
            style={{ background:"var(--surface2)", border:"1px solid var(--border2)",
              borderRadius:6, color:"var(--text4)", fontFamily:"inherit",
              fontSize:11, fontWeight:500, padding:"6px 12px", cursor:"pointer",
              display:"inline-flex", alignItems:"center", gap:5 }}>
            <Icon name="arrowLeft" size={12}/> Alert Monitor
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:650, color:"var(--text)" }}>
              SQL Text — {state.data?.db_unique_name || backupDb?.name || alert.labels?.resourceName || alert.resource || "database"}
            </div>
            <div style={{ fontSize:10.5, color:"var(--muted)", marginTop:2 }}>
              {sysOcid && !ocid
                ? "DB System / ASM · resolving database OCID for AWR"
                : `${backupDb ? `Daily backup DB (${backupDb.group}) · ` : ""}OCI Database Management · ${state.data?.source === "awr" ? "AWR snapshot" : "last 1 hour ASH"}`}
            </div>
          </div>
          <button onClick={() => setNonce(n => n + 1)} disabled={state.loading}
            style={{ background:"var(--surface2)", border:"1px solid var(--border2)",
              borderRadius:5, color:"var(--muted)", fontFamily:"inherit",
              fontSize:10.5, fontWeight:600, padding:"5px 10px",
              cursor:state.loading ? "default" : "pointer", opacity:state.loading ? .5 : 1,
              display:"inline-flex", alignItems:"center", gap:5 }}>
            <Icon name="refresh" size={11}/> Refresh
          </button>
          <button onClick={onClose}
            style={{ background:"none", border:"none", color:"var(--muted2)", cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", padding:4 }}>
            <Icon name="close" size={15}/>
          </button>
        </div>

        <div style={{ flex:1, overflow:"auto", padding:"16px 24px" }}>
          {state.loading ? (
            <div style={{ textAlign:"center", color:"var(--muted)", padding:"40px 0", fontSize:12 }}>
              Loading Top SQL from OCI AWR…
            </div>
          ) : state.error ? (
            <div style={{ background:"var(--red-dim)", border:"1px solid var(--border2)",
              borderRadius:8, padding:"14px 16px" }}>
              <div style={{ fontSize:12.5, color:"var(--red)", fontWeight:650, marginBottom:6 }}>
                {titleForCode[state.code] || "Failed to load data"}
              </div>
              <div style={{ fontSize:11, color:"var(--text4)", lineHeight:1.6 }}>{state.error}</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:14, marginTop:10 }}>
                {consoleUrl && (
                  <a href={consoleUrl} target="_blank" rel="noreferrer"
                    style={{ display:"inline-flex", alignItems:"center", gap:4,
                      fontSize:11, color:"var(--blue)", textDecoration:"none" }}>
                    {consoleLabel} <Icon name="external" size={11}/>
                  </a>
                )}
                {grafanaUrl && (
                  <a href={grafanaUrl} target="_blank" rel="noreferrer"
                    style={{ display:"inline-flex", alignItems:"center", gap:4,
                      fontSize:11, color:"var(--blue)", textDecoration:"none" }}>
                    View alert graph in Grafana <Icon name="external" size={11}/>
                  </a>
                )}
              </div>
              {state.code === "db_system_no_access" && (
                <div style={{ marginTop:10, fontSize:10.5, color:"var(--muted)", lineHeight:1.6 }}>
                  This alert comes from a DB System / ASM resource, not a managed database OCID.
                  Top SQL requires a database OCID. Open the ASM graph in Grafana or ask the DBA
                  team to grant DB System access.
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ display:"flex", flexWrap:"wrap", gap:14, alignItems:"center",
                fontSize:10, color:"var(--muted)", marginBottom:10 }}>
                <span>DB: <b style={{ color:"var(--text3)" }}>{state.data.db_unique_name}</b></span>
                <span>Snapshot: {state.data.snapshots?.begin === state.data.snapshots?.end
                  ? state.data.snapshots?.end
                  : `${state.data.snapshots?.begin} → ${state.data.snapshots?.end}`}</span>
                {state.data.snapshots?.end_time && (
                  <span>until {fmtTime(state.data.snapshots.end_time)}</span>
                )}
                <span>AWR DB: {state.data.awr_db_id}</span>
              </div>

              {(state.data.sql || []).map((s, i) => (
                <div key={s.sql_id} style={{ border:"1px solid var(--border2)", borderRadius:8,
                  marginBottom:10, background:"var(--bg3)", overflow:"hidden" }}>
                  <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:8,
                    padding:"8px 12px", borderBottom:"1px solid var(--border)" }}>
                    <span style={{ fontSize:10, fontWeight:700, color:"var(--amber)" }}>#{i + 1}</span>
                    <code style={{ fontSize:11, color:"var(--blue)", fontFamily:"var(--mono)" }}>{s.sql_id}</code>
                    {s.activity_pct != null ? (
                      <>
                        <span style={{ fontSize:10, color:"var(--muted)" }}>
                          activity <b style={{ color:"var(--text3)" }}>{s.activity_pct}%</b>
                        </span>
                        <span style={{ fontSize:10, color:"var(--muted)" }}>
                          sampled <b style={{ color:"var(--text3)" }}>{s.sampled}</b>
                        </span>
                        {s.event && (
                          <span title={s.event} style={{ fontSize:9, color:"var(--red)",
                            background:"var(--red-dim)", border:"1px solid var(--border2)",
                            borderRadius:4, padding:"1px 6px", maxWidth:240, overflow:"hidden",
                            textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {s.event}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize:10, color:"var(--muted)" }}>
                          elapsed <b style={{ color:"var(--text3)" }}>{s.elapsed_s}s</b>
                        </span>
                        <span style={{ fontSize:10, color:"var(--muted)" }}>
                          cpu <b style={{ color:"var(--text3)" }}>{s.cpu_s}s</b>
                        </span>
                        <span style={{ fontSize:10, color:"var(--muted)" }}>
                          execs <b style={{ color:"var(--text3)" }}>{s.execs}</b>
                        </span>
                      </>
                    )}
                    {s.pdb && (
                      <span style={{ fontSize:9, color:"var(--text3)", background:"var(--surface2)",
                        border:"1px solid var(--border2)", borderRadius:4, padding:"1px 6px" }}>
                        PDB {s.pdb}
                      </span>
                    )}
                    <span style={{ flex:1 }}/>
                    {copyBtn(s.sql_id, s.text || "", "Copy SQL")}
                    {copyBtn("id:" + s.sql_id, s.sql_id, "Copy ID")}
                  </div>
                  <pre style={{ margin:0, padding:"10px 12px", fontSize:11, lineHeight:1.55,
                    color:"var(--text3)", whiteSpace:"pre-wrap", wordBreak:"break-word",
                    fontFamily:"var(--mono)", maxHeight:220, overflow:"auto" }}>
                    {s.text || "(SQL text unavailable)"}
                  </pre>
                  {!s.text_full && (
                    <div style={{ padding:"0 12px 8px", fontSize:9.5, color:"var(--amber)" }}>
                      Text from the {state.data.source === "awr" ? "AWR" : "ASH"} report may be truncated.
                      Copy the SQL ID and open the full statement in the OCI console if needed.
                    </div>
                  )}
                </div>
              ))}

              <div style={{ fontSize:9.5, color:"var(--muted)", lineHeight:1.55 }}>
                Source: {state.data.source === "awr"
                  ? `AWR snapshot ${state.data.snapshots?.begin} → ${state.data.snapshots?.end}`
                  : "Active Session History (ASH), last hour"}{" "}
                (snapshot interval ~{state.data.snapshots?.interval_min || 60} min). This is not
                real-time data. Open the Grafana chart to review live database trends.
              </div>
            </>
          )}
        </div>

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", alignItems:"center",
          padding:"12px 18px", borderTop:"1px solid var(--border)" }}>
          {consoleUrl && (
            <a href={consoleUrl} target="_blank" rel="noreferrer"
              style={{ display:"inline-flex", alignItems:"center", gap:4,
                fontSize:11, color:"var(--blue)", textDecoration:"none", marginRight:"auto" }}>
              {consoleLabel} <Icon name="external" size={11}/>
            </a>
          )}
          <button onClick={onClose}
            style={{ background:"var(--surface2)", border:"1px solid var(--border2)",
              borderRadius:6, color:"var(--text4)", fontFamily:"inherit",
              fontSize:11, padding:"7px 14px", cursor:"pointer" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── HealthCheck Evidence Modal ─────────────────────── */
function HealthCheckModal({ alert, onClose }) {
  const url = healthUrl(alert);
  const [minutes, setMinutes] = useState(60);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!url) {
      setState({ loading: false, error: "This alert has no URL.", data: null });
      return;
    }
    const ctrl = new AbortController();
    setState({ loading: true, error: "", data: null });
    fetch(`/api/healthcheck/evidence?url=${encodeURIComponent(url)}&minutes=${minutes}`,
      { signal: ctrl.signal })
      .then(r => r.json().then(d => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        if (!httpOk || d.ok === false) {
          setState({ loading: false, error: d.error || "Failed to load check evidence.", data: null });
        } else {
          setState({ loading: false, error: "", data: d });
        }
      })
      .catch(e => {
        if (e.name !== "AbortError") {
          setState({ loading: false, error: "Unable to reach the backend.", data: null });
        }
      });
    return () => ctrl.abort();
  }, [url, minutes, nonce]);

  const d = state.data;
  const probe = d?.probe;
  const tls = d?.tls;
  const prom = d?.prom;

  const badge = !probe
    ? { text: "-", color: "var(--muted3)" }
    : probe.ok
      ? { text: "HEALTHY", color: "var(--green)" }
      : probe.reachable
        ? { text: "RESPONDING, WITH ERRORS", color: "var(--amber)" }
        : { text: "NOT RESPONDING", color: "var(--red)" };

  const card = { background:"var(--bg3)", border:"1px solid var(--border)",
    borderRadius:8, padding:"10px 12px" };
  const cardTitle = { fontSize:9, fontWeight:700, color:"var(--muted2)",
    textTransform:"uppercase", letterSpacing:".07em", marginBottom:6 };
  const kv = (label, value, color) => (
    <div key={label} style={{ display:"flex", justifyContent:"space-between", gap:10,
      fontSize:11, padding:"3px 0" }}>
      <span style={{ color:"var(--muted)", flexShrink:0 }}>{label}</span>
      <span style={{ color:color || "var(--text3)", fontWeight:600,
        textAlign:"right", wordBreak:"break-all" }}>{value}</span>
    </div>
  );

  const lat = prom?.latency_avg_ms != null
    ? `avg ${prom.latency_avg_ms} ms · max ${prom.latency_max_ms} ms`
    : "-";

  const copyReport = () => copyToClipboard(d?.report_text || "", () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });

  return (
    <div onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)",
        display:"flex", alignItems:"center", justifyContent:"center",
        zIndex:1000, padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width:"100%", maxWidth:760, maxHeight:"88vh", display:"flex",
          flexDirection:"column", background:"var(--surface)",
          border:"1px solid var(--border2)", borderRadius:10,
          boxShadow:"0 20px 60px rgba(0,0,0,.6)", overflow:"hidden" }}>

        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 18px",
          borderBottom:"1px solid var(--border)" }}>
          <span style={{ width:30, height:30, borderRadius:7, background:"var(--blue-dim)",
            color:"var(--blue)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <Icon name="globe" size={15}/>
          </span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:650, color:"var(--text)" }}>
              URL check evidence
            </div>
            <div style={{ fontSize:10, color:"var(--muted)", marginTop:2,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {url || "-"}
            </div>
          </div>
          {[60, 360].map(m => (
            <button key={m} onClick={() => setMinutes(m)}
              style={{ ...MINI_BTN, padding:"4px 9px",
                color: minutes === m ? "var(--blue)" : "var(--muted)",
                borderColor: minutes === m ? "var(--blue)" : "var(--border2)" }}>
              {m === 60 ? "1 hour" : "6 hours"}
            </button>
          ))}
          <button onClick={() => setNonce(n => n + 1)} disabled={state.loading}
            style={{ ...MINI_BTN, opacity: state.loading ? .5 : 1 }}>Recheck</button>
          <button onClick={onClose}
            style={{ background:"none", border:"none", color:"var(--muted2)", cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", padding:4 }}>
            <Icon name="close" size={15}/>
          </button>
        </div>

        <div style={{ padding:"12px 18px", overflowY:"auto", flex:1 }}>
          {state.loading && (
            <div style={{ padding:"28px 0", textAlign:"center", color:"var(--muted)", fontSize:11 }}>
              Running a live probe and fetching blackbox metrics…
            </div>
          )}

          {!state.loading && state.error && (
            <div style={{ padding:"10px 12px", background:"var(--red-dim)",
              border:"1px solid var(--border2)", borderRadius:6, color:"var(--red)",
              fontSize:11, lineHeight:1.5 }}>
              {state.error}
            </div>
          )}

          {d && (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12,
                padding:"9px 12px", background:"var(--bg3)", borderRadius:8,
                border:"1px solid var(--border)" }}>
                <span style={{ fontSize:10, fontWeight:700, color:"#fff",
                  background:badge.color, borderRadius:4, padding:"3px 9px" }}>
                  {badge.text}
                </span>
                <span style={{ fontSize:11, color:"var(--text3)", flex:1 }}>
                  {d.conclusion}
                </span>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div style={card}>
                  <div style={cardTitle}>Live probe</div>
                  {kv("HTTP", probe?.status_code != null ? probe.status_code : "failed",
                    probe?.ok ? "var(--green)" : "var(--amber)")}
                  {kv("Latency", probe?.latency_ms != null ? `${probe.latency_ms} ms` : "-")}
                  {kv("Server", probe?.server || "-")}
                  {probe?.tls_verified === false && kv("TLS verify", "failed (bypass)", "var(--amber)")}
                  {kv("Redirects", `${probe?.redirects?.length || 0}`)}
                  {probe?.final_url && probe.final_url !== url && kv("Final URL", probe.final_url)}
                  {probe?.body_snippet && kv("Snippet", probe.body_snippet)}
                  {probe?.error && kv("Error", `${probe.error_type}: ${probe.error}`, "var(--red)")}
                </div>

                <div style={card}>
                  <div style={cardTitle}>TLS / Certificate</div>
                  {tls === null && (
                    <div style={{ fontSize:11, color:"var(--muted)" }}>
                      Not applicable (URL is not HTTPS)
                    </div>
                  )}
                  {tls?.valid && (
                    <>
                      {kv("Issuer", tls.issuer)}
                      {kv("Valid until", fmtTime(tls.not_after))}
                      {kv("Remaining", `${tls.days_left} days`,
                        tls.days_left < 14 ? "var(--red)" : tls.days_left < 30 ? "var(--amber)" : "var(--green)")}
                    </>
                  )}
                  {tls && tls.valid === false && kv("Error", tls.error, "var(--red)")}
                </div>

                <div style={{ ...card, gridColumn:"1 / -1" }}>
                  <div style={cardTitle}>
                    Blackbox history — last {minutes === 60 ? "hour" : "6 hours"}
                  </div>
                  {prom?.samples ? (
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 18px" }}>
                      <div>
                        {kv("Uptime", `${prom.uptime_pct}%`,
                          prom.uptime_pct >= 99 ? "var(--green)" : prom.uptime_pct >= 95 ? "var(--amber)" : "var(--red)")}
                        {kv("Samples", `${prom.samples} points`)}
                        {kv("Current status", prom.current_success ? "UP" : "DOWN",
                          prom.current_success ? "var(--green)" : "var(--red)")}
                        {kv("Data source", prom.datasource)}
                      </div>
                      <div>
                        {kv("Last OK", fmtTime(prom.last_ok_at))}
                        {kv("Last failure", fmtTime(prom.last_fail_at))}
                        {prom.current_success === false && kv("Down since", `${fmtTime(prom.current_since)} (±${prom.down_minutes}m)`)}
                        {kv("Latency", lat)}
                        {prom.status_codes?.length > 0 && kv("HTTP codes", prom.status_codes.join(", "))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize:11, color:"var(--muted)" }}>
                      No probe_success metric found for this URL in the Grafana data source.
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop:12 }}>
                <div style={{ fontSize:9, fontWeight:700, color:"var(--muted2)",
                  textTransform:"uppercase", letterSpacing:".07em", marginBottom:6 }}>
                  Report text (for tickets)
                </div>
                <textarea readOnly value={d.report_text}
                  style={{ width:"100%", height:150, background:"var(--bg3)",
                    border:"1px solid var(--border2)", borderRadius:6, color:"var(--text3)",
                    fontFamily:"var(--mono)", fontSize:10,
                    padding:"10px 12px", resize:"vertical", outline:"none",
                    boxSizing:"border-box", lineHeight:1.6 }}/>
              </div>
            </>
          )}
        </div>

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", alignItems:"center",
          padding:"12px 18px", borderTop:"1px solid var(--border)" }}>
          {d && (
            <button onClick={copyReport}
              style={{ display:"inline-flex", alignItems:"center", gap:6,
                background: copied ? "var(--green)" : "var(--accent)", border:"none",
                borderRadius:6, color:"#fff", fontFamily:"inherit", fontSize:11,
                fontWeight:600, padding:"7px 14px", cursor:"pointer", marginRight:"auto" }}>
              <Icon name={copied ? "check" : "copy"} size={12}/>
              {copied ? "Report copied" : "Copy report"}
            </button>
          )}
          <button onClick={onClose}
            style={{ background:"var(--surface2)", border:"1px solid var(--border2)",
              borderRadius:6, color:"var(--text4)", fontFamily:"inherit",
              fontSize:11, padding:"7px 14px", cursor:"pointer" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Evidence Modal (DB / Kubernetes / Node / generic) ─── */
function evidenceChecklist(kind, a, rancher) {
  const labels = a.labels || {};
  if (kind === "k8s") {
    const obj = labels.pod ? "Pod" : labels.deployment ? "Deployment"
      : labels.statefulset ? "StatefulSet" : labels.daemonset ? "DaemonSet" : "Workload";
    return [
      `Open ${obj} ${rancher?.object || ""} in Rancher (deep link to the detail view, not the home page).`,
      "Check Ready status, restart count, and Events on the object.",
      "For pods that are not Ready: open View Logs and copy the primary error.",
      "Record the pod or deployment name and the error in the report for the owning team.",
    ];
  }
  if (kind === "k8s-node") {
    return [
      `Open node ${rancher?.object || nodeHost(a)} in Rancher.`,
      "Check Conditions (MemoryPressure / DiskPressure), Events, and node load.",
      "Open the Grafana chart to review node metric trends.",
      "Record the node, latest metric values, and affected pods.",
    ];
  }
  if (kind === "node") {
    return [
      "Open the Grafana panel to review node / VM metric trends.",
      labels.mountpoint
        ? `Check mountpoint ${labels.mountpoint} on host ${nodeHost(a)} (disk usage).`
        : `Check CPU, memory, and disk on host ${nodeHost(a)}.`,
      "Record the latest values and the time the alert started.",
      "If the host is a database server, escalate to the DBA team with this evidence.",
    ];
  }
  if (kind === "db-system") {
    return [
      "Open the ASM / DB System chart in Grafana to review disk and usage trends.",
      "Top SQL and AWR require a database OCID; this DB System has no OCI CLI access.",
      "Open DB Systems in the OCI Console to verify the resource.",
      "Escalate to the DBA team with the OCID, region, and ASM chart.",
    ];
  }
  if (kind === "db") {
    return [
      "Open Top SQL to review the statements with the highest elapsed time.",
      "Open the Grafana chart to review database session and load trends.",
      "Copy the SQL ID and main query into the report.",
      "Escalate to the DBA team if database load is high or a query is problematic.",
    ];
  }
  return [
    "Open the alert chart in Grafana to review trends and the latest value.",
    "Record the alert values or annotations and the time it started.",
    "Identify the owning team from the folder and resource.",
    "Copy this report for the ticket or escalation.",
  ];
}

function buildEvidenceReport(a, kind, rancher, grafana) {
  const labels = a.labels || {};
  const ann = a.annotations || {};
  let lines = [
    "ALERT CHECK EVIDENCE REPORT",
    `Alert        : ${shortName(a.name)}`,
    `Folder       : ${folderDisplay(a.folder)}`,
    `Severity     : ${a.severity || "-"}`,
    `Resource     : ${a.resource || "-"}`,
    `Since        : ${fmtTime(a.active_at)}`,
    `Duration     : ${fmtDur(a.duration_min || 0)}`,
    `Classification: ${kind}`,
  ];
  const ocid = dbOcid(a) || dbSystemOcid(a);
  const backupDb = backupDbFor(a);
  if (ocid) lines.push(`OCID         : ${ocid}`);
  if (backupDb) lines.push(`Backup DB    : ${backupDb.name} (${backupDb.group})`);
  if (labels.region || backupDb?.region) lines.push(`Region       : ${dbRegion(a)}`);
  if (rancher) {
    lines.push(`Rancher      : ${rancher.label}`);
    lines.push(`Rancher URL  : ${rancher.url}`);
    if (rancher.cluster?.name) lines.push(`Cluster      : ${rancher.cluster.name}`);
    if (rancher.namespace) lines.push(`Namespace    : ${rancher.namespace}`);
  }
  if (grafana) lines.push(`Grafana URL  : ${grafana}`);
  if (dbSystemOcid(a)) lines.push(`DB System URL: ${dbConsoleUrl(a)}`);
  lines.push("", "ALERT CONTEXT", ann.summary || ann.description || "(no summary or description)");
  const values = alertValues(a);
  if (values.length) {
    lines.push("", "LATEST VALUES");
    values.forEach(([k, v]) => lines.push(`  ${k} = ${v}`));
  }
  lines.push("", "EVIDENCE CHECKLIST");
  evidenceChecklist(kind, a, rancher).forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`);
  });
  lines.push("", `Generated: ${new Date().toLocaleString("en-GB")}`);
  return lines.join("\n");
}

function EvidenceModal({ alert, onClose, onTopSql }) {
  const [copied, setCopied] = useState(false);
  const kind = evidenceKind(alert);
  const labels = alert.labels || {};
  const ann = alert.annotations || {};
  const rancher = rancherTarget(alert);
  const grafana = grafanaEvidenceUrl(alert);
  const dbSys = dbSystemOcid(alert);
  const db = dbOcid(alert);
  const backupDb = backupDbFor(alert);
  const values = alertValues(alert);
  const checklist = evidenceChecklist(kind, alert, rancher);
  const report = buildEvidenceReport(alert, kind, rancher, grafana);

  const title = kind === "db-system" || kind === "db"
    ? "Database check evidence"
    : kind === "k8s" || kind === "k8s-node"
      ? "Kubernetes check evidence"
      : kind === "node"
        ? "Node / VM check evidence"
        : "Alert check evidence";

  const card = { background:"var(--bg3)", border:"1px solid var(--border)",
    borderRadius:8, padding:"10px 12px" };
  const cardTitle = { fontSize:9, fontWeight:700, color:"var(--muted2)",
    textTransform:"uppercase", letterSpacing:".07em", marginBottom:6 };
  const kv = (label, value, color) => (
    <div key={label} style={{ display:"flex", justifyContent:"space-between", gap:12,
      fontSize:11, padding:"3px 0" }}>
      <span style={{ color:"var(--muted)", flexShrink:0 }}>{label}</span>
      <span style={{ color:color || "var(--text3)", fontWeight:600,
        textAlign:"right", wordBreak:"break-all" }}>{value}</span>
    </div>
  );
  const linkBtn = (href, text, color) => href && (
    <a href={href} target="_blank" rel="noreferrer"
      style={{ ...MINI_BTN, color:color || "var(--blue)", textDecoration:"none" }}>
      {text} <Icon name="external" size={9}/>
    </a>
  );

  const copyReport = () => copyToClipboard(report, () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });

  return (
    <div onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)",
        display:"flex", alignItems:"center", justifyContent:"center",
        zIndex:1000, padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width:"100%", maxWidth:820, maxHeight:"88vh", display:"flex",
          flexDirection:"column", background:"var(--surface)",
          border:"1px solid var(--border2)", borderRadius:10,
          boxShadow:"0 20px 60px rgba(0,0,0,.6)", overflow:"hidden" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 18px",
          borderBottom:"1px solid var(--border)" }}>
          <span style={{ width:30, height:30, borderRadius:7,
            background: kind.startsWith("db") ? "var(--red-dim)" : kind.startsWith("k8s") ? "var(--blue-dim)" : "var(--surface3)",
            color: kind.startsWith("db") ? "var(--red)" : kind.startsWith("k8s") ? "var(--blue)" : "var(--text4)",
            display:"flex", alignItems:"center", justifyContent:"center" }}>
            <Icon name={kind.startsWith("db") ? "database" : kind.startsWith("k8s") ? "kubernetes" : "search"} size={15}/>
          </span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:650, color:"var(--text)" }}>{title}</div>
            <div style={{ fontSize:10, color:"var(--muted)", marginTop:2,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {shortName(alert.name)} · {folderDisplay(alert.folder)} · {alert.resource || "-"}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:"none", border:"none", color:"var(--muted2)", cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", padding:4 }}>
            <Icon name="close" size={15}/>
          </button>
        </div>

        <div style={{ padding:"12px 18px", overflowY:"auto", flex:1 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div style={card}>
              <div style={cardTitle}>Alert identity</div>
              {kv("Severity", alert.severity || "-")}
              {kv("Since", fmtTime(alert.active_at))}
              {kv("Duration", fmtDur(alert.duration_min || 0))}
              {kv("Folder", folderDisplay(alert.folder))}
            </div>
            <div style={card}>
              <div style={cardTitle}>Check target</div>
              {kind.startsWith("k8s") && rancher && (
                <>
                  {kv("Cluster", rancher.cluster?.name || "-")}
                  {kv("Object", `${rancher.kind} ${rancher.object || ""}`)}
                  {kv("Namespace", rancher.namespace || "-")}
                </>
              )}
              {kind === "node" && (
                <>
                  {kv("Host", nodeHost(alert))}
                  {kv("Instance", rawInstance(alert) || "-")}
                  {kv("Job", labels.job || "-")}
                  {labels.mountpoint && kv("Mountpoint", labels.mountpoint)}
                </>
              )}
              {(kind === "db" || kind === "db-system") && (
                <>
                  {kv("DB", backupDb?.name || labels.resourceName || alert.resource || "-")}
                  {backupDb && kv("Backup group", backupDb.group)}
                  {kv("Type", dbSys ? "DB System / ASM" : "Managed Database")}
                  {kv("Region", dbRegion(alert))}
                  {kv("OCID", db || dbSys || "-")}
                  {labels.diskgroupName && kv("Diskgroup", labels.diskgroupName)}
                </>
              )}
              {kind === "generic" && (
                <>
                  {kv("Resource", alert.resource || "-")}
                  {kv("Rule", labels.rulename || labels.alertname || "-")}
                </>
              )}
            </div>
          </div>

          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:10 }}>
            {rancher && linkBtn(rancher.url, rancher.label)}
            {(kind === "db" || kind === "db-system") && (db || dbSys) && (
              <button onClick={() => onTopSql(alert)} style={MINI_BTN}>Top SQL</button>
            )}
            {dbSys && !db && linkBtn(dbConsoleUrl(alert), "Open DB Systems")}
            {grafana && linkBtn(grafana, "Open Grafana chart")}
          </div>

          <div style={{ ...card, marginTop:10 }}>
            <div style={cardTitle}>Alert context and values</div>
            <div style={{ fontSize:11, color:"var(--text3)", lineHeight:1.6 }}>
              {ann.summary || ann.description || "No summary or description on this alert."}
            </div>
            {values.length > 0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:8 }}>
                {values.map(([k, v]) => (
                  <span key={k} style={{ fontSize:10, color:"var(--text3)",
                    background:"var(--surface2)", border:"1px solid var(--border2)",
                    borderRadius:4, padding:"2px 7px" }}>
                    {k}: <b>{v}</b>
                  </span>
                ))}
              </div>
            )}
            {ann.Error && (
              <div style={{ marginTop:8, fontSize:10, color:"var(--red)", lineHeight:1.5 }}>
                Error: {ann.Error}
              </div>
            )}
          </div>

          <div style={{ ...card, marginTop:10 }}>
            <div style={cardTitle}>Evidence checklist</div>
            <ol style={{ margin:0, paddingLeft:18, fontSize:11, color:"var(--text3)",
              lineHeight:1.7 }}>
              {checklist.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
            {(kind.startsWith("k8s") || kind === "node") && (
              <div style={{ marginTop:8, fontSize:10, color:"var(--muted)", lineHeight:1.5 }}>
                Rancher uses your browser session. This application does not store Rancher
                credentials and will not ask you to sign in again while a Rancher tab is active.
              </div>
            )}
          </div>

          <div style={{ marginTop:12 }}>
            <div style={{ fontSize:9, fontWeight:700, color:"var(--muted2)",
              textTransform:"uppercase", letterSpacing:".07em", marginBottom:6 }}>
              Report text (for tickets)
            </div>
            <textarea readOnly value={report}
              style={{ width:"100%", height:170, background:"var(--bg3)",
                border:"1px solid var(--border2)", borderRadius:6, color:"var(--text3)",
                fontFamily:"var(--mono)", fontSize:10,
                padding:"10px 12px", resize:"vertical", outline:"none",
                boxSizing:"border-box", lineHeight:1.6 }}/>
          </div>
        </div>

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", alignItems:"center",
          padding:"12px 18px", borderTop:"1px solid var(--border)" }}>
          <button onClick={copyReport}
            style={{ display:"inline-flex", alignItems:"center", gap:6,
              background: copied ? "var(--green)" : "var(--accent)", border:"none",
              borderRadius:6, color:"#fff", fontFamily:"inherit", fontSize:11,
              fontWeight:600, padding:"7px 14px", cursor:"pointer", marginRight:"auto" }}>
            <Icon name={copied ? "check" : "copy"} size={12}/>
            {copied ? "Report copied" : "Copy report"}
          </button>
          <button onClick={onClose}
            style={{ background:"var(--surface2)", border:"1px solid var(--border2)",
              borderRadius:6, color:"var(--text4)", fontFamily:"inherit",
              fontSize:11, padding:"7px 14px", cursor:"pointer" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Label badge colors ─────────────────────────────── */
/* Labels stay neutral so the accent colour only marks alerts. */

/* ─── Alert Row ──────────────────────────────────────── */
function AlertRow({ a, isNew, eskalasi, onLaporkan, onEvidence, onGrafana }) {
  const [expanded, setExpanded] = useState(false);
  const fc      = folderColor(a.folder);
  const sev     = getSeverity(a.name, a.severity);
  const sc      = SEV_COLOR[sev];
  const done    = eskalasi.has(a._key);
  const isOld   = a.duration_min > 720;
  const labels  = a.labels || {};
  // Label paling penting tampil langsung, sisanya di expand
  const PRIORITY = ["instance","nodename","node","cluster","namespace","deployment",
                    "job","service","resourceName","hostName","mountpoint","volume","pod"];
  const allLabelEntries = Object.entries(labels);
  const priorityEntries = allLabelEntries.filter(([k])=>PRIORITY.includes(k));
  const otherEntries    = allLabelEntries.filter(([k])=>!PRIORITY.includes(k));
  const visibleEntries  = [...priorityEntries, ...otherEntries].slice(0,4);
  const hiddenCount     = allLabelEntries.length - visibleEntries.length;

  const rowBg = isOld ? "var(--bg3)" : isNew ? "var(--red-dim)" : "transparent";
  const healthCheck = isHealthCheckAlert(a);
  const db = isDbAlert(a);
  const dbId = dbOcid(a);
  const dbSys = dbSystemOcid(a);
  const k8s = isK8sAlert(a);
  const nodeAlert = isNodeAlert(a);
  const rancher = rancherTarget(a);
  const grafanaUrl = grafanaEvidenceUrl(a);

  return (
    <>
      <tr style={{ borderBottom: expanded ? "none" : "1px solid var(--border)",
        background: rowBg, opacity: isOld ? 0.6 : 1 }}>

        {/* alert name + expand toggle */}
        <td style={{ padding:"8px 10px", verticalAlign:"middle" }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:7 }}>
            <button onClick={()=>setExpanded(v=>!v)}
              style={{ background:"none", border:"none", color:"var(--muted2)",
                cursor:"pointer", padding:"0 2px", flexShrink:0,
                lineHeight:1, marginTop:2, display:"flex", alignItems:"center" }}>
              <Icon name={expanded ? "chevronDown" : "chevronRight"} size={11}/>
            </button>
            {isNew && !isOld && (
              <span style={{ width:6,height:6,borderRadius:"50%",background:"var(--red)",
                flexShrink:0,boxShadow:"0 0 0 3px var(--red-dim)",
                marginTop:5 }}/>
            )}
            {isOld && (
              <span style={{ fontSize:9,fontWeight:700,color:"var(--amber)",
                background:"var(--amber-dim)",border:"1px solid var(--border)",
                padding:"1px 5px",borderRadius:3,whiteSpace:"nowrap",flexShrink:0 }}>
                LONG
              </span>
            )}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11.5,fontWeight:550,
                color: isOld?"var(--muted3)":isNew?"var(--text)":"var(--text3)",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                {shortName(a.name)}
              </div>
              {/* label badges inline */}
              {visibleEntries.length > 0 && (
                <div style={{ display:"flex",flexWrap:"wrap",gap:3,marginTop:4 }}>
                  {visibleEntries.map(([k,v])=>{
                    return (
                      <span key={k} style={{ fontSize:9,borderRadius:3,padding:"1px 5px",
                        background:"var(--surface2)",border:"1px solid var(--border)",color:"var(--text4)",
                        whiteSpace:"nowrap",maxWidth:140,overflow:"hidden",
                        textOverflow:"ellipsis",display:"inline-block" }}
                        title={`${k}=${v}`}>
                        <span style={{opacity:.7}}>{k} </span>{v}
                      </span>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <span style={{ fontSize:9,color:"var(--muted)",padding:"1px 4px",
                      border:"1px solid var(--border2)",borderRadius:3 }}>
                      +{hiddenCount} more
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </td>

        {/* folder */}
        <td style={{ padding:"8px 10px", verticalAlign:"top", paddingTop:10 }}>
          <span style={{ fontSize:10,fontWeight:700,
            color:isOld?"var(--muted3)":fc,background:"var(--surface2)",
            padding:"2px 7px",borderRadius:4,whiteSpace:"nowrap" }}>
            {folderDisplay(a.folder)}
          </span>
        </td>

        {/* severity */}
        <td style={{ padding:"8px 10px", verticalAlign:"top", paddingTop:10 }}>
          {a.state==="NoData" ? (
            <span style={{ fontSize:10,fontWeight:700,color:"var(--muted)",
              background:"var(--surface2)",padding:"2px 7px",borderRadius:4 }}>NO DATA</span>
          ) : (
            <span style={{ fontSize:10,fontWeight:700,
              color:isOld?"var(--muted3)":sc,background:"var(--surface2)",
              padding:"2px 7px",borderRadius:4,textTransform:"uppercase" }}>
              {sev}
            </span>
          )}
        </td>

        {/* since */}
        <td style={{ padding:"8px 10px", verticalAlign:"top", paddingTop:10,
          color:isOld?"var(--muted3)":"var(--muted)", fontSize:10, whiteSpace:"nowrap" }}>
          {fmtTime(a.active_at)}
        </td>

        {/* duration */}
        <td style={{ padding:"8px 10px", verticalAlign:"top", paddingTop:10, textAlign:"right" }}>
          <span style={{ display:"inline-flex", alignItems:"center", gap:4,
            fontWeight:600,fontSize:11,whiteSpace:"nowrap",
            color:isOld?"var(--muted3)":a.duration_min>60?"var(--red)":"var(--amber)" }}>
            <Icon name="clock" size={11}/> {fmtDur(a.duration_min)}
          </span>
        </td>

        {/* action */}
        <td style={{ padding:"8px 10px", verticalAlign:"top", paddingTop:8, textAlign:"right" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end", whiteSpace:"nowrap" }}>
            {db && (dbId || dbSys) && ociTopSqlUrl(a) && (
              <a href={ociTopSqlUrl(a)} target="_blank" rel="noreferrer"
                title="Open OCI Top SQL in a new tab (uses your OCI session; asks for login when needed)"
                style={{ ...MINI_BTN, textDecoration: "none" }}>
                Top SQL <Icon name="external" size={9}/>
              </a>
            )}
            <button onClick={()=>onGrafana(a)}
              title="View the Grafana history chart for this alert"
              style={{ ...MINI_BTN, color:"var(--rose)",
                borderColor:"rgba(232,165,152,.32)" }}>
              <Icon name="grafana" size={10}/> Grafana
            </button>
            {db && (!dbId || dbSys) && (
              <button onClick={()=>onEvidence(a)}
                title="DB System / ASM evidence, Grafana chart, and OCI access"
                style={MINI_BTN}>
                DB evidence
              </button>
            )}
            {healthCheck && (
              <button onClick={()=>onEvidence(a)}
                title="Live URL probe, TLS certificate, and blackbox history"
                style={MINI_BTN}>
                Check URL
              </button>
            )}
            {k8s && (
              <a href={rancher?.url || RANCHER_HOME_URL} target="_blank" rel="noreferrer"
                title={rancher
                  ? `Open ${rancher.kind} ${rancher.object || ""} directly in Rancher (new tab, your session)`
                  : "Cluster is not mapped yet; open Rancher and select the cluster manually"}
                style={{ ...MINI_BTN, textDecoration:"none" }}>
                {rancher?.label || "Rancher"} <Icon name="external" size={9}/>
              </a>
            )}
            {k8s && (
              <button onClick={()=>onEvidence(a)}
                title="Evidence checklist, Rancher target, and Grafana chart"
                style={MINI_BTN}>
                K8s evidence
              </button>
            )}
            {!db && !healthCheck && !k8s && nodeAlert && (
              <button onClick={()=>onEvidence(a)}
                title="Node / VM evidence: Grafana chart, alert values, and checklist"
                style={MINI_BTN}>
                Check node
              </button>
            )}
            {!db && !healthCheck && !k8s && !nodeAlert && (
              <button onClick={()=>onEvidence(a)}
                title="Alert details and Grafana chart evidence"
                style={MINI_BTN}>
                Details
              </button>
            )}
            {done ? (
              <span style={{ fontSize:10,color:"var(--green)",fontWeight:600,
                display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end" }}>
                <Icon name="check" size={11}/> Escalated
              </span>
            ) : (
              <button onClick={()=>onLaporkan(a)}
                style={{ background:isOld?"var(--surface2)":"var(--accent)",
                  border:isOld?"1px solid var(--border2)":"1px solid var(--accent)",
                  borderRadius:5,color:isOld?"var(--muted3)":"#ffffff",
                  fontFamily:"inherit",fontSize:10,fontWeight:600,
                  padding:"4px 10px",cursor:"pointer",whiteSpace:"nowrap",
                  display:"inline-flex",alignItems:"center",gap:4 }}>
                <Icon name="alert" size={10}/> Report
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* ── Expanded: semua label ── */}
      {expanded && (
        <tr style={{ borderBottom:"1px solid var(--border)", background:"var(--bg3)" }}>
          <td colSpan={6} style={{ padding:"8px 14px 10px 30px" }}>
            <div style={{ fontSize:9,color:"var(--muted2)",marginBottom:5,
              textTransform:"uppercase",letterSpacing:".08em" }}>
              All Labels
            </div>
            <div style={{ display:"flex",flexWrap:"wrap",gap:4 }}>
              {allLabelEntries.map(([k,v])=>{
                return (
                  <span key={k} style={{ fontSize:9,borderRadius:3,padding:"2px 7px",
                    background:"var(--surface2)",border:"1px solid var(--border)",color:"var(--text4)",
                    whiteSpace:"nowrap",maxWidth:280,overflow:"hidden",
                    textOverflow:"ellipsis",display:"inline-block" }}
                    title={`${k}=${v}`}>
                    <span style={{opacity:.65,fontWeight:600}}>{k}</span>
                    <span style={{color:"var(--muted)"}}> = </span>
                    {v}
                  </span>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Ringtone playback itself now lives in components/AlertWatcher.jsx, which
// is mounted globally in App.jsx so it keeps ringing on every page — not
// just while this Alert Monitor page happens to be open. This page only
// reads/writes the shared mute flag via alertMute.js.

/* ─── Alert Table (reusable section) ────────────────── */
function AlertTable({ alerts, newSet, eskalasi, onLaporkan, onEvidence, onGrafana, title, titleColor, headerBg, dim }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginTop:14, border:"1px solid var(--border)",
      borderRadius:12, overflow:"hidden", background:"var(--bg2)",
      boxShadow:"var(--shadow-card)" }}>
      {/* section header */}
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 14px",
        background: headerBg||"var(--bg3)", cursor:"pointer", userSelect:"none",
        borderBottom: open ? "1px solid var(--border)" : "none" }}
        onClick={()=>setOpen(v=>!v)}>
        <span style={{ width:8, height:8, borderRadius:2,
          background:titleColor, flexShrink:0 }}/>
        <span style={{ flex:1, fontSize:11.5, fontWeight:650, color:titleColor }}>
          {title}
        </span>
        <span style={{ display:"inline-flex", color:"var(--muted2)",
          transform:open?"rotate(90deg)":"none",
          transition:"transform .15s" }}><Icon name="chevronRight" size={11}/></span>
      </div>
      {open && (
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:"1px solid var(--border)",
              background:"var(--bg3)" }}>
              {[
                { label:"Alert Name / Labels", align:"left"  },
                { label:"Folder",              align:"left"  },
                { label:"Severity",            align:"left"  },
                { label:"Since",               align:"left"  },
                { label:"Duration",            align:"right" },
                { label:"Action",              align:"right" },
              ].map(h => (
                <th key={h.label} style={{ padding:"7px 10px", textAlign:h.align,
                  fontSize:9, fontWeight:700,
                  color:"var(--muted2)",
                  letterSpacing:".1em", textTransform:"uppercase",
                  whiteSpace:"nowrap" }}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {alerts.map((a,i) => (
              <AlertRow key={i} a={a}
                isNew={newSet.has(a._key)}
                eskalasi={eskalasi}
                onLaporkan={onLaporkan}
                onEvidence={onEvidence}
                onGrafana={onGrafana}/>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─── MAIN ───────────────────────────────────────────── */
const ESKALASI_KEY        = "pr_alert_eskalasi";
const ALERT_TASK_KEY      = "pr_alert_task_ids";
/* ── API helpers for tasks ── */
const taskApiCreate = (task) =>
  fetch("/api/tasks", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(task) }).then(r=>r.json());
const taskApiUpdate = (id, changes) =>
  fetch(`/api/tasks/${id}`, { method:"PUT",  headers:{"Content-Type":"application/json"}, body:JSON.stringify(changes) }).then(r=>r.json());

async function createTaskFromAlert(alert) {
  const resource = alert.resource && alert.resource !== "-" ? ` → ${alert.resource}` : "";
  const folder   = folderDisplay(alert.folder);
  const alertKey = alert._key || `${alert.name}||${alert.resource}||${alert.active_at}`;
  const ticket   = getOrCreateTicket(alertKey);
  const pic      = sessionStorage.getItem("pr_display") || sessionStorage.getItem("pr_user") || "";
  const task     = {
    id:          `alert_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    alertKey,
    customer:    folder,
    description: `[ALERT] ${shortName(alert.name)}${resource}`,
    date:        localISODate(),
    start:       new Date().toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" }),
    end:         "",
    pic,
    status:      "In Progress",
    detail:      `Ticket: ${ticket}\nSeverity: ${alert.severity || "-"}\nDuration: ${fmtDur(alert.duration_min)}\nSince: ${fmtTime(alert.active_at)}\nFolder: ${folder}`,
    createdAt:   new Date().toISOString(),
  };
  await taskApiCreate(task);
  return task.id;
}

async function syncAlertsToDailyTask(alerts) {
  // Fetch existing tasks dari API
  let existing = [];
  try {
    const res = await fetch("/api/tasks");
    existing  = await res.json();
    if (!Array.isArray(existing)) existing = [];
  } catch { return { added:0, resolved:0 }; }

  const existingDescs = new Set(existing.map(t => t.description));
  const tracked = (() => {
    try { return new Set(JSON.parse(localStorage.getItem(ALERT_TASK_KEY) || "[]")); } catch { return new Set(); }
  })();
  const newKeys = new Set(tracked);

  // ── 1. Tambah task untuk alert baru ──
  let added = 0;
  for (const a of alerts) {
    if (a.duration_min < 5) continue;
    const key      = `${a.name}||${a.resource}||${a.active_at}`;
    const resource = a.resource && a.resource !== "-" ? ` → ${a.resource}` : "";
    const desc     = `[ALERT] ${shortName(a.name)}${resource}`;

    if (!canCreateTicket(key)) { newKeys.add(key); continue; }
    if (tracked.has(key) || existingDescs.has(desc)) { newKeys.add(key); continue; }

    const folder = folderDisplay(a.folder);
    const ticket = getOrCreateTicket(key);
    const pic    = sessionStorage.getItem("pr_display") || sessionStorage.getItem("pr_user") || "";
    await taskApiCreate({
      id:          `alert_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      alertKey:    key,
      customer:    folder,
      description: desc,
      date:        localISODate(),
      start:       new Date().toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" }),
      end:         "",
      pic,
      status:      a.duration_min <= 10 ? "In Progress" : "Pending",
      detail:      `Ticket: ${ticket}\nSeverity: ${a.severity || "-"}\nDuration: ${fmtDur(a.duration_min)}\nSince: ${fmtTime(a.active_at)}\nFolder: ${folder}`,
      createdAt:   new Date().toISOString(),
    });
    // Same reasoning as the auto-close log below — without this,
    // "Tasks Created" in Engineer Activity KPI undercounts alert-generated
    // tasks because it only reads the activity log, not /api/tasks directly.
    logActivity("Create Ticket", "task", `[${folder}] ${desc}`);
    recordTicketCreated(key);
    newKeys.add(key);
    added++;
  }

  // ── 2. Mark Close untuk alert yang sudah resolved ──
  const activeDescs = new Set(
    alerts.filter(a => a.duration_min >= 5).map(a => {
      const resource = a.resource && a.resource !== "-" ? ` → ${a.resource}` : "";
      return `[ALERT] ${shortName(a.name)}${resource}`;
    })
  );

  let resolved = 0;
  for (const t of existing) {
    if (!t.description?.startsWith("[ALERT]")) continue;
    if (t.status === "Close" || t.status === "Cancelled") continue;
    if (!activeDescs.has(t.description)) {
      await taskApiUpdate(t.id, {
        status: "Close",
        end:    new Date().toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" }),
        detail: (t.detail || "") + `\n\nResolved: ${new Date().toLocaleString("en-GB")}`,
      });
      // Auto-close by the alert sync must also be recorded, otherwise
      // Engineer Activity KPI's "Tasks Closed" undercounts — it only reads
      // from the activity log, not from task status directly.
      logActivity("Update Ticket Status", "task", `${t.description} → Close`);
      resolved++;
    }
  }

  if (added > 0 || resolved > 0) {
    localStorage.setItem(ALERT_TASK_KEY, JSON.stringify([...newKeys]));
  }
  return { added, resolved };
}

export default function AlertPage() {
  const [allAlerts,  setAllAlerts]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [alertsError, setAlertsError] = useState("");
  const [search,     setSearch]     = useState("");
  const [folderFil,  setFolderFil]  = useState("");
  const [modal,      setModal]      = useState(null);
  const [topSqlFor, setTopSqlFor] = useState(null);
  const [evidenceFor, setEvidenceFor] = useState(null);
  const [grafanaFor, setGrafanaFor] = useState(null);
  const [, setDbCatalogTick] = useState(0);
  const [muted,      setMutedState] = useState(() => isAlertMuted());
  const [toast,      setToast]      = useState(null); // {msg, count}
  // eskalasi: Set of _key strings — shared di backend supaya semua
  // engineer melihat alert yang sudah dilaporkan oleh siapa pun.
  const [eskalasi, setEskalasi] = useState(() => new Set());
  // Track alert _key yang sudah dibuat task — hindari duplikat
  const [alertTaskIds, setAlertTaskIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(ALERT_TASK_KEY)||"[]")); }
    catch { return new Set(); }
  });

  const loadEskalasi = useCallback(() => {
    fetch("/api/alerts/eskalasi")
      .then(r => r.json())
      .then(d => setEskalasi(new Set(Object.keys(d || {}))))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/grafana/alerts")
      .then(r => r.json())
      .then(d => {
        setAllAlerts(Array.isArray(d.alerts) ? d.alerts : []);
        setAlertsError(d.error || "");
        setLastUpdate(new Date());
      })
      .catch(() => setAlertsError("Unable to reach the backend"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/backup/databases")
      .then(r => r.json())
      .then(d => {
        setBackupDatabases(d.databases || []);
        setDbCatalogTick(t => t + 1);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    loadEskalasi();
    const iv = setInterval(load, 30000); // refresh tiap 30 detik
    const ivEsk = setInterval(loadEskalasi, 30000); // sync status eskalasi antar user
    return () => { clearInterval(iv); clearInterval(ivEsk); };
  }, [load, loadEskalasi]);

  const markEskalasi = (key, alert) => {
    setEskalasi(prev => new Set(prev).add(key));
    const by = sessionStorage.getItem("pr_display") || sessionStorage.getItem("pr_user") || "";
    fetch("/api/alerts/eskalasi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, by }),
    }).catch(() => {});

    // PIC task di Daily Task ikut diupdate jadi engineer yang benar-benar
    // melapor — bukan siapa yang browsernya kebetulan lebih dulu terbuka
    // saat auto-sync membuat task tersebut.
    if (alert && by) {
      const resource = alert.resource && alert.resource !== "-" ? ` → ${alert.resource}` : "";
      const desc     = `[ALERT] ${shortName(alert.name)}${resource}`;
      fetch("/api/tasks")
        .then(r => r.json())
        .then(tasks => {
          if (!Array.isArray(tasks)) return;
          const match = tasks.find(t => t.description === desc && t.status !== "Close" && t.status !== "Cancelled");
          if (match && match.pic !== by) {
            taskApiUpdate(match.id, { pic: by });
          }
        })
        .catch(() => {});
    }
  };

  // ── Auto-buat task di Daily Task untuk setiap alert baru ──
  useEffect(() => {
    if (!allAlerts.length) return;
    syncAlertsToDailyTask(allAlerts).then(({ added, resolved }) => {
      if (added > 0 || resolved > 0) {
        try {
          setAlertTaskIds(new Set(JSON.parse(localStorage.getItem(ALERT_TASK_KEY)||"[]")));
        } catch {}
        const msgs = [];
        if (added > 0)    msgs.push(`${added} new ${added === 1 ? "alert" : "alerts"} → task`);
        if (resolved > 0) msgs.push(`${resolved} alert resolved → Close`);
        setToast({ msg: msgs.join(" · "), count: added });
        setTimeout(() => setToast(null), 4000);
      }
    }).catch(() => {});
  }, [allAlerts]);

  // Stay in sync if mute is toggled from elsewhere (e.g. another tab/page).
  useEffect(() => onAlertMuteChange(setMutedState), []);
  const toggleMuted = () => setAlertMuted(!muted); // persists + notifies AlertWatcher

  // Tampilkan semua alert aktif (termasuk yang baru firing < 5 menit);
  // threshold 5 menit hanya dipakai untuk auto-create/auto-close ticket.
  const withKey = allAlerts
    .map(a => ({ ...a, _key: `${a.name}||${a.resource}||${a.active_at}` }));

  const newSet = new Set(withKey.filter(a => a.duration_min <= 30).map(a => a._key));

  const filtered = withKey.filter(a => {
    if (folderFil && a.folder !== folderFil) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!a.name.toLowerCase().includes(s) &&
          !(a.resource||"").toLowerCase().includes(s) &&
          !folderDisplay(a.folder).toLowerCase().includes(s)) return false;
    }
    return true;
  });

  // sort: new first (freshest on top), then active (<12h) by duration desc,
  // then old (>12h) at bottom
  const activeAlerts = filtered.filter(a => a.duration_min <= 720)
    .sort((a,b) => {
      const aN = newSet.has(a._key), bN = newSet.has(b._key);
      if (aN !== bN) return aN ? -1 : 1;
      if (aN) return a.duration_min - b.duration_min;
      return b.duration_min - a.duration_min;
    });
  const oldAlerts = filtered.filter(a => a.duration_min > 720)
    .sort((a,b) => b.duration_min - a.duration_min);
  const sorted = [...activeAlerts, ...oldAlerts];
  const allFolders = [...new Set(withKey.map(a => a.folder))].sort();

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden",
      background:"var(--bg)", fontFamily:"var(--font)" }}>

      {/* ── Header ── */}
      <PageHeader
        icon="alert"
        title="Alert Monitor"
        subtitle={`Active Grafana alerts · live${lastUpdate ? ` · updated ${lastUpdate.toLocaleTimeString("en-GB",{timeZone:"Asia/Jakarta",hour:"2-digit",minute:"2-digit",second:"2-digit"})} WIB` : ""}`}
        actions={
          <>
            <button onClick={load} disabled={loading}
              style={{ background:"var(--surface2)", border:"1px solid var(--border2)", borderRadius:6,
                color:"var(--text4)", fontSize:11, padding:"5px 12px", cursor:"pointer",
                fontFamily:"inherit" }}>
              <span style={{ display:"inline-flex",
                animation: loading ? "spin 1s linear infinite" : "none" }}><Icon name="refresh" size={12}/></span>
              {" "}Refresh
            </button>
            <button onClick={() => {
                localStorage.removeItem(ALERT_TASK_KEY);
                setAlertTaskIds(new Set());
                syncAlertsToDailyTask(allAlerts).then(({ added, resolved }) => {
                  const msgs = [];
                  if (added > 0)    msgs.push(`${added} alert → Task`);
                  if (resolved > 0) msgs.push(`${resolved} resolved → Close`);
                  setToast({ msg: msgs.length ? msgs.join(" · ") : "Everything is already in sync", count: added });
                  setTimeout(() => setToast(null), 4000);
                }).catch(() => {});
              }}
              style={{ background:"var(--surface2)", border:"1px solid var(--border2)",
                borderRadius:6, color:"var(--green)", fontSize:11, fontWeight:600,
                padding:"5px 12px", cursor:"pointer", fontFamily:"inherit",
                display:"flex", alignItems:"center", gap:5 }}>
              <Icon name="pin" size={12}/> Sync to tasks
            </button>
            <button onClick={toggleMuted}
              title={muted ? "Enable alert sound" : "Mute alert sound"}
              style={{ background: muted ? "var(--surface2)" : "var(--amber-dim)",
                border: muted ? "1px solid var(--border2)" : "1px solid var(--amber)",
                borderRadius:6, color: muted ? "var(--muted)" : "var(--amber)",
                fontSize:13, padding:"5px 10px", cursor:"pointer",
                display:"flex", alignItems:"center", gap:4 }}>
              <Icon name={muted ? "bellOff" : "bell"} size={12}/>
              <span style={{ fontSize:10, fontWeight:600 }}>{muted ? "Muted" : "Sound on"}</span>
            </button>
          </>
        }
      />

      {/* ── Toolbar: search, folder filter, live counters ── */}
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 28px",
        borderBottom:"1px solid var(--border)", background:"var(--bg2)", flexShrink:0,
        flexWrap:"wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search alert / resource…"
          style={{ background:"var(--surface2)", border:"1px solid var(--border2)", borderRadius:6,
            color:"var(--text3)", fontSize:11.5, padding:"6px 10px",
            fontFamily:"inherit", outline:"none", width:240 }}/>
        <select value={folderFil} onChange={e => setFolderFil(e.target.value)}
          style={{ background:"var(--surface2)", border:"1px solid var(--border2)", borderRadius:6,
            color:"var(--text3)", fontSize:11.5, padding:"6px 10px",
            fontFamily:"inherit", outline:"none" }}>
          <option value="">All Folders</option>
          {allFolders.map(f => (
            <option key={f} value={f}>{folderDisplay(f)}</option>
          ))}
        </select>

        <div style={{ display:"flex", alignItems:"center", gap:20, marginLeft:"auto" }}>
          {[
            { label:"Firing",     value: withKey.length,                                     color:"var(--red)" },
            { label:"Active",     value: activeAlerts.length,                                color:"var(--red)" },
            { label:"New ≤30m",   value: newSet.size,                                        color:"var(--amber)" },
            { label:"Escalated",  value: [...eskalasi].filter(k=>withKey.find(a=>a._key===k)).length, color:"var(--green)" },
            { label:"> 12h",      value: oldAlerts.length,                                   color:"var(--muted)" },
          ].map(s => (
            <div key={s.label} style={{ display:"flex", alignItems:"baseline", gap:6 }}>
              <span style={{ fontSize:15, fontWeight:700, color:s.color, letterSpacing:"-.02em" }}>{s.value}</span>
              <span style={{ fontSize:9.5, fontWeight:600, color:"var(--muted2)",
                textTransform:"uppercase", letterSpacing:".06em" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {alertsError && (
        <div style={{ margin:"8px 28px 0", padding:"8px 12px", borderRadius:6,
          background:"var(--amber-dim)", border:"1px solid var(--border2)",
          color:"var(--amber)", fontSize:11, flexShrink:0,
          display:"flex", alignItems:"center", gap:7 }}>
          <Icon name="warning" size={13}/> Grafana alerts are unavailable — {alertsError}
        </div>
      )}

      {/* ── Content ── */}
      <div style={{ flex:1, overflow:"auto", padding:"14px 28px 24px",
        background:"var(--bg)" }}>
        {loading && !allAlerts.length ? (
          <div style={{ textAlign:"center", color:"var(--muted2)", paddingTop:60, fontSize:12 }}>
            Loading alerts…
          </div>
        ) : withKey.length === 0 ? (
          <div style={{ textAlign:"center", paddingTop:70 }}>
            <div style={{ width:44, height:44, borderRadius:"50%", background:"var(--green-dim)",
              color:"var(--green)", display:"inline-flex", alignItems:"center",
              justifyContent:"center", marginBottom:10 }}>
              <Icon name="checkCircle" size={22}/>
            </div>
            <div style={{ fontSize:13, fontWeight:600, color:"var(--text2)" }}>No active alerts</div>
            <div style={{ fontSize:11, color:"var(--muted)", marginTop:3 }}>All monitored services are reporting normally.</div>
          </div>
        ) : (
          <>
            {/* ── Section Active (< 12 jam) ── */}
            {activeAlerts.length > 0 && (
              <AlertTable
                alerts={activeAlerts} newSet={newSet}
                eskalasi={eskalasi} onLaporkan={setModal}
                onEvidence={setEvidenceFor}
                onGrafana={setGrafanaFor}
                title={`Active alerts (< 12h) — ${activeAlerts.length} firing`}
                titleColor="var(--red)"
                headerBg="var(--bg3)"
              />
            )}

            {/* ── Section Long Running (> 12 jam) ── */}
            {oldAlerts.length > 0 && (
              <AlertTable
                alerts={oldAlerts} newSet={newSet}
                eskalasi={eskalasi} onLaporkan={setModal}
                onEvidence={setEvidenceFor}
                onGrafana={setGrafanaFor}
                title={`Long running (> 12h) — ${oldAlerts.length} alerts`}
                titleColor="var(--amber)"
                headerBg="var(--bg3)"
                dim
              />
            )}
          </>
        )}
      </div>

      {/* ── Laporkan Modal ── */}
      {modal && (
        <LaporkanModal
          alert={modal}
          alreadyEskalasi={eskalasi.has(modal._key)}
          onClose={() => setModal(null)}
          onEskalasi={(key, a) => { markEskalasi(key, a); }}/>
      )}

      {/* ── Top SQL page ── */}
      {topSqlFor && (
        <TopSqlPage alert={topSqlFor} onClose={() => setTopSqlFor(null)}/>
      )}

      {/* ── Grafana history chart ── */}
      {grafanaFor && (
        <GrafanaChartModal alert={grafanaFor} onClose={() => setGrafanaFor(null)}/>
      )}

      {/* ── Evidence Modal: health URL vs DB/K8s/Node ── */}
      {evidenceFor && (isHealthCheckAlert(evidenceFor) ? (
        <HealthCheckModal alert={evidenceFor} onClose={() => setEvidenceFor(null)}/>
      ) : (
        <EvidenceModal
          alert={evidenceFor}
          onClose={() => setEvidenceFor(null)}
          onTopSql={(a) => { setEvidenceFor(null); setTopSqlFor(a); }}/>
      ))}

      {/* ── Toast notif ── */}
      {toast && (
        <div style={{ position:"fixed", bottom:24, right:24, zIndex:2000,
          background:"var(--surface)", border:"1px solid var(--border2)",
          borderRadius:8, padding:"10px 16px", display:"flex",
          alignItems:"center", gap:9, boxShadow:"var(--shadow-pop)",
          animation:"slideIn .3s ease" }}>
          <span style={{ color:"var(--green)", display:"flex" }}><Icon name="checkCircle" size={15}/></span>
          <span style={{ fontSize:12, color:"var(--text2)" }}>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
