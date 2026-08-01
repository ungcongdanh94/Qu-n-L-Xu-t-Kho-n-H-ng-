const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireRole, requireRoleOrPermission } = require('../middleware/auth');

const router = express.Router();

const storageDir = path.join(__dirname, '..', '..', 'storage');
const dataDir = path.join(storageDir, 'data');
const uploadsDir = path.join(storageDir, 'uploads');

const backupUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 1024 * 1024 * 1024 }, // toi da 1GB cho 1 file sao luu
});

// ============ Tai file sao luu ve may (database + toan bo hinh anh) ============
router.get('/export', requireAuth, requireRoleOrPermission('manage_admin', 'leader'), async (req, res) => {
  const tmpDbPath = path.join(os.tmpdir(), `backup-${Date.now()}.db`);
  try {
    // Dung API backup chinh thuc cua SQLite (thong qua better-sqlite3) de tao ban sao
    // nhat quan cua database, an toan ngay ca khi dang co nguoi dung khac.
    await db.backup(tmpDbPath);

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="backup-xuatkho-${dateStr}.zip"`);
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('[backup] Loi tao file zip:', err);
      if (!res.headersSent) res.status(500).end();
    });
    archive.on('end', () => {
      fs.unlink(tmpDbPath, () => {});
    });

    archive.pipe(res);
    archive.file(tmpDbPath, { name: 'app.db' });
    if (fs.existsSync(uploadsDir)) {
      archive.directory(uploadsDir, 'uploads');
    }
    await archive.finalize();
  } catch (err) {
    console.error('[backup] Loi xuat backup:', err);
    fs.unlink(tmpDbPath, () => {});
    if (!res.headersSent) res.status(500).json({ error: 'Loi khi tao file sao luu.' });
  }
});

// ============ Khoi phuc du lieu tu file sao luu da tai ve truoc do ============
router.post('/import', requireAuth, requireRole('leader'), backupUpload.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Vui long chon file sao luu (.zip).' });

  try {
    const zip = new AdmZip(req.file.path);
    const entries = zip.getEntries();
    const dbEntry = entries.find((e) => e.entryName === 'app.db');

    if (!dbEntry) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'File khong hop le: khong tim thay database (app.db) ben trong file sao luu.' });
    }

    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });

    // Sao luu an toan du lieu HIEN TAI truoc khi ghi de, phong truong hop can khoi phuc lai
    // (vi du lo chon nham file backup). Thu muc nay co the tu tay xoa sau khi chac chan on.
    const safetyDir = path.join(storageDir, `before-restore-${Date.now()}`);
    fs.mkdirSync(safetyDir, { recursive: true });
    const currentDbPath = path.join(dataDir, 'app.db');
    if (fs.existsSync(currentDbPath)) {
      fs.copyFileSync(currentDbPath, path.join(safetyDir, 'app.db'));
    }

    // Ghi de database bang ban trong file sao luu
    fs.writeFileSync(currentDbPath, dbEntry.getData());
    // Xoa file WAL/SHM cu (neu co) vi khong con khop voi database moi vua ghi de
    ['app.db-wal', 'app.db-shm'].forEach((f) => {
      const p = path.join(dataDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });

    // Ghi de toan bo hinh anh (chi khi file sao luu co chua thu muc uploads)
    const uploadEntries = entries.filter((e) => e.entryName.startsWith('uploads/') && !e.isDirectory);
    if (uploadEntries.length > 0) {
      for (const oldFile of fs.readdirSync(uploadsDir)) {
        fs.unlinkSync(path.join(uploadsDir, oldFile));
      }
      for (const entry of uploadEntries) {
        // Chi lay ten file, bo qua duong dan ben trong zip de tranh loi zip-slip
        const filename = path.basename(entry.entryName);
        if (!filename || filename.includes('..')) continue;
        fs.writeFileSync(path.join(uploadsDir, filename), entry.getData());
      }
    }

    fs.unlink(req.file.path, () => {});

    res.json({
      ok: true,
      message: 'Khoi phuc du lieu thanh cong! Server se tu khoi dong lai trong giay lat, vui long dang nhap lai sau khoang 10-15 giay.',
    });

    // Khoi dong lai tien trinh de nap lai ket noi database moi.
    // Railway (va cac nen tang container khac) se tu dong restart lai app sau khi thoat.
    setTimeout(() => process.exit(0), 1500);
  } catch (err) {
    console.error('[backup] Loi khoi phuc du lieu:', err);
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Loi khi khoi phuc du lieu: ' + err.message });
  }
});

module.exports = router;
