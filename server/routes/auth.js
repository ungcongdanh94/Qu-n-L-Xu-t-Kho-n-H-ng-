const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Vui long nhap ten dang nhap va mat khau.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Sai ten dang nhap hoac mat khau.' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'Tai khoan nay da bi vo hieu hoa.' });
  }
  const warehouse = user.warehouse_id
    ? db.prepare('SELECT * FROM warehouses WHERE id = ?').get(user.warehouse_id)
    : null;
  let permissions = [];
  try {
    permissions = JSON.parse(user.permissions || '[]');
  } catch (err) {
    permissions = [];
  }
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    full_name: user.full_name,
    warehouse_id: user.warehouse_id || null,
    warehouse_name: warehouse ? warehouse.name : null,
    permissions,
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: payload });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password || new_password.length < 4) {
    return res.status(400).json({ error: 'Mat khau moi phai co it nhat 4 ky tu.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(old_password, user.password_hash)) {
    return res.status(401).json({ error: 'Mat khau cu khong dung.' });
  }
  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
  res.json({ ok: true });
});

module.exports = router;
