const webpush = require('web-push');
const db = require('./db');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

const isConfigured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (isConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.log('[push] Chua cau hinh VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY - tinh nang thong bao day dang TAT.');
  console.log('[push] Chay lenh "npm run generate-vapid" de tao khoa, roi them vao bien moi truong.');
}

// Gui push toi 1 danh sach user_id cu the (vd: tat ca thu kho cua 1 kho + quan ly)
async function sendPushToUsers(userIds, payload) {
  if (!isConfigured || !userIds || userIds.length === 0) return;

  const placeholders = userIds.map(() => '?').join(',');
  const subs = db
    .prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${placeholders})`)
    .all(...userIds);

  const payloadStr = JSON.stringify(payload);

  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(subscription, payloadStr);
    } catch (err) {
      // Subscription khong con hop le (vd: nguoi dung da xoa/tu choi quyen) -> don dep khoi DB
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      } else {
        console.error('[push] Loi gui thong bao:', err.message);
      }
    }
  }
}

// Lay danh sach user_id lien quan de bao (thu kho cua 1 kho cu the + tat ca quan ly)
function getRelevantUserIds(warehouseId) {
  const rows = db
    .prepare(
      `SELECT id FROM users
       WHERE is_active = 1 AND (role = 'leader' OR (role = 'warehouse' AND warehouse_id = ?))`
    )
    .all(warehouseId);
  return rows.map((r) => r.id);
}

function getLeaderUserIds() {
  const rows = db.prepare("SELECT id FROM users WHERE is_active = 1 AND role = 'leader'").all();
  return rows.map((r) => r.id);
}

module.exports = { sendPushToUsers, getRelevantUserIds, getLeaderUserIds, isConfigured };
