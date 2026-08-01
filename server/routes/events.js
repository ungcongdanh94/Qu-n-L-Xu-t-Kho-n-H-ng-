const express = require('express');
const jwt = require('jsonwebtoken');
const { addClient, removeClient } = require('../sse');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// EventSource cua trinh duyet khong gui duoc header Authorization, nen phai xac thuc
// qua query string (?token=...) thay vi dung middleware requireAuth thong thuong.
router.get('/', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).end();

  let user;
  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).end();
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tranh bi proxy (vd Nginx tren Railway) buffer lam cham thong bao
  });
  res.write('retry: 3000\n\n');

  addClient(res, user);

  req.on('close', () => {
    removeClient(res);
  });
});

module.exports = router;
