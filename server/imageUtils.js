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

// ============ Phat hien anh bi MO (dung khi thu kho chup hinh xac nhan) ============
// Ky thuat pho bien: ap bo loc Laplacian (do canh/chi tiet trong anh) roi tinh PHUONG SAI cua
// ket qua - anh CANG NET thi cang nhieu canh ro net, phuong sai cang CAO. Anh mo (it chi tiet,
// chuyen sac muot) se cho phuong sai THAP. Nguong duoi day la gia tri mac dinh hop ly cho anh
// chup dien thoai thong thuong, co the can tinh chinh lai theo thuc te su dung.
const BLUR_VARIANCE_THRESHOLD = 45;

async function computeSharpnessScore(filePath) {
  // Giam kich thuoc truoc de tinh nhanh hon, khong can do phan giai cao de danh gia do net
  const { data, info } = await sharp(filePath)
    .greyscale()
    .resize(700, null, { withoutEnlargement: true })
    .convolve({
      width: 3,
      height: 3,
      kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], // bo loc Laplacian chuan, phat hien thay doi do sang dot ngot (canh/net)
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixelCount = info.width * info.height;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / pixelCount;

  let variance = 0;
  for (let i = 0; i < data.length; i++) {
    const diff = data[i] - mean;
    variance += diff * diff;
  }
  variance /= pixelCount;

  return variance;
}

// Tra ve true neu anh CO THE bi mo. Dung de TU CHOI luu anh xac nhan qua mo, bat buoc chup lai -
// vi vay nguong can vua du de bat dung anh mo ro rang, tranh chan nham anh du net gay kho chiu
// cho nguoi dung. Neu thay bi bat qua tay/qua long, dieu chinh BLUR_VARIANCE_THRESHOLD o tren.
async function isLikelyBlurry(filePath) {
  try {
    const score = await computeSharpnessScore(filePath);
    return score < BLUR_VARIANCE_THRESHOLD;
  } catch (err) {
    console.error('[image] Loi kiem tra do net, bo qua canh bao:', err.message);
    return false;
  }
}

module.exports = { compressImage, isLikelyBlurry };
