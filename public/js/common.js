// ==== Helper dung chung cho toan bo frontend ====

// Tu dang ky Service Worker ngam ngay khi vao app (khong xin quyen gi, hoan toan im lang) -
// day la dieu kien bat buoc de Chrome cho phep "Cai dat app" (beforeinstallprompt).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ==== Tu dong phat hien khi server co ban moi (sau khi deploy) va tu tai lai trang ====
// Giai quyet triet de van de dien thoai/may tinh "cache" lai giao dien cu: khong can ai phai
// vao cai dat xoa cache bang tay - app tu kiem tra ngam va tu lam moi khi phat hien co thay doi.
(function watchAppVersion() {
  const STORAGE_KEY = 'appVersionSeen';

  async function checkVersion() {
    try {
      const res = await fetch('/api/app-version', { cache: 'no-store' });
      const data = await res.json();
      const seen = sessionStorage.getItem(STORAGE_KEY);
      if (seen && seen !== data.version) {
        // Neu dang go dang cai gi do (o nhap co noi dung dang duoc focus), hoan lai viec tai
        // trang sang lan kiem tra sau, tranh lam mat noi dung dang nhap chua luu.
        const activeEl = document.activeElement;
        const isActivelyEditing =
          activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.value;
        if (isActivelyEditing) return;

        sessionStorage.setItem(STORAGE_KEY, data.version);
        window.location.reload();
        return;
      }
      sessionStorage.setItem(STORAGE_KEY, data.version);
    } catch (err) {
      // Mat mang tam thoi hoac loi khac - bo qua, thu lai o lan kiem tra sau
    }
  }

  checkVersion();
  setInterval(checkVersion, 3 * 60 * 1000); // kiem tra dinh ky moi 3 phut khi app dang mo
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkVersion();
  });
})();

function getToken() {
  return localStorage.getItem('token');
}
function getUser() {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}
function saveSession(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}
function logout() {
  if (typeof __sseConnection !== 'undefined' && __sseConnection) {
    __sseConnection.close();
    __sseConnection = null;
  }
  clearSession();
  window.location.href = '/login.html';
}

// Bao ve trang: neu chua dang nhap thi day ve trang login.
// Neu truyen allowedRoles, kiem tra luon quyen truy cap.
function hasUserPermission(user, permission) {
  return !!(user && Array.isArray(user.permissions) && user.permissions.includes(permission));
}

function hasUserRole(user, role) {
  if (!user) return false;
  if (Array.isArray(user.roles) && user.roles.length > 0) return user.roles.includes(role);
  return user.role === role;
}

function requireLogin(allowedRoles, requiredPermission) {
  const token = getToken();
  const user = getUser();
  if (!token || !user) {
    window.location.href = '/login.html';
    return null;
  }
  const roleOk = !allowedRoles || allowedRoles.some((r) => hasUserRole(user, r));
  const permOk = requiredPermission && hasUserPermission(user, requiredPermission);
  if (!roleOk && !permOk) {
    alert('Ban khong co quyen truy cap trang nay.');
    window.location.href = '/index.html';
    return null;
  }
  connectRealtime();
  return user;
}

async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  const isLoginRequest = url.includes('/api/auth/login');

  if (res.status === 401 && !isLoginRequest) {
    clearSession();
    window.location.href = '/login.html';
    throw new Error('Phien dang nhap het han.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Da xay ra loi.');
  }
  return data;
}

function roleLabel(role) {
  return { sales: 'Sales', warehouse: 'Thủ kho', leader: 'Quản lý' }[role] || role;
}
function statusLabel(status) {
  return {
    cho_soan: 'Chờ soạn hàng',
    da_soan: 'Đã giao hàng',
    co_hang_tra: 'Có hàng trả',
    cho_kho_xac_nhan: 'Chờ kho chụp hình',
    cho_sales_xac_nhan: 'Chờ sales xác nhận',
    hoan_tat: 'Hoàn tất',
  }[status] || status;
}
function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function orderDisplayName(order) {
  return order.order_code ? `${order.order_code} - ${order.customer_name}` : order.customer_name;
}

function orderTypeLabel(type) {
  return { xuat_kho: 'Xuất kho', nhap_kho: 'Nhập kho' }[type] || type;
}

function todayStr() {
  return localDateStr(new Date());
}
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDaysStr(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return localDateStr(d);
}

// Mo 1 lop xem hinh phong to, co nut in truc tiep hinh do
function openImageViewer(url) {
  let overlay = document.getElementById('imgViewerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'imgViewerOverlay';
    overlay.style.cssText =
      'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:200; align-items:center; justify-content:center; flex-direction:column; padding:16px;';
    overlay.innerHTML = `
      <img id="imgViewerImg" style="max-width:100%; max-height:75vh; border-radius:8px; background:#fff; object-fit:contain;" />
      <div style="display:flex; gap:10px; margin-top:16px; width:100%; max-width:360px;">
        <button class="btn" style="margin:0;" onclick="printCurrentImage()">🖨️ In hình này</button>
        <button class="btn secondary" style="margin:0;" onclick="closeImageViewer()">Đóng</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  document.getElementById('imgViewerImg').src = url;
  overlay.dataset.url = url;
  overlay.style.display = 'flex';
}
function closeImageViewer() {
  const overlay = document.getElementById('imgViewerOverlay');
  if (overlay) overlay.style.display = 'none';
}
function printCurrentImage() {
  const overlay = document.getElementById('imgViewerOverlay');
  const url = overlay ? overlay.dataset.url : null;
  if (!url) return;
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html>
      <head><title>In hình</title></head>
      <body style="margin:0; display:flex; align-items:center; justify-content:center;">
        <img src="${url}" style="max-width:100%;" onload="window.print();" />
      </body>
    </html>
  `);
  printWindow.document.close();
}

// ==== He thong thong bao nhanh (toast) ====
function showToast(message, opts = {}) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText =
      'position:fixed; top:calc(12px + env(safe-area-inset-top,0)); left:50%; transform:translateX(-50%); ' +
      'z-index:300; display:flex; flex-direction:column; gap:8px; align-items:center; width:100%; padding:0 12px; pointer-events:none;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.style.cssText =
    'background:#1f2937; color:#fff; padding:12px 16px; border-radius:10px; font-size:14px; ' +
    'box-shadow:0 4px 14px rgba(0,0,0,0.25); max-width:420px; text-align:center; pointer-events:auto; ' +
    'animation:toastIn 0.25s ease-out; cursor:pointer;';
  toast.textContent = message;
  toast.onclick = () => toast.remove();
  container.appendChild(toast);
  setTimeout(() => toast.remove(), opts.duration || 6000);
}

if (!document.getElementById('toastKeyframes')) {
  const style = document.createElement('style');
  style.id = 'toastKeyframes';
  style.textContent = '@keyframes toastIn { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }';
  document.head.appendChild(style);
}

// ==== Ket noi real-time (Server-Sent Events) de nhan thong bao va tu dong lam moi danh sach ====
let __sseConnection = null;
function connectRealtime() {
  const token = getToken();
  if (!token || __sseConnection) return;

  const user = getUser();
  __sseConnection = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);

  __sseConnection.addEventListener('new_order', (e) => {
    const data = JSON.parse(e.data);
    const isRelevantWarehouse =
      hasUserRole(user, 'leader') ||
      (hasUserRole(user, 'warehouse') && data.warehouse_ids && data.warehouse_ids.includes(user.warehouse_id));
    if (isRelevantWarehouse) {
      const khoNames = (data.warehouses || []).map((w) => w.warehouse_name).join(', ');
      showToast(`🔔 Đơn hàng mới: ${data.customer_name}${khoNames ? ' — ' + khoNames : ''}`);
    }
    if (typeof window.refreshList === 'function') window.refreshList();
  });

  __sseConnection.addEventListener('order_updated', (e) => {
    const data = JSON.parse(e.data);
    if (hasUserRole(user, 'sales') && data.sales_user_id === user.id && data.updated_by !== user.username) {
      showToast(`📦 Đơn "${data.customer_name}" vừa được cập nhật: ${statusLabel(data.warehouse_status)}`);
    }
    if (typeof window.refreshList === 'function') window.refreshList();
  });

  __sseConnection.addEventListener('order_deleted', () => {
    if (typeof window.refreshList === 'function') window.refreshList();
  });

  __sseConnection.addEventListener('new_return', (e) => {
    const data = JSON.parse(e.data);
    const isRelevant = hasUserRole(user, 'leader') || (hasUserRole(user, 'warehouse') && data.warehouse_id === user.warehouse_id);
    if (isRelevant) {
      showToast(`↩️ Có phiếu trả hàng mới: ${data.customer_name}`);
    }
    if (typeof window.refreshList === 'function') window.refreshList();
  });

  __sseConnection.addEventListener('return_updated', () => {
    if (typeof window.refreshList === 'function') window.refreshList();
  });

  __sseConnection.onerror = () => {
    // EventSource tu dong ket noi lai, khong can xu ly gi them
  };
}

// ==== Web Push: dang ky nhan thong bao day (hoat dong ke ca khi da dong trinh duyet) ====
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

async function getPushSubscriptionStatus() {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) {
    const sub = await reg.pushManager.getSubscription();
    if (sub) return 'subscribed';
  }
  return 'not-subscribed';
}

async function enablePushNotifications() {
  if (!isPushSupported()) {
    alert('Trình duyệt này không hỗ trợ thông báo đẩy. Hãy thử trên Chrome/Safari bản mới, hoặc trên điện thoại.');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Bạn chưa cho phép nhận thông báo. Có thể bật lại trong cài đặt trình duyệt.');
      return;
    }

    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const { publicKey, enabled } = await apiFetch('/api/push/vapid-public-key');
    if (!enabled || !publicKey) {
      showToast('Server chưa bật tính năng thông báo đẩy. Liên hệ quản lý để cấu hình.');
      return;
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await apiFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    showToast('🔔 Đã bật thông báo đẩy thành công!');
    renderPushButton();
  } catch (err) {
    console.error(err);
    showToast('Không bật được thông báo: ' + err.message);
  }
}

async function renderPushButton() {
  const el = document.getElementById('pushButtonWrap');
  if (!el) return;
  const status = await getPushSubscriptionStatus();
  if (status === 'subscribed' || status === 'unsupported') {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<button onclick="enablePushNotifications()" style="background:rgba(255,255,255,0.15); color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:12px; cursor:pointer;">🔔 Bật thông báo</button>`;
}

// ==== Cai dat app ra man hinh chinh (tu nhan dien iOS / Android / May tinh) ====
let __deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  __deferredInstallPrompt = e;
  renderInstallButton();
});
window.addEventListener('appinstalled', () => {
  __deferredInstallPrompt = null;
  renderInstallButton();
});

function isRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function detectPlatform() {
  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

async function installApp() {
  const platform = detectPlatform();
  // iOS khong co API cai dat tu dong (gioi han cua Safari/WebKit) - phai huong dan thu cong
  if (platform === 'ios') {
    showInstallInstructions('ios');
    return;
  }
  if (__deferredInstallPrompt) {
    __deferredInstallPrompt.prompt();
    await __deferredInstallPrompt.userChoice;
    __deferredInstallPrompt = null;
    renderInstallButton();
  } else {
    // Trinh duyet khong ho tro cai tu dong (vd Firefox) hoac da tung tu choi truoc do
    showInstallInstructions(platform);
  }
}

function showInstallInstructions(platform) {
  let overlay = document.getElementById('installInstructionsOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'installInstructionsOverlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }
  let content;
  if (platform === 'ios') {
    content = `
      <h2 style="margin-top:0;">📲 Thêm vào Màn hình chính</h2>
      <p class="hint">Áp dụng cho iPhone/iPad, dùng trình duyệt Safari:</p>
      <ol style="padding-left:20px; line-height:1.9; font-size:14px;">
        <li>Bấm vào biểu tượng <b>Chia sẻ</b> (hình vuông có mũi tên đi lên) ở thanh dưới trình duyệt.</li>
        <li>Kéo xuống, chọn <b>"Thêm vào MH chính"</b> (Add to Home Screen).</li>
        <li>Bấm <b>Thêm</b> ở góc trên bên phải.</li>
      </ol>
      <p class="hint">Lưu ý: chỉ làm được trên Safari — Chrome/Firefox trên iPhone không hỗ trợ bước này.</p>
    `;
  } else if (platform === 'android') {
    content = `
      <h2 style="margin-top:0;">📲 Cài đặt app</h2>
      <p class="hint">Nếu không tự hiện hộp thoại cài đặt, làm thủ công:</p>
      <ol style="padding-left:20px; line-height:1.9; font-size:14px;">
        <li>Bấm vào menu (dấu 3 chấm ⋮) ở góc trên bên phải trình duyệt Chrome.</li>
        <li>Chọn <b>"Cài đặt ứng dụng"</b> hoặc <b>"Thêm vào màn hình chính"</b>.</li>
      </ol>
    `;
  } else {
    content = `
      <h2 style="margin-top:0;">📲 Cài đặt app</h2>
      <p class="hint">Nếu không tự hiện hộp thoại cài đặt, làm thủ công:</p>
      <ol style="padding-left:20px; line-height:1.9; font-size:14px;">
        <li>Tìm biểu tượng cài đặt (⊕ hoặc hình màn hình nhỏ) ở cuối thanh địa chỉ trình duyệt Chrome/Edge.</li>
        <li>Bấm vào đó và chọn <b>Cài đặt</b>.</li>
      </ol>
    `;
  }
  overlay.innerHTML = `
    <div class="card">
      ${content}
      <button class="btn secondary" onclick="document.getElementById('installInstructionsOverlay').style.display='none'">Đóng</button>
    </div>
  `;
  overlay.style.display = 'flex';
}

function renderInstallButton() {
  const el = document.getElementById('installButtonWrap');
  if (!el) return;
  if (isRunningStandalone()) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<button onclick="installApp()" style="background:rgba(255,255,255,0.15); color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:12px; cursor:pointer;">📲 Cài đặt app</button>`;
}

function renderTopbar(activeTitle) {
  const user = getUser();
  setTimeout(() => {
    renderPushButton();
    renderInstallButton();
  }, 0);
  return `
    <div class="topbar">
      <div style="display:flex; align-items:center; gap:8px;">
        <img src="/images/logo-icon.png" alt="" style="height:32px; width:auto; display:block;" />
        <h1>${activeTitle}</h1>
      </div>
      <div class="userinfo">
        <span id="installButtonWrap"></span>
        <span id="pushButtonWrap"></span>
        <span class="userNameLabel">${user ? user.full_name + ' (' + roleLabel(user.role) + ')' : ''}</span>
        <button onclick="logout()">Đăng xuất</button>
      </div>
    </div>
  `;
}

function renderNavTabs(active) {
  const user = getUser();
  if (!user) return '';
  const tabs = [];
  if (hasUserRole(user, 'sales') || hasUserRole(user, 'leader')) {
    tabs.push({ href: '/sales.html', label: 'Đăng đơn', icon: '📤', key: 'sales' });
  }
  if (hasUserRole(user, 'sales')) {
    tabs.push({ href: '/myorders.html', label: 'Đơn hàng', icon: '📑', key: 'myorders' });
  }
  if (hasUserRole(user, 'warehouse') || hasUserRole(user, 'leader')) {
    tabs.push({ href: '/warehouse.html', label: 'Xử lý kho', icon: '📦', key: 'warehouse' });
  }
  tabs.push({ href: '/returns.html', label: 'Hàng trả', icon: '↩️', key: 'returns' });
  if (hasUserRole(user, 'leader') || hasUserPermission(user, 'view_all')) {
    tabs.push({ href: '/dashboard.html', label: 'Tổng quan', icon: '📊', key: 'dashboard' });
  }
  if (hasUserRole(user, 'leader') || hasUserPermission(user, 'manage_admin')) {
    tabs.push({ href: '/users.html', label: 'Tài khoản', icon: '👥', key: 'users' });
  }
  return `
    <div class="nav-tabs">
      ${tabs
        .map(
          (t) =>
            `<a href="${t.href}" class="${t.key === active ? 'active' : ''}">
              <span class="nav-icon">${t.icon}</span>
              <span class="nav-label">${t.label}</span>
            </a>`
        )
        .join('')}
    </div>
  `;
}
