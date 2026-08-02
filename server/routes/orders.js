const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth, requireRole, hasPermission, getUserRoles } = require('../middleware/auth');
const { runOcr } = require('../ocr');
const { broadcast } = require('../sse');
const { sendPushToUsers, getRelevantUserIds } = require('../push');
const { upload, uploadDir } = require('../uploadConfig');
const { compressImage } = require('../imageUtils');

const router = express.Router();

// Tinh trang thai TONG HOP cua ca don hang tu trang thai rieng cua tung kho lien quan:
// - Neu bat ky kho nao co hang tra -> tong hop la "co_hang_tra"
// - Neu TAT CA cac kho deu da giao hang -> tong hop la "da_soan"
// - Con lai (it nhat 1 kho chua xong) -> "cho_soan"
function computeAggregateStatus(statuses) {
  if (statuses.includes('co_hang_tra')) return 'co_hang_tra';
  if (statuses.length > 0 && statuses.every((s) => s === 'da_soan')) return 'da_soan';
  return 'cho_soan';
}

function getOrderWarehouses(orderId) {
  return db
    .prepare(
      `SELECT ow.warehouse_id, w.name AS warehouse_name, ow.status, ow.confirmed_by_username, ow.confirmed_at
       FROM order_warehouses ow JOIN warehouses w ON w.id = ow.warehouse_id
       WHERE ow.order_id = ?
       ORDER BY w.name ASC`
    )
    .all(orderId);
}

// Gan kem danh sach kho + trang thai rieng vao 1 mang don hang (dung cho GET danh sach)
function attachWarehousesInfo(orders) {
  if (orders.length === 0) return orders;
  const ids = orders.map((o) => o.id);
  const placeholders = ids.map(() => '?').join(',');
  const owRows = db
    .prepare(
      `SELECT ow.order_id, ow.warehouse_id, w.name AS warehouse_name, ow.status
       FROM order_warehouses ow JOIN warehouses w ON w.id = ow.warehouse_id
       WHERE ow.order_id IN (${placeholders})`
    )
    .all(...ids);
  const grouped = {};
  for (const row of owRows) {
    if (!grouped[row.order_id]) grouped[row.order_id] = [];
    grouped[row.order_id].push({ warehouse_id: row.warehouse_id, warehouse_name: row.warehouse_name, status: row.status });
  }
  for (const o of orders) {
    o.warehouses = grouped[o.id] || [];
  }
  return orders;
}

// ============ SALES: quet hinh + doc OCR - CHUA LUU don hang, chi tra ve ket qua de xac nhan ============
router.post(
  '/scan',
  requireAuth,
  requireRole('sales', 'leader'),
  upload.single('photo'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Vui long gui kem hinh don hang.' });

    // QUAN TRONG: doc OCR TRUOC tren anh GOC (do phan giai cao nhat, chu nho tren phieu
    // van con ro net) - roi moi nen anh lai de tiet kiem dung luong luu tru. Neu nen truoc
    // roi moi OCR, chu nho co the bi mo di, lam giam do chinh xac nhan dien ro ret.
    let ocrResult = { rawText: '', guess: '', suggestedName: '', orderCode: '' };
    try {
      ocrResult = await runOcr(req.file.path);
    } catch (err) {
      console.error('Loi OCR:', err.message);
      // Van tiep tuc luu anh binh thuong, chi la khong co goi y ten
    }

    await compressImage(req.file.path);

    res.json({ photo_filename: req.file.filename, ocr: ocrResult });
  }
);

// ============ Huy 1 hinh da quet nhung chua duoc luu thanh don (bam "Lam lai"/chon hinh khac) ============
router.post('/discard-scan', requireAuth, requireRole('sales', 'leader'), (req, res) => {
  const photoFilename = (req.body && req.body.photo_filename) || '';
  if (photoFilename) {
    const safeName = path.basename(photoFilename); // chi lay ten file, tranh duong dan la
    const filePath = path.join(uploadDir, safeName);
    fs.unlink(filePath, () => {});
  }
  res.json({ ok: true });
});

// ============ SALES: XAC NHAN va LUU don hang that su, dua tren hinh da quet o buoc /scan ============
router.post('/', requireAuth, requireRole('sales', 'leader'), async (req, res) => {
  const photoFilename = (req.body.photo_filename || '').trim();
  if (!photoFilename) {
    return res.status(400).json({ error: 'Vui long chup/chon hinh don hang truoc khi luu.' });
  }
  const safeFilename = path.basename(photoFilename);
  const photoFullPath = path.join(uploadDir, safeFilename);
  if (!fs.existsSync(photoFullPath)) {
    return res.status(400).json({ error: 'Khong tim thay hinh da quet, vui long chon lai hinh.' });
  }

  // warehouse_ids: chuoi cac id kho cach nhau boi dau phay, vi du "1,2" (ho tro chon nhieu kho)
  const rawIds = (req.body.warehouse_ids || req.body.warehouse_id || '').toString();
  const warehouseIds = [...new Set(
    rawIds.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0)
  )];
  if (warehouseIds.length === 0) {
    return res.status(400).json({ error: 'Vui long chon it nhat 1 kho nhan don hang.' });
  }

  const placeholders = warehouseIds.map(() => '?').join(',');
  const validWarehouses = db
    .prepare(`SELECT * FROM warehouses WHERE is_active = 1 AND id IN (${placeholders})`)
    .all(...warehouseIds);
  if (validWarehouses.length !== warehouseIds.length) {
    return res.status(400).json({ error: 'Mot hoac nhieu kho da chon khong hop le.' });
  }

  const orderType = req.body.order_type === 'nhap_kho' ? 'nhap_kho' : 'xuat_kho';
  const finalName = (req.body.customer_name || '').trim() || 'Chua xac dinh';
  const orderCode = (req.body.order_code || '').trim() || null;

  const info = db
    .prepare(
      `INSERT INTO orders (customer_name, order_type, order_code, ocr_raw_text, ocr_guess, sales_user_id, sales_username, warehouse_id, order_photo_path, status, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cho_soan', ?)`
    )
    .run(
      finalName,
      orderType,
      orderCode,
      req.body.ocr_raw_text || null,
      req.body.ocr_guess || null,
      req.user.id,
      req.user.username,
      warehouseIds[0], // luu kho dau tien lam gia tri du phong/hien thi don gian
      safeFilename,
      req.body.note || null
    );

  const orderId = info.lastInsertRowid;

  const insertOW = db.prepare(
    'INSERT INTO order_warehouses (order_id, warehouse_id, status) VALUES (?, ?, ?)'
  );
  for (const whId of warehouseIds) {
    insertOW.run(orderId, whId, 'cho_soan');
  }

  db.prepare(
    `INSERT INTO order_photos (order_id, warehouse_id, type, photo_path, uploaded_by_username)
     VALUES (?, NULL, 'order', ?, ?)`
  ).run(orderId, safeFilename, req.user.username);

  if (finalName && finalName !== 'Chua xac dinh') {
    db.prepare('INSERT OR IGNORE INTO customers (name) VALUES (?)').run(finalName);
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  order.warehouses = getOrderWarehouses(orderId);

  // Bao cho cac client dang mo app biet co don hang moi (de hien thi thong bao nhanh cho thu kho)
  broadcast('new_order', {
    order_id: orderId,
    customer_name: order.customer_name,
    order_type: order.order_type,
    warehouse_ids: warehouseIds,
    warehouses: order.warehouses,
  });

  // Gui push notification thuc su (hien ca khi da tat trinh duyet) toi thu kho cua tung kho lien quan
  const notifyUserIds = new Set();
  for (const whId of warehouseIds) {
    getRelevantUserIds(whId).forEach((id) => notifyUserIds.add(id));
  }
  sendPushToUsers([...notifyUserIds], {
    title: '🔔 Đơn hàng mới',
    body: `${order.customer_name}${order.warehouses ? ' — ' + order.warehouses.map((w) => w.warehouse_name).join(', ') : ''}`,
    url: '/warehouse.html',
  }).catch((err) => console.error('[push] Loi:', err.message));

  res.json({ order });
});

// ============ Sua thong tin don hang sau khi da luu (lo sai ten khach, ma don, kho, loai don...) ============
router.patch('/:id', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Khong tim thay don hang.' });

  const roles = getUserRoles(req.user);
  const isLeader = roles.includes('leader');
  // "Toan quyen sua": quan ly, hoac nguoi duoc cap rieng quyen delete_any_order (dung chung voi
  // quyen xoa moi don - coi nhu quyen "xu ly moi don hang" noi chung).
  const canEditAny = isLeader || hasPermission(req.user.id, 'delete_any_order');
  const isOwnerSales = roles.includes('sales') && order.sales_user_id === req.user.id;

  if (!canEditAny && !isOwnerSales) {
    return res.status(403).json({ error: 'Ban khong co quyen sua don hang nay.' });
  }
  // Sales thuong (khong co toan quyen): chi duoc tu sua khi don CON "cho soan hang" hoan toan
  // (chua kho nao giao xong/co hang tra) - tranh sua nham lam roi du lieu kho da xu ly xong.
  if (!canEditAny && order.status !== 'cho_soan') {
    return res.status(400).json({
      error: 'Don hang nay da duoc kho xu ly (khong con "cho soan hang"), khong the tu sua. Lien he quan ly neu can sua.',
    });
  }

  const { customer_name, note, order_code, order_type, warehouse_ids } = req.body || {};
  const updates = [];
  const params = [];

  if (typeof customer_name === 'string' && customer_name.trim()) {
    updates.push('customer_name = ?');
    params.push(customer_name.trim());
    db.prepare('INSERT OR IGNORE INTO customers (name) VALUES (?)').run(customer_name.trim());
  }
  if (typeof order_code === 'string') {
    updates.push('order_code = ?');
    params.push(order_code.trim() || null);
  }
  if (typeof note === 'string') {
    updates.push('note = ?');
    params.push(note);
  }
  if (order_type === 'xuat_kho' || order_type === 'nhap_kho') {
    updates.push('order_type = ?');
    params.push(order_type);
  }

  // Doi danh sach kho nhan don hang - chi cho phep khi CHUA co kho nao bat dau xac nhan
  // (tranh lam sai lech du lieu da xu ly), tru khi nguoi sua co toan quyen (quan ly/delete_any_order).
  let warehouseIdsChanged = false;
  if (typeof warehouse_ids === 'string' && warehouse_ids.trim()) {
    const newIds = [...new Set(
      warehouse_ids.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0)
    )];
    if (newIds.length === 0) {
      return res.status(400).json({ error: 'Vui long chon it nhat 1 kho nhan don hang.' });
    }
    const whPlaceholders = newIds.map(() => '?').join(',');
    const validWarehouses = db
      .prepare(`SELECT * FROM warehouses WHERE is_active = 1 AND id IN (${whPlaceholders})`)
      .all(...newIds);
    if (validWarehouses.length !== newIds.length) {
      return res.status(400).json({ error: 'Mot hoac nhieu kho da chon khong hop le.' });
    }

    const currentOw = db.prepare('SELECT * FROM order_warehouses WHERE order_id = ?').all(order.id);
    const currentIds = currentOw.map((ow) => ow.warehouse_id).sort((a, b) => a - b).join(',');
    const sameAsCurrent = currentIds === [...newIds].sort((a, b) => a - b).join(',');

    if (!sameAsCurrent) {
      const anyStarted = currentOw.some((ow) => ow.confirmed_by_username);
      if (anyStarted && !canEditAny) {
        return res.status(400).json({
          error: 'Da co kho xac nhan xu ly don nay, khong the tu doi kho. Lien he quan ly neu can doi.',
        });
      }
      // Bo cac kho khong con trong danh sach moi, them cac kho moi duoc chon (giu nguyen kho cu
      // neu van con trong danh sach moi, khong mat trang thai/nguoi xac nhan cua kho do).
      for (const ow of currentOw) {
        if (!newIds.includes(ow.warehouse_id)) {
          db.prepare('DELETE FROM order_warehouses WHERE id = ?').run(ow.id);
        }
      }
      const insertOW = db.prepare(
        'INSERT OR IGNORE INTO order_warehouses (order_id, warehouse_id, status) VALUES (?, ?, ?)'
      );
      for (const whId of newIds) {
        insertOW.run(order.id, whId, 'cho_soan');
      }
      db.prepare('UPDATE orders SET warehouse_id = ? WHERE id = ?').run(newIds[0], order.id);
      warehouseIdsChanged = true;
    }
  }

  if (updates.length === 0 && !warehouseIdsChanged) {
    return res.status(400).json({ error: 'Khong co gi de cap nhat.' });
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  // Neu doi kho, trang thai tong hop cua don co the thay doi (vi danh sach kho lien quan thay doi) -
  // tinh lai cho dung, kem cap nhat updated_at neu chua duoc cap o buoc tren.
  if (warehouseIdsChanged) {
    const allStatuses = db
      .prepare('SELECT status FROM order_warehouses WHERE order_id = ?')
      .all(order.id)
      .map((r) => r.status);
    const aggregateStatus = computeAggregateStatus(allStatuses);
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
      aggregateStatus,
      order.id
    );
  }

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  updated.warehouses = getOrderWarehouses(updated.id);

  broadcast('order_edited', {
    order_id: updated.id,
    customer_name: updated.customer_name,
    sales_user_id: updated.sales_user_id,
    updated_by: req.user.username,
    warehouse_ids: updated.warehouses.map((w) => w.warehouse_id),
  });

  res.json({ order: updated });
});

// ============ THU KHO: upload hinh da giao hang hoac hang tra - CHO DUNG KHO cua minh ============
router.post(
  '/:id/photos',
  requireAuth,
  requireRole('warehouse', 'leader'),
  upload.single('photo'),
  async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Khong tim thay don hang.' });

    // Thu kho: luon xac nhan cho DUNG kho cua chinh minh (bo qua neu client gui warehouse_id khac).
    // Quan ly (leader): phai chi dinh ro dang xac nhan cho kho nao vi ho khong gan co dinh 1 kho.
    // Neu client gui ro warehouse_id thi dung dung gia tri do (cho phep leader/nguoi kiem
    // nhieu vai tro chi dinh kho khac). Neu khong, va nguoi dung co vai tro Thu kho va da
    // duoc gan 1 kho co dinh, tu dong dung kho cua chinh ho.
    let warehouseId = parseInt(req.body.warehouse_id, 10) || null;
    if (!warehouseId && getUserRoles(req.user).includes('warehouse') && req.user.warehouse_id) {
      warehouseId = req.user.warehouse_id;
    }
    if (!warehouseId) return res.status(400).json({ error: 'Vui long chon kho can xac nhan.' });

    const ow = db
      .prepare('SELECT * FROM order_warehouses WHERE order_id = ? AND warehouse_id = ?')
      .get(order.id, warehouseId);
    if (!ow) {
      return res.status(403).json({ error: 'Kho nay khong duoc gan vao don hang nay.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Vui long gui kem hinh anh.' });
    await compressImage(req.file.path);

    const type = req.body.type === 'return' ? 'return' : 'packed';
    db.prepare(
      `INSERT INTO order_photos (order_id, warehouse_id, type, photo_path, uploaded_by_username, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(order.id, warehouseId, type, req.file.filename, req.user.username, req.body.note || null);

    const newOwStatus = type === 'return' ? 'co_hang_tra' : 'da_soan';
    db.prepare(
      `UPDATE order_warehouses SET status = ?, confirmed_by_username = ?, confirmed_at = datetime('now') WHERE id = ?`
    ).run(newOwStatus, req.user.username, ow.id);

    // Tinh lai trang thai TONG HOP cua ca don hang tu trang thai tat ca cac kho lien quan
    const allStatuses = db
      .prepare('SELECT status FROM order_warehouses WHERE order_id = ?')
      .all(order.id)
      .map((r) => r.status);
    const aggregateStatus = computeAggregateStatus(allStatuses);
    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      aggregateStatus,
      order.id
    );

    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    updatedOrder.warehouses = getOrderWarehouses(order.id);

    broadcast('order_updated', {
      order_id: order.id,
      customer_name: updatedOrder.customer_name,
      warehouse_id: warehouseId,
      warehouse_status: newOwStatus,
      overall_status: aggregateStatus,
      sales_user_id: updatedOrder.sales_user_id,
      updated_by: req.user.username,
    });

    sendPushToUsers([updatedOrder.sales_user_id], {
      title: '📦 Đơn hàng cập nhật',
      body: `${updatedOrder.customer_name}: ${newOwStatus === 'co_hang_tra' ? 'Có hàng trả' : 'Đã giao hàng'}`,
      url: '/sales.html',
    }).catch((err) => console.error('[push] Loi:', err.message));

    res.json({ order: updatedOrder });
  }
);

// ============ Danh sach don hang (co loc) ============
router.get('/', requireAuth, (req, res) => {
  const { status, customer, from, to, mine, warehouse_id, order_type, date } = req.query;
  const params = [];
  let sql;

  const isWarehouseScoped = getUserRoles(req.user).includes('warehouse') && !getUserRoles(req.user).includes('leader') && !hasPermission(req.user.id, 'view_all');

  if (isWarehouseScoped) {
    // Thu kho: chi xem don co gan kho cua minh, va loc theo TRANG THAI RIENG cua kho ho
    // (khong phai trang thai tong hop cua ca don, vi don co the con kho khac chua xong)
    sql = `
      SELECT o.*, ow.status AS my_status, ow.confirmed_by_username AS my_confirmed_by,
             ow.confirmed_at AS my_confirmed_at
      FROM orders o
      JOIN order_warehouses ow ON ow.order_id = o.id
      WHERE ow.warehouse_id = ?`;
    params.push(req.user.warehouse_id);
    if (status) {
      sql += ' AND ow.status = ?';
      params.push(status);
    }
  } else {
    sql = 'SELECT o.* FROM orders o WHERE 1=1';
    if (status) {
      sql += ' AND o.status = ?';
      params.push(status);
    }
    if (warehouse_id) {
      sql += ' AND EXISTS (SELECT 1 FROM order_warehouses ow2 WHERE ow2.order_id = o.id AND ow2.warehouse_id = ?)';
      params.push(warehouse_id);
    }
  }

  if (order_type) {
    sql += ' AND o.order_type = ?';
    params.push(order_type);
  }
  if (customer) {
    sql += ' AND o.customer_name LIKE ?';
    params.push(`%${customer}%`);
  }
  if (date) {
    sql += ' AND date(o.created_at) = date(?)';
    params.push(date);
  } else {
    if (from) {
      sql += ' AND date(o.created_at) >= date(?)';
      params.push(from);
    }
    if (to) {
      sql += ' AND date(o.created_at) <= date(?)';
      params.push(to);
    }
  }
  if (mine === '1' && getUserRoles(req.user).includes('sales')) {
    sql += ' AND o.sales_user_id = ?';
    params.push(req.user.id);
  }

  sql += ' ORDER BY o.created_at DESC LIMIT 500';
  const orders = db.prepare(sql).all(...params);
  attachWarehousesInfo(orders);

  res.json({ orders });
});

// ============ Chi tiet 1 don hang + tat ca hinh anh + trang thai tung kho ============
router.get('/:id', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Khong tim thay don hang.' });

  order.warehouses = getOrderWarehouses(order.id);

  const photos = db
    .prepare(
      `SELECT op.*, w.name AS warehouse_name
       FROM order_photos op
       LEFT JOIN warehouses w ON w.id = op.warehouse_id
       WHERE op.order_id = ?
       ORDER BY op.uploaded_at ASC`
    )
    .all(order.id);
  res.json({ order, photos });
});

// ============ Xoa don hang (xoa luon hinh anh lien quan tren dia) ============
router.delete('/:id', requireAuth, requireRole('leader', 'sales', 'warehouse'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Khong tim thay don hang.' });

  const canDeleteAny = getUserRoles(req.user).includes('leader') || hasPermission(req.user.id, 'delete_any_order');

  if (!canDeleteAny) {
    // Sales/thu kho thuong: chi duoc xoa DUNG don cua chinh minh tao, va CHI KHI don chua duoc
    // kho xu ly gi (con "cho soan hang") - tranh xoa nham don da co thu kho lam viec, gay roi cho kho.
    if (!getUserRoles(req.user).includes('sales') || order.sales_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Ban khong co quyen xoa don hang nay.' });
    }
    if (order.status !== 'cho_soan') {
      return res.status(400).json({
        error: 'Don hang nay da duoc kho xu ly (khong con o trang thai cho soan hang), khong the tu xoa. Lien he quan ly neu can xoa.',
      });
    }
  }

  const photos = db.prepare('SELECT * FROM order_photos WHERE order_id = ?').all(order.id);

  db.prepare('DELETE FROM order_photos WHERE order_id = ?').run(order.id);
  db.prepare('DELETE FROM order_warehouses WHERE order_id = ?').run(order.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);

  // Xoa file hinh anh tren dia (best-effort, khong lam fail request neu xoa file loi)
  for (const p of photos) {
    const filePath = path.join(uploadDir, p.photo_path);
    fs.unlink(filePath, () => {});
  }

  broadcast('order_deleted', { order_id: order.id });

  res.json({ ok: true });
});

module.exports = router;
