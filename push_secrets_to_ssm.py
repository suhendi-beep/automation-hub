#!/usr/bin/env python3
"""
push_secrets_to_ssm.py
Upload semua credential Portal Report ke AWS Systems Manager Parameter Store.

Jalankan SEKALI dari mesin yang sudah punya AWS credentials dengan izin:
  ssm:PutParameter, ssm:GetParameter, kms:GenerateDataKey (jika pakai custom KMS)

Usage:
  python3 push_secrets_to_ssm.py [--region ap-southeast-1] [--prefix /portal-report]

Parameter akan disimpan sebagai SecureString (terenkripsi dengan AWS-managed KMS).
"""

import boto3, argparse, sys

# ── Semua secret yang perlu disimpan ──────────────────────────
# Format: (ssm_name_suffix, value, description)
SECRETS = [
    # Flask
    ("SECRET_KEY",              "GANTI_DENGAN_SECRET_KEY_AMAN",   "Flask secret key"),

    # Grafana
    ("GRAFANA_USER",            "icscompute",                      "Grafana username"),
    ("GRAFANA_PASS",            "GANTI_DENGAN_PASS_GRAFANA",       "Grafana password"),
    ("GRAFANA_URL",             "https://monitoring.ilcs.co.id",   "Grafana base URL"),

    # AWS (untuk NIKP reporting)
    ("AWS_ACCESS_KEY_ID",       "GANTI_DENGAN_AWS_ACCESS_KEY",     "AWS access key ID untuk NIKP"),
    ("AWS_SECRET_ACCESS_KEY",   "GANTI_DENGAN_AWS_SECRET_KEY",     "AWS secret access key untuk NIKP"),
    ("AWS_ACCOUNT_ID",          "038361715485",                    "AWS account ID NIKP"),
    ("AWS_REGION",              "ap-southeast-1",                  "AWS region NIKP"),

    # Email / SMTP
    ("SMTP_HOST",               "smtp.gmail.com",                  "SMTP host"),
    ("SMTP_PORT",               "587",                             "SMTP port"),
    ("SMTP_USER",               "noreply@icscompute.com",          "SMTP username"),
    ("SMTP_PASS",               "GANTI_DENGAN_APP_PASSWORD_EMAIL", "SMTP app password"),
    ("SMTP_FROM",               "Portal Report · ICS Compute",     "SMTP from display name"),
    ("EMAIL_TO",                "suhendi@icscompute.com",          "Default email recipient"),
]


def push(ssm_client, prefix: str, dry_run: bool):
    ok = 0
    fail = 0
    for suffix, value, desc in SECRETS:
        name = f"{prefix}/{suffix}"
        if value.startswith("GANTI_"):
            print(f"  ⚠  SKIP  {name}  — nilai masih placeholder, isi dulu sebelum push")
            continue
        try:
            if dry_run:
                print(f"  [DRY]  {name}  = {'*' * min(len(value), 8)}...")
            else:
                ssm_client.put_parameter(
                    Name=name,
                    Value=value,
                    Description=desc,
                    Type="SecureString",
                    Overwrite=True,
                )
                print(f"  ✓  {name}")
                ok += 1
        except Exception as e:
            print(f"  ✗  {name}  ERROR: {e}")
            fail += 1

    if not dry_run:
        print(f"\nDone: {ok} pushed, {fail} failed")


def main():
    parser = argparse.ArgumentParser(description="Push Portal Report secrets to AWS SSM")
    parser.add_argument("--region",  default="ap-southeast-1", help="AWS region (default: ap-southeast-1)")
    parser.add_argument("--prefix",  default="/portal-report",  help="SSM parameter prefix (default: /portal-report)")
    parser.add_argument("--dry-run", action="store_true",        help="Preview tanpa upload")
    args = parser.parse_args()

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Pushing secrets → SSM {args.region} prefix={args.prefix}\n")

    try:
        session = boto3.Session(region_name=args.region)
        ssm     = session.client("ssm")
        # Quick connectivity check
        ssm.describe_parameters(MaxResults=1)
    except Exception as e:
        print(f"ERROR: Cannot connect to AWS SSM — {e}")
        print("Pastikan AWS credentials sudah dikonfigurasi (aws configure atau IAM role).")
        sys.exit(1)

    push(ssm, args.prefix, args.dry_run)


if __name__ == "__main__":
    main()
