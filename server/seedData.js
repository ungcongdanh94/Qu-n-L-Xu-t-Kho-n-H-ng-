const bcrypt = require('bcryptjs');
const db = require('./db');

const DEFAULT_WAREHOUSES = ['Kho Tổng', 'Kho XINGFA'];

// Cho phep dat lai mat khau tai khoan quan ly (leader) thong qua bien moi truong,
// dung khi quen mat khau va khong con cach nao dang nhap vao he thong.
// Cach dung: tren Railway (hoac moi truong chay app) them 2 bien:
//   RESET_ADMIN_PASSWORD = mat khau moi muon dat
//   RESET_ADMIN_USERNAME = ten dang nhap can dat lai (khong dien thi mac dinh la 'quanly')
// Sau khi deploy lai va dang nhap thanh cong, NHO XOA bien RESET_ADMIN_PASSWORD di
// (khong nen de bien nay ton tai lau dai vi ly do an toan).
function maybeResetAdminPassword() {
  const newPassword = process.env.RESET_ADMIN_PASSWORD;
  if (!newPassword) return;

  const targetUsername = process.env.RESET_ADMIN_USERNAME || 'quanly';
  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(targetUsername);

  if (!user) {
    // Neu khong tim thay dung ten, thu tim tai khoan quan ly (leader) dau tien co trong he thong
    user = db.prepare("SELECT * FROM users WHERE role = 'leader' ORDER BY id ASC LIMIT 1").get();
  }

  if (!user) {
    console.log(`[RESET_ADMIN_PASSWORD] Khong tim thay tai khoan "${targetUsername}" hoac bat ky tai khoan quan ly nao de dat lai mat khau.`);
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?').run(hash, user.id);
  console.log(`\n[RESET_ADMIN_PASSWORD] Da dat lai mat khau cho tai khoan "${user.username}" thanh cong.`);
  console.log('[RESET_ADMIN_PASSWORD] NHO XOA bien moi truong RESET_ADMIN_PASSWORD sau khi da dang nhap duoc, de dam bao an toan.\n');
}

function ensureSeedData({ verbose = false } = {}) {
  const log = (msg) => { if (verbose) console.log(msg); };

  // Chay TRUOC tien, khong phu thuoc viec he thong da co tai khoan hay chua -
  // vi day chinh la co che dung khi quen mat khau, luc do tai khoan da ton tai san roi.
  maybeResetAdminPassword();

  const insertWarehouse = db.prepare('INSERT OR IGNORE INTO warehouses (name) VALUES (?)');
  for (const name of DEFAULT_WAREHOUSES) {
    const result = insertWarehouse.run(name);
    if (result.changes > 0) log(`Da tao kho: ${name}`);
  }
  const kho1 = db.prepare('SELECT id FROM warehouses WHERE name = ?').get('Kho Tổng');
  const kho2 = db.prepare('SELECT id FROM warehouses WHERE name = ?').get('Kho XINGFA');

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) {
    log('Da co tai khoan trong he thong, bo qua tao tai khoan mau.');
    return;
  }

  const users = [
    { username: 'sales1', password: '123456', full_name: 'Nhan vien Sales 1', role: 'sales', warehouse_id: null },
    { username: 'thukho1', password: '123456', full_name: 'Thu kho - Kho Tong', role: 'warehouse', warehouse_id: kho1.id },
    { username: 'thukho2', password: '123456', full_name: 'Thu kho - Kho XINGFA', role: 'warehouse', warehouse_id: kho2.id },
    { username: 'quanly', password: '123456', full_name: 'Quan ly / Chu', role: 'leader', warehouse_id: null },
  ];

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (username, password_hash, full_name, role, warehouse_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const u of users) {
    const hash = bcrypt.hashSync(u.password, 10);
    const result = insertUser.run(u.username, hash, u.full_name, u.role, u.warehouse_id);
    if (result.changes > 0) {
      log(`Da tao tai khoan mau: ${u.username} / ${u.password} (${u.role})`);
    }
  }
  log('\nDa tu dong tao du lieu mau (chi xay ra 1 lan duy nhat, khi he thong chua co tai khoan nao).');
  log('Doi mat khau cac tai khoan mau nay ngay sau khi dang nhap lan dau (muc "Quan ly tai khoan").');
}

module.exports = { ensureSeedData, maybeResetAdminPassword };
