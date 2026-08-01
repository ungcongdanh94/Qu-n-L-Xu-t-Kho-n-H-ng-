const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  let customers;
  if (q) {
    customers = db
      .prepare('SELECT * FROM customers WHERE name LIKE ? ORDER BY name ASC LIMIT 20')
      .all(`%${q}%`);
  } else {
    customers = db.prepare('SELECT * FROM customers ORDER BY name ASC LIMIT 50').all();
  }
  res.json({ customers });
});

module.exports = router;
