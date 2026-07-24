# ⚡ Automation Hub Dashboard — Pelindo

## Quick Start

### 1. Copy OCI config
```bash
cp ~/.oci/config ./oci_config/config
cp ~/.oci/oci_api_key.pem ./oci_config/oci_api_key.pem
cp ~/.oci/oci_api_key_pelindo.pem ./oci_config/oci_api_key_pelindo.pem

# Update path di oci_config/config → ganti /home/suhendi/.oci/ menjadi /root/.oci/
sed -i 's|/home/suhendi/.oci/|/root/.oci/|g' ./oci_config/config

chmod 600 ./oci_config/*.pem
```

### 2. Copy template Grafana
```bash
cp ~/template_grafana.pptx ./shared/template_grafana.pptx
```

### 3. Build & jalankan
```bash
docker-compose up --build
```

### 4. Buka browser
```
http://localhost:3000
```

---

## Cara pakai

### Automation yang butuh OCI login (backup ILCS & Pelindo)
1. Klik bar **OCI Session** di sidebar bawah
2. Masukkan username & password OCI
3. Tunggu proses login selesai (~30 detik)
4. Status berubah jadi "OCI Session Aktif"
5. Sekarang bisa Run automation backup

### Automation Grafana HO
1. Klik **▶ Run** → muncul form tanggal
2. Isi Start Date, Start Time, End Date, End Time
3. Klik Jalankan → progress bisa dipantau di Log

### Daily Status ILCS
1. Langsung klik **▶ Run** — pakai OCI CLI, tidak perlu login browser
2. Hasil tersimpan di `shared/reports/`

---

## Tambah customer baru (AWS/Huawei)

1. Daftarkan di `backend/app.py` → REGISTRY
2. Buat folder `backend/tasks/nama_customer/`
3. Buat file automation dengan fungsi `run(log_path, args)`
4. Restart: `docker-compose restart backend worker`
