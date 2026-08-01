const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, getUserRoles } = require('../middleware/auth');
const { broadcast } = require('../sse');
const { sendPushToUsers, getRelevantUserIds, getLeaderUserIds } = require('../push');
const { upload } = require('../uploadConfig');
const { compressImage } = require('../imageUtils');

const router = express.Router();

// ============ Lap phieu tra hang moi ============
// - Neu nguoi lap la thu kho/quan ly VA co dinh kem hinh: coi la "kho lap truoc, da chup hinh xac nhan"
//   -> chi con cho SALES xac nhan da tiep nhan thong tin.
// - Neu khong co hinh (thuong la sales bao truoc): -> cho THU KHO chup hinh xac nhan khi nhan duoc hang.
router.post('/', requireAuth, requireRole('sales', 'warehouse', 'leader'), upload.single('photo'), async (req, res) => {
  const customerName = (req.body.customer_name || '').trim();
  const warehouseId = parseInt(req.body.warehouse_id, 10);
  const note = req.body.note || null;

  if (!customerName) return res.status(400).json({ error: 'Vui long nhap ten khach hang.' });
  if (!warehouseId) return res.status(400).json({ error: 'Vui long chon kho.' });

  const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ? AND is_active = 1').get(warehouseId);
  if (!warehouse) return res.status(400).json({ error: 'Kho khong hop le.' });

  const hasPhoto = !!req.file;
  if (hasPhoto) await compressImage(req.file.path);
  const canAttachPhoto = getUserRoles(req.user).includes('warehouse') || getUserRoles(req.user).includes('leader');
  if (hasPhoto && !canAttachPhoto) {
    return res.status(400).json({
      error: 'Sales khong dinh kem hinh khi lap phieu. Neu khach da tra hang truc tiep tai kho, de thu kho lap phieu va chup hinh.',
    });
  }

  const initiatedByRole = hasPhoto ? 'warehouse' : 'sales';
  const status = hasPhoto ? 'cho_sales_xac_nhan' : 'cho_kho_xac_nhan';

  const info = db
    .prepare(
      `INSERT INTO returns (customer_name, warehouse_id, note, photo_path, initiated_by_role, initiated_by_username, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(customerName, warehouseId, note, hasPhoto ? req.file.filename : null, initiatedByRole, req.user.username, status);

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

// ============ THU KHO chup hinh xac nhan cho phieu do SALES lap truoc ============
router.post('/:id/photo', requireAuth, requireRole('warehouse', 'leader'), upload.single('photo'), async (req, res) => {
  const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!ret) return res.status(404).json({ error: 'Khong tim thay phieu tra hang.' });
  if (getUserRoles(req.user).includes('warehouse') && !getUserRoles(req.user).includes('leader') && ret.warehouse_id !== req.user.warehouse_id) {
    return res.status(403).json({ error: 'Phieu nay khong thuoc kho cua ban.' });
  }
  if (ret.status !== 'cho_kho_xac_nhan') {
    return res.status(400).json({ error: 'Phieu nay khong o trang thai cho kho chup hinh.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Vui long gui kem hinh anh.' });
  await compressImage(req.file.path);

  db.prepare(
    `UPDATE returns SET photo_path = ?, status = 'hoan_tat', confirmed_by_username = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(req.file.filename, req.user.username, ret.id);

  const updated = db.prepare('SELECT * FROM returns WHERE id = ?').get(ret.id);

  broadcast('return_updated', {
    return_id: updated.id,
    customer_name: updated.customer_name,
    warehouse_id: updated.warehouse_id,
    status: updated.status,
  });

  if (updated.initiated_by_role === 'sales') {
    const initiator = db.prepare('SELECT id FROM users WHERE username = ?').get(updated.initiated_by_username);
    if (initiator) {
      sendPushToUsers([initiator.id], {
        title: '↩️ Phiếu trả hàng đã xong',
        body: `Kho đã xác nhận phiếu trả hàng của ${updated.customer_name}`,
        url: '/returns.html',
      }).catch((err) => console.error('[push] Loi:', err.message));
    }
  }

  res.json({ return: updated });
});

// ============ SALES xac nhan da tiep nhan thong tin cho phieu do THU KHO lap truoc ============
router.post('/:id/confirm', requireAuth, requireRole('sales', 'leader'), (req, res) => {
  const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!ret) return res.status(404).json({ error: 'Khong tim thay phieu tra hang.' });
  if (ret.status !== 'cho_sales_xac_nhan') {
    return res.status(400).json({ error: 'Phieu nay khong o trang thai cho sales xac nhan.' });
  }

  db.prepare(
    `UPDATE returns SET status = 'hoan_tat', confirmed_by_username = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(req.user.username, ret.id);

  const updated = db.prepare('SELECT * FROM returns WHERE id = ?').get(ret.id);

  broadcast('return_updated', {
    return_id: updated.id,
    customer_name: updated.customer_name,
    warehouse_id: updated.warehouse_id,
    status: updated.status,
  });

  sendPushToUsers(getRelevantUserIds(updated.warehouse_id), {
    title: '↩️ Phiếu trả hàng đã xong',
    body: `Sales đã xác nhận tiếp nhận: ${updated.customer_name}`,
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

  if (getUserRoles(req.user).includes('warehouse') && !getUserRoles(req.user).includes('leader')) {
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

module.exports = router;
