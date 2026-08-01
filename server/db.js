const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'storage', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('sales','warehouse','leader')),
  warehouse_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'xuat_kho' CHECK(order_type IN ('xuat_kho','nhap_kho')),
  order_code TEXT,
  ocr_raw_text TEXT,
  ocr_guess TEXT,
  sales_user_id INTEGER NOT NULL,
  sales_username TEXT NOT NULL,
  warehouse_id INTEGER,
  order_photo_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'cho_soan' CHECK(status IN ('cho_soan','da_soan','co_hang_tra')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sales_user_id) REFERENCES users(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE IF NOT EXISTS order_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  warehouse_id INTEGER,
  type TEXT NOT NULL CHECK(type IN ('order','packed','return')),
  photo_path TEXT NOT NULL,
  uploaded_by_username TEXT NOT NULL,
  note TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

-- Theo doi trang thai RIENG cua tung kho trong 1 don hang (1 don co the gan nhieu kho).
-- Don hoan tat (da_soan) chi khi TAT CA kho lien quan deu da xac nhan xong.
CREATE TABLE IF NOT EXISTS order_warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'cho_soan' CHECK(status IN ('cho_soan','da_soan','co_hang_tra')),
  confirmed_by_username TEXT,
  confirmed_at TEXT,
  UNIQUE(order_id, warehouse_id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  warehouse_id INTEGER NOT NULL,
  note TEXT,
  photo_path TEXT,
  initiated_by_role TEXT NOT NULL CHECK(initiated_by_role IN ('sales','warehouse')),
  initiated_by_username TEXT NOT NULL,
  confirmed_by_username TEXT,
  status TEXT NOT NULL DEFAULT 'cho_kho_xac_nhan' CHECK(status IN ('cho_kho_xac_nhan','cho_sales_xac_nhan','hoan_tat')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

-- Luu thong tin dang ky nhan Web Push (thong bao day) cua tung nguoi dung, tren tung thiet bi/trinh duyet
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_name);
CREATE INDEX IF NOT EXISTS idx_orders_warehouse ON orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_order_photos_order ON order_photos(order_id);
CREATE INDEX IF NOT EXISTS idx_order_warehouses_order ON order_warehouses(order_id);
CREATE INDEX IF NOT EXISTS idx_order_warehouses_warehouse ON order_warehouses(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
CREATE INDEX IF NOT EXISTS idx_returns_warehouse ON returns(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
`);

// ---- Migration an toan: neu DB da ton tai tu truoc (chua co cot moi), tu them cot vao ----
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

if (!columnExists('users', 'warehouse_id')) {
  db.exec('ALTER TABLE users ADD COLUMN warehouse_id INTEGER REFERENCES warehouses(id)');
}
if (!columnExists('users', 'is_active')) {
  db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
}
if (!columnExists('orders', 'warehouse_id')) {
  db.exec('ALTER TABLE orders ADD COLUMN warehouse_id INTEGER REFERENCES warehouses(id)');
}
if (!columnExists('orders', 'order_type')) {
  db.exec("ALTER TABLE orders ADD COLUMN order_type TEXT NOT NULL DEFAULT 'xuat_kho'");
}
if (!columnExists('orders', 'order_code')) {
  db.exec('ALTER TABLE orders ADD COLUMN order_code TEXT');
}
if (!columnExists('order_photos', 'warehouse_id')) {
  db.exec('ALTER TABLE order_photos ADD COLUMN warehouse_id INTEGER REFERENCES warehouses(id)');
}
// Tao index cho order_photos.warehouse_id O DAY (sau khi chac chan cot da ton tai), tranh loi
// "no such column" tren cac database cu (da co bang order_photos truoc khi co tinh nang nay).
db.exec('CREATE INDEX IF NOT EXISTS idx_order_photos_warehouse ON order_photos(warehouse_id)');

// Khoi tao bang order_warehouses tu du lieu don hang CU (truoc khi co tinh nang nhieu kho),
// de cac don hang cu van hien thi va hoat dong binh thuong voi logic moi.
// An toan de chay lai nhieu lan: chi them neu (order_id, warehouse_id) chua ton tai.
const legacyOrders = db
  .prepare('SELECT id, warehouse_id, status FROM orders WHERE warehouse_id IS NOT NULL')
  .all();
const insertOrderWarehouse = db.prepare(
  'INSERT OR IGNORE INTO order_warehouses (order_id, warehouse_id, status) VALUES (?, ?, ?)'
);
for (const o of legacyOrders) {
  insertOrderWarehouse.run(o.id, o.warehouse_id, o.status);
}
// Gan warehouse_id cho cac anh "packed"/"return" cu (truoc khi co da-kho) theo dung kho cua don
db.exec(`
  UPDATE order_photos
  SET warehouse_id = (SELECT warehouse_id FROM orders WHERE orders.id = order_photos.order_id)
  WHERE warehouse_id IS NULL AND type IN ('packed', 'return')
`);

// Doi ten kho mac dinh cho khop ten thuc te cong ty dang dung (chi doi neu ten moi chua ton tai,
// tranh vi pham UNIQUE va tranh ghi de neu nguoi dung da tu doi ten khac roi)
function renameWarehouseIfNeeded(oldName, newName) {
  const oldRow = db.prepare('SELECT id FROM warehouses WHERE name = ?').get(oldName);
  const newRow = db.prepare('SELECT id FROM warehouses WHERE name = ?').get(newName);
  if (oldRow && !newRow) {
    db.prepare('UPDATE warehouses SET name = ? WHERE id = ?').run(newName, oldRow.id);
  }
}
renameWarehouseIfNeeded('Kho 1', 'Kho Tổng');
renameWarehouseIfNeeded('Kho 2', 'Kho XINGFA');

module.exports = db;
