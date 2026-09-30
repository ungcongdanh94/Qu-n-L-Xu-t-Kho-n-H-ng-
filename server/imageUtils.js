const sharp = require('sharp');
const fs = require('fs');

// Nen va resize anh ngay sau khi upload de tiet kiem dung luong luu tru lau dai.
// Voi anh chup dien thoai (thuong 3-6MB), sau buoc nay thuong con khoang 150-400KB
// ma van doc ro chu tren phieu - giam ~10-20 lan dung luong can luu.
async function compressImage(filePath, { maxDimension = 1600, quality = 80 } = {}) {
  const tmpPath = `${filePath}.tmp`;
  try {
    await sharp(filePath)
      .rotate() // tu dong xoay anh dung chieu theo du lieu EXIF (quan trong voi anh chup tu dien thoai)
      .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toFile(tmpPath);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Neu nen loi vi ly do gi do (dinh dang la, file hong...), giu nguyen anh goc,
    // khong lam fail toan bo request chi vi buoc toi uu dung luong.
    console.error('[image] Loi nen anh, giu nguyen anh goc:', err.message);
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (e) {}
    }
  }
}

module.exports = { compressImage };
