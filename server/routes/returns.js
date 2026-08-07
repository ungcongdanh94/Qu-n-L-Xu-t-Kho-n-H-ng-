const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth, requireRole, hasPermission, getUserRoles } = require('../middleware/auth');
const { broadcast } = require('../sse');
const { sendPushToUsers, getRelevantUserIds, getLeaderUserIds } = require('../push');
const { upload, uploadDir } = require('../uploadConfig');
const { compressImage } = require('../imageUtils');

const router = express.Router();

// Xac dinh nguoi lap phieu dang gui loai anh nao: 'voucher' (anh PHIEU tra hang - viec CHINH cua
// Sales) hay 'goods' (anh HANG THUC TRA - viec CHINH cua Thu kho). Uu tien theo vai trò dang giu:
// Sales luon la 'voucher' (du co kiem them vai tro khac), roi moi den Thu kho la 'goods'. Truong
// hop Quan ly (khong giu 2 vai tro tren) hoac tai khoan kiem ca 2 vai tro muon lam thay vai kia,
// co the tu chi dinh qua truong photo_type gui len tu form.
function resolveCreatorPhotoType(req) {
  const requested = req.body.photo_type;
  if (requested === 'voucher' || requested === 'goods') return requested;
  const roles = getUserRoles(req.user);
  if (roles.includes('sales')) return 'voucher';
  if (roles.includes('warehouse')) return 'goods';
  return 'voucher';
}

// ============ Lap phieu tra hang moi ============
// Thiet ke: Sales (vai tro CHINH, khong phai lam them) luon dinh kem anh PHIEU tra hang khi bao
// truoc cho kho -> cho THU KHO gui anh HANG THUC TRA de hoan tat.
// Nguoc lai, neu THU KHO lap phieu truoc (khach tra hang truc tiep tai kho) -> dinh kem anh HANG
// THUC TRA -> cho SALES gui anh PHIEU tra hang de hoan tat.
// Ca 2 phia luon co dung 1 loai anh cua minh, bat ke ai lap phieu truoc.
router.post('/', requireAuth, requireRole('sales', 'warehouse', 'leader'), upload.single('photo'), async (req, res) => {
  const customerName = (req.body.customer_name || '').trim();
  const warehouseId = parseInt(req.body.warehouse_id, 10);
  const note = req.body.note || null;
  const orderCode = (req.body.order_code || '').trim() || null;

  if (!customerName) return res.status(400).json({ error: 'Vui long nhap ten khach hang.' });
  if (!warehouseId) return res.status(400).json({ error: 'Vui long chon kho.' });

  const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ? AND is_active = 1').get(warehouseId);
  if (!warehouse) return res.status(400).json({ error: 'Kho khong hop le.' });

  if (!req.file) {
    return res.status(400).json({ error: 'Vui long dinh kem hinh anh (phieu tra hang hoac hang thuc tra).' });
  }
  await compressImage(req.file.path);

  const photoType = resolveCreatorPhotoType(req);
  const initiatedByRole = photoType === 'voucher' ? 'sales' : 'warehouse';
  const status = photoType === 'voucher' ? 'cho_kho_xac_nhan' : 'cho_sales_xac_nhan';
  const voucherPath = photoType === 'voucher' ? req.file.filename : null;
  const goodsPath = photoType === 'goods' ? req.file.filename : null;

  const info = db
    .prepare(
      `INSERT INTO returns (customer_name, warehouse_id, order_code, note, voucher_photo_path, goods_photo_path, initiated_by_role, initiated_by_username, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(customerName, warehouseId, orderCode, note, voucherPath, goodsPath, initiatedByRole, req.user.username, status);

  db.prepare('INSERT OR IGNORE INTO customers (name) VALUES (?)').run(customerName);

  const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(info.lastInsertRowid);

  broadcast('new_return', {
    return_id: ret.id,
    customer_name: ret.customer_name,
    warehouse_id: ret.warehouse_id,
    status: ret.status,
  });

  sendPushToUsers(getRelevantUserIds(ret.warehouse_id), {
    title: '↩️ Phiếu trả hàng mới',
    body: ret.customer_name,
    url: '/returns.html',
  }).catch((err) => console.error('[push] Loi:', err.message));

  res.json({ return: ret });
});

// ============ THU KHO gui anh HANG THUC TRA de hoan tat (phieu dang cho_kho_xac_nhan, do Sales lap truoc) ============
router.post('/:id/goods-photo', requireAuth, requireRole('warehouse', 'leader'), upload.single('photo'), async (req, res) => {
  const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!ret) return res.status(404).json({ error: 'Khong tim thay phieu tra hang.' });
  if (getUserRoles(req.user).includes('warehouse') && !getUserRoles(req.user).includes('leader') && ret.warehouse_id !== req.user.warehouse_id) {
    return res.status(403).json({ error: 'Phieu nay khong thuoc kho cua ban.' });
  }
  if (ret.status !== 'cho_kho_xac_nhan') {
    return res.status(400).json({ error: 'Phieu nay khong o trang thai cho kho chup hang thuc tra.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Vui long gui kem hinh hang thuc tra.' });
  await compressImage(req.file.path);

  db.prepare(
    `UPDATE returns SET goods_photo_path = ?, status = 'hoan_tat', confirmed_by_username = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(req.file.filename, req.user.username, ret.id);

  const updated = db.prepare('SELECT * FROM returns WHERE id = ?').get(ret.id);

  broadcast('return_updated', {
    return_id: updated.id,
    customer_name: updated.customer_name,
    warehouse_id: updated.warehouse_id,
    status: updated.status,
  });

  const initiator = db.prepare('SELECT id FROM users WHERE username = ?').get(updated.initiated_by_username);
  if (initiator) {
    sendPushToUsers([initiator.id], {
      title: '↩️ Phiếu trả hàng đã xong',
      body: `Kho đã gửi ảnh hàng thực trả của ${updated.customer_name}`,
      url: '/returns.html',
    }).catch((err) => console.error('[push] Loi:', err.message));
  }

  res.json({ return: updated });
});

// ============ SALES gui anh PHIEU tra hang de hoan tat (phieu dang cho_sales_xac_nhan, do Thu kho lap truoc) ============
router.post('/:id/voucher-photo', requireAuth, requireRole('sales', 'leader'), upload.single('photo'), async (req, res) => {
  const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!ret) return res.status(404).json({ error: 'Khong tim thay phieu tra hang.' });
  if (ret.status !== 'cho_sales_xac_nhan') {
    return res.status(400).json({ error: 'Phieu nay khong o trang thai cho sales gui anh phieu.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Vui long gui kem hinh phieu tra hang.' });
  await compressImage(req.file.path);

  db.prepare(
    `UPDATE returns SET voucher_photo_path = ?, status = 'hoan_tat', confirmed_by_username = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(req.file.filename, req.user.username, ret.id);

  const updated = db.prepare('SELECT * FROM returns WHERE id = ?').get(ret.id);

  broadcast('return_updated', {
    return_id: updated.id,
    customer_name: updated.customer_name,
    warehouse_id: updated.warehouse_id,
    status: updated.status,
  });

  sendPushToUsers(getRelevantUserIds(updated.warehouse_id), {
    title: '↩️ Phiếu trả hàng đã xong',
    body: `Sales đã gửi ảnh phiếu trả hàng của ${updated.customer_name}`,
    url: '/returns.html',
  }).catch((err) => console.error('[push] Loi:', err.message));

  res.json({ return: updated });
});

// ============ Danh sach phieu tra hang (co loc) ============
router.get('/', requireAuth, (req, res) => {
  const { status, customer, warehouse_id } = req.query;
  let sql = `
    SELECT r.*, w.name AS warehouse_name
    FROM returns r
    LEFT JOIN warehouses w ON w.id = r.warehouse_id
    WHERE 1=1`;
  const params = [];

  if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  if (customer) {
    sql += ' AND r.customer_name LIKE ?';
    params.push(`%${customer}%`);
  }

  // CHI thu kho "thuan" (khong kiem them vai tro sales) moi bi gioi han xem theo dung kho cua ho.
  // Neu tai khoan co CA vai tro sales (du co kiem them thu kho), van phai thay DUOC MOI phieu tra
  // hang minh lap - vi khach co the tra hang qua kho KHAC voi kho ho duoc gan lam thu kho.
  const isWarehouseOnly =
    getUserRoles(req.user).includes('warehouse') &&
    !getUserRoles(req.user).includes('leader') &&
    !getUserRoles(req.user).includes('sales');

  if (isWarehouseOnly) {
    sql += ' AND r.warehouse_id = ?';
    params.push(req.user.warehouse_id);
  } else if (warehouse_id) {
    sql += ' AND r.warehouse_id = ?';
    params.push(warehouse_id);
  }

  sql += ' ORDER BY r.created_at DESC LIMIT 500';
  const returns = db.prepare(sql).all(...params);
  res.json({ returns });
});

router.get('/:id', requireAuth, (req, res) => {
  const ret = db
    .prepare(
      `SELECT r.*, w.name AS warehouse_name
       FROM returns r LEFT JOIN warehouses w ON w.id = r.warehouse_id
       WHERE r.id = ?`
    )
    .get(req.params.id);
  if (!ret) return res.status(404).json({ error: 'Khong tim thay phieu tra hang.' });
  res.json({ return: ret });
});

// ============ Xoa phieu tra hang (xoa luon hinh anh lien quan tren dia) ============
router.delete('/:id', requireAuth, requireRole('leader', 'sales', 'warehouse'), (req, res) => {
  const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!ret) return res.status(404).json({ error: 'Khong tim thay phieu tra hang.' });

  const canDeleteAny = getUserRoles(req.user).includes('leader') || hasPermission(req.user.id, 'delete_any_order');

  if (!canDeleteAny) {
    // Nguoi lap phieu (sales hoac thu kho) chi duoc xoa DUNG phieu minh lap, va CHI KHI phieu
    // CHUA hoan tat (con dang cho ben kia xac nhan) - tranh xoa nham phieu da xu ly xong.
    if (ret.initiated_by_username !== req.user.username) {
      return res.status(403).json({ error: 'Ban khong co quyen xoa phieu tra hang nay.' });
    }
    if (ret.status === 'hoan_tat') {
      return res.status(400).json({
        error: 'Phieu tra hang nay da hoan tat, khong the tu xoa. Lien he quan ly neu can xoa.',
      });
    }
  }

  db.prepare('DELETE FROM returns WHERE id = ?').run(ret.id);

  // Xoa file hinh anh tren dia (best-effort, khong lam fail request neu xoa file loi) - co the co
  // ca 2 anh (phieu + hang thuc tra) neu phieu da hoan tat.
  for (const filename of [ret.voucher_photo_path, ret.goods_photo_path]) {
    if (filename) {
      const filePath = path.join(uploadDir, filename);
      fs.unlink(filePath, () => {});
    }
  }

  broadcast('return_deleted', { return_id: ret.id });

  res.json({ ok: true });
});

module.exports = router;
