"""
generate_deploy_doc.py
Membuat file DEPLOY_UPDATE_GUIDE.docx — panduan step-by-step
update Portal Report dari login AWS sampai selesai deploy.
"""
from docx import Document
from docx.shared import Pt, RGBColor, Cm, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import copy

# ── Warna ─────────────────────────────────────────────────
RED    = RGBColor(0xB1, 0x12, 0x26)
DARK   = RGBColor(0x1A, 0x1A, 0x1A)
GRAY   = RGBColor(0x50, 0x50, 0x50)
WHITE  = RGBColor(0xFF, 0xFF, 0xFF)
LBLUE  = RGBColor(0xE8, 0xF0, 0xFE)
LRED   = RGBColor(0xFF, 0xF0, 0xF0)
LGREEN = RGBColor(0xF0, 0xFF, 0xF4)
LYEL   = RGBColor(0xFF, 0xFD, 0xEA)
LCYAN  = RGBColor(0xE8, 0xF8, 0xFF)

doc = Document()

# ── Page margins ──────────────────────────────────────────
for section in doc.sections:
    section.top_margin    = Cm(2)
    section.bottom_margin = Cm(2)
    section.left_margin   = Cm(2.5)
    section.right_margin  = Cm(2.5)

# ── Default font ─────────────────────────────────────────
style = doc.styles['Normal']
style.font.name = 'Calibri'
style.font.size = Pt(10.5)

# ── Helper functions ──────────────────────────────────────
def set_cell_bg(cell, hex_color):
    tc   = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd  = OxmlElement('w:shd')
    shd.set(qn('w:val'),   'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'),  hex_color)
    tcPr.append(shd)

def h1(text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(text)
    r.font.size  = Pt(20)
    r.font.bold  = True
    r.font.color.rgb = RED
    r.font.name  = 'Calibri'
    return p

def h2(text):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size  = Pt(14)
    r.font.bold  = True
    r.font.color.rgb = RED
    r.font.name  = 'Calibri'
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after  = Pt(4)
    return p

def h3(text):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size  = Pt(11.5)
    r.font.bold  = True
    r.font.color.rgb = DARK
    r.font.name  = 'Calibri'
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after  = Pt(2)
    return p

def body(text, bold=False, color=None):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(10.5)
    r.font.bold = bold
    r.font.name = 'Calibri'
    if color:
        r.font.color.rgb = color
    p.paragraph_format.space_after = Pt(3)
    return p

def note(text, bg='E8F0FE', emoji='ℹ️'):
    tbl = doc.add_table(rows=1, cols=1)
    tbl.style = 'Table Grid'
    cell = tbl.cell(0, 0)
    set_cell_bg(cell, bg)
    p = cell.paragraphs[0]
    r = p.add_run(f'{emoji}  {text}')
    r.font.size = Pt(10)
    r.font.name = 'Calibri'
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after  = Pt(3)
    doc.add_paragraph()

def code(text):
    tbl = doc.add_table(rows=1, cols=1)
    tbl.style = 'Table Grid'
    cell = tbl.cell(0, 0)
    set_cell_bg(cell, '1E1E1E')
    p = cell.paragraphs[0]
    for line in text.strip().split('\n'):
        if p.runs:
            p.add_run('\n')
        r = p.add_run(line)
        r.font.name  = 'Courier New'
        r.font.size  = Pt(9)
        r.font.color.rgb = RGBColor(0xA8, 0xFF, 0xB0)
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after  = Pt(4)
    doc.add_paragraph()

def step_box(num, title, desc):
    tbl = doc.add_table(rows=1, cols=2)
    tbl.style = 'Table Grid'
    # number cell
    c0 = tbl.cell(0, 0)
    c0.width = Cm(1.5)
    set_cell_bg(c0, 'B11226')
    p0 = c0.paragraphs[0]
    p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r0 = p0.add_run(str(num))
    r0.font.size  = Pt(18)
    r0.font.bold  = True
    r0.font.color.rgb = WHITE
    r0.font.name  = 'Calibri'
    # content cell
    c1 = tbl.cell(0, 1)
    set_cell_bg(c1, 'F9F9F9')
    p1 = c1.paragraphs[0]
    rt = p1.add_run(title + '\n')
    rt.font.size  = Pt(11)
    rt.font.bold  = True
    rt.font.name  = 'Calibri'
    rt.font.color.rgb = DARK
    rd = p1.add_run(desc)
    rd.font.size  = Pt(10)
    rd.font.name  = 'Calibri'
    rd.font.color.rgb = GRAY
    doc.add_paragraph()

def user_table():
    tbl = doc.add_table(rows=6, cols=3)
    tbl.style = 'Table Grid'
    headers = ['Username', 'Password', 'Role']
    for i, h in enumerate(headers):
        c = tbl.cell(0, i)
        set_cell_bg(c, 'B11226')
        p = c.paragraphs[0]
        r = p.add_run(h)
        r.font.bold  = True
        r.font.color.rgb = WHITE
        r.font.name  = 'Calibri'
        r.font.size  = Pt(10)
        p.alignment  = WD_ALIGN_PARAGRAPH.CENTER
    rows = [
        ('admin',         'ICSsupport2026',   'Admin'),
        ('suhendi',       'm7Kx9pQ3nRvL2wZt', 'Engineer'),
        ('Priyanto',      'bF4hJeU8cYsA6dNp', 'Engineer'),
        ('neal.hotama',   'Tg5zXw1kMrD0qVjH', 'Engineer'),
        ('nazran.hisyami', 'Wy2nLf6uBsC9eKoP', 'Engineer'),
    ]
    for ri, row in enumerate(rows):
        bg = 'FFFFFF' if ri % 2 == 0 else 'F5F5F5'
        for ci, val in enumerate(row):
            c = tbl.cell(ri+1, ci)
            set_cell_bg(c, bg)
            p = c.paragraphs[0]
            r = p.add_run(val)
            r.font.name = 'Courier New' if ci < 2 else 'Calibri'
            r.font.size = Pt(9.5)
            if ci == 2:
                r.font.color.rgb = RED if val == 'Admin' else GRAY
    doc.add_paragraph()

def resource_table():
    tbl = doc.add_table(rows=4, cols=3)
    tbl.style = 'Table Grid'
    headers = ['Service', 'CPU Limit', 'Memory Limit']
    for i, h in enumerate(headers):
        c = tbl.cell(0, i)
        set_cell_bg(c, '363636')
        p = c.paragraphs[0]
        r = p.add_run(h)
        r.font.bold  = True
        r.font.color.rgb = WHITE
        r.font.name  = 'Calibri'
        r.font.size  = Pt(10)
        p.alignment  = WD_ALIGN_PARAGRAPH.CENTER
    rows = [
        ('backend',  '0.4 core', '384 MB'),
        ('worker',   '0.6 core', '512 MB'),
        ('frontend', '0.2 core', '128 MB'),
    ]
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            c = tbl.cell(ri+1, ci)
            set_cell_bg(c, 'F9F9F9')
            p = c.paragraphs[0]
            r = p.add_run(val)
            r.font.name = 'Calibri'
            r.font.size = Pt(10)
    doc.add_paragraph()

# ══════════════════════════════════════════════════════════
#  COVER
# ══════════════════════════════════════════════════════════
doc.add_paragraph()
h1("PORTAL REPORT")
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Panduan Update & Deploy")
r.font.size  = Pt(14)
r.font.color.rgb = GRAY
r.font.name  = 'Calibri'

p2 = doc.add_paragraph()
p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
r2 = p2.add_run("ICS Compute · September 2026")
r2.font.size  = Pt(10)
r2.font.color.rgb = GRAY
r2.font.name  = 'Calibri'

doc.add_paragraph()
note(
    "Dokumen ini mencakup step-by-step update Portal Report dari awal (login AWS) "
    "sampai aplikasi berjalan di server production. "
    "Ini adalah UPDATE dari aplikasi yang sudah berjalan, BUKAN deploy dari nol.",
    bg='FFF8E1', emoji='📌'
)

# ══════════════════════════════════════════════════════════
#  RINGKASAN PERUBAHAN
# ══════════════════════════════════════════════════════════
h2("📋  Ringkasan Perubahan")

tbl = doc.add_table(rows=5, cols=2)
tbl.style = 'Table Grid'
changes = [
    ('Redis',          'Pindah dari Redis lokal → Redis eksternal 172.19.10.143:6379 channel 8'),
    ('Secrets',        'Dipindah dari file .env → AWS SSM Parameter Store (terenkripsi)'),
    ('Resource Limits','Semua container dikurangi CPU/memory agar tidak spike'),
    ('Fitur Baru',     'Multi-user login, Engineer Activity, Daily Task shared (server-side), notifikasi reminder, alert detail lengkap'),
]
for i, (k, v) in enumerate(changes):
    c0 = tbl.cell(i, 0)
    c1 = tbl.cell(i, 1)
    set_cell_bg(c0, 'B11226')
    set_cell_bg(c1, 'FFFFFF' if i % 2 == 0 else 'F9F9F9')
    r0 = c0.paragraphs[0].add_run(k)
    r0.font.bold = True; r0.font.color.rgb = WHITE; r0.font.name = 'Calibri'; r0.font.size = Pt(10)
    r1 = c1.paragraphs[0].add_run(v)
    r1.font.name = 'Calibri'; r1.font.size = Pt(10)
doc.add_paragraph()

# ══════════════════════════════════════════════════════════
#  PRASYARAT
# ══════════════════════════════════════════════════════════
h2("✅  Prasyarat")
items = [
    "Akses SSH ke server production",
    "AWS CLI terinstall di mesin lokal",
    "Akun AWS dengan hak akses SSM PutParameter",
    "Server production memiliki IAM Role dengan policy AmazonSSMReadOnlyAccess (jika EC2)",
    "Redis eksternal 172.19.10.143:6379 sudah bisa diakses dari server",
]
for item in items:
    p = doc.add_paragraph(style='List Bullet')
    r = p.add_run(item)
    r.font.name = 'Calibri'
    r.font.size = Pt(10.5)

doc.add_paragraph()

# ══════════════════════════════════════════════════════════
#  BAGIAN A — DI MESIN LOKAL
# ══════════════════════════════════════════════════════════
h2("🖥️  BAGIAN A — Di Mesin Lokal")
note("Lakukan bagian ini di laptop/PC Anda sebelum menyentuh server.", bg='E8F0FE', emoji='💻')

h3("A1. Login AWS CLI")
body("Buka terminal, jalankan perintah berikut:")
code("aws configure")
body("Isi informasi yang diminta:")
code(
    "AWS Access Key ID     : AKIA... (isi access key)\n"
    "AWS Secret Access Key : xxxxxxxx (isi secret key)\n"
    "Default region name   : ap-southeast-1\n"
    "Default output format : json"
)
body("Verifikasi login berhasil:")
code("aws sts get-caller-identity")
body("Expected output (tampil informasi akun Anda):")
code('{\n    "Account": "038361715485",\n    "Arn": "arn:aws:iam::..."\n}')

h3("A2. Isi Nilai Secret")
body(
    "Buka file push_secrets_to_ssm.py di folder automation-hub. "
    "Ganti semua nilai yang masih bertulisan GANTI_DENGAN_... dengan nilai asli:"
)
code(
    '("SECRET_KEY",            "isi-random-string-panjang",    ...),\n'
    '("GRAFANA_PASS",          "password-grafana-asli",         ...),\n'
    '("AWS_ACCESS_KEY_ID",     "AKIA...",                       ...),\n'
    '("AWS_SECRET_ACCESS_KEY", "secret-key-aws",                ...),\n'
    '("SMTP_PASS",             "app-password-gmail",            ...),\n'
    '# ... dan seterusnya'
)
note("JANGAN commit file ini setelah diisi nilai asli!", bg='FFE8E8', emoji='⚠️')

h3("A3. Upload Secrets ke AWS SSM")
body("Jalankan preview dulu untuk memastikan tidak ada error:")
code("python3 push_secrets_to_ssm.py --dry-run")
body("Jika preview OK (semua [DRY] tampil), jalankan upload asli:")
code("python3 push_secrets_to_ssm.py")
body("Expected output:")
code(
    "✓  /portal-report/SECRET_KEY\n"
    "✓  /portal-report/GRAFANA_USER\n"
    "✓  /portal-report/GRAFANA_PASS\n"
    "✓  /portal-report/AWS_ACCESS_KEY_ID\n"
    "✓  /portal-report/SMTP_PASS\n"
    "....\n"
    "Done: 12 pushed, 0 failed"
)

h3("A4. Verifikasi Upload SSM")
body("Pastikan semua secret sudah tersimpan di SSM:")
code(
    "aws ssm get-parameters-by-path \\\n"
    "  --path /portal-report \\\n"
    "  --with-decryption \\\n"
    "  --region ap-southeast-1 \\\n"
    "  --query 'Parameters[*].Name' \\\n"
    "  --output table"
)
body("Harus muncul daftar 12+ parameter /portal-report/...")

doc.add_page_break()

# ══════════════════════════════════════════════════════════
#  BAGIAN B — DI SERVER PRODUCTION
# ══════════════════════════════════════════════════════════
h2("🖧  BAGIAN B — Di Server Production")
note("Semua perintah berikut dijalankan di dalam server via SSH.", bg='E8F0FE', emoji='🔐')

h3("B1. SSH ke Server")
code("ssh user@<ip-server-production>")
body("Masuk ke folder project:")
code("cd /path/to/automation-hub")

h3("B2. Test Koneksi Redis Eksternal")
body("Sebelum update apapun, pastikan Redis eksternal bisa diakses:")
code("redis-cli -h 172.19.10.143 -p 6379 -n 8 ping")
body("Expected: ")
code("PONG")
note(
    "Jika Redis menggunakan password, gunakan:\n"
    "redis-cli -h 172.19.10.143 -p 6379 -n 8 -a <password> ping\n"
    "Tambahkan password ke .env: REDIS_URL=redis://:<password>@172.19.10.143:6379/8",
    bg='FFF8E1', emoji='🔑'
)

h3("B3. Test Akses SSM dari Server")
code(
    "aws ssm get-parameters-by-path \\\n"
    "  --path /portal-report \\\n"
    "  --with-decryption \\\n"
    "  --region ap-southeast-1"
)
body("Jika gagal (NoCredentialProviders), konfigurasi AWS di server:")
code("aws configure\n# Isi access key, secret key, region: ap-southeast-1")
note(
    "Jika server adalah EC2, lebih baik attach IAM Role 'AmazonSSMReadOnlyAccess' "
    "ke instance daripada menyimpan credentials di server.",
    bg='E8F8FF', emoji='💡'
)

h3("B4. Pull Kode Terbaru")
code(
    "git fetch origin\n"
    "git pull origin main"
)
body("Pastikan tidak ada conflict. Jika ada, resolve dulu sebelum lanjut.")
code("git status   # harus: 'nothing to commit, working tree clean'")

h3("B5. Update File .env")
body(
    "File .env di server tidak perlu berisi password apapun — semua diambil dari SSM. "
    "Cukup berisi 4 baris ini:"
)
code(
    "FLASK_ENV=production\n"
    "REDIS_URL=redis://172.19.10.143:6379/8\n"
    "SSM_PREFIX=/portal-report\n"
    "AWS_REGION=ap-southeast-1"
)
body("Buat/update file .env:")
code(
    "cp .env.example .env\n"
    "nano .env\n"
    "# Edit sesuai 4 baris di atas, simpan dengan Ctrl+X → Y → Enter"
)

h3("B6. Build Ulang Docker Image")
body("Rebuild semua image dengan kode terbaru:")
code("docker compose build")
note(
    "Proses ini membutuhkan beberapa menit karena mengunduh dependencies. "
    "Tunggu sampai selesai sebelum lanjut ke step berikutnya.",
    bg='FFF8E1', emoji='⏳'
)

h3("B7. Jalankan Semua Container")
code("docker compose up -d")
body("Cek semua container berjalan:")
code("docker compose ps")
body("Expected output — 3 container status Up (tidak ada redis lokal lagi):")
code(
    "NAME                        STATUS\n"
    "automation-hub-backend-1    Up\n"
    "automation-hub-worker-1     Up\n"
    "automation-hub-frontend-1   Up"
)

doc.add_page_break()

# ══════════════════════════════════════════════════════════
#  BAGIAN C — VERIFIKASI
# ══════════════════════════════════════════════════════════
h2("🔍  BAGIAN C — Verifikasi Setelah Update")

h3("C1. Cek Log Backend")
body("Pastikan SSM berhasil load dan backend tidak error:")
code(
    "docker logs automation-hub-backend-1 2>&1 | grep -E 'SSM|Running|ERROR' | head -20"
)
body("Log SSM yang diharapkan muncul:")
code(
    "SSM: loaded 12 parameters from /portal-report\n"
    "SSM: all secrets injected into os.environ\n"
    " * Running on http://0.0.0.0:5000"
)

h3("C2. Cek Log Worker (Celery)")
code(
    "docker logs automation-hub-worker-1 2>&1 | grep -E 'SSM|celery|ERROR' | head -20"
)
body("Worker harus terhubung ke Redis eksternal:")
code(
    "SSM: loaded 12 parameters from /portal-report\n"
    "[2026-09-01 ...] celery@worker ready."
)

h3("C3. Test API")
code(
    "curl http://localhost:5000/api/ping\n"
    "# Expected: {\"status\": \"ok\"}\n\n"
    "curl http://localhost:5000/api/auth/users\n"
    "# Expected: JSON list berisi admin, suhendi, Priyanto, dll"
)

h3("C4. Buka Aplikasi di Browser")
body("Buka browser dan akses:")
code("http://<ip-server>:3000")
body("Login menggunakan salah satu akun berikut:")
doc.add_paragraph()
user_table()

# ══════════════════════════════════════════════════════════
#  RESOURCE LIMITS
# ══════════════════════════════════════════════════════════
h2("⚙️  Resource Limits Container")
body("Limit yang sudah dikonfigurasi di docker-compose.yml:")
doc.add_paragraph()
resource_table()

# ══════════════════════════════════════════════════════════
#  ROLLBACK
# ══════════════════════════════════════════════════════════
h2("🔄  Rollback (Jika Ada Masalah)")

note(
    "Jika SSM tidak bisa diakses, aplikasi otomatis fallback ke env var. "
    "Isi nilai asli langsung di .env sebagai solusi darurat.",
    bg='FFE8E8', emoji='🚨'
)

h3("Fallback: Isi .env Langsung")
code(
    "FLASK_ENV=production\n"
    "REDIS_URL=redis://172.19.10.143:6379/8\n"
    "SSM_PREFIX=/portal-report\n"
    "AWS_REGION=ap-southeast-1\n\n"
    "# Fallback — isi jika SSM tidak tersedia\n"
    "SECRET_KEY=nilai-asli\n"
    "GRAFANA_USER=nilai-asli\n"
    "GRAFANA_PASS=nilai-asli\n"
    "# ... dst"
)
body("Restart container setelah update .env:")
code("docker compose up -d")

h3("Rollback ke Versi Sebelumnya")
code(
    "git log --oneline -5           # lihat history commit\n"
    "git checkout <commit-lama>     # kembali ke versi lama\n"
    "docker compose build\n"
    "docker compose up -d"
)

# ══════════════════════════════════════════════════════════
#  RANGKUMAN STEP
# ══════════════════════════════════════════════════════════
h2("📌  Rangkuman Urutan Step")
steps = [
    ("A1", "Login AWS CLI",            "aws configure di mesin lokal"),
    ("A2", "Isi nilai secret",         "Edit push_secrets_to_ssm.py"),
    ("A3", "Upload ke SSM",            "python3 push_secrets_to_ssm.py"),
    ("A4", "Verifikasi SSM",           "Cek semua parameter tersimpan"),
    ("B1", "SSH ke server",            "ssh user@<ip-server>"),
    ("B2", "Test Redis",               "redis-cli -h 172.19.10.143 ping"),
    ("B3", "Test SSM dari server",     "aws ssm get-parameters-by-path ..."),
    ("B4", "Git pull",                 "git pull origin main"),
    ("B5", "Update .env",              "cp .env.example .env → edit 4 baris"),
    ("B6", "Docker build",             "docker compose build"),
    ("B7", "Docker up",                "docker compose up -d"),
    ("C1", "Cek log backend",          "docker logs automation-hub-backend-1"),
    ("C2", "Cek log worker",           "docker logs automation-hub-worker-1"),
    ("C3", "Test API",                 "curl http://localhost:5000/api/ping"),
    ("C4", "Buka browser",             "http://<ip-server>:3000"),
]

tbl = doc.add_table(rows=len(steps)+1, cols=3)
tbl.style = 'Table Grid'
for i, h in enumerate(['Step', 'Nama', 'Perintah / Tindakan']):
    c = tbl.cell(0, i)
    set_cell_bg(c, '1A1A1A')
    r = c.paragraphs[0].add_run(h)
    r.font.bold = True; r.font.color.rgb = WHITE
    r.font.name = 'Calibri'; r.font.size = Pt(10)
    c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

for ri, (step, name, cmd) in enumerate(steps):
    bg = 'FFFFFF' if ri % 2 == 0 else 'F5F5F5'
    for ci, val in enumerate([step, name, cmd]):
        c = tbl.cell(ri+1, ci)
        set_cell_bg(c, bg)
        p = c.paragraphs[0]
        r = p.add_run(val)
        r.font.name = 'Courier New' if ci in (0, 2) else 'Calibri'
        r.font.size = Pt(9.5)
        if ci == 0:
            r.font.bold = True
            r.font.color.rgb = RED

doc.add_paragraph()

# Footer
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Portal Report v2  ·  ICS Compute  ·  September 2026")
r.font.size = Pt(9)
r.font.color.rgb = GRAY
r.font.name = 'Calibri'

# ── Save ─────────────────────────────────────────────────
out = "/home/suhendi/automation-hub/DEPLOY_UPDATE_GUIDE.docx"
doc.save(out)
print(f"✓ Saved: {out}")
