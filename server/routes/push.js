const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isConfigured } = require('../push');

const router = express.Router();

// Client can public key nay de dang ky nhan push (subscribe). Khong nhay cam, ai co the xem.
router.get('/vapid-public-key', requireAuth, (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null, enabled: isConfigured });
});

router.post('/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Du lieu dang ky khong hop le.' });
  }
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(req.user.id, endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

router.post('/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }
  res.json({ ok: true });
});

module.exports = router;
