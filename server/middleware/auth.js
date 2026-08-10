const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'thay-doi-chuoi-nay-trong-file-env';

// Danh sach cac quyen rieng co the cap them cho tung nguoi (khong phu thuoc vai tro co dinh).
// Dinh nghia tap trung o day de dung chung giua backend va giao dien quan ly tai khoan.
const PERMISSIONS = {
  view_all: 'Xem Tổng quan toàn hệ thống (như quản lý)',
  delete_any_order: 'Xoá được mọi đơn hàng (không chỉ đơn của mình)',
  manage_admin: 'Quản lý tài khoản, kho, và sao lưu dữ liệu (như quản lý)',
};

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Chua dang nhap.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, username, role, full_name }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Phien dang nhap khong hop le hoac da het han.' });
  }
}

function getUserRoles(user) {
  if (user && Array.isArray(user.roles) && user.roles.length > 0) return user.roles;
  return user && user.role ? [user.role] : [];
}

function requireRole(...roles) {
  return (req, res, next) => {
    const userRoles = getUserRoles(req.user);
    if (!req.user || !userRoles.some((r) => roles.includes(r))) {
      return res.status(403).json({ error: 'Ban khong co quyen thuc hien thao tac nay.' });
    }
    next();
  };
}

const getUserPermissionsStmt = db.prepare('SELECT permissions FROM users WHERE id = ?');

// Kiem tra 1 nguoi dung (theo id) co duoc cap 1 quyen rieng cu the hay khong.
// Luon doc truc tiep tu database (khong dua vao JWT) de thay doi quyen co hieu luc ngay,
// khong can nguoi dung phai dang xuat/dang nhap lai.
function hasPermission(userId, permission) {
  const row = getUserPermissionsStmt.get(userId);
  if (!row || !row.permissions) return false;
  try {
    const perms = JSON.parse(row.permissions);
    return Array.isArray(perms) && perms.includes(permission);
  } catch (err) {
    return false;
  }
}

// Cho qua neu vai tro nam trong danh sach roles, HOAC nguoi dung duoc cap rieng quyen permission do.
function requireRoleOrPermission(permission, ...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Chua dang nhap.' });
    const userRoles = getUserRoles(req.user);
    if (userRoles.some((r) => roles.includes(r))) return next();
    if (hasPermission(req.user.id, permission)) return next();
    return res.status(403).json({ error: 'Ban khong co quyen thuc hien thao tac nay.' });
  };
}

module.exports = {
  requireAuth,
  requireRole,
  requireRoleOrPermission,
  hasPermission,
  getUserRoles,
  PERMISSIONS,
  JWT_SECRET,
};
