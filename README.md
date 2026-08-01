# App Quản Lý Đơn Hàng Xuất Kho

Ứng dụng giúp:
- **Sales** chụp hình đơn hàng → hệ thống tự động đọc hình (OCR) và gợi ý tên khách hàng → sales xác nhận/sửa lại trước khi lưu.
- **Thủ kho** xem danh sách đơn cần soạn, chụp hình đơn đã soạn xong hoặc hình hàng khách trả lại.
- **Quản lý (chủ)** xem tổng quan toàn bộ đơn hàng, lọc theo trạng thái/khách hàng/ngày, xem lại tất cả hình ảnh liên quan.

## 0. Có gì mới: quản lý nhiều kho + tự tạo tài khoản nhân viên

- Hỗ trợ **nhiều kho** (ví dụ Kho 1, Kho 2), mỗi kho có (các) thủ kho riêng.
- Khi **Sales đăng đơn hàng**, bắt buộc chọn kho sẽ nhận đơn đó.
- **Thủ kho** đăng nhập vào chỉ thấy đơn hàng của đúng kho mình phụ trách, không thấy đơn của kho khác.
- **Quản lý (leader)** có thêm trang **"Quản lý tài khoản"** để tự tạo tài khoản nhân viên mới (sales/thủ kho/quản lý), gán thủ kho vào đúng kho, đổi mật khẩu, hoặc khoá tài khoản khi nhân viên nghỉ việc — không cần sửa code hay chạy lại lệnh `seed`.
- Trang Tổng quan (dashboard) và trang Xử lý kho đều có thể lọc theo từng kho.

## 1. Cài đặt lần đầu

Yêu cầu máy chủ đã cài **Node.js phiên bản 18 trở lên**.

```bash
cd order-warehouse-app
npm install
cp .env.example .env
```

Mở file `.env` và đổi `JWT_SECRET` thành một chuỗi bí mật dài, khó đoán (dùng để mã hoá phiên đăng nhập).

Tạo các tài khoản mẫu ban đầu:

```bash
npm run seed
```

Lệnh này tạo sẵn 2 kho (Kho 1, Kho 2) và 4 tài khoản:
| Tài khoản | Mật khẩu | Vai trò | Kho |
|---|---|---|---|
| sales1 | 123456 | Sales (đăng đơn) | — |
| thukho1 | 123456 | Thủ kho | Kho 1 |
| thukho2 | 123456 | Thủ kho | Kho 2 |
| quanly | 123456 | Quản lý (xem tổng quan) | — |

**Quan trọng: đổi mật khẩu ngay sau khi đăng nhập lần đầu.** Từ nay, muốn thêm tài khoản nhân viên/thủ kho mới, **không cần chạy lại `npm run seed`** — đăng nhập bằng tài khoản `quanly`, vào mục **"Quản lý tài khoản"** trên giao diện để tạo, sửa, gán kho hoặc khoá tài khoản trực tiếp. Lệnh `npm run seed` chỉ nên chạy 1 lần lúc mới cài đặt.

## 2. Chạy thử

```bash
npm start
```

Mở trình duyệt vào `http://localhost:3000`.

Lần đầu quét OCR sẽ hơi chậm hơn (vài giây) vì thư viện Tesseract tải file ngôn ngữ tiếng Việt về máy — các lần sau sẽ nhanh hơn.

## 3. Triển khai để dùng thật (cả trong nội bộ lẫn ngoài Internet)

Vì anh cần vừa dùng ở kho (LAN) vừa truy cập được từ ngoài, cách đơn giản và ổn định nhất là **thuê 1 VPS nhỏ** (ví dụ VPS giá rẻ trong nước, hoặc DigitalOcean/Vultr — cấu hình 1-2GB RAM là đủ), rồi:

1. Cài Node.js trên VPS.
2. Copy toàn bộ thư mục `order-warehouse-app` lên VPS.
3. Chạy `npm install`, cấu hình `.env`, chạy `npm run seed`.
4. Cài **PM2** để chạy nền và tự khởi động lại khi server reboot:
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name xuatkho
   pm2 save
   pm2 startup
   ```
5. Cài **Nginx** làm reverse proxy + **Certbot** để có HTTPS miễn phí (bắt buộc nên có, vì app này có upload hình ảnh và mật khẩu đăng nhập):
   - Trỏ domain (ví dụ `xuatkho.congthanh.vn`) về IP của VPS.
   - Nginx proxy request từ port 80/443 vào `localhost:3000`.
   - Chạy `certbot --nginx` để tự cấp SSL.
6. Sau khi có domain + HTTPS, mọi người (cả sales ngoài đường lẫn thủ kho tại kho) chỉ cần mở domain đó trên điện thoại là dùng được, không cần VPN hay cùng mạng LAN.

Nếu anh chưa quen tự làm bước server/domain/SSL này, em có thể hướng dẫn từng bước cụ thể hơn khi anh đã chọn được nhà cung cấp VPS.

### Lưu ý bảo mật
- Ảnh upload hiện phục vụ qua URL `/uploads/...` không yêu cầu đăng nhập lại (vì thẻ `<img>` trên trình duyệt không tự gửi được token đăng nhập). Tên file là chuỗi ngẫu nhiên khó đoán nên tương đối an toàn cho dùng nội bộ, nhưng **nhất định phải bật HTTPS** khi để server truy cập từ Internet để tránh lộ mật khẩu khi đăng nhập.
- Định kỳ backup file `storage/data/app.db` (đây là toàn bộ database) và thư mục `storage/uploads/` (toàn bộ hình ảnh).

## 4. Cấu trúc dữ liệu (để dễ mở rộng sau này)

- `orders`: mỗi đơn hàng — tên khách, trạng thái (`cho_soan` / `da_soan` / `co_hang_tra`), ảnh đơn gốc, ai đăng.
- `order_photos`: tất cả hình ảnh liên quan tới 1 đơn (đơn gốc, hình đã soạn, hình hàng trả) — 1 đơn có thể có nhiều hình.
- `customers`: danh sách tên khách hàng đã từng xuất hiện, dùng để gợi ý tự động khi gõ tên.
- `users`: tài khoản đăng nhập, phân theo vai trò `sales` / `warehouse` / `leader`.

## 5. Những điểm có thể nâng cấp sau

- Thêm màn hình đổi mật khẩu ngay trên giao diện (hiện đã có sẵn API `/api/auth/change-password`).
- Thêm thông báo (Zalo/Telegram bot) mỗi khi có đơn mới hoặc có hàng trả, để anh không cần mở app liên tục.
- Gắn thêm số điện thoại, địa chỉ giao hàng vào từng khách hàng.
- Nếu muốn độ chính xác nhận diện tên khách cao hơn nữa (chữ viết tay khó đọc), có thể nâng cấp OCR hiện tại (Tesseract, miễn phí) lên dùng AI đọc hình qua API (có phí nhỏ mỗi lần nhưng chính xác hơn nhiều, đặc biệt với chữ viết tay) — em có thể làm phần này bất cứ lúc nào anh cần.

## 6. Xử lý lỗi thường gặp khi deploy

### Lỗi `Cannot find module '/app/server/index.js'`
Nguyên nhân: cấu trúc thư mục trên GitHub bị lồng thêm 1 cấp (ví dụ `order-warehouse-app/order-warehouse-app/server/...`) thay vì `package.json`, `server/`, `public/` nằm ngay gốc repo. Sửa bằng cách đưa toàn bộ nội dung bên trong thư mục `order-warehouse-app` lên thẳng gốc repo, hoặc set "Root Directory" của nền tảng deploy thành `order-warehouse-app`.

### Deploy bằng Docker (khuyên dùng, không phụ thuộc cách nền tảng tự đoán cấu trúc)
Dự án đã có sẵn `Dockerfile`. Trên VPS đã cài Docker:
```bash
docker build -t xuatkho .
docker run -d --name xuatkho \
  -p 3000:3000 \
  -e JWT_SECRET="doi-chuoi-nay-that-dai-va-bi-mat" \
  -v $(pwd)/storage:/app/storage \
  xuatkho
```
**Lưu ý quan trọng:** database và hình ảnh được lưu trong 1 thư mục duy nhất là `storage/` (nằm ngang hàng với `server/`, không lồng bên trong thư mục code) — chỉ cần mount **đúng 1 thư mục `storage/`** ra ngoài container như trên là đủ cho cả database lẫn hình ảnh. Nếu không mount, dữ liệu sẽ mất sạch mỗi khi container khởi động lại hoặc deploy bản mới.

Nếu dùng Railway: vào tab **Volumes**, tạo 1 Volume, **Mount path đặt là `/app/storage`** (không phải `/app/server` hay `/app/server/data`) — vì `/app/server` chứa code, nếu gắn Volume trực tiếp vào đó, ổ đĩa trống sẽ che mất toàn bộ code đã build, gây lỗi `Cannot find module '/app/server/index.js'`.

Sau khi container chạy, vào trong container chạy lệnh seed 1 lần:
```bash
docker exec -it xuatkho npm run seed
```

## 7. Quy trình phiếu trả hàng (2 chiều)

Trang **"Hàng trả"** (menu dưới cùng, dùng được cho Sales, Thủ kho, Quản lý) hỗ trợ 2 tình huống:

1. **Khách trả hàng trực tiếp tại kho:** Thủ kho vào "Hàng trả" → lập phiếu, chọn kho, nhập tên khách, **chụp hình xác nhận ngay lúc lập phiếu** → phiếu chuyển trạng thái "Chờ sales xác nhận". Sales vào xem phiếu đó, bấm "Xác nhận đã tiếp nhận thông tin" → phiếu chuyển "Hoàn tất".

2. **Khách báo trước sẽ trả hàng (qua sales):** Sales vào "Hàng trả" → lập phiếu, chọn kho, nhập tên khách (**không có hình** vì chưa nhận được hàng) → phiếu ở trạng thái "Chờ kho chụp hình". Khi hàng trả thực sự đến kho, thủ kho mở đúng phiếu đó → chụp hình xác nhận → phiếu tự chuyển "Hoàn tất".

Quản lý (leader) xem được tất cả phiếu ở mọi kho, lọc theo trạng thái/kho, và có thể thay mặt thực hiện cả 2 hành động trên nếu cần.

Đổi tên kho: vào **"Quản lý tài khoản"** → mục "Danh sách kho" ở đầu trang, sửa tên rồi bấm Lưu.

## 8. Loại đơn (Xuất kho / Nhập kho), xem theo ngày, và in hình

- Khi Sales đăng đơn, giờ có thêm lựa chọn **Loại đơn: Xuất kho / Nhập kho** để cả sales và thủ kho dễ phân biệt đơn nào là hàng ra, đơn nào là hàng vào.
- Trang **Xử lý kho** và **Tổng quan** có thêm thanh điều hướng theo ngày (nút ◀ ▶ và "Hôm nay") để xem nhanh đơn hàng của từng ngày, cùng bộ lọc theo loại đơn.
- Bấm vào bất kỳ hình đơn hàng/hình xác nhận nào trong app sẽ mở to ra kèm nút **"🖨️ In hình này"** để in trực tiếp.

## 9. Một đơn hàng có thể lấy từ nhiều kho cùng lúc

Khi đăng đơn, Sales có thể tick chọn **nhiều kho** cùng lúc nếu đơn hàng cần lấy hàng từ cả Kho Tổng lẫn Kho XINGFA. Mỗi kho sẽ:
- Chỉ thấy phần việc của mình, tự chụp hình xác nhận **riêng** khi đã giao xong phần hàng của kho mình.
- Trạng thái tổng của đơn chỉ chuyển "Đã giao hàng" khi **tất cả** các kho liên quan đều đã xác nhận xong. Nếu 1 trong các kho báo có hàng trả, trạng thái tổng sẽ là "Có hàng trả".

Ở mọi nơi hiển thị danh sách/chi tiết đơn hàng, hệ thống đều liệt kê rõ từng kho kèm trạng thái riêng (ví dụ: "Kho Tổng: Đã giao hàng · Kho XINGFA: Chờ soạn hàng") để dễ theo dõi tổng thể.

## 10. Thông báo nhanh & cập nhật thời gian thực

App giờ tự động đẩy thông báo và cập nhật danh sách ngay khi có thay đổi, không cần bấm tải lại trang:
- Khi Sales đăng đơn mới, **thủ kho của đúng kho đó** (và Quản lý) sẽ thấy thông báo nhỏ (toast) hiện ra ngay trên màn hình.
- Khi thủ kho xác nhận đã giao hàng hoặc báo hàng trả, **Sales đã tạo đơn đó** sẽ được báo ngay lập tức.
- Khi có phiếu trả hàng mới, thủ kho của đúng kho liên quan và Quản lý sẽ được báo.
- Danh sách đơn hàng/phiếu trả hàng đang xem tự động làm mới ngay khi có bất kỳ thao tác nào liên quan (không cần F5).

Công nghệ dùng: Server-Sent Events (SSE) — không cần cài thêm thư viện, gọn nhẹ, chạy tốt trên Railway. Nếu sau này thấy thông báo bị trễ hoặc mất kết nối liên tục trên môi trường thực tế, báo lại để điều chỉnh cơ chế giữ kết nối cho phù hợp.

## 11. Bật thông báo đẩy (Web Push) — hoạt động kể cả khi đã tắt trình duyệt

Đây là bước **bắt buộc phải làm 1 lần** sau khi deploy, nếu không tính năng thông báo đẩy sẽ không hoạt động (app vẫn chạy bình thường, chỉ là không gửi được thông báo khi đã đóng trình duyệt).

### Bước 1: Tạo cặp khoá VAPID
Trên máy đã cài Node.js (máy tính hoặc ngay trong terminal của Railway nếu có), chạy:
```bash
npm run generate-vapid
```
Lệnh này in ra 2 dòng dạng:
```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

### Bước 2: Thêm vào biến môi trường
- Nếu chạy trên máy/VPS: dán 2 dòng trên vào file `.env`.
- Nếu chạy trên Railway: vào tab **Variables**, thêm từng biến `VAPID_PUBLIC_KEY` và `VAPID_PRIVATE_KEY` với đúng giá trị vừa tạo. Có thể thêm luôn `VAPID_SUBJECT=mailto:email-cua-anh@gmail.com` (bắt buộc phải là 1 email hoặc URL hợp lệ, dùng để các dịch vụ push của Google/Apple liên hệ nếu có vấn đề, không hiển thị cho người dùng thấy).

### Bước 3: Deploy lại
Sau khi deploy lại với 2 biến trên, mỗi người dùng (đặc biệt là thủ kho) cần:
1. Đăng nhập vào app như bình thường.
2. Bấm nút **"🔔 Bật thông báo"** ở góc trên bên phải màn hình (chỉ hiện nếu chưa bật).
3. Trình duyệt sẽ hỏi xin quyền gửi thông báo — chọn **Cho phép/Allow**.

Từ đó, thiết bị đó sẽ nhận được thông báo dạng noti thật của điện thoại/máy tính (có thể kèm rung, âm thanh tuỳ cài đặt máy) **ngay cả khi đã tắt hẳn trình duyệt** — miễn là chưa gỡ cài đặt hoặc chưa từ chối quyền thông báo.

**Lưu ý:**
- Mỗi thiết bị/trình duyệt phải tự bấm "Bật thông báo" riêng (ví dụ điện thoại của thủ kho Kho Tổng và điện thoại thủ kho Kho XINGFA là 2 lượt bật riêng biệt).
- Trên iPhone, tính năng này chỉ hoạt động nếu đã **"Thêm vào Màn hình chính"** (Add to Home Screen) trang web đó trước, do giới hạn của Safari/iOS. Trên Android và máy tính thì bật trực tiếp trên trình duyệt là được, không cần thêm bước này.
- Nếu không muốn dùng tính năng này, không sao cả — bỏ qua bước tạo VAPID key, app vẫn chạy bình thường với thông báo dạng banner nhỏ (toast) như trước, chỉ hoạt động khi đang mở app trên trình duyệt.

## 12. Tự động nén ảnh để tiết kiệm dung lượng lưu trữ

Vì app chủ yếu hoạt động dựa trên upload hình ảnh, mọi ảnh gửi lên (đơn hàng, xác nhận giao hàng, hàng trả...) đều được **tự động resize + nén lại** ngay khi upload:
- Giới hạn chiều rộng/cao tối đa 1600px (đủ rõ để đọc chữ trên phiếu, không cần giữ độ phân giải gốc của điện thoại).
- Nén sang định dạng JPEG chất lượng 80%.
- Tự động xoay ảnh đúng chiều theo dữ liệu EXIF (khắc phục tình trạng ảnh chụp dọc bị lưu ngang).

Kết quả: ảnh gốc từ điện thoại (thường 3-6MB) sau khi lưu thường chỉ còn **150-400KB**, giảm khoảng 10-20 lần dung lượng cần lưu trữ lâu dài, mà chất lượng vẫn đủ dùng để đọc lại thông tin trên phiếu.

Nếu về sau dung lượng vẫn tăng nhanh do số lượng đơn quá lớn, có 2 hướng tiếp theo (chưa cần làm ngay):
1. **Chuyển sang lưu trữ dạng Object Storage** (ví dụ Cloudflare R2, hoặc "Object Storage" của chính Railway) — rẻ hơn khoảng 10 lần so với Volume hiện tại, và không giới hạn cứng theo dung lượng ổ đĩa.
2. **Chính sách lưu trữ theo thời gian** — tự động xoá hoặc chuyển lưu trữ lạnh (archive) các đơn hàng quá cũ (ví dụ trên 1-2 năm) sau khi đã export/backup.

## 13. Sao lưu & khôi phục dữ liệu

Vào **Quản lý tài khoản** (chỉ tài khoản Quản lý mới thấy), mục đầu trang **"💾 Sao lưu & khôi phục dữ liệu"**:

- **Tải file sao lưu về máy:** tạo 1 file `.zip` chứa toàn bộ database (đơn hàng, tài khoản, phiếu trả hàng...) và toàn bộ hình ảnh, tải thẳng về máy tính/điện thoại. Nên làm định kỳ (ví dụ 1 lần/tuần hoặc trước khi thực hiện thay đổi lớn), lưu file này ở nơi khác (Google Drive, USB, máy tính cá nhân...) để phòng trường hợp mất dữ liệu trên server.
- **Khôi phục từ file sao lưu:** chọn lại đúng file `.zip` đã tải trước đó, hệ thống sẽ **ghi đè toàn bộ** dữ liệu hiện tại bằng dữ liệu trong file đó. Dùng khi: chuyển sang server/Railway project mới, hoặc cần quay lại đúng thời điểm đã sao lưu trước đó.

**Lưu ý quan trọng:**
- Khôi phục là thao tác **ghi đè**, không thể hoàn tác qua giao diện. Hệ thống tự động giữ lại 1 bản sao của database ngay trước khi ghi đè (lưu trong thư mục `storage/before-restore-<thời-điểm>/`) để phòng trường hợp khôi phục nhầm file — nhưng đây chỉ là lớp an toàn cuối cùng, không thay thế việc tự kiểm tra kỹ file trước khi khôi phục.
- Sau khi khôi phục thành công, server sẽ **tự khởi động lại** trong vài giây (bắt buộc để nạp lại đúng dữ liệu mới) — mọi người đang dùng app sẽ cần đăng nhập lại.
- File sao lưu càng nhiều hình ảnh thì dung lượng và thời gian tải càng lâu — bình thường, không phải lỗi.

## 14. Nhận diện tiếng Việt chính xác hơn (OCR)

Công cụ OCR (Tesseract) không dùng "font chữ" như Word — nó dùng mô hình nhận diện ngôn ngữ đã huấn luyện sẵn. App hiện dùng bản **"best" (chính xác cao nhất)** dành cho tiếng Việt, giúp đọc đúng tên khách hàng có dấu tốt hơn bản tiêu chuẩn — đổi lại xử lý chậm hơn một chút (thường vẫn chỉ vài giây/hình).

Nếu sau này thấy quá trình quét hình bị chậm rõ rệt và muốn đổi lại về bản tiêu chuẩn (nhanh hơn, độ chính xác thấp hơn một chút), thêm biến môi trường:
```
OCR_USE_BEST=0
```
rồi deploy lại.

## 15. Đăng đơn hàng: chỉ lưu khi bấm xác nhận

Trước đây, ngay khi chọn/chụp hình là đơn hàng đã được tạo trong hệ thống (dù chưa xác nhận tên khách). Giờ luồng đã đổi lại:
- Chọn/chụp hình → hệ thống chỉ **đọc thử (OCR)** và hiện gợi ý tên khách + mã đơn, **CHƯA lưu gì vào hệ thống**.
- Chỉ khi bấm **"Xác nhận & Lưu đơn hàng"**, đơn mới thật sự được tạo.
- Nút **"↺ Làm lại"** bên cạnh: xoá hình vừa chọn, dọn dẹp file tạm trên server, đưa form về trạng thái ban đầu — dùng khi lỡ chụp/chọn nhầm hình trước khi lưu.

Nhờ vậy, nếu sales chụp thử/xem trước rồi đổi ý, hệ thống sẽ không còn tạo ra các đơn hàng rác/dở dang nữa.

## 16. Phân quyền chi tiết theo từng người (nâng cao)

Ngoài 3 vai trò cố định (Sales / Thủ kho / Quản lý), Quản lý (leader) có thể **cấp thêm quyền riêng cho từng người cụ thể** mà không cần đổi hẳn vai trò của họ. Vào **Quản lý tài khoản** → bấm vào 1 tài khoản → cuối form sẽ có mục **"Quyền riêng"** (chỉ Quản lý mới thấy mục này):

- **📊 Xem tổng quan** — cho phép người này vào xem trang Tổng quan như quản lý (xem toàn bộ đơn hàng mọi kho).
- **🗑️ Xoá mọi đơn** — cho phép xoá bất kỳ đơn hàng nào, không chỉ đơn do chính mình tạo và còn "chờ soạn hàng".
- **👥 Quản trị** — cho phép vào trang Quản lý tài khoản (tạo/sửa tài khoản, quản lý kho, tải file sao lưu). Vì lý do an toàn, riêng việc **khôi phục** dữ liệu (ghi đè toàn bộ) vẫn luôn giữ riêng cho Quản lý thật, không cấp được qua quyền này.

**Lưu ý an toàn quan trọng:** chỉ tài khoản có vai trò **Quản lý (leader) thật** mới được cấp/gỡ các quyền riêng này cho người khác — một người chỉ được cấp quyền "Quản trị" sẽ không tự cấp thêm quyền cho mình hoặc người khác được, tránh tình trạng tự leo thang quyền.

## 17. Một tài khoản có thể kiêm nhiều vai trò

Trước đây mỗi tài khoản chỉ được gán đúng 1 vai trò (Sales HOẶC Thủ kho HOẶC Quản lý). Giờ khi tạo/sửa tài khoản trong **Quản lý tài khoản**, ô "Vai trò" là **checkbox chọn được nhiều lựa chọn cùng lúc** — ví dụ 1 người vừa tick "Sales" vừa tick "Thủ kho" sẽ:
- Thấy đủ cả tab "Đăng đơn", "Đơn hàng" (của Sales) và "Xử lý kho" (của Thủ kho).
- Khi vào "Xử lý kho", tự động thấy đúng đơn hàng của kho mình phụ trách (cần chọn Kho phụ trách khi tick vai trò Thủ kho).

Nếu tick thêm cả vai trò "Quản lý" cùng 1-2 vai trò khác, hệ thống sẽ ưu tiên xử lý người đó như Quản lý ở những chỗ cần phân biệt (ví dụ xem được toàn bộ đơn hàng mọi kho, không bị giới hạn theo 1 kho).

**Lưu ý:** người dùng cần **đăng xuất và đăng nhập lại** sau khi được đổi vai trò để giao diện cập nhật đúng (vai trò được lưu trong phiên đăng nhập).
