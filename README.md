# 🏙️ IOC Flood Monitoring System — TDTU District 7

Hệ thống giám sát ngập lụt thời gian thực cho Quận 7, TPHCM.

---

## 📁 Cấu trúc thư mục

```
iot-project/
├── server.js          ← Backend (Node.js + Express)
├── package.json       ← Dependencies
├── .env               ← Cấu hình (tự tạo từ .env.example)
├── .env.example       ← Mẫu cấu hình
└── public/
    ├── index.html     ← Dashboard chính
    ├── admin.html     ← Trang quản trị
    ├── login.html     ← Đăng nhập
    └── register.html  ← Đăng ký
```

---

## ⚙️ Yêu cầu hệ thống

| Phần mềm | Phiên bản | Tải về |
|----------|-----------|--------|
| Node.js  | >= 18.x   | https://nodejs.org |
| MongoDB  | >= 6.x    | https://mongodb.com/try/download |
| MQTT Broker | Mosquitto | https://mosquitto.org |

---

## 🚀 Hướng dẫn cài đặt

### Bước 1 — Cài đặt dependencies

```bash
cd iot-project
npm install
```

### Bước 2 — Tạo file `.env`

Sao chép file mẫu và điền thông tin thật:

```bash
cp .env.example .env
```

Mở `.env` và chỉnh sửa:

```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/iot_commercial
SESSION_SECRET=thay_bang_chuoi_ngau_nhien_dai_va_phuc_tap
GMAIL_USER=email_cua_ban@gmail.com
GMAIL_PASS=mat_khau_ung_dung_gmail
MQTT_BROKER=mqtt://192.168.1.2
OTP_EXPIRE_MINUTES=10
```

> **Lấy Gmail App Password:**
> 1. Vào https://myaccount.google.com/security
> 2. Bật "2-Step Verification"
> 3. Tìm "App passwords" → tạo mới → chọn "Mail"
> 4. Dán 16 ký tự vào `GMAIL_PASS`

### Bước 3 — Khởi động MongoDB

**Windows:**
```bash
net start MongoDB
```

**macOS/Linux:**
```bash
sudo systemctl start mongod
# hoặc
mongod --dbpath /data/db
```

### Bước 4 — Khởi động MQTT Broker (Mosquitto)

**Windows:**
```bash
net start mosquitto
```

**macOS/Linux:**
```bash
sudo systemctl start mosquitto
```

> Nếu broker MQTT ở máy khác, sửa `MQTT_BROKER` trong `.env` thành IP đúng.

### Bước 5 — Chạy server

```bash
# Production
npm start

# Development (tự reload khi sửa code)
npm run dev
```

Mở trình duyệt: **http://localhost:3000**

---

## 👤 Tạo tài khoản Admin đầu tiên

Sau khi đăng ký tài khoản qua giao diện web, vào MongoDB để nâng quyền:

```bash
mongosh
use iot_commercial
db.users.updateOne({ email: "email_cua_ban@gmail.com" }, { $set: { role: "ADMIN" } })
```

Hoặc sau khi có 1 Admin, dùng trang `/admin` để nâng quyền các tài khoản khác.

---

## 📡 Cấu trúc MQTT Topics

| Topic | Hướng | Mô tả |
|-------|-------|-------|
| `hcm/quan_7/tan_phong/{node_id}/data` | Uplink (ESP32 → Server) | Gửi dữ liệu cảm biến |
| `hcm/quan_7/tan_phong/{node_id}/control` | Downlink (Server → ESP32) | Nhận lệnh điều khiển |

### Format dữ liệu cảm biến (JSON):

```json
{
  "node_id": "node_q7_01",
  "water_level_cm": 15.3,
  "temp": 28.5,
  "humi": 75.2,
  "light": 450
}
```

### Format lệnh điều khiển:

```json
{
  "device": "siren",
  "state": 1
}
```

---

## 🌐 API Endpoints

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| POST | `/api/register-step-1` | — | Gửi OTP đăng ký |
| POST | `/api/register-verify` | — | Xác thực OTP |
| POST | `/api/login` | — | Đăng nhập |
| GET | `/api/me` | User | Thông tin user hiện tại |
| GET | `/api/stations` | User | Danh sách trạm |
| GET | `/api/sensor/latest/:node_id` | User | Dữ liệu mới nhất |
| GET | `/api/sensor/history/:node_id` | User | Lịch sử (query: `?limit=20`) |
| POST | `/api/admin/add-station` | Admin | Thêm trạm |
| DELETE | `/api/admin/station/:node_id` | Admin | Xóa trạm |
| POST | `/api/admin/control` | Admin | Điều khiển thiết bị |
| GET | `/api/admin/users` | Admin | Danh sách users |
| POST | `/api/admin/set-role` | Admin | Đổi role user |

---

## 🔐 Tính năng bảo mật

- ✅ Mật khẩu mã hóa bcrypt (salt rounds: 12)
- ✅ Session-based authentication (server-side)
- ✅ Rate limiting: 20 req/15 phút (auth), 3 req/phút (OTP)
- ✅ OTP hết hạn sau 10 phút
- ✅ Credentials trong `.env` (không hardcode)
- ✅ Input validation đầy đủ
- ✅ Role-based access control (USER / ADMIN)

---

## ❓ Troubleshooting

**Lỗi "MongoDB Error":**
- Kiểm tra MongoDB đang chạy: `mongosh --eval "db.adminCommand('ping')"`

**Lỗi "MQTT Error":**
- Kiểm tra IP broker trong `.env`
- Kiểm tra broker đang chạy và không có firewall block port 1883

**Không nhận được email OTP:**
- Kiểm tra `GMAIL_USER` và `GMAIL_PASS` trong `.env`
- Đảm bảo đã tạo App Password (không phải mật khẩu Gmail thường)
- Kiểm tra folder Spam của người nhận
