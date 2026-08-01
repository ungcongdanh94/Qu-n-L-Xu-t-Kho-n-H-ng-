const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'thay-doi-chuoi-nay-trong-file-env';

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

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Ban khong co quyen thuc hien thao tac nay.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, JWT_SECRET };
