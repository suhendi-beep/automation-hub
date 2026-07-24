from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

doc = Document()
section = doc.sections[0]
section.left_margin = section.right_margin = Inches(1)
section.top_margin  = section.bottom_margin = Inches(1)

def heading(text, level=1, color=(204,0,0)):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        run.font.color.rgb = RGBColor(*color)
    return p

def para(text="", bold=False, size=11, color=None, indent=False, center=False):
    p = doc.add_paragraph()
    if indent: p.paragraph_format.left_indent = Inches(0.3)
    if center: p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    if color: run.font.color.rgb = RGBColor(*color)
    return p

def table(headers, rows, header_color=(204,0,0)):
    t = doc.add_table(rows=1+len(rows), cols=len(headers))
    t.style = "Table Grid"
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = h
        for run in hdr[i].paragraphs[0].runs:
            run.bold = True
            run.font.size = Pt(10)
            run.font.color.rgb = RGBColor(255,255,255)
        shd = OxmlElement("w:shd")
        shd.set(qn("w:fill"), "%02X%02X%02X" % header_color)
        shd.set(qn("w:val"), "clear")
        hdr[i]._tc.get_or_add_tcPr().append(shd)
    for ri, row in enumerate(rows):
        cells = t.rows[ri+1].cells
        for ci, val in enumerate(row):
            cells[ci].text = val
            cells[ci].paragraphs[0].runs[0].font.size = Pt(10)
    doc.add_paragraph()

def divider():
    p = doc.add_paragraph()
    run = p.add_run("━" * 60)
    run.font.color.rgb = RGBColor(204,0,0)
    run.font.size = Pt(8)

# ══════════════════════════════════════════════════════════════
# COVER
# ══════════════════════════════════════════════════════════════
doc.add_paragraph()
doc.add_paragraph()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("PORTALREPORT")
r.bold = True; r.font.size = Pt(32); r.font.color.rgb = RGBColor(204,0,0)

p2 = doc.add_paragraph()
p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
r2 = p2.add_run("Sistem Otomasi Laporan Customer")
r2.font.size = Pt(16); r2.font.color.rgb = RGBColor(80,80,80)

doc.add_paragraph()
p3 = doc.add_paragraph()
p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
r3 = p3.add_run("ICS Compute  |  Juli 2026")
r3.font.size = Pt(12); r3.font.color.rgb = RGBColor(150,150,150)

doc.add_paragraph()
p4 = doc.add_paragraph()
p4.alignment = WD_ALIGN_PARAGRAPH.CENTER
r4 = p4.add_run("Presented by: Suhendi")
r4.font.size = Pt(11); r4.font.color.rgb = RGBColor(150,150,150)
doc.add_page_break()

# ══════════════════════════════════════════════════════════════
# 1. LATAR BELAKANG
# ══════════════════════════════════════════════════════════════
heading("1. Latar Belakang")
divider()
para("Sebelum ada PortalReport, proses pelaporan untuk customer Pelindo & ILCS dilakukan secara manual:", size=11)
doc.add_paragraph()
for item in [
    "✘  Screenshot halaman OCI Console satu per satu secara manual",
    "✘  Menyusun laporan Word/PowerPoint dari nol setiap minggu",
    "✘  Cek status backup harian harus login ke OCI CLI satu per satu",
    "✘  Proses memakan waktu berjam-jam setiap minggunya",
    "✘  Rentan human error karena dilakukan manual",
]:
    para(item, indent=True, color=(150,0,0) if "✘" in item else (0,0,0))

doc.add_paragraph()
para("Solusi yang dibutuhkan:", bold=True)
para("Sebuah sistem yang bisa menjalankan semua proses tersebut secara otomatis,", indent=True)
para("cukup dengan satu klik, dan hasilnya langsung bisa didownload.", indent=True)
doc.add_page_break()

# ══════════════════════════════════════════════════════════════
# 2. APA ITU PORTALREPORT
# ══════════════════════════════════════════════════════════════
heading("2. Apa Itu PortalReport?")
divider()
para("PortalReport adalah aplikasi web internal ICS Compute yang berfungsi sebagai pusat otomasi laporan untuk customer.", size=12, bold=True)
doc.add_paragraph()
para("Dengan PortalReport, tim bisa:")
for item in [
    "✅  Generate laporan backup OCI secara otomatis (Weekly)",
    "✅  Screenshot console OCI tanpa perlu login manual",
    "✅  Cek status backup harian semua resource sekaligus",
    "✅  Download file laporan langsung dari web (Word/PowerPoint)",
    "✅  Semua proses berjalan di background, tidak mengganggu pekerjaan lain",
]:
    para(item, indent=True)
doc.add_page_break()

# ══════════════════════════════════════════════════════════════
# 3. FITUR YANG TERSEDIA
# ══════════════════════════════════════════════════════════════
heading("3. Fitur yang Tersedia")
divider()
table(
    ["No", "Nama Fitur", "Customer", "Output", "Jadwal"],
    [
        ["1", "Weekly Capture Grafana HO",
         "Pelindo & ILCS",
         "PowerPoint (.pptx)\nScreenshot semua dashboard Grafana",
         "Mingguan"],
        ["2", "Weekly Backup Report OCI Pelindo",
         "Pelindo",
         "Word (.docx)\nScreenshot 7 database OCI",
         "Mingguan"],
        ["3", "Weekly Backup Report OCI ILCS",
         "ILCS & Pelindo",
         "Word (.docx)\nScreenshot 60 resource OCI\n(volume + database)",
         "Mingguan"],
        ["4", "Daily Backup Status ILCS",
         "ILCS & Pelindo",
         "Text report\nStatus backup semua resource\n(35 volume + 30 database)",
         "Harian"],
    ]
)
doc.add_page_break()

# ══════════════════════════════════════════════════════════════
# 4. CARA KERJA APLIKASI
# ══════════════════════════════════════════════════════════════
heading("4. Cara Kerja Aplikasi")
divider()
para("Alur penggunaan sangat sederhana:", bold=True)
doc.add_paragraph()

steps = [
    ("1", "Buka Web PortalReport", "Akses lewat browser: http://ip-server"),
    ("2", "Login", "Username: admin | Password: ICSsupport2026"),
    ("3", "Pilih Customer", "Contoh: klik Pelindo di sidebar"),
    ("4", "Pilih Report & Klik Run", "Contoh: Weekly Backup Report OCI ILCS → klik ▶ Run"),
    ("5", "Input Kredensial OCI", "Masukkan Tenancy, Username, Password OCI\n(tersimpan otomatis untuk penggunaan berikutnya)"),
    ("6", "Input OTP", "OTP dikirim ke email, masukkan di kolom yang muncul"),
    ("7", "Tunggu Proses Selesai", "Aplikasi otomatis screenshot semua halaman\nProgress bisa dipantau di panel Log"),
    ("8", "Download File", "File Word/PowerPoint muncul di Output Files\nKlik tombol Download"),
]

t = doc.add_table(rows=len(steps), cols=3)
t.style = "Table Grid"
for i, (num, title, desc) in enumerate(steps):
    cells = t.rows[i].cells
    cells[0].text = num
    cells[0].paragraphs[0].runs[0].bold = True
    cells[0].paragraphs[0].runs[0].font.color.rgb = RGBColor(204,0,0)
    cells[0].paragraphs[0].runs[0].font.size = Pt(14)
    cells[1].text = title
    cells[1].paragraphs[0].runs[0].bold = True
    cells[1].paragraphs[0].runs[0].font.size = Pt(10)
    cells[2].text = desc
    cells[2].paragraphs[0].runs[0].font.size = Pt(10)
doc.add_paragraph()
doc.add_page_break()

# ══════════════════════════════════════════════════════════════
# 5. TEKNOLOGI YANG DIGUNAKAN
# ══════════════════════════════════════════════════════════════
heading("5. Teknologi yang Digunakan")
divider()
table(
    ["Komponen", "Teknologi", "Fungsi"],
    [
        ["Backend",   "Python + Flask",    "API server, menjalankan logika automation"],
        ["Worker",    "Python + Celery",   "Menjalankan proses berat di background"],
        ["Message Broker", "Redis",        "Komunikasi antara backend dan worker"],
        ["Frontend",  "React + Vite",      "Tampilan web yang diakses user"],
        ["Web Server","Nginx",             "Meneruskan request ke backend/frontend"],
        ["Browser Automation","Selenium + Chromium","Screenshot OCI Console otomatis"],
        ["Container", "Docker Compose",    "Menjalankan semua komponen sekaligus"],
        ["Cloud Target","Oracle OCI",      "Platform yang di-monitor dan di-capture"],
    ]
)
doc.add_page_break()

# ══════════════════════════════════════════════════════════════
# 6. KEBUTUHAN SERVER
# ══════════════════════════════════════════════════════════════
heading("6. Kebutuhan Server (Infrastruktur)")
divider()
table(
    ["Spesifikasi", "Minimum", "Rekomendasi"],
    [
        ["Instance Type (AWS)", "t3.small",    "t3.small"],
        ["CPU",                 "2 vCPU",      "2 vCPU"],
        ["RAM",                 "2 GB",        "2 GB"],
        ["Storage",             "15 GB",       "15 GB"],
        ["OS",                  "Ubuntu 22.04","Ubuntu 22.04 LTS"],
        ["Software",            "Docker",      "Docker + Docker Compose"],
        ["Port",                "80",          "80 (HTTP)"],
    ]
)

para("💡 Tips hemat biaya:", bold=True)
para("   Aplikasi dipakai seminggu sekali → STOP instance setelah selesai, START saat perlu.", indent=True)
para("   Biaya hanya dihitung saat status Running.", indent=True)
doc.add_paragraph()
para("Estimasi biaya AWS (t3.small, Region Asia Pacific):", bold=True)
para("Pemakaian 2 jam/minggu × 4 minggu = 8 jam/bulan", indent=True)
para("t3.small: $0.026/jam × 8 jam = $0.21 (komputasi)", indent=True)
para("Storage 15GB: $0.10/GB × 15 = $1.50/bulan", indent=True)
para("Total estimasi: ± $2/bulan", indent=True, color=(0,120,0))
doc.add_page_break()

# ══════════════════════════════════════════════════════════════
# 7. KEAMANAN
# ══════════════════════════════════════════════════════════════
heading("7. Keamanan Aplikasi")
divider()
table(
    ["Aspek", "Implementasi"],
    [
        ["Login Web",           "Username & password wajib untuk akses aplikasi"],
        ["Kredensial OCI",      "Diinput langsung saat Run, tidak disimpan permanen di server"],
        ["Session Login",       "Session habis otomatis saat browser ditutup"],
        ["Akses Server",        "Hanya bisa diakses via EC2 Instance Connect (AWS Console)"],
        ["Port Terbuka",        "Hanya port 22 (SSH) dan 80 (HTTP)"],
        ["Data Customer",       "Tidak ada data customer disimpan, hanya screenshot & laporan"],
    ]
)
doc.add_page_break()

# ══════════════════════════════════════════════════════════════
# 8. PERTANYAAN YANG SERING DITANYA
# ══════════════════════════════════════════════════════════════
heading("8. Pertanyaan yang Sering Ditanya (Q&A)")
divider()

qnas = [
    ("Apakah aplikasi ini akan membuka browser di server?",
     "Tidak. Browser berjalan secara headless (di background), tidak ada tampilan yang muncul di server."),
    ("Apakah password OCI tersimpan di server?",
     "Tidak. Password OCI hanya dipakai saat proses berjalan dan tidak disimpan di database manapun."),
    ("Apakah bisa diakses dari luar kantor?",
     "Bisa, selama tahu IP server dan kredensial login web (admin / ICSsupport2026)."),
    ("Berapa lama proses Weekly Backup Report ILCS?",
     "Sekitar 15-20 menit untuk 60 resource. Prosesnya berjalan di background, halaman web bisa ditinggal."),
    ("Apakah bisa tambah report baru nanti?",
     "Bisa. Cukup tambah file Python baru dan daftarkan di konfigurasi, tanpa perlu rebuild seluruh aplikasi."),
    ("Apakah perlu restart server setiap ada update?",
     "Tidak perlu restart server. Cukup jalankan: docker compose up -d --build (sekitar 1-2 menit)."),
    ("Bagaimana jika OTP tidak masuk ke email?",
     "Tunggu beberapa menit, OTP kadang terlambat. Kalau timeout, cukup Run ulang dari awal."),
    ("Apakah bisa dipakai oleh beberapa orang sekaligus?",
     "Bisa. Namun disarankan tidak menjalankan automation yang sama secara bersamaan."),
    ("File laporan lama otomatis terhapus?",
     "Ya, sistem hanya menyimpan 2 file terbaru per jenis laporan. File lama otomatis dihapus."),
    ("Bagaimana cara ganti password login web?",
     "Saat ini password ada di kode (LoginPage.jsx). Bisa diubah oleh developer dan deploy ulang frontend."),
]

for q, a in qnas:
    p = doc.add_paragraph()
    r = p.add_run("❓ " + q)
    r.bold = True; r.font.size = Pt(11); r.font.color.rgb = RGBColor(0,70,127)
    p2 = doc.add_paragraph()
    p2.paragraph_format.left_indent = Inches(0.3)
    r2 = p2.add_run("→ " + a)
    r2.font.size = Pt(10)
    doc.add_paragraph()

doc.add_page_break()

# ══════════════════════════════════════════════════════════════
# 9. RENCANA KE DEPAN
# ══════════════════════════════════════════════════════════════
heading("9. Rencana Pengembangan ke Depan")
divider()
table(
    ["Prioritas", "Fitur", "Keterangan"],
    [
        ["Tinggi",  "Deploy ke AWS EC2",         "Agar bisa diakses tim dari mana saja"],
        ["Tinggi",  "Tambah customer baru",       "Mudah ditambah tanpa rebuild aplikasi"],
        ["Sedang",  "Notifikasi email/WhatsApp",  "Kirim laporan otomatis ke PIC setelah selesai"],
        ["Sedang",  "Jadwal otomatis (Cron)",     "Report berjalan otomatis tanpa perlu klik Run"],
        ["Rendah",  "Multi user / role",          "Admin vs viewer dengan akses berbeda"],
        ["Rendah",  "History laporan",            "Arsip semua laporan yang pernah dibuat"],
    ]
)
doc.add_page_break()

# ══════════════════════════════════════════════════════════════
# 10. RINGKASAN
# ══════════════════════════════════════════════════════════════
heading("10. Ringkasan")
divider()
doc.add_paragraph()
para("PortalReport hadir untuk menggantikan proses manual yang memakan waktu.", size=12)
doc.add_paragraph()

table(
    ["Sebelum (Manual)", "Sesudah (PortalReport)"],
    [
        ["Screenshot OCI satu per satu (berjam-jam)", "Otomatis, selesai dalam 15-20 menit"],
        ["Susun Word/PowerPoint manual",              "File ter-generate otomatis, langsung download"],
        ["Cek backup harian satu per satu",           "Satu klik, semua status muncul sekaligus"],
        ["Perlu login OCI manual setiap kali",        "Input sekali, history tersimpan di browser"],
        ["Rentan human error",                        "Konsisten dan akurat setiap saat"],
    ],
    header_color=(0,100,0)
)

doc.add_paragraph()
para("PortalReport bukan hanya menghemat waktu —", bold=True, size=12)
para("tapi juga memastikan laporan selalu konsisten, akurat, dan siap kapanpun dibutuhkan.", size=12)

doc.add_paragraph()
doc.add_paragraph()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("ICS Compute  |  PortalReport  |  Juli 2026")
r.font.size = Pt(10); r.font.color.rgb = RGBColor(150,150,150)

doc.save("/home/suhendi/automation-hub/PORTALREPORT_PRESENTATION.docx")
print("DONE: PORTALREPORT_PRESENTATION.docx saved")
