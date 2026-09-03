# Panduan Deploy PortalReport ke AWS EC2
**Dibuat oleh: ICS Compute**  
**Versi: 1.0 | Juli 2026**

---

## Persiapan Sebelum Mulai

Pastikan kamu punya:
- Akses ke AWS Console (login)
- Aplikasi PortalReport sudah ada di komputer lokal
- Koneksi internet

---

## BAGIAN 1 — Buat EC2 di AWS

### Langkah 1: Login ke AWS Console
1. Buka browser, pergi ke https://console.aws.amazon.com
2. Login dengan akun AWS kamu

### Langkah 2: Buka EC2
1. Di kolom pencarian atas, ketik **EC2**
2. Klik **EC2** yang muncul

### Langkah 3: Launch Instance (Buat Server Baru)
1. Klik tombol **Launch Instance** (warna oranye)
2. Isi form berikut:

| Field | Isi |
|---|---|
| Name | `portalreport` |
| AMI (OS) | Ubuntu Server 22.04 LTS |
| Instance type | `t3.medium` |
| Storage | 20 GB (gp3) |

### Langkah 4: Buat Key Pair (Kunci SSH)
1. Klik **Create new key pair**
2. Name: `portalreport-key`
3. Type: RSA
4. Format: `.pem`
5. Klik **Create key pair** → file otomatis ter-download ke komputer
6. **Simpan file .pem ini baik-baik, jangan sampai hilang!**

### Langkah 5: Setting Security Group (Firewall)
1. Di bagian **Network settings**, klik **Edit**
2. Pastikan ada rule berikut:

| Type | Port | Source |
|---|---|---|
| SSH | 22 | My IP |
| HTTP | 80 | Anywhere |
| Custom TCP | 3000 | Anywhere |

### Langkah 6: Launch
1. Klik **Launch Instance**
2. Tunggu status berubah menjadi **Running** (sekitar 1-2 menit)
3. Catat **Public IP Address** dari instance yang baru dibuat

---

## BAGIAN 2 — Masuk ke Server (SSH)

### Langkah 7: Buka Terminal

**Di Windows:** Buka **PowerShell** atau **Command Prompt**

**Di Mac/Linux:** Buka **Terminal**

### Langkah 8: Set Permission File .pem (Mac/Linux saja)
```bash
chmod 400 portalreport-key.pem
```

> Windows tidak perlu langkah ini

### Langkah 9: Masuk ke Server
```bash
ssh -i portalreport-key.pem ubuntu@<IP-SERVER>
```

Ganti `<IP-SERVER>` dengan IP yang tadi dicatat.

Contoh:
```bash
ssh -i portalreport-key.pem ubuntu@54.123.45.67
```

Kalau muncul pertanyaan `Are you sure you want to continue connecting?` → ketik **yes** lalu Enter.

✅ Kalau berhasil, tampilan terminal berubah menjadi `ubuntu@ip-xxx:~$`

---

## BAGIAN 3 — Install Docker di Server

### Langkah 10: Update Server
```bash
sudo apt update && sudo apt upgrade -y
```

Tunggu sampai selesai (sekitar 1-2 menit).

### Langkah 11: Install Docker
```bash
curl -fsSL https://get.docker.com | sh
```

Tunggu sampai selesai (sekitar 2-3 menit).

### Langkah 12: Tambah User ke Group Docker
```bash
sudo usermod -aG docker ubuntu
newgrp docker
```

### Langkah 13: Verifikasi Docker Berhasil
```bash
docker --version
```

Kalau muncul `Docker version 24.x.x` berarti berhasil ✅

---

## BAGIAN 4 — Upload Aplikasi ke Server

### Langkah 14: Compress Folder Aplikasi (di komputer lokal)

Buka terminal di komputer lokal, jalankan:

```bash
# Di WSL Ubuntu (komputer lokal)
cd /home/suhendi
tar -czf portalreport.tar.gz automation-hub/
```

### Langkah 15: Upload ke Server

```bash
scp -i portalreport-key.pem portalreport.tar.gz ubuntu@<IP-SERVER>:~/
```

Tunggu proses upload selesai.

### Langkah 16: Extract di Server

Kembali ke terminal server (SSH), jalankan:

```bash
cd ~
tar -xzf portalreport.tar.gz
cd automation-hub
```

---

## BAGIAN 5 — Konfigurasi & Jalankan Aplikasi

### Langkah 17: Sesuaikan Port (opsional)

Kalau mau akses lewat port 80 (tanpa nulis nomor port di browser), edit nginx:

```bash
nano nginx/nginx.conf
```

Cari baris `listen 3000;` → ganti menjadi `listen 80;`

Simpan: **Ctrl+X** → **Y** → **Enter**

### Langkah 18: Jalankan Aplikasi

```bash
docker compose up -d
```

Perintah ini akan:
- Download semua komponen yang dibutuhkan (pertama kali ~5-10 menit)
- Menjalankan semua service (backend, frontend, worker, redis)

### Langkah 19: Cek Semua Service Berjalan

```bash
docker compose ps
```

Pastikan semua status **Up** atau **running** ✅

```
NAME                          STATUS
automation-hub-backend-1      Up
automation-hub-frontend-1     Up
automation-hub-worker-1       Up
automation-hub-redis-1        Up
```

---

## BAGIAN 6 — Test Aplikasi

### Langkah 20: Buka di Browser

1. Buka browser
2. Ketik: `http://<IP-SERVER>` atau `http://<IP-SERVER>:3000`
3. Halaman login **PortalReport** akan muncul

### Langkah 21: Login

| Field | Isi |
|---|---|
| Username | `admin` |
| Password | `admin2026!` |

Klik **Login** → Dashboard muncul ✅

---

## BAGIAN 7 — Perintah Penting

### Cek log aplikasi
```bash
docker compose logs -f
```

### Restart semua service
```bash
docker compose restart
```

### Stop aplikasi
```bash
docker compose down
```

### Update aplikasi (setelah ada perubahan kode)
```bash
docker compose up -d --build
```

### Cek penggunaan resource
```bash
docker stats
```

---

## Troubleshooting (Kalau Ada Masalah)

| Masalah | Solusi |
|---|---|
| Tidak bisa SSH | Cek Security Group, pastikan port 22 terbuka untuk IP kamu |
| Browser tidak bisa buka | Cek Security Group, pastikan port 80/3000 terbuka |
| Service tidak jalan | Jalankan `docker compose logs` untuk cek error |
| Disk penuh | Jalankan `docker system prune -f` untuk bersihkan cache |

---

## Informasi Aplikasi

| Item | Detail |
|---|---|
| Nama Aplikasi | PortalReport |
| Dibuat oleh | ICS Compute |
| Stack | Python, React, Redis, Docker |
| Port | 80 atau 3000 |
| OS Server | Ubuntu 22.04 |
| Instance Type | t3.medium (min) |

---

*Dokumen ini dibuat untuk keperluan internal ICS Compute*
