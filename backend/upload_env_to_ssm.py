#!/usr/bin/env python3
"""Upload secret Portal Report dari environment container ke AWS SSM.

Jalankan SATU KALI dari server production SEBELUM .env lama dibersihkan:
    docker compose build backend
    docker compose run --rm --no-deps backend python upload_env_to_ssm.py --confirm

Script tidak mencetak nilai secret dan tidak menyimpan secret ke file baru.
Server harus memakai IAM Role yang sementara memiliki ssm:PutParameter untuk
/portal-report/*. Setelah upload selesai, ganti kembali role menjadi read-only.
"""

import argparse
import os
import sys
from urllib.parse import urlparse

import boto3

PARAMETER_NAMES = (
    "REDIS_URL",
    "SECRET_KEY",
    "GRAFANA_USER",
    "GRAFANA_PASS",
    "GRAFANA_URL",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCOUNT_ID",
    "AWS_REGION",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "EMAIL_TO",
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Upload existing Portal Report environment values to AWS SSM."
    )
    parser.add_argument("--prefix", default="/portal-report")
    parser.add_argument(
        "--region",
        default=os.getenv("AWS_REGION", "ap-southeast-1"),
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required: writes SecureString values to AWS SSM.",
    )
    args = parser.parse_args()

    if not args.confirm:
        print("Nothing uploaded. Run again with --confirm after reviewing the command.")
        return 2

    prefix = args.prefix.rstrip("/")
    values = {name: os.getenv(name, "").strip() for name in PARAMETER_NAMES}
    missing = [name for name, value in values.items() if not value]
    if missing:
        print("Upload stopped: these variables are empty in the current environment:")
        for name in missing:
            print(f"  - {name}")
        print("Keep the existing production .env in place, then retry.")
        return 1

    redis_url = values["REDIS_URL"]
    if not urlparse(redis_url).password:
        print("Upload stopped: REDIS_URL must include the Redis username/password.")
        print("Ask the Redis administrator for the authenticated connection URI.")
        return 1

    client = boto3.client("ssm", region_name=args.region)
    try:
        client.describe_parameters(MaxResults=1)
    except Exception as error:
        print(f"Cannot access AWS SSM in {args.region}: {error}")
        print("Attach temporary permission to write /portal-report/* to the server IAM role.")
        return 1

    print(f"Uploading {len(PARAMETER_NAMES)} encrypted parameters to {prefix} in {args.region}.")
    for name, value in values.items():
        client.put_parameter(
            Name=f"{prefix}/{name}",
            Value=value,
            Type="SecureString",
            Overwrite=True,
            Description=f"Portal Report configuration: {name}",
        )
        print(f"  uploaded {prefix}/{name}")

    print("Upload complete. Values were not printed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
