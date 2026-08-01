require('dotenv').config();
const express = require('express');
const path = require('path');
const { ensureSeedData } = require('./seedData');

// Tu dong tao du lieu mau (kho + tai khoan) neu he thong dang chua co tai khoan nao.
// An toan de goi moi lan khoi dong: neu da co du lieu roi thi se tu bo qua, khong ghi de.
ensureSeedData({ verbose: true });

const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const customerRoutes = require('./routes/customers');
const warehouseRoutes = require('./routes/warehouses');
const userRoutes = require('./routes/users');
const returnRoutes = require('./routes/returns');
const eventsRoutes = require('./routes/events');
const pushRoutes = require('./routes/push');
const backupRoutes = require('./routes/backup');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));

// Phuc vu hinh anh da upload. Luu y: ten file la chuoi ngau nhien kho doan (xem routes/orders.js),
// nhung URL khong yeu cau dang nhap vi tag <img> tren trinh duyet khong gui duoc Bearer token.
// Neu can bao mat chat hon, nen dat toan bo app sau VPN/mang noi bo hoac Basic Auth o tang Nginx.
app.use('/uploads', express.static(path.join(__dirname, '..', 'storage', 'uploads')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/users', userRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/backup', backupRoutes);

// Frontend tinh (HTML/JS thuan, khong can build).
// Dat Cache-Control: no-cache cho HTML/JS/CSS de trinh duyet LUON kiem tra lai ban moi nhat
// tren server moi lan tai trang, tranh tinh trang cai/cap nhat code moi roi nhung dien thoai
// van hien giao dien/logic cu do bi cache lai (van con hop le hien anh/icon tinh nhu binh thuong).
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    setHeaders: (res, filePath) => {
      if (/\.(html|js|css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  })
);

// Xu ly loi chung (vi du: multer bao loi file qua lon / sai dinh dang)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Loi may chu.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server dang chay tai cong ${PORT} (0.0.0.0)`);
  console.log('Neu day la lan dau chay, nho chay: npm run seed');
});
