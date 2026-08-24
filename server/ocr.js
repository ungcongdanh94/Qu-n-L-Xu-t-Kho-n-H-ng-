const Tesseract = require('tesseract.js');
const db = require('./db');

// Cac tu khoa thuong dung truoc ten khach hang - xep TU CU THE/DAI NHAT den chung chung nhat,
// vi du "ten khach hang" phai duoc uu tien hon "khach hang" don le (de tranh bat nham cho khac
// cung co chu "khach hang", vi du dong chu ky cuoi phieu).
const NAME_KEYWORDS = [
  'ten khach hang', 'tên khách hàng',
  'nguoi mua', 'người mua',
  'giao cho',
  'ten khach', 'tên khách',
  'khach hang', 'khách hàng',
  'kh:', 'kh :', 'khach:', 'khách:', 'ten kh', 'tên kh',
];

const KEYWORD_PHRASES = [
  ['ten', 'khach', 'hang'],
  ['nguoi', 'mua'],
  ['giao', 'cho'],
  ['ten', 'khach'],
  ['khach', 'hang'],
  ['kh'],
];

// Cac nhan CUA TRUONG KHAC co the nam cung dong/hang ben phai (vi du "Ngay:", "So:") -
// khi gap 1 trong cac nhan nay thi DUNG LAI, khong lay tiep noi dung phia sau no.
// LUU Y: "so" (Số:) KHONG dua vao day nhu 1 tu don le, vi sau khi bo dau no trung het voi
// chu "Sở" (vi du "Cơ Sở" trong ten cong ty) - can xu ly rieng, chi coi la ranh gioi khi
// co dau ":" di kem ngay sau (dac diem rieng cua nhan "Số:"), xem ham isSoBoundary/otherFieldSoMatch.
const BOUNDARY_PHRASES = [
  ['ngay'], ['dia', 'chi'], ['dien', 'thoai'], ['sdt'], ['dt'], ['mau', 'so'],
];
const OTHER_FIELD_KEYWORDS_TEXT = ['ngay', 'dia chi', 'dien thoai', 'sdt', 'mau so'];

// Cac cum chu KHONG PHAI la ten khach hang du co the bi bat nham (vi du dong chu ky cuoi phieu:
// "Khach hang | Tai xe | Ban hang | Kiem hang"). Neu ket qua doan duoc trung/chua cum nay,
// coi nhu khong hop le va bo qua, tim tiep vi tri khac.
const BLACKLIST_PHRASES = [
  'tai xe', 'ban hang', 'kiem hang', 'chu ky', 'nguoi giao', 'nguoi nhan', 'thu kho',
  'phieu xuat kho', 'phieu nhap kho', 'phieu xuat nhap kho',
];

// Cac dong CHAC CHAN khong phai ten khach (tieu de, dong tieu de bang) - loai khoi fallback
const NON_NAME_LINES = [
  'phieu xuat kho', 'phieu nhap kho', 'phieu xuat nhap kho',
  'stt ma hang ten hang', 'tong cong',
];

// Dau hieu cho thay 1 dong CO THE la thong tin khach hang (ten cong ty/cua hang, so dien thoai...)
const COMPANY_HINTS = ['cong ty', 'tnhh', 'cua hang', 'doanh nghiep', 'dntn', 'co so'];
const PHONE_PATTERN = /0\d[\d.\-\s]{7,12}\d/;

// Ten cong ty CUA CHINH CONG THANH - thuong in san o tieu de/dau phieu (dac biet Phieu Nhap Kho,
// khi CONG THANH la ben nhap hang chu khong phai khach hang). Neu 1 dong khop voi day thi
// KHONG DUOC chon lam ten khach du diem so cao (co chu "cong ty", "tnhh"...).
// Them cac bien the neu OCR doc sai/thieu dau khac di.
const OWN_COMPANY_HINTS = ['cong thanh', 'cty tnhh tm sx cong thanh', 'cong ty tnhh tm sx cong thanh'];

function isOwnCompanyLine(text) {
  const normalized = stripDiacritics(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return OWN_COMPANY_HINTS.some((hint) => normalized.includes(hint));
}

// Mau nhan dien MA SO DON HANG dang "BH........." (vi du BH8374, BH837346...).
// Ghep toan bo van ban lai bang khoang trang truoc khi tim, de xu ly truong hop
// ma bi ngat xuong dong giua chung (vi du "BH8374" xuong dong con "6" o dong sau).
const ORDER_CODE_PATTERN = /B[Hh][\s\-]{0,3}(\d[\d\s\-]{1,14}\d|\d{2,10})/;

function guessOrderCode(rawText) {
  const flat = (rawText || '').replace(/\n/g, ' ');
  const match = flat.match(ORDER_CODE_PATTERN);
  if (!match) return '';
  const digits = match[1].replace(/[\s\-]/g, '');
  if (!digits) return '';
  return 'BH' + digits;
}

// Doan tong so kg cua don hang, tu dong "Tong thanh tien" o cuoi bang (theo dung mau phieu cua
// CONG THANH: dong nay co CA tong tien VA tong so kg nam canh nhau, vi du "3,530,989   48.02").
// Dau hieu phan biet: tien luon co dau phay ngan hang nghin (khong co dau cham thap phan),
// con so kg luon co dang so thap phan (XX.XX) - nen chi lay so dang thap phan tren dong nay.
// CHI la goi y de dien san - sales van xac nhan/sua lai truoc khi luu, tranh sai so lieu thong ke.
const WEIGHT_LINE_KEYWORDS = ['tong thanh tien', 'tong cong'];
const WEIGHT_NUMBER_PATTERN = /\b\d{1,4}\.\d{1,2}\b/g;

// Cach 1 (uu tien): dua vao TOA DO THUC cua tung chu tren anh, giong cach doan ten khach hang -
// khong phu thuoc vao viec Tesseract co tach dung dong hay khong. Bang nhieu cot rong de bi
// Tesseract tach sai dong (nhan "Tong thanh tien" va con so co the bi day sang 2 dong text khac
// nhau du chung nam CUNG 1 HANG tren anh that) - dung Y-coordinate se dang tin cay hon nhieu
// so voi so khop chuoi ky tu tren cung 1 dong.
function guessTotalWeightKgFromWords(words) {
  if (!words || words.length === 0) return null;

  const isWeightNumber = (text) => /^\d{1,4}[.,]\d{1,2}$/.test((text || '').trim());
  const centerY = (w) => (w.bbox.y0 + w.bbox.y1) / 2;
  const centerX = (w) => (w.bbox.x0 + w.bbox.x1) / 2;

  // Buoc 1: Tim tieu de cot "Số kg" - lay TAM DIEM X cua no lam moc xac dinh dung cot, thay vi
  // doan "cot ngoai cung ben phai" (khong dang tin cay bang, vi con tuy mau phieu).
  let weightColumnX = null;
  for (let i = 0; i < words.length; i++) {
    const t = normalizeToken(words[i].text);
    if (t === 'sokg') {
      weightColumnX = centerX(words[i]);
      break;
    }
    if (t === 'so') {
      for (let j = i + 1; j < Math.min(i + 3, words.length); j++) {
        if (normalizeToken(words[j].text) === 'kg') {
          weightColumnX = (centerX(words[i]) + centerX(words[j])) / 2;
          break;
        }
      }
      if (weightColumnX !== null) break;
    }
  }

  // Buoc 2: Tim hang "Tổng cộng"/"Tổng thành tiền" - lay TAM DIEM Y lam moc xac dinh dung hang.
  const totalRowMatches = [];
  for (let i = 0; i < words.length; i++) {
    const t = normalizeToken(words[i].text);
    if (t === 'tongcong' || t === 'tongthanhtien') {
      totalRowMatches.push(words[i]);
      continue;
    }
    if (t !== 'tong') continue;
    for (let j = i + 1; j < Math.min(i + 6, words.length); j++) {
      const t2 = normalizeToken(words[j].text);
      if (t2 === 'thanh' || t2 === 'tien' || t2 === 'cong') {
        totalRowMatches.push(words[i]);
        break;
      }
    }
  }

  // Buoc 3: SO GIAO giua cot va hang - lay dung con so nam o vi tri GIAO NHAU cua cot "Số kg"
  // (theo truc X) va hang "Tổng..." (theo truc Y). Day la cach chinh xac nhat, vi dua thang vao
  // cau truc bang that thay vi doan "so nao o ben phai nhat".
  if (weightColumnX !== null && totalRowMatches.length > 0) {
    const anchor = totalRowMatches[totalRowMatches.length - 1]; // uu tien hang CUOI CUNG neu co nhieu
    const targetY = centerY(anchor);
    const wordHeight = Math.max(anchor.bbox.y1 - anchor.bbox.y0, 14);
    const rowTolerance = wordHeight * 0.7;

    const rowCandidates = words.filter((w) => isWeightNumber(w.text) && Math.abs(centerY(w) - targetY) <= rowTolerance);
    if (rowCandidates.length > 0) {
      // Trong dung hang do, lay so co TAM DIEM X GAN NHAT voi tam cot "Số kg" - chinh la giao diem.
      rowCandidates.sort((a, b) => Math.abs(centerX(a) - weightColumnX) - Math.abs(centerX(b) - weightColumnX));
      const value = parseFloat(rowCandidates[0].text.replace(',', '.'));
      if (Number.isFinite(value) && value > 0 && value < 100000) return value;
    }
  }

  // Phuong an du phong (khi khong xac dinh duoc ca 2 moc tren, vi du OCR doc sai tieu de cot
  // hoac dong tong): lay so dang thap phan nam o HANG DUOI CUNG trang (Y lon nhat, vi tong luon
  // o cuoi bang), uu tien so nam ben PHAI nhat theo tam diem X trong dung hang do.
  const maxY = Math.max(...words.map((w) => w.bbox.y1));
  const weightWords = words.filter((w) => isWeightNumber(w.text) && centerY(w) > maxY * 0.5);
  if (weightWords.length > 0) {
    const bottomY = Math.max(...weightWords.map((w) => centerY(w)));
    const sameRowTolerance = Math.max(...weightWords.map((w) => w.bbox.y1 - w.bbox.y0)) * 0.7;
    const bottomRow = weightWords.filter((w) => Math.abs(centerY(w) - bottomY) <= sameRowTolerance);
    bottomRow.sort((a, b) => centerX(b) - centerX(a));
    const value = parseFloat(bottomRow[0].text.replace(',', '.'));
    if (Number.isFinite(value) && value > 0 && value < 100000) return value;
  }

  return null;
}

// Cach 2 (du phong): neu khong co du lieu toa do (data.words rong) hoac cach 1 khong tim ra,
// quay lai so khop tren cung 1 dong van ban nhu truoc - van co ich cho cac truong hop don gian.
function guessTotalWeightKg(rawText) {
  const lines = (rawText || '').split('\n');
  for (const line of lines) {
    const normalized = stripDiacritics(line).replace(/\s+/g, ' ').trim();
    if (WEIGHT_LINE_KEYWORDS.some((kw) => normalized.includes(kw))) {
      const matches = line.match(WEIGHT_NUMBER_PATTERN);
      if (matches && matches.length > 0) {
        // Neu dong co nhieu so thap phan, lay so CUOI CUNG (thuong la cot ben phai nhat = Số kg,
        // theo dung thu tu cot trong mau phieu: ... Thành tiền | Số kg).
        const value = parseFloat(matches[matches.length - 1]);
        if (Number.isFinite(value) && value > 0 && value < 100000) {
          return value;
        }
      }
    }
  }
  return null;
}

function stripDiacritics(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function normalizeToken(text) {
  return stripDiacritics(text || '').replace(/[^a-z0-9]/g, '');
}

function isBlacklisted(text) {
  const normalized = stripDiacritics(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  return BLACKLIST_PHRASES.some((phrase) => normalized === phrase || normalized.includes(phrase));
}

// Cac tu dau dong duoc coi la HOP LE (khong phai rac), du viet hoa ngan gon
const VALID_LEADING_WORDS = /^(CTY|CÔNG|CONG|DNTN|HTX|CO|CỬA|CUA|DOANH|CH|CN|XN|HKD|ONG|BA|CHI|ANH|CHỊ)$/i;

// Don dep ky tu rac o dau/cuoi ket qua (vi du dau "|", ":", "-" bi OCR doc nham vao,
// hoac 1 tu rac ngan viet hoa lien lac o dau dong do OCR doc nham chu nhan con sot lai)
function cleanCandidate(text) {
  let cleaned = text
    .replace(/^[|:;,._\-\s]+/, '')
    .replace(/[|:;,._\-\s]+$/, '')
    .trim();

  const parts = cleaned.split(/\s+/);
  if (parts.length > 1) {
    const first = parts[0];
    // Tu dau tien: toan chu hoa, ngan (2-5 ky tu), khong phai la tien to ten cong ty hop le
    // -> nhieu kha nang la rac do OCR doc nham (vd manh vun cua chu "Ten" bi lech cot)
    const isAllCapsShort = /^[A-ZÀÁẢÃẠÂẦẤẨẪẬĂẰẮẲẴẶÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]{2,5}$/.test(first);
    if (isAllCapsShort && !VALID_LEADING_WORDS.test(first)) {
      cleaned = parts.slice(1).join(' ');
    }
  }
  return cleaned.trim();
}

// ===== Cach 1 (du phong khi khong co toa do tung tu): doan theo van ban tung dong =====
// Ap dung DUNG CUNG co che uu tien/chan nham nhu cach doan theo toa do, de dam bao chinh xac
// ke ca khi phien ban thu vien OCR dang dung khong tra ve toa do (bbox) tung tu.
function guessCustomerNameFromText(rawText) {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const candidates = [];

  lines.forEach((line, lineIndex) => {
    const normalized = stripDiacritics(line);
    for (let kwIndex = 0; kwIndex < NAME_KEYWORDS.length; kwIndex++) {
      const kw = NAME_KEYWORDS[kwIndex];
      const kwNorm = stripDiacritics(kw);
      const idx = normalized.indexOf(kwNorm);
      if (idx === -1) continue;

      let afterKeyword = line.slice(idx + kw.length).replace(/^[:\-\s]+/, '');
      const afterNorm = stripDiacritics(afterKeyword);

      // Neu tren cung dong con co nhan cua truong khac (vd "Ngay:", "So:"), cat bot truoc do.
      // Dung ranh gioi tu (\b) de tranh khop nham, vi du "so" khong duoc khop vao giua chu "song".
      let cutIndex = afterKeyword.length;
      for (const otherKw of OTHER_FIELD_KEYWORDS_TEXT) {
        const pattern = new RegExp('\\b' + otherKw.replace(/ /g, '\\s+') + '\\b');
        const m = afterNorm.match(pattern);
        if (m && m.index < cutIndex) cutIndex = m.index;
      }
      // Rieng nhan "So:" (ma don) chi duoc coi la ranh gioi khi co dau ":" ngay sau,
      // vi ban than tu "so" (sau khi bo dau) trung het voi chu "Sở" (vd trong "Cơ Sở ...").
      const soMatch = afterNorm.match(/\bso\s*:/);
      if (soMatch && soMatch.index < cutIndex) cutIndex = soMatch.index;

      const cleaned = afterKeyword.slice(0, cutIndex).trim();
      if (cleaned.length >= 2 && !isBlacklisted(cleaned) && !isOwnCompanyLine(cleaned)) {
        candidates.push({ text: cleaned, kwIndex, lineIndex });
      }
      // Chi thu tu khoa DAU TIEN khop tren dong nay (cu the/dai nhat), khong thu tiep
      // cac tu khoa ngan hon cung ho (vi du dong "Ten khach hang:" khong nen bi khop lai
      // voi tu khoa "ten khach" ngan hon, lam sot lai chu "hang:" thanh ket qua sai).
      break;
    }
  });

  if (candidates.length > 0) {
    // Uu tien tu khoa cu the/dai nhat (kwIndex nho hon), sau do uu tien dong nam CANG SOM
    // trong van ban (thuong tuong ung voi vi tri cang cao tren hinh).
    candidates.sort((a, b) => a.kwIndex - b.kwIndex || a.lineIndex - b.lineIndex);
    return cleanCandidate(candidates[0].text);
  }

  // Fallback cuoi cung: KHONG lay dai dong dau tien nua, ma CHAM DIEM tung dong hop le va
  // uu tien dong co dau hieu ro la thong tin khach hang (ten cong ty/cua hang, so dien thoai...).
  // Ly do: neu khong tim thay nhan "Ten khach hang" (vi du OCR doc theo thu tu cot, tach roi
  // nhan va gia tri), dong dau tien cua van ban thuong la TIEU DE PHIEU chu khong phai ten khach.
  let bestLine = null;
  let bestScore = -1;
  for (const line of lines) {
    const normalized = stripDiacritics(line);
    const wordCount = line.split(/\s+/).length;
    const isMostlyDigits = /^[\d\s.,:\-\/]+$/.test(line);
    const isNonNameLine = NON_NAME_LINES.some((n) => normalized.includes(n));
    if (
      wordCount < 2 ||
      isMostlyDigits ||
      line.length > 80 ||
      isBlacklisted(line) ||
      isNonNameLine ||
      isOwnCompanyLine(line)
    ) {
      continue;
    }
    let score = 1;
    if (COMPANY_HINTS.some((h) => normalized.includes(h))) score += 3;
    if (PHONE_PATTERN.test(line)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }
  return cleanCandidate(bestLine || '');
}

// ===== Cach 2 (chinh, chinh xac hon neu co du lieu): doan theo TOA DO tren hinh =====
function matchesPhraseAt(tokens, startIndex, phrase) {
  for (let j = 0; j < phrase.length; j++) {
    if (tokens[startIndex + j] !== phrase[j]) return false;
  }
  return true;
}

function findAllLabelMatches(words) {
  const tokens = words.map((w) => normalizeToken(w.text));
  const matches = [];
  KEYWORD_PHRASES.forEach((phrase, phraseRank) => {
    for (let i = 0; i <= tokens.length - phrase.length; i++) {
      if (matchesPhraseAt(tokens, i, phrase)) {
        const matchedWords = words.slice(i, i + phrase.length).filter((w) => w.bbox);
        if (matchedWords.length === 0) continue;
        matches.push({
          phraseLength: phrase.length,
          phraseRank,
          x1: Math.max(...matchedWords.map((w) => w.bbox.x1)),
          y0: Math.min(...matchedWords.map((w) => w.bbox.y0)),
          y1: Math.max(...matchedWords.map((w) => w.bbox.y1)),
        });
      }
    }
  });
  return matches;
}

function collectWordsToRightOfRow(words, label) {
  const rowHeight = (label.y1 - label.y0) || 20;
  const tolerance = rowHeight * 0.7;

  const rowWords = words
    .filter((w) => {
      const cy = (w.bbox.y0 + w.bbox.y1) / 2;
      const withinRow = cy >= label.y0 - tolerance && cy <= label.y1 + tolerance;
      const toRight = w.bbox.x0 > label.x1;
      return withinRow && toRight;
    })
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);

  const tokens = rowWords.map((w) => normalizeToken(w.text));
  const result = [];
  for (let i = 0; i < rowWords.length; i++) {
    const hitsBoundary = BOUNDARY_PHRASES.some((phrase) => matchesPhraseAt(tokens, i, phrase));
    // Rieng "so" (Số:) chi tinh la ranh gioi neu ban than tu co dau ':' dinh kem, hoac tu ke
    // tiep la dau ':' - tranh nham voi chu "Sở" (vd "Cơ Sở ...") sau khi bo dau deu thanh "so".
    const isSoBoundary =
      tokens[i] === 'so' &&
      (/:/.test(rowWords[i].text) || (rowWords[i + 1] && /^:+$/.test(rowWords[i + 1].text.trim())));
    if (hitsBoundary || isSoBoundary) break;
    const text = rowWords[i].text.trim();
    if (text && !/^[:\-.,]+$/.test(text)) result.push(text);
  }
  return result.join(' ').trim();
}

function guessCustomerNameFromWords(words) {
  const validWords = (words || []).filter((w) => w && w.bbox && w.text && w.text.trim());
  const matches = findAllLabelMatches(validWords);
  if (matches.length === 0) return '';

  matches.sort((a, b) => a.phraseRank - b.phraseRank || a.y0 - b.y0);

  for (const label of matches) {
    const candidate = collectWordsToRightOfRow(validWords, label);
    if (candidate && candidate.length >= 2 && !isBlacklisted(candidate) && !isOwnCompanyLine(candidate)) {
      return candidate;
    }
  }
  return '';
}

async function findClosestCustomer(guess) {
  if (!guess) return null;
  const customers = db.prepare('SELECT name FROM customers').all();
  const guessNorm = stripDiacritics(guess);
  let best = null;
  let bestScore = 0;
  for (const c of customers) {
    const nameNorm = stripDiacritics(c.name);
    if (nameNorm === guessNorm) return c.name;
    if (nameNorm.includes(guessNorm) || guessNorm.includes(nameNorm)) {
      const score = Math.min(nameNorm.length, guessNorm.length);
      if (score > bestScore) {
        bestScore = score;
        best = c.name;
      }
    }
  }
  return best;
}

async function runOcr(imagePath) {
  // Dung bo du lieu nhan dien "best" (chinh xac cao nhat) thay vi ban tieu chuan,
  // giup doc dung ten khach hang tieng Viet co dau tot hon - danh doi mot chut toc do.
  // Co the tat de quay lai ban mac dinh (nhanh hon) bang cach dat OCR_USE_BEST=0
  // trong bien moi truong neu thay xu ly qua cham.
  const recognizeOptions = { logger: () => {} };
  if (process.env.OCR_USE_BEST !== '0') {
    recognizeOptions.langPath = 'https://tessdata.projectnaptha.com/4.0.0_best';
  }

  const { data } = await Tesseract.recognize(imagePath, 'vie+eng', recognizeOptions);
  const rawText = data.text || '';

  let guess = '';
  if (data.words && data.words.length > 0) {
    guess = guessCustomerNameFromWords(data.words);
  }
  if (!guess) {
    guess = guessCustomerNameFromText(rawText);
  }

  const matchedCustomer = await findClosestCustomer(guess);
  const orderCode = guessOrderCode(rawText);
  let totalWeightGuess = null;
  if (data.words && data.words.length > 0) {
    totalWeightGuess = guessTotalWeightKgFromWords(data.words);
  }
  if (totalWeightGuess === null) {
    totalWeightGuess = guessTotalWeightKg(rawText);
  }
  return {
    rawText,
    guess,
    suggestedName: matchedCustomer || guess,
    orderCode,
    totalWeightGuess,
  };
}

module.exports = { runOcr, guessCustomerName: guessCustomerNameFromText, findClosestCustomer };
