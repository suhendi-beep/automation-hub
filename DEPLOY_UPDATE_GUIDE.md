# Portal Report — Panduan Update Aplikasi

> **Ini adalah update app yang sudah berjalan, bukan deploy dari nol.**  
> Server, Docker, dan semua infrastruktur sudah ada sebelumnya.

---

## Gambaran Umum Perubahan

| Komponen | Perubahan |
|---|---|
| Redis | Pindah dari Redis lokal → Redis eksternal `172.19.10.143:6379` channel 8 |
| Secrets | Dipindah dari `.env` → AWS SSM Parameter Store (terenkripsi) |
| Resource Limits | Semua container dikurangi limit CPU/memory agar tidak spike |
| Fitur Baru | Multi-user login, Engineer Activity, Daily Task shared, notifikasi reminder, dll |

---

## Prasyarat

Sebelum mulai, pastikan:

- [ ] Akses SSH ke server production
- [ ] AWS CLI terkonfigurasi di mesin lokal (untuk upload secrets ke SSM)
- [ ] Redis eksternal `172.19.10.143:6379` sudah bisa diakses dari server
- [ ] Server memiliki IAM Role dengan policy `AmazonSSMReadOnlyAccess` (jika EC2), atau AWS credentials dikonfigurasi di server

---

## Bagian A — Di Mesin Lokal (Sebelum ke Server)

### A1. Isi Nilai Secret

Buka file `push_secrets_to_ssm.py` di root project, ganti semua nilai `GANTI_DENGAN_...` dengan nilai asli:

```python
("SECRET_KEY",            "random-string-minimal-32-karakter",  ...),
("GRAFANA_PASS",          "password-grafana-asli",               ...),
("AWS_ACCESS_KEY_ID",     "AKIA...",                             ...),
("AWS_SECRET_ACCESS_KEY", "secret-key-asli",                     ...),
("SMTP_PASS",             "app-password-gmail",                  ...),
# ... dan seterusnya
```

> ⚠️ **Jangan commit file ini setelah diisi nilai asli.**

### A2. Login AWS CLI

```bash
aws configure
# AWS Access Key ID: <isi>
# AWS Secret Access Key: <isi>
# Default region name: ap-southeast-1
# Default output format: json
```

### A3. Upload Secrets ke SSM

```bash
# Preview dulu tanpa upload
python3 push_secrets_to_ssm.py --dry-run

# Upload asli jika preview OK
python3 push_secrets_to_ssm.py
```

Output yang diharapkan:
```
✓  /portal-report/SECRET_KEY
✓  /portal-report/GRAFANA_USER
✓  /portal-report/GRAFANA_PASS
...
Done: 12 pushed, 0 failed
```

### A4. Verifikasi Upload SSM

```bash
aws ssm get-parameters-by-path \
  --path /portal-report \
  --with-decryption \
  --region ap-southeast-1 \
  --query "Parameters[*].{Name:Name,Value:Value}" \
  --output table
```

---

## Bagian B — Di Server Production

### B1. SSH ke Server

```bash
ssh user@<ip-server>
cd /path/to/automation-hub
```

### B2. Pull Kode Terbaru

```bash
git pull origin main
```

### B3. Siapkan File `.env`

File `.env` di server **tidak perlu berisi password apapun** — semua diambil dari SSM saat startup. Isi minimal:

```env
FLASK_ENV=production
REDIS_URL=redis://172.19.10.143:6379/8
SSM_PREFIX=/portal-report
AWS_REGION=ap-southeast-1
```

Jika file `.env` belum ada, copy dari template:

```bash
cp .env.example .env
# Lalu edit sesuai isi minimal di atas
nano .env
```

### B4. Test Koneksi Redis Eksternal

```bash
redis-cli -h 172.19.10.143 -p 6379 -n 8 ping
```

Expected: `PONG`

Jika Redis butuh password:
```bash
redis-cli -h 172.19.10.143 -p 6379 -n 8 -a <password> ping
# Tambahkan juga ke .env:
# REDIS_URL=redis://:<password>@172.19.10.143:6379/8
```

### B5. Test Akses SSM dari Server

```bash
aws ssm get-parameters-by-path \
  --path /portal-report \
  --with-decryption \
  --region ap-southeast-1
```

Jika gagal, konfigurasi AWS credentials di server:
```bash
aws configure
```

### B6. Build Ulang Docker Image

```bash
docker compose build
```

> Proses ini membutuhkan waktu beberapa menit karena mengunduh dependencies.

### B7. Restart Semua Container

```bash
docker compose up -d
```

### B8. Verifikasi Container Berjalan

```bash
docker compose ps
```

Expected output:
```
NAME                        STATUS
automation-hub-backend-1    Up
automation-hub-worker-1     Up
automation-hub-frontend-1   Up
```

> ℹ️ Service `redis` tidak ada lagi — sudah menggunakan Redis eksternal.

---

## Bagian C — Verifikasi Setelah Update

### C1. Cek Log Backend (SSM + Redis)

```bash
docker logs automation-hub-backend-1 2>&1 | grep -E "SSM|Running|ERROR" | head -20
docker logs automation-hub-worker-1  2>&1 | grep -E "SSM|celery|ERROR" | head -20
```

Log SSM yang diharapkan:
```
SSM: loaded 12 parameters from /portal-report
SSM: all secrets injected into os.environ
```

### C2. Test API

```bash
curl http://localhost:5000/api/ping
# Expected: {"status": "ok"}

curl http://localhost:5000/api/auth/users
# Expected: JSON list user (admin, suhendi, dll)
```

### C3. Buka Browser

```
http://<ip-server>:3000
```

Login dengan salah satu user:

| Username | Password | Role |
|---|---|---|
| admin | admin2026! | Admin |
| suhendi | m7Kx9pQ3nRvL2wZt | Engineer |
| Priyanto | bF4hJeU8cYsA6dNp | Engineer |
| neal.hotama | Tg5zXw1kMrD0qVjH | Engineer |
| nazran.hisyami | Wy2nLf6uBsC9eKoP | Engineer |

---

## Rollback (Jika Ada Masalah)

Jika SSM tidak bisa diakses, isi `.env` langsung dengan nilai asli sebagai fallback — aplikasi otomatis menggunakan env var tanpa perlu ubah kode:

```env
FLASK_ENV=production
REDIS_URL=redis://172.19.10.143:6379/8
SSM_PREFIX=/portal-report
AWS_REGION=ap-southeast-1

# Fallback values (isi jika SSM tidak tersedia)
SECRET_KEY=nilai-asli
GRAFANA_USER=nilai-asli
GRAFANA_PASS=nilai-asli
# ... dst
```

Jika update gagal dan perlu kembali ke versi sebelumnya:

```bash
git log --oneline -5          # lihat commit history
git checkout <commit-lama>    # kembali ke versi lama
docker compose build
docker compose up -d
```

---

## Resource Limits Container

| Service | CPU Limit | Memory Limit |
|---|---|---|
| backend | 0.4 core | 384 MB |
| worker | 0.6 core | 512 MB |
| frontend | 0.2 core | 128 MB |

---

*Dokumen ini dibuat untuk update Portal Report v2 — September 2026*
