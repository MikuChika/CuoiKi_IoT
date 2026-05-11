require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const mqtt = require('mqtt');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ─────────────────────────────────────────────
// 1. CẤU HÌNH HỆ THỐNG
// ─────────────────────────────────────────────
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000, httpOnly: true }
}));

// Rate limiting - chống brute force
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 20,
    message: { success: false, message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.' }
});
const otpLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 phút
    max: 3,
    message: { success: false, message: 'Gửi OTP quá nhiều lần. Thử lại sau 1 phút.' }
});

// ─────────────────────────────────────────────
// 2. DATABASE MODELS
// ─────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/iot_commercial')
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));

const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true, trim: true },
    email: { type: String, unique: true, required: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, default: 'USER', enum: ['USER', 'ADMIN'] },
    createdAt: { type: Date, default: Date.now }
}));

const Station = mongoose.model('Station', new mongoose.Schema({
    node_id: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    threshold_cm: { type: Number, default: 30 },
    active: { type: Boolean, default: true }
}));

const SensorData = mongoose.model('SensorData', new mongoose.Schema({
    node_id: { type: String, required: true, index: true },
    water_level_cm: { type: Number, default: 0 },
    temp: { type: Number, default: 0 },
    humi: { type: Number, default: 0 },
    light: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now, index: true }
}));

// ─────────────────────────────────────────────
// 3. EMAIL CONFIG
// ─────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});

// Lưu OTP tạm thời với thời gian hết hạn
const tempUsers = {};
const OTP_EXPIRE_MS = (parseInt(process.env.OTP_EXPIRE_MINUTES) || 10) * 60 * 1000;

function cleanupTempUser(email) {
    setTimeout(() => { delete tempUsers[email]; }, OTP_EXPIRE_MS);
}

// ─────────────────────────────────────────────
// 4. MIDDLEWARE BẢO MẬT & PHÂN QUYỀN
// ─────────────────────────────────────────────
const checkAuth = (req, res, next) => {
    if (req.session.loggedIn) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ success: false, message: 'Chưa đăng nhập!' });
    res.redirect('/login.html');
};

const checkAdmin = (req, res, next) => {
    if (req.session.loggedIn && req.session.role === 'ADMIN') return next();
    res.status(403).json({ success: false, message: 'Quyền Admin yêu cầu!' });
};

// ─────────────────────────────────────────────
// 5. API AUTH
// ─────────────────────────────────────────────
app.post('/api/register-step-1', otpLimiter, async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.json({ success: false, message: 'Thiếu thông tin!' });
        if (password.length < 6) return res.json({ success: false, message: 'Mật khẩu ít nhất 6 ký tự!' });

        const existing = await User.findOne({ email: email.toLowerCase() });
        if (existing) return res.json({ success: false, message: 'Email đã được sử dụng!' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        tempUsers[email.toLowerCase()] = { username: username.trim(), password, otp, createdAt: Date.now() };
        cleanupTempUser(email.toLowerCase());

        await transporter.sendMail({
            from: `"IOC TDTU System" <${process.env.GMAIL_USER}>`,
            to: email,
            subject: 'Mã OTP Xác Thực Tài Khoản IOC',
            html: `
                <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#0f172a;color:white;border-radius:16px;overflow:hidden;">
                    <div style="padding:32px 32px 16px;background:#1e293b;">
                        <h2 style="color:#38bdf8;margin:0 0 8px">IOC TDTU - Xác Thực OTP</h2>
                        <p style="color:#94a3b8;margin:0">Hệ thống giám sát ngập lụt Quận 7</p>
                    </div>
                    <div style="padding:32px;">
                        <p style="color:#cbd5e1">Xin chào <strong>${username}</strong>, đây là mã OTP của bạn:</p>
                        <div style="background:#0f172a;border:2px solid #38bdf8;border-radius:12px;padding:20px;text-align:center;margin:24px 0;">
                            <span style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#38bdf8;">${otp}</span>
                        </div>
                        <p style="color:#64748b;font-size:13px;">Mã hết hạn sau ${process.env.OTP_EXPIRE_MINUTES || 10} phút. Không chia sẻ mã này với ai.</p>
                    </div>
                </div>
            `
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Register step 1 error:', err);
        res.json({ success: false, message: 'Lỗi gửi email. Kiểm tra cấu hình Gmail!' });
    }
});

app.post('/api/register-verify', authLimiter, async (req, res) => {
    try {
        const { email, otp } = req.body;
        const userData = tempUsers[email?.toLowerCase()];

        if (!userData) return res.json({ success: false, message: 'Phiên OTP đã hết hạn. Vui lòng đăng ký lại!' });
        if (Date.now() - userData.createdAt > OTP_EXPIRE_MS) {
            delete tempUsers[email.toLowerCase()];
            return res.json({ success: false, message: 'OTP đã hết hạn!' });
        }
        if (userData.otp !== otp) return res.json({ success: false, message: 'Sai OTP!' });

        const hashedPassword = await bcrypt.hash(userData.password, 12);
        await User.create({ username: userData.username, email: email.toLowerCase(), password: hashedPassword });
        delete tempUsers[email.toLowerCase()];
        res.json({ success: true });
    } catch (err) {
        console.error('Register verify error:', err);
        if (err.code === 11000) return res.json({ success: false, message: 'Email đã tồn tại!' });
        res.json({ success: false, message: 'Lỗi server!' });
    }
});

app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.json({ success: false, message: 'Thiếu thông tin!' });

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.json({ success: false, message: 'Sai email hoặc mật khẩu!' });
        }

        req.session.loggedIn = true;
        req.session.role = user.role;
        req.session.email = user.email;
        req.session.username = user.username;
        res.json({ success: true, role: user.role, username: user.username });
    } catch (err) {
        console.error('Login error:', err);
        res.json({ success: false, message: 'Lỗi server!' });
    }
});

app.get('/api/me', checkAuth, (req, res) => {
    res.json({ username: req.session.username, role: req.session.role, email: req.session.email });
});

// ─────────────────────────────────────────────
// 6. API STATIONS & SENSOR DATA
// ─────────────────────────────────────────────
app.get('/api/stations', checkAuth, async (req, res) => {
    res.json(await Station.find({ active: true }));
});

app.get('/api/sensor/latest/:node_id', checkAuth, async (req, res) => {
    const data = await SensorData.findOne({ node_id: req.params.node_id }).sort({ timestamp: -1 });
    res.json(data || {});
});

app.get('/api/sensor/history/:node_id', checkAuth, async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const data = await SensorData.find({ node_id: req.params.node_id })
        .sort({ timestamp: -1 }).limit(limit).select('water_level_cm temp humi timestamp');
    res.json(data.reverse());
});

// ─────────────────────────────────────────────
// 7. API ADMIN
// ─────────────────────────────────────────────
app.get('/api/admin/users', checkAdmin, async (req, res) => {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
});

app.post('/api/admin/add-station', checkAdmin, async (req, res) => {
    try {
        const { node_id, name, lat, lng, threshold_cm } = req.body;
        if (!node_id || !name || !lat || !lng) return res.json({ success: false, message: 'Thiếu thông tin trạm!' });
        await Station.create({
            node_id: node_id.trim(),
            name: name.trim(),
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            threshold_cm: parseInt(threshold_cm) || 30
        });
        res.json({ success: true });
    } catch (err) {
        if (err.code === 11000) return res.json({ success: false, message: 'Node ID đã tồn tại!' });
        res.json({ success: false, message: 'Lỗi thêm trạm!' });
    }
});

app.delete('/api/admin/station/:node_id', checkAdmin, async (req, res) => {
    await Station.findOneAndUpdate({ node_id: req.params.node_id }, { active: false });
    res.json({ success: true });
});

app.post('/api/admin/set-role', checkAdmin, async (req, res) => {
    const { email, role } = req.body;
    if (!['USER', 'ADMIN'].includes(role)) return res.json({ success: false, message: 'Role không hợp lệ!' });
    await User.findOneAndUpdate({ email }, { role });
    res.json({ success: true });
});

// ─────────────────────────────────────────────
// 8. ĐIỀU KHIỂN THIẾT BỊ (DOWNLINK)
// ─────────────────────────────────────────────
app.post('/api/admin/control', checkAdmin, (req, res) => {
    const { node_id, device, state } = req.body;
    if (!node_id || !device || state === undefined) return res.json({ success: false, message: 'Thiếu thông tin điều khiển!' });

    const topic = `hcm/quan_7/tan_phong/${node_id}/control`;
    mqttClient.publish(topic, JSON.stringify({ device, state }), { qos: 1 }, (err) => {
        if (err) return res.json({ success: false, message: 'Không gửi được lệnh MQTT!' });
        io.emit('device_control_ack', { node_id, device, state, by: req.session.email });
        res.json({ success: true });
    });
});

// ─────────────────────────────────────────────
// 9. MQTT
// ─────────────────────────────────────────────
const mqttClient = mqtt.connect(process.env.MQTT_BROKER || 'mqtt://192.168.1.2');

mqttClient.on('connect', () => {
    console.log('✅ MQTT Connected');
    mqttClient.subscribe('hcm/quan_7/tan_phong/#', { qos: 1 });
});

mqttClient.on('error', (err) => {
    console.error('❌ MQTT Error:', err.message);
});

mqttClient.on('offline', () => console.warn('⚠️  MQTT Offline'));

mqttClient.on('message', async (topic, message) => {
    try {
        // Bỏ qua topic điều khiển (downlink)
        if (topic.endsWith('/control')) return;

        const data = JSON.parse(message.toString());
        if (!data.node_id) return;

        // Lưu database
        await SensorData.create({
            node_id: data.node_id,
            water_level_cm: Number(data.water_level_cm) || 0,
            temp: Number(data.temp) || 0,
            humi: Number(data.humi) || 0,
            light: Number(data.light) || 0
        });

        // Broadcast realtime
        io.emit('flood_data', data);

        // Kiểm tra ngưỡng cảnh báo
        const station = await Station.findOne({ node_id: data.node_id });
        if (station && data.water_level_cm >= station.threshold_cm) {
            io.emit('flood_alert', {
                node_id: data.node_id,
                station_name: station.name,
                water_level_cm: data.water_level_cm,
                threshold_cm: station.threshold_cm,
                timestamp: new Date()
            });
        }
    } catch (err) {
        console.error('❌ MQTT message error:', err.message);
    }
});

// ─────────────────────────────────────────────
// 10. SOCKET.IO
// ─────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('📡 Client connected:', socket.id);
    // Relay video stream từ camera node
    socket.on('video_frame', (data) => socket.broadcast.emit('stream_display', data));
    socket.on('disconnect', () => console.log('📡 Client disconnected:', socket.id));
});

// ─────────────────────────────────────────────
// 11. STATIC & ROUTES
// ─────────────────────────────────────────────
app.get('/', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/admin', checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login.html'); });
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server: http://localhost:${PORT}`));
