const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole, requireRoleOrPermission, PERMISSIONS } = require('../middleware/auth');

const router = express.Router();

// Danh sach cac quyen rieng co the cap - de giao dien lay ra hien thi
router.get('/permissions-list', requireAuth, requireRole('leader'), (req, res) => {
  res.json({ permissions: PERMISSIONS });
});

// Cac route con lai: cho leader, hoac nguoi duoc cap rieng quyen "manage_admin"
router.use(requireAuth, requireRoleOrPermission('manage_admin', 'leader'));

router.get('/', (req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.role, u.warehouse_id, u.is_active, u.permissions, u.created_at,
              w.name AS warehouse_name
       FROM users u LEFT JOIN warehouses w ON w.id = u.warehouse_id
       ORDER BY u.created_at DESC`
    )
    .all();
  const parsed = users.map((u) => ({
    ...u,
    permissions: (() => {
      try {
        return JSON.parse(u.permissions || '[]');
      } catch (err) {
        return [];
      }
    })(),
  }));
  res.json({ users: parsed });
});

router.post('/', (req, res) => {
  const { username, password, full_name, role, warehouse_id } = req.body || {};
  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: 'Vui long nhap day du thong tin.' });
  }
  if (!['sales', 'warehouse', 'leader'].includes(role)) {
    return res.status(400).json({ error: 'Vai tro khong hop le.' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Mat khau phai co it nhat 4 ky tu.' });
  }
  if (role === 'warehouse' && !warehouse_id) {
    return res.status(400).json({ error: 'Vui long chon kho cho thu kho nay.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Ten dang nhap nay da ton tai.' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, full_name, role, warehouse_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(username, hash, full_name, role, warehouse_id || null);

  const user = db.prepare('SELECT id, username, full_name, role, warehouse_id, is_active, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ user });
});

router.patch('/:id', (req, res) => {
  const { full_name, role, warehouse_id, is_active, new_password, permissions } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Khong tim thay tai khoan.' });

  const updates = [];
  const params = [];
  if (typeof full_name === 'string' && full_name.trim()) {
    updates.push('full_name = ?');
    params.push(full_name.trim());
  }
  if (role && ['sales', 'warehouse', 'leader'].includes(role)) {
    updates.push('role = ?');
    params.push(role);
  }
  if (warehouse_id !== undefined) {
    updates.push('warehouse_id = ?');
    params.push(warehouse_id || null);
  }
  if (typeof is_active === 'boolean') {
    updates.push('is_active = ?');
    params.push(is_active ? 1 : 0);
  }
  if (new_password) {
    if (new_password.length < 4) {
      return res.status(400).json({ error: 'Mat khau moi phai co it nhat 4 ky tu.' });
    }
    updates.push('password_hash = ?');
    params.push(bcrypt.hashSync(new_password, 10));
  }
  // Chi QUAN LY THAT (role = leader) moi duoc cap/go quyen rieng cho nguoi khac -
  // tranh truong hop nguoi chi duoc uy quyen "manage_admin" tu cap them quyen cho minh/nguoi khac.
  if (Array.isArray(permissions)) {
    if (req.user.role !== 'leader') {
      return res.status(403).json({ error: 'Chi quan ly moi duoc cap/go quyen rieng cho nguoi khac.' });
    }
    const validKeys = Object.keys(PERMISSIONS);
    const cleaned = permissions.filter((p) => validKeys.includes(p));
    updates.push('permissions = ?');
    params.push(JSON.stringify(cleaned));
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Khong co gi de cap nhat.' });

  params.push(req.params.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db
    .prepare('SELECT id, username, full_name, role, warehouse_id, is_active, permissions, created_at FROM users WHERE id = ?')
    .get(req.params.id);
  updated.permissions = (() => {
    try {
      return JSON.parse(updated.permissions || '[]');
    } catch (err) {
      return [];
    }
  })();
  res.json({ user: updated });
});

// Xoa tai khoan - chan 1 so truong hop nguy hiem:
// - Khong cho tu xoa chinh tai khoan dang dang nhap (tranh tu khoa minh ra khoi he thong)
// - Khong cho xoa neu la tai khoan quan ly (leader) CUOI CUNG con lai (tranh mat quyen quan tri)
// - Khong cho xoa neu tai khoan da tung tao don hang (giu lich su), nen khoa (is_active=false) thay vi xoa
router.delete('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Khong tim thay tai khoan.' });

  if (user.id === req.user.id) {
    return res.status(400).json({ error: 'Khong the tu xoa tai khoan dang dang nhap.' });
  }
  if (user.role === 'leader') {
    const leaderCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'leader'").get().c;
    if (leaderCount <= 1) {
      return res.status(400).json({ error: 'Khong the xoa: day la tai khoan quan ly cuoi cung trong he thong.' });
    }
  }
  const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE sales_user_id = ?').get(user.id).c;
  if (orderCount > 0) {
    return res.status(400).json({
      error: `Khong the xoa: tai khoan nay da tao ${orderCount} don hang (can giu lai lich su). Hay dung nut "Khoa tai khoan" thay vi xoa.`,
    });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

module.exports = router;
