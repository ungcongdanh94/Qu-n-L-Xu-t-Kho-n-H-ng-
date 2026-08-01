// Chay 1 lan de tao cap khoa VAPID (bat buoc phai co de gui duoc push notification):
//   npm run generate-vapid
// Sau do copy 2 dong VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in ra vao file .env (hoac bien
// moi truong tren Railway), roi restart lai server.
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('\n=== Da tao xong cap khoa VAPID ===\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('\nCopy 2 dong tren vao file .env (hoac bien moi truong tren Railway), roi khoi dong lai server.');
console.log('LUU Y: chi tao 1 LAN DUY NHAT. Neu tao lai va thay doi key, tat ca thiet bi da bat thong bao truoc do se can bat lai tu dau.\n');
