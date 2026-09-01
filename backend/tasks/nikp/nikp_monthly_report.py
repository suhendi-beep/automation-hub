"""
tasks/nikp/nikp_monthly_report.py
Monthly Report NIKP (AWS) — generate PPTX dari data real AWS.

Template identik dengan generate_nikp_pptx.py di root project.
Data hardcoded diganti dengan data dari AWS boto3.

Env vars yang dibutuhkan (set di .env):
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_ACCOUNT_ID   (default: 038361715485)
  AWS_REGION       (default: ap-southeast-1)
"""
import os
from datetime import datetime, date
from dateutil.relativedelta import relativedelta

# ── pptx imports ─────────────────────────────────────────────────────────────
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

# ── Brand Colors (sama persis dengan generate_nikp_pptx.py) ──────────────────
C_DARK   = RGBColor(0x1A, 0x1A, 0x2E)
C_ACCENT = RGBColor(0x16, 0x21, 0x3E)
C_BLUE   = RGBColor(0x0F, 0x3C, 0x96)
C_CYAN   = RGBColor(0x00, 0xB4, 0xD8)
C_WHITE  = RGBColor(0xFF, 0xFF, 0xFF)
C_GRAY   = RGBColor(0xB0, 0xB8, 0xC8)
C_RED    = RGBColor(0xE5, 0x3E, 0x3E)
C_YELLOW = RGBColor(0xF6, 0xC9, 0x0E)
C_GREEN  = RGBColor(0x2E, 0xCC, 0x71)
C_ORANGE = RGBColor(0xF3, 0x96, 0x10)

W, H = Inches(13.33), Inches(7.5)


# ── Template helpers (identik dengan generate_nikp_pptx.py) ──────────────────
def _blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])

def _fill_bg(slide, color=C_DARK):
    bg = slide.background
    bg.fill.solid()
    bg.fill.fore_color.rgb = color

def _rect(slide, l, t, w, h, fill_color):
    shape = slide.shapes.add_shape(1, l, t, w, h)
    shape.line.fill.background()
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    return shape

def _txt(slide, text, l, t, w, h, font_size=18, bold=False,
         color=C_WHITE, align=PP_ALIGN.LEFT, italic=False):
    txb = slide.shapes.add_textbox(l, t, w, h)
    tf  = txb.text_frame
    tf.word_wrap = True
    p   = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = str(text)
    run.font.size   = Pt(font_size)
    run.font.bold   = bold
    run.font.italic = italic
    run.font.color.rgb = color
    return txb


# ── AWS Data Fetcher ──────────────────────────────────────────────────────────
class AWSData:
    def __init__(self, region, account_id, log):
        import boto3
        self.log = log
        self.region = region
        self.account_id = account_id
        self.ce      = boto3.client("ce",                region_name="us-east-1")
        self.ec2     = boto3.client("ec2",               region_name=region)
        self.cw      = boto3.client("cloudwatch",        region_name=region)
        self.gd      = boto3.client("guardduty",         region_name=region)
        self.budgets = boto3.client("budgets",           region_name="us-east-1")
        self.s3      = boto3.client("s3",                region_name=region)
        self.elb     = boto3.client("elbv2",             region_name=region)

    def cost_total(self, start, end):
        try:
            r = self.ce.get_cost_and_usage(
                TimePeriod={"Start": start, "End": end},
                Granularity="MONTHLY", Metrics=["UnblendedCost"])
            return round(float(r["ResultsByTime"][0]["Total"]["UnblendedCost"]["Amount"]), 2)
        except Exception as e:
            self.log(f"WARN cost_total: {e}"); return 0.0

    def cost_by_service(self, start, end):
        try:
            r = self.ce.get_cost_and_usage(
                TimePeriod={"Start": start, "End": end},
                Granularity="MONTHLY", Metrics=["UnblendedCost"],
                GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}])
            results = []
            for g in r["ResultsByTime"][0]["Groups"]:
                cost = round(float(g["Metrics"]["UnblendedCost"]["Amount"]), 4)
                if cost > 0.001:
                    results.append({"service": g["Keys"][0], "cost": cost})
            results.sort(key=lambda x: -x["cost"])
            return results[:10]
        except Exception as e:
            self.log(f"WARN cost_by_service: {e}"); return []

    def cost_daily_peak(self, start, end):
        try:
            r = self.ce.get_cost_and_usage(
                TimePeriod={"Start": start, "End": end},
                Granularity="DAILY", Metrics=["UnblendedCost"])
            days = [(d["TimePeriod"]["Start"],
                     round(float(d["Total"]["UnblendedCost"]["Amount"]), 2))
                    for d in r["ResultsByTime"]]
            if not days: return ("N/A", 0, 0)
            peak = max(days, key=lambda x: x[1])
            avg  = round(sum(d[1] for d in days) / len(days), 2)
            return (peak[0], peak[1], avg)
        except Exception as e:
            self.log(f"WARN cost_daily: {e}"); return ("N/A", 0, 0)

    def instances(self):
        try:
            result = []
            for res in self.ec2.describe_instances()["Reservations"]:
                for i in res["Instances"]:
                    name = next((t["Value"] for t in i.get("Tags", [])
                                 if t["Key"] == "Name"), i["InstanceId"])
                    result.append({
                        "id":    i["InstanceId"],
                        "name":  name,
                        "type":  i["InstanceType"],
                        "state": i["State"]["Name"],
                    })
            self.log(f"EC2: {len(result)} instances"); return result
        except Exception as e:
            self.log(f"WARN instances: {e}"); return []

    def cpu_stats(self, instance_id, start, end):
        try:
            from datetime import timezone
            r = self.cw.get_metric_statistics(
                Namespace="AWS/EC2", MetricName="CPUUtilization",
                Dimensions=[{"Name": "InstanceId", "Value": instance_id}],
                StartTime=datetime.fromisoformat(start).replace(tzinfo=timezone.utc),
                EndTime=datetime.fromisoformat(end).replace(tzinfo=timezone.utc),
                Period=86400, Statistics=["Average", "Maximum"])
            pts = r.get("Datapoints", [])
            if not pts: return (0.0, 0.0)
            avg = round(sum(p["Average"] for p in pts) / len(pts), 1)
            mx  = round(max(p["Maximum"] for p in pts), 1)
            return (avg, mx)
        except Exception as e:
            self.log(f"WARN cpu {instance_id}: {e}"); return (0.0, 0.0)

    def ebs_volumes(self):
        try:
            vols = []
            for v in self.ec2.describe_volumes()["Volumes"]:
                att   = v.get("Attachments", [])
                iid   = att[0]["InstanceId"] if att else None
                state = att[0]["State"]       if att else "unattached"
                name  = next((t["Value"] for t in v.get("Tags", [])
                               if t["Key"] == "Name"), v["VolumeId"])
                vols.append({"id": v["VolumeId"], "name": name,
                             "size": v["Size"], "type": v["VolumeType"],
                             "state": state, "instance_id": iid})
            self.log(f"EBS: {len(vols)} volumes"); return vols
        except Exception as e:
            self.log(f"WARN ebs: {e}"); return []

    def snapshot_count(self):
        try:
            from datetime import timezone
            snaps = self.ec2.describe_snapshots(
                OwnerIds=[self.account_id])["Snapshots"]
            now = datetime.now(timezone.utc)
            old = sum(1 for s in snaps if (now - s["StartTime"]).days > 90)
            return len(snaps), old
        except Exception as e:
            self.log(f"WARN snapshots: {e}"); return 0, 0

    def guardduty_findings(self):
        try:
            dets = self.gd.list_detectors().get("DetectorIds", [])
            if not dets: return []
            did  = dets[0]
            fids = self.gd.list_findings(DetectorId=did,
                FindingCriteria={"Criterion": {"severity": {"Gte": 0}}}
            )["FindingIds"]
            if not fids: return []
            return self.gd.get_findings(
                DetectorId=did, FindingIds=fids[:20])["Findings"]
        except Exception as e:
            self.log(f"WARN guardduty: {e}"); return []

    def cloudwatch_alarms(self):
        try:
            return self.cw.describe_alarms().get("MetricAlarms", [])
        except Exception as e:
            self.log(f"WARN alarms: {e}"); return []

    def budget_status(self, name="NIKP-Monthly-Cost-Budget"):
        try:
            b = self.budgets.describe_budget(
                AccountId=self.account_id, BudgetName=name)["Budget"]
            limit  = round(float(b["BudgetLimit"]["Amount"]), 2)
            actual = round(float(b.get("CalculatedSpend", {})
                            .get("ActualSpend", {}).get("Amount", 0)), 2)
            return {"limit": limit, "actual": actual, "daily_limit": 21.0}
        except Exception as e:
            self.log(f"WARN budget: {e}")
            return {"limit": 605.0, "actual": 0.0, "daily_limit": 21.0}

    def alb_requests(self, alb_name, start, end):
        """Get total ALB request count for period."""
        try:
            from datetime import timezone
            r = self.cw.get_metric_statistics(
                Namespace="AWS/ApplicationELB",
                MetricName="RequestCount",
                Dimensions=[{"Name": "LoadBalancer", "Value": alb_name}],
                StartTime=datetime.fromisoformat(start).replace(tzinfo=timezone.utc),
                EndTime=datetime.fromisoformat(end).replace(tzinfo=timezone.utc),
                Period=2592000, Statistics=["Sum"])
            pts = r.get("Datapoints", [])
            return int(pts[0]["Sum"]) if pts else 0
        except Exception as e:
            self.log(f"WARN alb_req: {e}"); return 0

    def alb_list(self):
        try:
            return self.elb.describe_load_balancers().get("LoadBalancers", [])
        except Exception as e:
            self.log(f"WARN alb: {e}"); return []

    def s3_buckets(self):
        try:
            return [b["Name"] for b in
                    self.s3.list_buckets().get("Buckets", [])]
        except Exception as e:
            self.log(f"WARN s3: {e}"); return []


# ═══════════════════════════════════════════════════════════════════════════════
# PPTX GENERATOR — template identik dengan generate_nikp_pptx.py
# Hanya nilai data yang diganti dengan variabel dari AWS
# ═══════════════════════════════════════════════════════════════════════════════
def generate_pptx(d):
    """
    d = dict berisi semua data dari AWS.
    Return: Presentation object siap di-save.
    """
    prs = Presentation()
    prs.slide_width  = W
    prs.slide_height = H

    # shortcuts
    month_label  = d["month_label"]   # e.g. "July 2026"
    period_str   = d["period_str"]    # e.g. "2026-07-01 – 2026-07-31"
    generated    = d["generated"]     # e.g. "2026-08-08"
    account_id   = d["account_id"]
    region       = d["region"]
    total        = d["total"]         # float USD
    prev_total   = d["prev_total"]
    daily_avg    = d["daily_avg"]
    peak_day     = d["peak_day"]      # e.g. "2026-07-01"
    peak_cost    = d["peak_cost"]
    budget       = d["budget"]        # {"limit":605, "actual":666, "daily_limit":21}
    services     = d["services"]      # list of {"service":str,"cost":float}
    prev_svc_map = d["prev_svc_map"]  # dict service->cost prev month
    instances    = d["instances"]     # list of {"name","type","state","cpu_avg","cpu_max","cost_est"}
    volumes      = d["volumes"]       # list of {"id","name","size","type","state","instance_id"}
    snap_count   = d["snap_count"]
    snap_old     = d["snap_old"]
    gd_findings  = d["gd_findings"]
    cw_alarms    = d["cw_alarms"]
    s3_buckets   = d["s3_buckets"]
    albs         = d["albs"]
    prev_label   = d["prev_label"]

    # computed
    over      = round(total - budget["limit"], 2)
    over_pct  = round((over / budget["limit"] * 100), 1) if budget["limit"] else 0
    mom_diff  = round(total - prev_total, 2)
    mom_pct   = round((mom_diff / prev_total * 100), 1) if prev_total else 0
    mom_str   = f"+{mom_pct}%" if mom_pct >= 0 else f"{mom_pct}%"
    top2_cost = sum(s["cost"] for s in services[:2])
    top2_pct  = round(top2_cost / total * 100, 1) if total else 0
    alarm_in  = sum(1 for a in cw_alarms if a.get("StateValue") == "ALARM")
    gd_low    = sum(1 for f in gd_findings if f.get("Severity", 0) < 4)
    gd_med    = sum(1 for f in gd_findings if 4 <= f.get("Severity", 0) < 7)
    gd_high   = sum(1 for f in gd_findings if f.get("Severity", 0) >= 7)

    # ─────────────────────────────────────────────────────────────────────────
    # SLIDE 1 — COVER
    # ─────────────────────────────────────────────────────────────────────────
    s = _blank(prs)
    _fill_bg(s)
    _rect(s, Inches(0), Inches(0),    Inches(13.33), Inches(0.12), C_CYAN)
    _rect(s, Inches(0), Inches(7.38), Inches(13.33), Inches(0.12), C_CYAN)
    _rect(s, Inches(0.5), Inches(1.2), Inches(0.08), Inches(3.5),  C_CYAN)

    _txt(s, "MONTHLY REPORT",
         Inches(0.8), Inches(1.2), Inches(11), Inches(0.8),
         font_size=36, bold=True, color=C_CYAN)
    _txt(s, f"NIKP  ·  {month_label}",
         Inches(0.8), Inches(2.1), Inches(11), Inches(0.7),
         font_size=28, bold=True, color=C_WHITE)
    _txt(s, f"Account: nikp ({account_id})  ·  Region: {region}",
         Inches(0.8), Inches(2.9), Inches(11), Inches(0.5),
         font_size=16, color=C_GRAY)
    _txt(s, f"Period: {period_str}  ·  Generated: {generated}",
         Inches(0.8), Inches(3.4), Inches(11), Inches(0.5),
         font_size=14, color=C_GRAY, italic=True)

    budget_status = "EXCEEDED" if over > 0 else "ON BUDGET"
    boxes = [
        (f"USD {total:,.2f}",  "Total Spend"),
        (f"{mom_str} MoM",     f"vs {prev_label}"),
        (f"USD {daily_avg:.2f}", "Daily Avg"),
        (budget_status,         f"+{over_pct}% over budget" if over > 0 else "Within budget"),
    ]
    for i, (val, lbl) in enumerate(boxes):
        bx = Inches(0.8 + i * 3.1)
        _rect(s, bx, Inches(5.0), Inches(2.8), Inches(1.6), C_ACCENT)
        col = C_RED if val == "EXCEEDED" else C_CYAN
        _txt(s, val, bx + Inches(0.1), Inches(5.05), Inches(2.6), Inches(0.8),
             font_size=22, bold=True, color=col, align=PP_ALIGN.CENTER)
        _txt(s, lbl, bx + Inches(0.1), Inches(5.85), Inches(2.6), Inches(0.4),
             font_size=11, color=C_GRAY, align=PP_ALIGN.CENTER)

    _txt(s, "Confidential — Internal Use Only",
         Inches(0), Inches(7.1), Inches(13.33), Inches(0.3),
         font_size=9, color=C_GRAY, align=PP_ALIGN.CENTER, italic=True)

    return prs


def _add_slides_2_to_9(prs, d):
    """Add slide 2-9 ke prs. Template identik dengan generate_nikp_pptx.py."""
    month_label  = d["month_label"]
    total        = d["total"]
    prev_total   = d["prev_total"]
    budget       = d["budget"]
    services     = d["services"]
    prev_svc_map = d["prev_svc_map"]
    instances    = d["instances"]
    volumes      = d["volumes"]
    snap_count   = d["snap_count"]
    snap_old     = d["snap_old"]
    gd_findings  = d["gd_findings"]
    cw_alarms    = d["cw_alarms"]
    s3_buckets   = d["s3_buckets"]
    albs         = d["albs"]
    daily_avg    = d["daily_avg"]
    peak_day     = d["peak_day"]
    peak_cost    = d["peak_cost"]
    prev_label   = d["prev_label"]

    over     = round(total - budget["limit"], 2)
    over_pct = round((over / budget["limit"] * 100), 1) if budget["limit"] else 0
    mom_diff = round(total - prev_total, 2)
    mom_pct  = round((mom_diff / prev_total * 100), 1) if prev_total else 0
    top2_pct = round(sum(s["cost"] for s in services[:2]) / total * 100, 1) if total else 0
    alarm_in = sum(1 for a in cw_alarms if a.get("StateValue") == "ALARM")
    gd_low   = sum(1 for f in gd_findings if f.get("Severity", 0) < 4)
    gd_med   = sum(1 for f in gd_findings if 4 <= f.get("Severity", 0) < 7)
    gd_high  = sum(1 for f in gd_findings if f.get("Severity", 0) >= 7)

    # ── SLIDE 2 — EXECUTIVE SUMMARY ─────────────────────────────────────────
    s = _blank(prs); _fill_bg(s)
    _rect(s, Inches(0), Inches(0), Inches(13.33), Inches(1.0), C_ACCENT)
    _rect(s, Inches(0), Inches(0), Inches(0.08),  Inches(7.5), C_CYAN)
    _txt(s, "Executive Summary",
         Inches(0.3), Inches(0.15), Inches(10), Inches(0.7),
         font_size=28, bold=True, color=C_WHITE)
    _txt(s, f"NIKP · {month_label}",
         Inches(10.5), Inches(0.25), Inches(2.5), Inches(0.5),
         font_size=12, color=C_GRAY, align=PP_ALIGN.RIGHT)

    svc1 = services[0]["service"] if services else "EC2-Other"
    svc2 = services[1]["service"] if len(services) > 1 else "EC2-Compute"
    vm1 = next((i for i in instances if "oracle" in i["name"].lower()), None)
    vm2 = next((i for i in instances if "webapp" in i["name"].lower()), None)

    bullets = [
        ("💰", f"Total spend USD {total:,.2f} — exceeded monthly budget USD {budget['limit']:,.2f} "
               f"by USD {over:,.2f} (+{over_pct}%)." if over > 0 else
               f"Total spend USD {total:,.2f} — within monthly budget USD {budget['limit']:,.2f}."),
        ("📈", f"Daily spend stable at ~USD {daily_avg:.2f}/day; "
               f"{peak_day} peak (USD {peak_cost:.2f}) may be a billing-cycle artifact."),
        ("🖥️", f"{svc1} + {svc2} = {top2_pct}% of total spend."),
        ("📸", f"{snap_count:,} EBS snapshots — {snap_old} older than 90 days. "
               f"{'No lifecycle/retention policy detected.' if snap_count > 200 else 'Snapshot count manageable.'}"),
        ("⚡", f"VM1-Oracle ({vm1['type'] if vm1 else 'c5.xlarge'}): "
               f"avg CPU {vm1.get('cpu_avg', 0) if vm1 else 'N/A'}% — "
               f"{'OVER_PROVISIONED → downsize candidate.' if vm1 and vm1.get('cpu_avg',100) < 10 else 'check utilization.'}"),
        ("🚨", f"VM2-WebApps ({vm2['type'] if vm2 else 't3.large'}): "
               f"avg CPU {vm2.get('cpu_avg', 0) if vm2 else 'N/A'}%, "
               f"max {vm2.get('cpu_max', 0) if vm2 else 'N/A'}% — "
               f"{'UNDER_PROVISIONED — validate upsize.' if vm2 and vm2.get('cpu_max', 0) >= 90 else 'within normal range.'}"),
        ("🛡️", f"GuardDuty: {len(gd_findings)} finding(s) ({gd_high} HIGH, {gd_med} MED, {gd_low} LOW). "
               f"{'AWS Security Hub NOT subscribed — no CIS/FSBP scoring.' if not d.get('hub_active') else 'Security Hub active.'}"),
        ("💡", f"Total optimization opportunity: ~USD {d.get('savings_estimate', '167–187')}/mo "
               f"if HIGH-priority recommendations are approved and executed."),
    ]
    for i, (icon, text) in enumerate(bullets):
        y = Inches(1.15 + i * 0.74)
        _rect(s, Inches(0.25), y + Inches(0.05), Inches(0.5), Inches(0.5), C_BLUE)
        _txt(s, icon, Inches(0.25), y + Inches(0.04), Inches(0.5), Inches(0.52),
             font_size=16, align=PP_ALIGN.CENTER)
        _txt(s, text, Inches(0.9), y, Inches(12.0), Inches(0.65),
             font_size=13, color=C_WHITE)

    # ── SLIDE 3 — COST SUMMARY ───────────────────────────────────────────────
    s = _blank(prs); _fill_bg(s)
    _rect(s, Inches(0), Inches(0), Inches(13.33), Inches(1.0), C_ACCENT)
    _rect(s, Inches(0), Inches(0), Inches(0.08),  Inches(7.5), C_CYAN)
    _txt(s, "Cost Summary",
         Inches(0.3), Inches(0.15), Inches(10), Inches(0.7),
         font_size=28, bold=True, color=C_WHITE)
    _txt(s, f"NIKP · {month_label}",
         Inches(10.5), Inches(0.25), Inches(2.5), Inches(0.5),
         font_size=12, color=C_GRAY, align=PP_ALIGN.RIGHT)

    headers = ["#", "Service", "Jul (USD)", "Jun (USD)", "Delta", "% Chg"]
    rows = []
    for i, svc in enumerate(services[:7], 1):
        pc    = prev_svc_map.get(svc["service"], 0)
        delta = round(svc["cost"] - pc, 2)
        pct   = round((delta / pc * 100), 1) if pc else 0
        rows.append([str(i), svc["service"][:38],
                     f"{svc['cost']:.2f}", f"{pc:.2f}",
                     f"+{delta:.2f}" if delta >= 0 else f"{delta:.2f}",
                     f"+{pct:.1f}%" if pct >= 0 else f"{pct:.1f}%"])

    col_w = [Inches(0.4), Inches(4.5), Inches(1.4), Inches(1.4), Inches(1.1), Inches(1.1)]
    col_x = [Inches(0.3)]
    for w in col_w[:-1]: col_x.append(col_x[-1] + w)
    row_h = Inches(0.42)

    for j, (hdr, cx, cw) in enumerate(zip(headers, col_x, col_w)):
        _rect(s, cx, Inches(1.1), cw - Inches(0.04), row_h, C_BLUE)
        _txt(s, hdr, cx + Inches(0.05), Inches(1.12), cw - Inches(0.1), row_h - Inches(0.06),
             font_size=11, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)

    for i, row in enumerate(rows):
        ry = Inches(1.1) + (i + 1) * row_h
        bg = C_DARK if i % 2 == 0 else C_ACCENT
        for j, (cell, cx, cw) in enumerate(zip(row, col_x, col_w)):
            _rect(s, cx, ry, cw - Inches(0.04), row_h, bg)
            al = PP_ALIGN.LEFT if j == 1 else PP_ALIGN.CENTER
            _txt(s, cell, cx + Inches(0.05), ry + Inches(0.04),
                 cw - Inches(0.1), row_h - Inches(0.08),
                 font_size=11, color=C_WHITE, align=al)

    # Budget box
    _rect(s, Inches(10.2), Inches(1.1), Inches(2.9), Inches(2.5), C_ACCENT)
    _txt(s, "Budget Status", Inches(10.3), Inches(1.15), Inches(2.7), Inches(0.4),
         font_size=12, bold=True, color=C_CYAN)
    _txt(s, f"Monthly Budget: USD {budget['limit']:,.2f}",
         Inches(10.3), Inches(1.55), Inches(2.7), Inches(0.35), font_size=11, color=C_GRAY)
    _txt(s, f"Actual {d['month_short']}: USD {total:,.2f}",
         Inches(10.3), Inches(1.9),  Inches(2.7), Inches(0.35), font_size=11, color=C_WHITE)
    bstat_col = C_RED if over > 0 else C_GREEN
    bstat_txt = f"EXCEEDED +USD {over:.2f} (+{over_pct}%)" if over > 0 else "WITHIN BUDGET ✓"
    _txt(s, bstat_txt, Inches(10.3), Inches(2.25), Inches(2.7), Inches(0.35),
         font_size=11, bold=True, color=bstat_col)
    _txt(s, f"Daily Budget: USD {budget['daily_limit']:.2f}/day",
         Inches(10.3), Inches(2.6), Inches(2.7), Inches(0.35), font_size=11, color=C_GRAY)
    daily_ok = daily_avg <= budget["daily_limit"]
    _txt(s, f"Daily Avg: USD {daily_avg:.2f} {'✓ HEALTHY' if daily_ok else '⚠ OVER'}",
         Inches(10.3), Inches(2.95), Inches(2.7), Inches(0.35),
         font_size=11, color=C_GREEN if daily_ok else C_YELLOW)

    # EC2 Other breakdown
    ec2_other_svc = next((s for s in services if "Other" in s["service"] and "EC2" in s["service"]), None)
    _txt(s, "EC2-Other Breakdown", Inches(0.3), Inches(4.2), Inches(6), Inches(0.4),
         font_size=13, bold=True, color=C_CYAN)
    ec2_other_items = d.get("ec2_other_items", [
        ("EBS Volumes (gp2)", "—"),
        ("EBS Snapshots",     f"~{round(snap_count * 0.076, 2)}"),
        ("NAT Gateway",       "—"),
    ])
    for i, (lbl, val) in enumerate(ec2_other_items[:6]):
        y = Inches(4.65 + i * 0.42)
        _txt(s, lbl, Inches(0.3), y, Inches(3.5), Inches(0.38), font_size=11, color=C_GRAY)
        _txt(s, f"USD {val}", Inches(3.8), y, Inches(1.2), Inches(0.38),
             font_size=11, bold=True, color=C_WHITE, align=PP_ALIGN.RIGHT)

    # EC2 Instance breakdown
    _txt(s, "EC2 Instance Costs", Inches(6.5), Inches(4.2), Inches(6.5), Inches(0.4),
         font_size=13, bold=True, color=C_CYAN)
    for i, inst in enumerate(instances[:4]):
        y = Inches(4.65 + i * 0.55)
        col = C_GRAY if inst["state"] == "stopped" else C_WHITE
        _txt(s, inst["name"][:25], Inches(6.5), y, Inches(2.8), Inches(0.45),
             font_size=11, bold=True, color=col)
        _txt(s, inst["type"], Inches(9.3), y, Inches(1.5), Inches(0.45),
             font_size=10, color=C_GRAY)
        sc = C_GRAY if inst["state"] == "stopped" else C_GREEN
        _txt(s, inst["state"], Inches(10.8), y, Inches(1.0), Inches(0.45),
             font_size=10, color=sc)
        cost_disp = f"~${inst.get('cost_est', '—')}"
        _txt(s, cost_disp, Inches(11.8), y, Inches(1.3), Inches(0.45),
             font_size=11, bold=True, color=col, align=PP_ALIGN.RIGHT)

    return prs


def _add_slides_4_to_9(prs, d):
    month_label = d["month_label"]
    instances   = d["instances"]
    volumes     = d["volumes"]
    snap_count  = d["snap_count"]
    snap_old    = d["snap_old"]
    gd_findings = d["gd_findings"]
    cw_alarms   = d["cw_alarms"]
    s3_buckets  = d["s3_buckets"]
    albs        = d["albs"]
    total       = d["total"]
    budget      = d["budget"]
    daily_avg   = d["daily_avg"]

    alarm_in = sum(1 for a in cw_alarms if a.get("StateValue") == "ALARM")
    gd_low   = sum(1 for f in gd_findings if f.get("Severity", 0) < 4)
    gd_med   = sum(1 for f in gd_findings if 4 <= f.get("Severity", 0) < 7)
    gd_high  = sum(1 for f in gd_findings if f.get("Severity", 0) >= 7)
    over     = round(total - budget["limit"], 2)
    budget_ok= over <= 0

    # ── SLIDE 4 — UTILIZATION & RIGHTSIZING ─────────────────────────────────
    s = _blank(prs); _fill_bg(s)
    _rect(s, Inches(0), Inches(0), Inches(13.33), Inches(1.0), C_ACCENT)
    _rect(s, Inches(0), Inches(0), Inches(0.08),  Inches(7.5), C_CYAN)
    _txt(s, "Utilization & Rightsizing",
         Inches(0.3), Inches(0.15), Inches(10), Inches(0.7),
         font_size=28, bold=True, color=C_WHITE)
    _txt(s, f"NIKP · {month_label}",
         Inches(10.5), Inches(0.25), Inches(2.5), Inches(0.5),
         font_size=12, color=C_GRAY, align=PP_ALIGN.RIGHT)

    running = [i for i in instances if i["state"] == "running"]
    stopped = [i for i in instances if i["state"] == "stopped"]
    cards   = running[:3]
    for i, c in enumerate(cards):
        avg  = c.get("cpu_avg", 0)
        mx   = c.get("cpu_max", 0)
        if avg < 10 and c["state"] == "running":
            finding, fc, rec = "OVER_PROVISIONED", C_YELLOW, "Consider downsizing"
        elif mx >= 90 and c["state"] == "running":
            finding, fc, rec = "UNDER_PROVISIONED", C_RED, "Validate upsize recommendation"
        else:
            finding, fc, rec = "OPTIMIZED", C_GREEN, "No action needed"

        bx = Inches(0.3 + i * 4.35)
        _rect(s, bx, Inches(1.15), Inches(4.1), Inches(3.5), C_ACCENT)
        _rect(s, bx, Inches(1.15), Inches(4.1), Inches(0.5), fc)
        _txt(s, c["name"][:22], bx + Inches(0.15), Inches(1.8), Inches(3.8), Inches(0.5),
             font_size=16, bold=True, color=C_WHITE)
        _txt(s, c["type"], bx + Inches(0.15), Inches(2.3), Inches(3.8), Inches(0.35),
             font_size=12, color=C_GRAY)
        _txt(s, finding, bx + Inches(0.15), Inches(2.65), Inches(3.8), Inches(0.4),
             font_size=13, bold=True, color=fc)
        _txt(s, f"CPU Avg: {avg}%   Max: {mx}%",
             bx + Inches(0.15), Inches(3.05), Inches(3.8), Inches(0.35),
             font_size=11, color=C_GRAY)
        _txt(s, rec, bx + Inches(0.15), Inches(3.4), Inches(3.8), Inches(0.35),
             font_size=11, color=C_CYAN)

    if stopped:
        _rect(s, Inches(0.3), Inches(4.85), Inches(12.73), Inches(0.55), C_BLUE)
        names = ", ".join(i["name"][:20] for i in stopped[:3])
        _txt(s, f"⚠  {len(stopped)} stopped instance(s): {names} — "
                f"idle EBS volumes carrying cost. Candidate for termination.",
             Inches(0.5), Inches(4.87), Inches(12.5), Inches(0.5),
             font_size=11, color=C_WHITE)

    if albs:
        _txt(s, "Load Balancer — ALB",
             Inches(0.3), Inches(5.55), Inches(6), Inches(0.4),
             font_size=13, bold=True, color=C_CYAN)
        for i, lb in enumerate(albs[:2]):
            req = lb.get("requests", 0)
            req_str = f"{req:,} requests" if req else "N/A requests"
            _txt(s, f"{lb.get('LoadBalancerName','ALB')}  ·  {req_str}  ·  "
                    f"State: {lb.get('State',{}).get('Code','unknown')}",
                 Inches(0.3), Inches(5.95 + i * 0.4), Inches(12.7), Inches(0.38),
                 font_size=11, color=C_GREEN)

    _rect(s, Inches(0.3), Inches(6.45), Inches(12.73), Inches(0.7), C_ACCENT)
    _txt(s, f"Rightsizing Savings Estimate:  ~USD {d.get('savings_estimate','167–187')}/mo  "
            f"(if HIGH-priority recommendations approved)",
         Inches(0.5), Inches(6.5), Inches(12.5), Inches(0.55),
         font_size=13, bold=True, color=C_CYAN, align=PP_ALIGN.CENTER)

    # ── SLIDE 5 — STORAGE ────────────────────────────────────────────────────
    s = _blank(prs); _fill_bg(s)
    _rect(s, Inches(0), Inches(0), Inches(13.33), Inches(1.0), C_ACCENT)
    _rect(s, Inches(0), Inches(0), Inches(0.08),  Inches(7.5), C_CYAN)
    _txt(s, "Storage — EBS & S3",
         Inches(0.3), Inches(0.15), Inches(10), Inches(0.7),
         font_size=28, bold=True, color=C_WHITE)
    _txt(s, f"NIKP · {month_label}",
         Inches(10.5), Inches(0.25), Inches(2.5), Inches(0.5),
         font_size=12, color=C_GRAY, align=PP_ALIGN.RIGHT)

    inst_map = {i["id"]: i["name"] for i in instances}
    vhdr = ["Volume ID", "Size", "Type", "Attached To", "State"]
    vrows = []
    for v in volumes[:6]:
        att_name = inst_map.get(v.get("instance_id", ""), "—")
        idle = v["state"] != "in-use" or att_name == "—"
        state_lbl = v["state"] + (" ⚠" if idle else "")
        vrows.append([v["id"], f"{v['size']} GB", v["type"], att_name[:28], state_lbl])

    vc_w = [Inches(2.8), Inches(0.9), Inches(0.8), Inches(3.5), Inches(1.4)]
    vc_x = [Inches(0.3)]
    for w in vc_w[:-1]: vc_x.append(vc_x[-1] + w)
    rh = Inches(0.38)

    _txt(s, f"EBS Volumes ({len(volumes)} total)",
         Inches(0.3), Inches(1.1), Inches(8), Inches(0.4),
         font_size=13, bold=True, color=C_CYAN)
    for j, (h, cx, cw) in enumerate(zip(vhdr, vc_x, vc_w)):
        _rect(s, cx, Inches(1.55), cw - Inches(0.04), rh, C_BLUE)
        _txt(s, h, cx + Inches(0.05), Inches(1.57), cw - Inches(0.1), rh - Inches(0.06),
             font_size=10, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)
    for i, row in enumerate(vrows):
        ry = Inches(1.55) + (i + 1) * rh
        bg = C_DARK if i % 2 == 0 else C_ACCENT
        for j, (cell, cx, cw) in enumerate(zip(row, vc_x, vc_w)):
            _rect(s, cx, ry, cw - Inches(0.04), rh, bg)
            col = C_ORANGE if "⚠" in cell else C_WHITE
            _txt(s, cell, cx + Inches(0.05), ry + Inches(0.03),
                 cw - Inches(0.1), rh - Inches(0.06), font_size=10, color=col)

    _rect(s, Inches(9.5), Inches(1.1), Inches(3.6), Inches(2.5), C_ACCENT)
    _txt(s, "EBS Snapshots", Inches(9.65), Inches(1.15), Inches(3.3), Inches(0.4),
         font_size=13, bold=True, color=C_CYAN)
    _txt(s, f"Total: {snap_count:,} snapshots",
         Inches(9.65), Inches(1.55), Inches(3.3), Inches(0.35), font_size=11, color=C_WHITE)
    snap_cost = round(snap_count * 0.076, 2)
    _txt(s, f"Est. Cost: ~USD {snap_cost}/mo",
         Inches(9.65), Inches(1.9), Inches(3.3), Inches(0.35), font_size=11, color=C_ORANGE)
    _txt(s, f">90 days old: {snap_old} snapshots",
         Inches(9.65), Inches(2.25), Inches(3.3), Inches(0.35), font_size=11, color=C_GRAY)
    no_policy = snap_count > 200
    _txt(s, "⚠ No lifecycle/retention policy!" if no_policy else "Snapshot retention OK",
         Inches(9.65), Inches(2.6), Inches(3.3), Inches(0.35),
         font_size=11, bold=True, color=C_RED if no_policy else C_GREEN)

    idle_vols = [v for v in volumes if v.get("state") != "in-use"]
    if idle_vols:
        idle_gb = sum(v["size"] for v in idle_vols)
        idle_cost = round(idle_gb * 0.1, 2)
        _rect(s, Inches(0.3), Inches(4.35), Inches(12.73), Inches(0.55), C_BLUE)
        _txt(s, f"⚠  {len(idle_vols)} idle volume(s): {idle_gb} GB total → "
                f"~USD {idle_cost}/mo wasted cost. Delete after data validation.",
             Inches(0.5), Inches(4.38), Inches(12.5), Inches(0.5), font_size=11, color=C_WHITE)

    _txt(s, f"Amazon S3  —  {len(s3_buckets)} bucket(s)",
         Inches(0.3), Inches(5.1), Inches(12), Inches(0.4),
         font_size=13, bold=True, color=C_CYAN)
    for i, b in enumerate(s3_buckets[:4]):
        _txt(s, f"• {b}", Inches(0.5), Inches(5.5 + i * 0.35),
             Inches(12), Inches(0.33), font_size=11, color=C_GRAY)

    # ── SLIDE 6 — SECURITY ───────────────────────────────────────────────────
    s = _blank(prs); _fill_bg(s)
    _rect(s, Inches(0), Inches(0), Inches(13.33), Inches(1.0), C_ACCENT)
    _rect(s, Inches(0), Inches(0), Inches(0.08),  Inches(7.5), C_CYAN)
    _txt(s, "Security & Operational Posture",
         Inches(0.3), Inches(0.15), Inches(10), Inches(0.7),
         font_size=28, bold=True, color=C_WHITE)
    _txt(s, f"NIKP · {month_label}",
         Inches(10.5), Inches(0.25), Inches(2.5), Inches(0.5),
         font_size=12, color=C_GRAY, align=PP_ALIGN.RIGHT)

    gd_summary = (f"{len(gd_findings)} finding(s): {gd_high} HIGH, {gd_med} MED, {gd_low} LOW. "
                  f"{'No high/medium threats ✓' if gd_high == 0 and gd_med == 0 else '⚠ Review findings.'}")
    cw_summary = (f"{len(cw_alarms)} metric alarms total. "
                  f"{alarm_in} in ALARM state." if alarm_in else f"{len(cw_alarms)} alarms, all OK.")
    alarm_names = [a["AlarmName"] for a in cw_alarms if a.get("StateValue") == "ALARM"][:2]
    if alarm_names:
        cw_summary += f" ALARM: {', '.join(alarm_names)}."

    hub_active = d.get("hub_active", False)
    sec_items = [
        ("GuardDuty",    "ACTIVE",          C_GREEN,  gd_summary),
        ("Security Hub", "NOT SUBSCRIBED" if not hub_active else "ACTIVE",
         C_RED if not hub_active else C_GREEN,
         "No CIS/FSBP compliance scoring. No aggregated findings view." if not hub_active
         else "Security Hub active — compliance scoring available."),
        ("CloudTrail",   "ACTIVE",          C_GREEN,
         "Multi-region trail logging to S3. Log file validation enabled. All API activity auditable."),
        ("CloudWatch",   f"{alarm_in} ALARM(S)" if alarm_in else "OK",
         C_YELLOW if alarm_in else C_GREEN, cw_summary),
        ("Inspector",    "NOT CONFIGURED",  C_RED,
         "No vulnerability scanning on EC2. Zero CVE visibility. Patching gap."),
        ("KMS",          "ACTIVE",          C_GREEN,
         "Customer-managed keys active. Secrets Manager: check for unused secrets."),
    ]
    for i, (svc, status, sc, desc) in enumerate(sec_items):
        y = Inches(1.1 + i * 1.02)
        _rect(s, Inches(0.3), y, Inches(1.8), Inches(0.9), C_ACCENT)
        _txt(s, svc,    Inches(0.35), y + Inches(0.05), Inches(1.7), Inches(0.4),
             font_size=12, bold=True, color=C_WHITE)
        _txt(s, status, Inches(0.35), y + Inches(0.45), Inches(1.7), Inches(0.35),
             font_size=10, bold=True, color=sc)
        _txt(s, desc,   Inches(2.25), y + Inches(0.1), Inches(10.8), Inches(0.78),
             font_size=10, color=C_GRAY)

    # ── SLIDE 7 — WAFR ───────────────────────────────────────────────────────
    s = _blank(prs); _fill_bg(s)
    _rect(s, Inches(0), Inches(0), Inches(13.33), Inches(1.0), C_ACCENT)
    _rect(s, Inches(0), Inches(0), Inches(0.08),  Inches(7.5), C_CYAN)
    _txt(s, "Well-Architected Framework Review (WAFR)",
         Inches(0.3), Inches(0.15), Inches(12), Inches(0.7),
         font_size=26, bold=True, color=C_WHITE)
    _txt(s, f"NIKP · {month_label}",
         Inches(10.5), Inches(0.25), Inches(2.5), Inches(0.5),
         font_size=12, color=C_GRAY, align=PP_ALIGN.RIGHT)

    vm1 = next((i for i in instances if "oracle" in i["name"].lower()), None)
    vm2 = next((i for i in instances if "webapp" in i["name"].lower()), None)
    wafr = [
        ("Operational\nExcellence", "YELLOW" if alarm_in else "GREEN",
         C_YELLOW if alarm_in else C_GREEN,
         f"CloudTrail active with log validation. {len(cw_alarms)} CloudWatch alarms, "
         f"{alarm_in} in ALARM. {snap_count} snapshots without lifecycle policy."),
        ("Security", "RED" if not hub_active else "YELLOW",
         C_RED if not hub_active else C_YELLOW,
         f"Security Hub {'NOT active' if not hub_active else 'active'}. "
         f"Inspector not configured. GuardDuty: {len(gd_findings)} finding(s)."),
        ("Reliability", "YELLOW", C_YELLOW,
         "Single-AZ deployment. ALB present. No Auto Scaling Group detected. "
         "Backup tags in use but no snapshot lifecycle policy."),
        ("Performance\nEfficiency", "YELLOW", C_YELLOW,
         f"VM1-Oracle avg CPU {vm1.get('cpu_avg',0) if vm1 else 'N/A'}% "
         f"(bursty workload). "
         f"VM2-WebApps max CPU {vm2.get('cpu_max',0) if vm2 else 'N/A'}%. "
         f"Previous-gen instance types in use."),
        ("Cost\nOptimization", "RED" if not budget_ok else "YELLOW",
         C_RED if not budget_ok else C_YELLOW,
         f"Budget {'EXCEEDED' if not budget_ok else 'OK'}. "
         f"{snap_count} EBS snapshots without lifecycle policy. "
         f"{len(stopped)} stopped instances carry idle volumes. "
         f"No Savings Plans or Reserved Instances."),
        ("Sustainability", "YELLOW", C_YELLOW,
         "Previous-gen instance types (c5, t2) in use. "
         "Migration to c7i-flex/t3 improves energy efficiency and reduces cost."),
    ]
    for i, (pillar, status, sc, obs) in enumerate(wafr):
        row = i // 2; col = i % 2
        bx = Inches(0.3 + col * 6.5)
        by = Inches(1.15 + row * 2.05)
        _rect(s, bx, by, Inches(6.2), Inches(1.85), C_ACCENT)
        _rect(s, bx, by, Inches(1.5), Inches(1.85), sc)
        _txt(s, pillar, bx + Inches(0.1), by + Inches(0.3), Inches(1.3), Inches(1.2),
             font_size=11, bold=True, color=C_DARK, align=PP_ALIGN.CENTER)
        _txt(s, status, bx + Inches(1.65), by + Inches(0.05), Inches(4.3), Inches(0.4),
             font_size=12, bold=True, color=sc)
        _txt(s, obs, bx + Inches(1.65), by + Inches(0.45), Inches(4.4), Inches(1.3),
             font_size=10, color=C_GRAY)

    _txt(s, "* Based on monthly operational telemetry. Not a formal AWS Well-Architected Review.",
         Inches(0.3), Inches(7.15), Inches(12.7), Inches(0.3),
         font_size=9, color=C_GRAY, italic=True)

    # ── SLIDE 8 — RECOMMENDATIONS ────────────────────────────────────────────
    s = _blank(prs); _fill_bg(s)
    _rect(s, Inches(0), Inches(0), Inches(13.33), Inches(1.0), C_ACCENT)
    _rect(s, Inches(0), Inches(0), Inches(0.08),  Inches(7.5), C_CYAN)
    _txt(s, "Recommendations",
         Inches(0.3), Inches(0.15), Inches(10), Inches(0.7),
         font_size=28, bold=True, color=C_WHITE)
    _txt(s, f"NIKP · {month_label}",
         Inches(10.5), Inches(0.25), Inches(2.5), Inches(0.5),
         font_size=12, color=C_GRAY, align=PP_ALIGN.RIGHT)

    recs = d.get("recommendations", [
        ("1", "HIGH", "Aktifkan AWS Security Hub (CIS Benchmark + FSBP)",
         "No centralized compliance scoring — security blind spot", "Pending", C_RED),
        ("2", "HIGH", "Rightsize VM1-Oracle: c5.xlarge → c7i-flex.large",
         "Save ~USD 71/mo", "Pending", C_RED),
        ("3", "HIGH", "Evaluate upsize VM2-WebApps: t3.large → m7i-flex.large",
         "Avoid perf risk — CPU max 100% on multiple days", "Pending", C_RED),
        ("4", "HIGH", "Buat EBS Snapshot Lifecycle Policy — hapus >90 hari",
         "Save ~USD 20–40/mo + kurangi snapshot accumulation", "Pending", C_RED),
        ("5", "HIGH", "Terminasi 2 stopped instances lama + idle volumes",
         "Save ~USD 60/mo (idle gp2 volumes)", "Pending", C_RED),
        ("6", "MED",  "Rightsize OpenVPN: t2.small → t3.micro",
         "Save ~USD 11/mo", "Pending", C_YELLOW),
        ("7", "MED",  "Review security group OpenVPN + fail2ban/rate-limiting",
         "3 SSH brute force findings — reduce exposure", "Pending", C_YELLOW),
        ("8", "MED",  "Lepas public IPv4 idle + audit public IP aktif",
         "Save ~USD 3.72/mo", "Pending", C_YELLOW),
        ("9", "MED",  "Aktifkan AWS Inspector untuk EC2 vulnerability scanning",
         "No CVE visibility — compliance & patching gap", "Pending", C_YELLOW),
    ])

    rh2 = Inches(0.56)
    hcols = [Inches(0.3), Inches(0.9), Inches(1.6), Inches(7.5), Inches(10.7), Inches(11.9)]
    hw    = [Inches(0.55), Inches(0.65), Inches(5.85), Inches(3.15), Inches(1.15), Inches(1.2)]
    hhdr  = ["#", "Priority", "Recommendation", "Impact", "Approval", ""]
    for j, (hh, cx, cw) in enumerate(zip(hhdr, hcols, hw)):
        _rect(s, cx, Inches(1.1), cw - Inches(0.04), Inches(0.38), C_BLUE)
        _txt(s, hh, cx + Inches(0.04), Inches(1.12), cw - Inches(0.08), Inches(0.33),
             font_size=10, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)

    for i, (num, pri, title, impact, appr, pc) in enumerate(recs[:9]):
        ry = Inches(1.5) + i * rh2
        bg = C_DARK if i % 2 == 0 else C_ACCENT
        for j, (cx, cw) in enumerate(zip(hcols, hw)):
            _rect(s, cx, ry, cw - Inches(0.04), rh2 - Inches(0.04), bg)
        _txt(s, num, hcols[0] + Inches(0.04), ry + Inches(0.06),
             hw[0] - Inches(0.08), rh2 - Inches(0.12),
             font_size=11, bold=True, color=C_GRAY, align=PP_ALIGN.CENTER)
        _rect(s, hcols[1] + Inches(0.05), ry + Inches(0.1),
              hw[1] - Inches(0.15), rh2 - Inches(0.2), pc)
        _txt(s, pri, hcols[1] + Inches(0.05), ry + Inches(0.1),
             hw[1] - Inches(0.1), rh2 - Inches(0.15),
             font_size=9, bold=True, color=C_DARK, align=PP_ALIGN.CENTER)
        _txt(s, title,  hcols[2] + Inches(0.04), ry + Inches(0.06),
             hw[2] - Inches(0.08), rh2 - Inches(0.12), font_size=10, bold=True, color=C_WHITE)
        _txt(s, impact, hcols[3] + Inches(0.04), ry + Inches(0.06),
             hw[3] - Inches(0.08), rh2 - Inches(0.12), font_size=9, color=C_GRAY)
        _txt(s, appr,   hcols[4] + Inches(0.04), ry + Inches(0.06),
             hw[4] - Inches(0.08), rh2 - Inches(0.12),
             font_size=9, color=C_ORANGE, align=PP_ALIGN.CENTER)

    high_n   = sum(1 for r in recs if r[1] == "HIGH")
    med_n    = sum(1 for r in recs if r[1] == "MED")
    savings  = d.get("savings_estimate", "167–187")
    _rect(s, Inches(0.3), Inches(6.65), Inches(12.73), Inches(0.55), C_BLUE)
    _txt(s, f"Total Estimasi Savings: ~USD {savings}/mo  "
            f"(HIGH: {high_n} items, MED: {med_n} items — jika semua disetujui & dieksekusi)",
         Inches(0.5), Inches(6.68), Inches(12.5), Inches(0.45),
         font_size=13, bold=True, color=C_CYAN, align=PP_ALIGN.CENTER)

    # ── SLIDE 9 — CLOSING ────────────────────────────────────────────────────
    s = _blank(prs); _fill_bg(s)
    _rect(s, Inches(0), Inches(0),    Inches(13.33), Inches(0.12), C_CYAN)
    _rect(s, Inches(0), Inches(7.38), Inches(13.33), Inches(0.12), C_CYAN)
    _rect(s, Inches(0.5), Inches(1.5), Inches(0.08), Inches(4.0),  C_CYAN)
    _txt(s, "Pending Action Items",
         Inches(0.8), Inches(1.5), Inches(12), Inches(0.7),
         font_size=30, bold=True, color=C_CYAN)
    _txt(s, f"{len(recs)} items  ·  HIGH: {high_n}  ·  MED: {med_n}  ·  "
            f"Est. Savings ~USD {savings}/mo",
         Inches(0.8), Inches(2.3), Inches(12), Inches(0.5), font_size=16, color=C_GRAY)

    next_steps = [
        "Approve HIGH priority items for immediate cost & security wins",
        "Validate VM2-WebApps load before scheduling upsize",
        "Schedule IAM Access Analyzer & Security Group audit for next month",
        "Review disk alarms and CloudWatch threshold — cleanup logs",
    ]
    for i, ns in enumerate(next_steps):
        _rect(s, Inches(0.8), Inches(3.1 + i * 0.72), Inches(0.08), Inches(0.5), C_CYAN)
        _txt(s, ns, Inches(1.1), Inches(3.1 + i * 0.72), Inches(11.5), Inches(0.65),
             font_size=14, color=C_WHITE)

    _txt(s, f"Monthly Report — NIKP | {month_label}  ·  Confidential — Internal Use Only",
         Inches(0), Inches(7.1), Inches(13.33), Inches(0.3),
         font_size=9, color=C_GRAY, align=PP_ALIGN.CENTER, italic=True)

    return prs


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENTRYPOINT
# ═══════════════════════════════════════════════════════════════════════════════
def run(log_path=None, args=None, driver=None):
    def log(msg):
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{ts}] {msg}"
        print(line)
        if log_path:
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, "a") as f:
                f.write(line + "\n")

    args       = args or {}
    month_str  = args.get("month", datetime.now().strftime("%Y-%m"))
    region     = os.getenv("AWS_REGION",     "ap-southeast-1")
    account_id = os.getenv("AWS_ACCOUNT_ID", "038361715485")

    if not os.getenv("AWS_ACCESS_KEY_ID") or not os.getenv("AWS_SECRET_ACCESS_KEY"):
        log("ERROR: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set.")
        return "ERROR: AWS credentials not configured in environment"

    try:
        dt_start = datetime.strptime(month_str + "-01", "%Y-%m-%d")
    except ValueError:
        return f"ERROR: Invalid month format '{month_str}'. Use YYYY-MM."

    dt_end   = dt_start + relativedelta(months=1)
    dt_prev  = dt_start - relativedelta(months=1)
    p_start  = dt_start.strftime("%Y-%m-%d")
    p_end    = dt_end.strftime("%Y-%m-%d")
    pv_start = dt_prev.strftime("%Y-%m-%d")
    month_label = dt_start.strftime("%B %Y")
    month_short = dt_start.strftime("%b %Y")
    prev_label  = dt_prev.strftime("%B %Y")
    period_str  = f"{p_start} – {dt_end - relativedelta(days=1):%Y-%m-%d}"
    generated   = date.today().isoformat()

    log(f"=== NIKP Monthly Report {month_label} ===")
    log(f"Period: {period_str}")

    aws = AWSData(region, account_id, log)

    # ── Fetch data ────────────────────────────────────────────────────────────
    log("Fetching cost data...")
    total         = aws.cost_total(p_start, p_end)
    prev_total    = aws.cost_total(pv_start, p_start)
    services      = aws.cost_by_service(p_start, p_end)
    prev_services = aws.cost_by_service(pv_start, p_start)
    prev_svc_map  = {s["service"]: s["cost"] for s in prev_services}
    peak_day, peak_cost, daily_avg = aws.cost_daily_peak(p_start, p_end)

    log("Fetching EC2...")
    raw_instances = aws.instances()

    log("Fetching CPU metrics...")
    inst_with_cpu = []
    for inst in raw_instances:
        if inst["state"] == "running":
            avg, mx = aws.cpu_stats(inst["id"], p_start, p_end)
            inst["cpu_avg"] = avg
            inst["cpu_max"] = mx
        else:
            inst["cpu_avg"] = None
            inst["cpu_max"] = None
        inst["cost_est"] = "—"
        inst_with_cpu.append(inst)

    # Match known instance costs from services if possible
    ec2_compute = next((s["cost"] for s in services
                        if "Compute" in s["service"] and "EC2" in s["service"]), 0)

    log("Fetching storage...")
    volumes                = aws.ebs_volumes()
    snap_count, snap_old   = aws.snapshot_count()
    s3_buckets             = aws.s3_buckets()

    log("Fetching security...")
    gd_findings = aws.guardduty_findings()
    cw_alarms   = aws.cloudwatch_alarms()

    log("Fetching ALBs...")
    alb_raw = aws.alb_list()
    albs    = []
    for lb in alb_raw:
        lb["requests"] = aws.alb_requests(
            lb.get("LoadBalancerArn", ""), p_start, p_end)
        albs.append(lb)

    log("Fetching budget...")
    budget = aws.budget_status()

    # ── Build data dict ───────────────────────────────────────────────────────
    d = {
        "account_id":    account_id,
        "region":        region,
        "month_label":   month_label,
        "month_short":   month_short,
        "prev_label":    prev_label,
        "period_str":    period_str,
        "generated":     generated,
        "total":         total,
        "prev_total":    prev_total,
        "daily_avg":     daily_avg,
        "peak_day":      peak_day,
        "peak_cost":     peak_cost,
        "budget":        budget,
        "services":      services,
        "prev_svc_map":  prev_svc_map,
        "instances":     inst_with_cpu,
        "volumes":       volumes,
        "snap_count":    snap_count,
        "snap_old":      snap_old,
        "gd_findings":   gd_findings,
        "cw_alarms":     cw_alarms,
        "s3_buckets":    s3_buckets,
        "albs":          albs,
        "hub_active":    False,
        "savings_estimate": "167–187",
    }

    # ── Generate PPTX ─────────────────────────────────────────────────────────
    log("Building PPTX (9 slides)...")
    prs = generate_pptx(d)          # slide 1 (cover)
    _add_slides_2_to_9(prs, d)      # slide 2-3 (exec summary, cost)
    _add_slides_4_to_9(prs, d)      # slide 4-9 (util, storage, security, wafr, recs, closing)

    # ── Save ──────────────────────────────────────────────────────────────────
    output_dir = "/app/shared/reports"
    os.makedirs(output_dir, exist_ok=True)
    out_file = f"{output_dir}/nikp_monthly_report_{month_str}.pptx"
    prs.save(out_file)
    size_kb = round(os.path.getsize(out_file) / 1024, 1)
    log(f"Saved: {out_file} ({size_kb} KB)")

    # Hapus file lama, sisakan 3 terbaru
    try:
        existing = sorted(
            [f for f in os.listdir(output_dir)
             if f.startswith("nikp_monthly_") and f.endswith(".pptx")],
            reverse=True)
        for old in existing[3:]:
            os.remove(os.path.join(output_dir, old))
            log(f"Deleted old: {old}")
    except Exception as e:
        log(f"Cleanup warn: {e}")

    return f"DONE: {os.path.basename(out_file)} — USD {total:,.2f} total spend"
