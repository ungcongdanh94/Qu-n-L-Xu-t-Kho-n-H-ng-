const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, requireRoleOrPermission } = require('../middleware/auth');

const router = express.Router();

// Danh sach kho - ai da dang nhap cung xem duoc (de chon khi tao don, loc, v.v.)
router.get('/', requireAuth, (req, res) => {
  const warehouses = db
    .prepare('SELECT * FROM warehouses WHERE is_active = 1 ORDER BY name ASC')
    .all();
  res.json({ warehouses });
});

// Chi quan ly (leader) moi duoc tao kho moi
router.post('/', requireAuth, requireRoleOrPermission('manage_admin', 'leader'), (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Vui long nhap ten kho.' });
  try {
    const info = db.prepare('INSERT INTO warehouses (name) VALUES (?)').run(name);
    const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(info.lastInsertRowid);
    res.json({ warehouse });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ten kho nay da ton tai.' });
    }
    res.status(500).json({ error: 'Loi khi tao kho.' });
  }
});

// Vo hieu hoa 1 kho (khong xoa, chi an di de khong lam mat lich su don hang cu)
router.patch('/:id', requireAuth, requireRoleOrPermission('manage_admin', 'leader'), (req, res) => {
  const { name, is_active } = req.body || {};
  const updates = [];
  const params = [];
  if (typeof name === 'string' && name.trim()) {
    updates.push('name = ?');
    params.push(name.trim());
  }
  if (typeof is_active === 'boolean') {
    updates.push('is_active = ?');
    params.push(is_active ? 1 : 0);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Khong co gi de cap nhat.' });
  params.push(req.params.id);
  db.prepare(`UPDATE warehouses SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
  res.json({ warehouse });
});

// Xoa kho (chi leader) - chi cho xoa neu kho khong con du lieu lien quan (don hang, phieu tra hang,
// tai khoan nhan vien dang gan vao kho nay), de tranh mat lich su hoac gay loi du lieu mo coi.
router.delete('/:id', requireAuth, requireRoleOrPermission('manage_admin', 'leader'), (req, res) => {
  const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
  if (!warehouse) return res.status(404).json({ error: 'Khong tim thay kho.' });

  const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE warehouse_id = ?').get(req.params.id).c;
  if (orderCount > 0) {
    return res.status(400).json({
      error: `Khong the xoa: kho nay dang co ${orderCount} don hang. Neu khong con dung nua, hay dung nut "Vo hieu hoa" thay vi xoa.`,
    });
  }
  const returnCount = db.prepare('SELECT COUNT(*) AS c FROM returns WHERE warehouse_id = ?').get(req.params.id).c;
  if (returnCount > 0) {
    return res.status(400).json({
      error: `Khong the xoa: kho nay dang co ${returnCount} phieu tra hang. Neu khong con dung nua, hay dung nut "Vo hieu hoa" thay vi xoa.`,
    });
  }
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users WHERE warehouse_id = ?').get(req.params.id).c;
  if (userCount > 0) {
    return res.status(400).json({
      error: `Khong the xoa: dang co ${userCount} tai khoan thu kho duoc gan vao kho nay. Hay doi kho khac cho cac tai khoan do truoc.`,
    });
  }

  db.prepare('DELETE FROM warehouses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
