from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

doc = Document()

section = doc.sections[0]
section.left_margin = section.right_margin = Inches(1)
section.top_margin  = section.bottom_margin = Inches(1)

def add_heading(text, level=1, color=(204,0,0)):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        run.font.color.rgb = RGBColor(*color)
    return p

def add_para(text="", bold=False, indent=False):
    p = doc.add_paragraph()
    if indent:
        p.paragraph_format.left_indent = Inches(0.3)
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(11)
    return p

def add_code(text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.3)
    run = p.add_run(text)
    run.font.name = "Courier New"
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0, 100, 0)
    shading = OxmlElement("w:shd")
    shading.set(qn("w:fill"), "F0F0F0")
    shading.set(qn("w:val"), "clear")
    p._p.get_or_add_pPr().append(shading)

def add_table(headers, rows):
    table = doc.add_table(rows=1+len(rows), cols=len(headers))
    table.style = "Table Grid"
    hdr = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = h
        for run in hdr[i].paragraphs[0].runs:
            run.bold = True
            run.font.size = Pt(10)
            run.font.color.rgb = RGBColor(255,255,255)
        shading = OxmlElement("w:shd")
        shading.set(qn("w:fill"), "CC0000")
        shading.set(qn("w:val"), "clear")
        hdr[i]._tc.get_or_add_tcPr().append(shading)
    for r_idx, row in enumerate(rows):
        cells = table.rows[r_idx+1].cells
        for c_idx, val in enumerate(row):
            cells[c_idx].text = val
            cells[c_idx].paragraphs[0].runs[0].font.size = Pt(10)
    doc.add_paragraph()

# COVER
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = p.add_run("PANDUAN DEPLOY PORTALREPORT KE AWS EC2")
run.bold = True; run.font.size = Pt(20); run.font.color.rgb = RGBColor(204,0,0)
p2 = doc.add_paragraph()
p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
r2 = p2.add_run("Menggunakan AWS Console (Tanpa SSH dari Komputer Lokal)")
r2.font.size = Pt(12); r2.font.color.rgb = RGBColor(100,100,100)
doc.add_paragraph()
p3 = doc.add_paragraph()
p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
r3 = p3.add_run("ICS Compute  |  Juli 2026")
r3.font.size = Pt(11); r3.font.color.rgb = RGBColor(150,150,150)
doc.add_page_break()

# PERSIAPAN
add_heading("Persiapan Sebelum Mulai")
add_para("Pastikan kamu memiliki hal-hal berikut:")
for item in [
    "Akses ke AWS Console (akun login)",
    "File aplikasi PortalReport sudah ter-compress (.tar.gz) — lihat Langkah 5",
    "Koneksi internet stabil",
    "Browser (Chrome/Firefox)",
]:
    add_para("✔  " + item, indent=True)
doc.add_paragraph()

# BAGIAN 1
add_heading("Bagian 1 — Buat EC2 Instance di AWS")

add_heading("Langkah 1: Login ke AWS Console", 2, (0,0,0))
add_para("1. Buka browser, pergi ke: https://console.aws.amazon.com")
add_para("2. Login dengan akun AWS kamu")

add_heading("Langkah 2: Buka Halaman EC2", 2, (0,0,0))
add_para("1. Di kolom pencarian atas, ketik EC2")
add_para("2. Klik EC2 yang muncul di hasil pencarian")

add_heading("Langkah 3: Buat Instance Baru", 2, (0,0,0))
add_para("1. Klik tombol Launch Instance (warna oranye)")
add_para("2. Isi konfigurasi berikut:")
add_table(["Field","Isi"],[
    ["Name","portalreport"],
    ["AMI (Sistem Operasi)","Ubuntu Server 22.04 LTS"],
    ["Instance Type","t3.small (2 vCPU, 2GB RAM)  ← Paling hemat"],
    ["Storage","15 GB (gp3)"],
])
add_para("💡 Tips hemat: STOP instance setelah selesai dipakai, START lagi saat perlu.")
add_para("   Biaya hanya dihitung saat instance dalam status Running.", indent=True)
add_para("   Estimasi pemakaian 2 jam/minggu = ± $2/bulan total.", indent=True)

add_heading("Langkah 4: Key Pair — Pilih Proceed Without", 2, (0,0,0))
add_para("Karena kita akan masuk lewat AWS Console langsung (bukan SSH dari terminal),")
add_para("pada bagian Key pair pilih: Proceed without a key pair")
add_para("Catatan: Opsi ini aman karena kita pakai EC2 Instance Connect dari browser.")

add_heading("Langkah 5: Setting Firewall (Security Group)", 2, (0,0,0))
add_para("Di bagian Network settings, klik Edit, lalu pastikan ada rule berikut:")
add_table(["Type","Port","Source","Keterangan"],[
    ["SSH","22","Anywhere","Untuk EC2 Instance Connect"],
    ["HTTP","80","Anywhere","Akses web aplikasi"],
    ["Custom TCP","3000","Anywhere","Port alternatif aplikasi"],
])

add_heading("Langkah 6: Launch Instance", 2, (0,0,0))
add_para("1. Klik Launch Instance")
add_para("2. Tunggu status berubah menjadi Running (sekitar 1-2 menit)")
add_para("3. Klik nama instance untuk melihat detailnya")
add_para("4. Catat Public IPv4 Address (contoh: 54.123.45.67)")
add_para("")
add_para("⚠  PENTING — Cara Hemat Biaya:", bold=True)
add_para("   Setelah selesai menggunakan aplikasi, selalu STOP instance!", indent=True)
add_para("   Cara Stop: EC2 → pilih instance → Instance State → Stop Instance", indent=True)
add_para("   Cara Start lagi: EC2 → pilih instance → Instance State → Start Instance", indent=True)
add_para("   (Catatan: IP server berubah setiap kali Start. Catat IP baru setelah Start.)", indent=True)
doc.add_page_break()

# BAGIAN 2
add_heading("Bagian 2 — Masuk ke Server Lewat AWS Console")

add_heading("Langkah 7: Buka EC2 Instance Connect", 2, (0,0,0))
add_para("1. Di halaman EC2, klik instance portalreport yang sudah dibuat")
add_para("2. Klik tombol Connect (di bagian atas)")
add_para("3. Pilih tab EC2 Instance Connect")
add_para("4. Klik tombol Connect")
add_para("5. Akan terbuka jendela terminal baru langsung di browser ✅")
add_para("   Tampilan: ubuntu@ip-xxx:~$  → berarti kamu sudah masuk ke server")
doc.add_page_break()

# BAGIAN 3
add_heading("Bagian 3 — Install Docker di Server")
add_para("Jalankan perintah berikut satu per satu di terminal browser yang sudah terbuka:")

add_heading("Langkah 8: Update Server", 2, (0,0,0))
add_code("sudo apt update && sudo apt upgrade -y")
add_para("Tunggu sampai selesai (sekitar 1-2 menit). Kalau ada pertanyaan, ketik Y lalu Enter.")

add_heading("Langkah 9: Install Docker", 2, (0,0,0))
add_code("curl -fsSL https://get.docker.com | sh")
add_para("Tunggu sampai selesai (sekitar 2-3 menit).")

add_heading("Langkah 10: Tambah User ke Grup Docker", 2, (0,0,0))
add_code("sudo usermod -aG docker ubuntu")
add_code("newgrp docker")

add_heading("Langkah 11: Verifikasi Docker Berhasil", 2, (0,0,0))
add_code("docker --version")
add_para("Kalau muncul Docker version 24.x.x berarti berhasil ✅")
doc.add_page_break()

# BAGIAN 4
add_heading("Bagian 4 — Upload Aplikasi ke Server")
add_para("Karena kita tidak pakai SSH lokal, file di-upload menggunakan GitHub atau langsung copy-paste script install.")

add_heading("Langkah 12: Compress Folder Aplikasi (di komputer lokal)", 2, (0,0,0))
add_para("Buka WSL/Terminal di komputer lokal, jalankan:")
add_code("cd /home/suhendi")
add_code("tar -czf portalreport.tar.gz automation-hub/")
add_para("File portalreport.tar.gz akan terbuat di folder /home/suhendi/")

add_heading("Langkah 13: Upload File ke Server via S3 (Cara Termudah)", 2, (0,0,0))
add_para("A. Upload file ke S3 dulu dari komputer lokal:")
add_para("   1. Buka AWS Console → S3 → pilih bucket (atau buat bucket baru)")
add_para("   2. Klik Upload → pilih file portalreport.tar.gz → Upload")
add_para("   3. Setelah upload, klik file tersebut → Copy S3 URI (contoh: s3://nama-bucket/portalreport.tar.gz)")
add_para("")
add_para("B. Download dari S3 ke server (di terminal EC2 Instance Connect):")
add_code("aws s3 cp s3://nama-bucket/portalreport.tar.gz ~/portalreport.tar.gz")
add_para("Ganti nama-bucket dengan nama bucket S3 kamu.")

add_heading("Langkah 14: Extract File di Server", 2, (0,0,0))
add_code("cd ~")
add_code("tar -xzf portalreport.tar.gz")
add_code("cd automation-hub")
add_para("Verifikasi folder ada:")
add_code("ls")
add_para("Harus muncul: backend  frontend  docker-compose.yml  nginx  dst.")
doc.add_page_break()

# BAGIAN 5
add_heading("Bagian 5 — Jalankan Aplikasi")

add_heading("Langkah 15: Jalankan Docker Compose", 2, (0,0,0))
add_code("docker compose up -d")
add_para("Perintah ini akan menjalankan semua komponen secara otomatis.")
add_para("Pertama kali membutuhkan waktu 5-10 menit untuk download komponen.")

add_heading("Langkah 16: Cek Status Semua Service", 2, (0,0,0))
add_code("docker compose ps")
add_para("Pastikan semua service berstatus Up ✅")
add_table(["Service","Status"],[
    ["automation-hub-backend-1","Up"],
    ["automation-hub-frontend-1","Up"],
    ["automation-hub-worker-1","Up"],
    ["automation-hub-redis-1","Up"],
])
doc.add_page_break()

# BAGIAN 6
add_heading("Bagian 6 — Test Aplikasi")

add_heading("Langkah 17: Buka di Browser", 2, (0,0,0))
add_para("1. Buka tab browser baru")
add_para("2. Ketik di address bar (gunakan IP yang dicatat di Langkah 6):")
add_code("http://<IP-SERVER>")
add_para("Contoh:"); add_code("http://54.123.45.67")
add_para("3. Halaman login PortalReport akan muncul ✅")

add_heading("Langkah 18: Login ke Aplikasi", 2, (0,0,0))
add_table(["Field","Isi"],[
    ["Username","admin"],
    ["Password","ICSsupport2026"],
])
add_para("Klik tombol Login → Dashboard PortalReport akan muncul ✅")
doc.add_page_break()

# PERINTAH PENTING
add_heading("Perintah Penting")
add_para("Jalankan perintah ini di terminal EC2 Instance Connect:")
add_table(["Kebutuhan","Perintah"],[
    ["Cek log aplikasi","docker compose logs -f"],
    ["Restart semua service","docker compose restart"],
    ["Stop aplikasi","docker compose down"],
    ["Update aplikasi","docker compose up -d --build"],
    ["Cek penggunaan resource","docker stats"],
    ["Bersihkan cache Docker","docker system prune -f"],
])

# TROUBLESHOOTING
add_heading("Troubleshooting")
add_table(["Masalah","Solusi"],[
    ["EC2 Instance Connect gagal connect","Pastikan port 22 di Security Group terbuka (Anywhere)"],
    ["Browser tidak bisa buka web","Pastikan port 80 di Security Group terbuka (Anywhere)"],
    ["Service tidak mau jalan","Jalankan: docker compose logs untuk lihat error"],
    ["Storage server penuh","Jalankan: docker system prune -f"],
    ["aws s3 cp gagal","Pastikan IAM Role EC2 punya akses S3, atau gunakan presigned URL"],
])

# INFO APLIKASI
add_heading("Informasi Aplikasi")
add_table(["Item","Detail"],[
    ["Nama Aplikasi","PortalReport"],
    ["Dibuat oleh","ICS Compute"],
    ["Teknologi","Python, React, Redis, Docker Compose"],
    ["Port Akses","80 (HTTP)"],
    ["OS Server","Ubuntu Server 22.04 LTS"],
    ["Instance Type","t3.small (2 vCPU, 2GB RAM)"],
    ["Storage","15 GB (gp3)"],
    ["Estimasi Biaya","± $2/bulan (pakai 2 jam/minggu, Stop saat tidak dipakai)"],
    ["Akses Server","EC2 Instance Connect (via browser AWS Console)"],
])

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Dokumen ini dibuat untuk keperluan internal ICS Compute  |  Juli 2026")
r.font.size = Pt(9); r.font.color.rgb = RGBColor(150,150,150)

doc.save("/home/suhendi/automation-hub/DEPLOY_GUIDE.docx")
print("DONE: DEPLOY_GUIDE.docx saved")
