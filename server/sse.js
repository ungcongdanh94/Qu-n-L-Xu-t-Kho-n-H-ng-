// Quan ly danh sach cac client dang mo app (ket noi SSE), va phat (broadcast) su kien
// toi tat ca khi co thay doi (don hang moi, cap nhat trang thai, phieu tra hang moi...).
// Khong can cai them thu vien ngoai (Socket.io) - dung tinh nang co san cua HTTP/Express.

const clients = new Set();

function addClient(res, user) {
  clients.add({ res, user });
}

function removeClient(res) {
  for (const c of clients) {
    if (c.res === res) {
      clients.delete(c);
      break;
    }
  }
}

function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try {
      c.res.write(payload);
    } catch (err) {
      // Client da ngat ket noi, se duoc don dep boi su kien 'close' o route
    }
  }
}

// Gui 1 dong comment rong dinh ky de giu ket noi khong bi proxy/timeout tu dong dong lai
setInterval(() => {
  for (const c of clients) {
    try {
      c.res.write(': ping\n\n');
    } catch (err) {}
  }
}, 25000);

module.exports = { addClient, removeClient, broadcast };
