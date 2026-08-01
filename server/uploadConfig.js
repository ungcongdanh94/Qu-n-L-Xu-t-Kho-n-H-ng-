const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', 'storage', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // Luon luu duoi dang .jpg vi anh se duoc nen lai thanh JPEG ngay sau khi upload
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // cho phep anh goc hoi lon truoc khi nen lai
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Chi chap nhan file hinh anh.'));
    }
    cb(null, true);
  },
});

module.exports = { upload, uploadDir };
