const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const bcrypt = require('bcrypt');
const NodeCache = require('node-cache');
const sanitizeHtml = require('sanitize-html');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_TTL = 24 * 60 * 60; // Cache for 24 hours
const cache = new NodeCache({ stdTTL: CACHE_TTL });

const cors = require('cors');

// Database configuration
const pool = new Pool({
    user: 'edufair',
    host: 'eilapgsql.in.psu.ac.th',
    database: 'edufair',
    password: 'n8&U{s{332',
    port: 5432,
});
app.use(cors({
    origin: 'http://127.0.0.1:5502',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${sanitizeHtml(req.body.username)}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const validTypes = ['image/jpeg', 'image/png'];
        if (validTypes.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only JPEG and PNG images are allowed'));
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(`Error in ${req.method} ${req.url}:`, err.stack);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Sanitize input middleware
const sanitizeInput = (req, res, next) => {
    for (const key in req.body) {
        if (typeof req.body[key] === 'string') {
            req.body[key] = sanitizeHtml(req.body[key], { allowedTags: [], allowedAttributes: {} });
        }
    }
    next();
};

// ----- Database Setup -----
app.post('/setup', async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`
            CREATE TABLE IF NOT EXISTS Type (
                type_id TEXT PRIMARY KEY,
                type_name TEXT NOT NULL,
                price DECIMAL NOT NULL,
                type_start TIMESTAMP NOT NULL,
                type_end TIMESTAMP NOT NULL
            );
            CREATE TABLE IF NOT EXISTS Institute (
                institute_name TEXT PRIMARY KEY,
                type_id TEXT REFERENCES Type(type_id)
            );
            CREATE TABLE IF       NOT EXISTS "User" (
                user_id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                full_name TEXT, -- Changed from name
                email TEXT UNIQUE NOT NULL,
                phone TEXT,
                organization_phone TEXT, -- Changed from fax
                institute_name TEXT REFERENCES Institute(institute_name),
                position TEXT,
                affiliation TEXT, -- Changed from department
                profile_image TEXT
            );
            CREATE TABLE IF NOT EXISTS Booth (
                booth_id TEXT PRIMARY KEY,
                location TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'available'
            );
            CREATE TABLE IF NOT EXISTS Electricity (
                electricity_quantity INTEGER PRIMARY KEY,
                electricity_price DECIMAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS Config (
                config_id SERIAL PRIMARY KEY,
                booth_max INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS Booking (
                booking_id TEXT PRIMARY KEY,
                booth_id TEXT REFERENCES Booth(booth_id),
                booth_quantity INTEGER NOT NULL,
                booking_datetime TIMESTAMP NOT NULL,
                booth_nameplate TEXT NOT NULL,
                amount DECIMAL NOT NULL,
                booking_status TEXT NOT NULL,
                electricity_request BOOLEAN NOT NULL,
                electricity_quantity INTEGER REFERENCES Electricity(electricity_quantity),
                staff_count INTEGER NOT NULL,
                user_id TEXT REFERENCES "User"(user_id),
                payment_status TEXT NOT NULL
            );
        `);
        await client.query('COMMIT');
        console.log('Database setup completed');
        res.status(201).json({ message: 'Database initialized' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Setup error:', err);
        next(err);
    } finally {
        client.release();
    }
});

// ----- User Table -----
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Login attempt:', { username, password: password ? '[HIDDEN]' : 'undefined' });
    try {
        if (!username || !password) {
            console.log('Login failed: Missing username or password');
            return res.status(400).json({ error: 'ต้องระบุชื่อผู้ใช้และรหัสผ่าน' });
        }
        const result = await pool.query(
            'SELECT user_id, username, role, full_name, email, institute_name, password FROM "User" WHERE username = $1',
            [username]
        );
        if (result.rowCount === 0) {
            console.log('Login failed: User not found');
            return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }
        const user = result.rows[0];
        if (password !== user.password) {
            console.log('Login failed: Incorrect password', {
                inputPassword: password,
                storedPassword: user.password
            });
            return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }
        console.log('Login successful:', { username, role: user.role });
        // ลบ password ออกจาก response
        const { password: _, ...userWithoutPassword } = user;
        res.json({ message: 'ล็อกอินสำเร็จ', user: userWithoutPassword });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการล็อกอิน: ' + err.message });
    }
});
// GET: Fetch user data
app.get('/user', sanitizeInput, async (req, res, next) => {
    const { user_id } = req.query;
    console.log('Fetching user:', { user_id });
    try {
        const result = await pool.query(
            'SELECT user_id, username, role, full_name, email, phone, organization_phone, institute_name, position, affiliation, profile_image FROM "User" WHERE user_id = $1',
            [user_id]
        );
        if (result.rowCount === 0) {
            console.log('User not found:', { user_id });
            return res.status(404).json({ error: 'User not found' });
        }
        console.log('User fetched:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('User fetch error:', err);
        next(err);
    }
});

// PUT: Update user data
app.put('/user', sanitizeInput, async (req, res, next) => {
    const { user_id, username, email, password, full_name, phone, organization_phone, institute_name, position, affiliation } = req.body;
    console.log('Updating user:', { user_id, username, email, institute_name });
    try {
        const checkUser = await pool.query('SELECT 1 FROM "User" WHERE username = $1 AND user_id != $2', [username, user_id]);
        if (checkUser.rowCount > 0) {
            console.log('Update failed: Username already exists');
            return res.status(400).json({ error: 'Username already exists' });
        }
        const updates = [];
        const values = [];
        let index = 1;
        if (username) {
            updates.push(`username = $${index++}`);
            values.push(username);
        }
        if (email) {
            updates.push(`email = $${index++}`);
            values.push(email);
        }
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updates.push(`password = $${index++}`);
            values.push(hashedPassword);
        }
        if (full_name) {
            updates.push(`full_name = $${index++}`);
            values.push(full_name);
        }
        if (phone) {
            updates.push(`phone = $${index++}`);
            values.push(phone);
        }
        if (organization_phone) {
            updates.push(`organization_phone = $${index++}`);
            values.push(organization_phone);
        }
        if (institute_name) {
            updates.push(`institute_name = $${index++}`);
            values.push(institute_name);
        }
        if (position) {
            updates.push(`position = $${index++}`);
            values.push(position);
        }
        if (affiliation) {
            updates.push(`affiliation = $${index++}`);
            values.push(affiliation);
        }
        values.push(user_id);
        const query = `UPDATE "User" SET ${updates.join(', ')} WHERE user_id = $${index} RETURNING *`;
        console.log('Executing update query:', query, values);
        const result = await pool.query(query, values);
        if (result.rowCount === 0) {
            console.log('Update failed: User not found');
            return res.status(404).json({ error: 'User not found' });
        }
        console.log('User updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('User update error:', err);
        next(err);
    }
});

// ----- Registration -----
app.post('/register', upload.single('profile_image'), sanitizeInput, async (req, res, next) => {
    const { username, password, email, full_name, phone, organization_phone, institute_name, position, affiliation } = req.body;
    const profile_image = req.file ? `/uploads/${req.file.filename}` : null;
    console.log('Registration attempt:', {
        username,
        email,
        institute_name,
        full_name,
        phone,
        organization_phone,
        position,
        affiliation,
        profile_image,
        password_length: password ? password.length : 'undefined'
    });

    try {
        // Validate input
        console.log('Validating registration input');
        if (!username || username.length < 3) {
            console.log('Validation failed: Username too short');
            if (profile_image && fs.existsSync(path.join(__dirname, 'public', profile_image))) {
                fs.unlinkSync(path.join(__dirname, 'public', profile_image));
            }
            return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร' });
        }
        if (!password || password.length < 6) {
            console.log('Validation failed: Password invalid');
            if (profile_image && fs.existsSync(path.join(__dirname, 'public', profile_image))) {
                fs.unlinkSync(path.join(__dirname, 'public', profile_image));
            }
            return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
        }
        if (!email || !email.includes('@')) {
            console.log('Validation failed: Invalid email');
            if (profile_image && fs.existsSync(path.join(__dirname, 'public', profile_image))) {
                fs.unlinkSync(path.join(__dirname, 'public', profile_image));
            }
            return res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
        }
        if (!institute_name) {
            console.log('Validation failed: Institute name required');
            if (profile_image && fs.existsSync(path.join(__dirname, 'public', profile_image))) {
                fs.unlinkSync(path.join(__dirname, 'public', profile_image));
            }
            return res.status(400).json({ error: 'ต้องระบุชื่อสถาบัน' });
        }
        if (!full_name) {
            console.log('Validation failed: Full name required');
            if (profile_image && fs.existsSync(path.join(__dirname, 'public', profile_image))) {
                fs.unlinkSync(path.join(__dirname, 'public', profile_image));
            }
            return res.status(400).json({ error: 'ต้องระบุชื่อ-สกุล' });
        }

        // Check if username or email exists
        console.log('Checking for existing user:', { username, email });
        const existingUser = await pool.query(
            'SELECT username, email FROM "User" WHERE username = $1 OR email = $2',
            [username, email]
        );
        if (existingUser.rowCount > 0) {
            console.log('Validation failed: Username or email already exists');
            const existing = existingUser.rows[0];
            const errorMessage = existing.username === username && existing.email === email
                ? 'ชื่อผู้ใช้และอีเมลนี้มีอยู่ในระบบแล้ว'
                : existing.username === username
                ? 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว'
                : 'อีเมลนี้มีอยู่ในระบบแล้ว';
            if (profile_image && fs.existsSync(path.join(__dirname, 'public', profile_image))) {
                fs.unlinkSync(path.join(__dirname, 'public', profile_image));
            }
            return res.status(400).json({ error: errorMessage });
        }

        // Verify institute exists
        console.log('Verifying institute:', { institute_name });
        const instituteResult = await pool.query(
            'SELECT institute_name FROM Institute WHERE institute_name = $1',
            [institute_name]
        );
        if (instituteResult.rowCount === 0) {
            console.log('Validation failed: Institute does not exist');
            if (profile_image && fs.existsSync(path.join(__dirname, 'public', profile_image))) {
                fs.unlinkSync(path.join(__dirname, 'public', profile_image));
            }
            return res.status(400).json({ error: 'สถาบันที่เลือกไม่มีอยู่ในระบบ' });
        }

        // Use plaintext password (WARNING: Not secure)
        console.log('Storing plaintext password (insecure)');
        const storedPassword = password; // เก็บรหัสผ่านแบบ plaintext

        // Insert user
        console.log('Inserting user:', { username, email, full_name, phone, organization_phone, institute_name, position, affiliation, profile_image });
        const query = 'INSERT INTO "User" (username, password, role, full_name, email, phone, organization_phone, institute_name, position, affiliation, profile_image) ' +
                      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *';
        const values = [
            username,
            storedPassword,
            'user',
            full_name,
            email,
            phone || null,
            organization_phone || null,
            institute_name,
            position || null,
            affiliation || null,
            profile_image
        ];
        console.log('Executing insert query:', query, values);
        const result = await pool.query(query, values);
        console.log('User registered:', result.rows[0]);

        res.status(201).json({ message: 'สมัครสมาชิกสำเร็จ' });
    } catch (err) {
        if (profile_image && fs.existsSync(path.join(__dirname, 'public', profile_image))) {
            fs.unlinkSync(path.join(__dirname, 'public', profile_image));
            console.log('Cleaned up uploaded image:', profile_image);
        }
        console.error('Registration error:', err);
        if (err.code === '42703') {
            console.error('Schema error: Column missing in User table');
            return res.status(500).json({ error: 'ข้อผิดพลาดของฐานข้อมูล: คอลัมน์ในตาราง User ไม่ถูกต้อง' });
        }
        if (err.code === '23505') {
            console.error('Unique constraint violation:', err.detail);
            const errorMessage = err.detail.includes('username')
                ? 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว'
                : err.detail.includes('email')
                ? 'อีเมลนี้มีอยู่ในระบบแล้ว'
                : 'ชื่อผู้ใช้หรืออีเมลนี้มีอยู่ในระบบแล้ว';
            return res.status(400).json({ error: errorMessage });
        }
        if (err.code === '23503') {
            console.error('Foreign key violation:', err.detail);
            return res.status(400).json({ error: 'สถาบันที่เลือกไม่มีอยู่ในระบบ' });
        }
        if (err.code === '22001') {
            console.error('String too long error:', {
                message: err.message,
                detail: err.detail,
                column: err.column || 'unknown'
            });
            return res.status(400).json({
                error: 'ข้อมูลที่กรอกยาวเกินกว่าที่ระบบรองรับ',
                details: 'กรุณาลดความยาวของข้อมูล เช่น อีเมล, ชื่อสถาบัน, หรือพาธรูปโปรไฟล์'
            });
        }
        return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสมัครสมาชิก: ' + err.message });
    }
});
app.get('/users/:user_id', sanitizeInput, async (req, res, next) => {
    const { user_id } = req.params;
    console.log('Fetching user by user_id:', { user_id });
    try {
        const result = await pool.query(
            'SELECT user_id, username, role, full_name, email, phone, organization_phone, institute_name, position, affiliation, profile_image FROM "User" WHERE user_id = $1',
            [user_id]
        );
        if (result.rowCount === 0) {
            console.log('User not found:', { user_id });
            return res.status(404).json({ error: 'User not found' });
        }
        let user = result.rows[0];
        // ตรวจสอบว่าไฟล์ profile_image มีจริงหรือไม่
        if (user.profile_image) {
            const imagePath = path.join(__dirname, 'public', user.profile_image);
            if (!fs.existsSync(imagePath)) {
                user.profile_image = 'https://via.placeholder.com/150'; // Fallback ถ้าไฟล์ไม่มี
            }
        }
        console.log('User fetched:', user);
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (err) {
        console.error('User fetch error:', err);
        next(err);
    }
});
const requireAdmin = async (req, res, next) => {
    const { user_id } = req.body;
    if (!user_id) {
        return res.status(401).json({ error: 'ต้องระบุ user_id' });
    }
    try {
        const result = await pool.query('SELECT role FROM "User" WHERE user_id = $1', [user_id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
        }
        if (result.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'ต้องเป็นผู้ดูแลระบบเท่านั้น' });
        }
        next();
    } catch (err) {
        console.error('Admin check error:', err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์' });
    }
};
// ----- Type Table -----
app.get('/types', async (req, res, next) => {
    console.log('Fetching all types');
    try {
        const result = await pool.query('SELECT * FROM Type');
        console.log('Types fetched:', result.rows);
        res.json(result.rows);
    } catch (err) {
        console.error('Types fetch error:', err);
        next(err);
    }
});

app.get('/types/:type_id', async (req, res, next) => {
    const { type_id } = req.params;
    console.log('Fetching type:', { type_id });
    try {
        const result = await pool.query('SELECT * FROM Type WHERE type_id = $1', [type_id]);
        if (result.rowCount === 0) {
            console.log('Type not found:', { type_id });
            return res.status(404).json({ error: 'Type not found' });
        }
        console.log('Type fetched:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Type fetch error:', err);
        next(err);
    }
});

app.put('/types/:type_id', sanitizeInput, async (req, res, next) => {
    const { type_id } = req.params;
    const { type_name, price, type_start, type_end } = req.body;
    console.log('Updating type:', { type_id, type_name, price, type_start, type_end });
    try {
        const newStart = new Date(type_start);
        const newEnd = new Date(type_end);
        if (newStart >= newEnd) {
            console.log('Update failed: Invalid date range');
            return res.status(400).json({ error: 'Start time must be before end time' });
        }
        const result = await pool.query(
            'UPDATE Type SET type_name = $1, price = $2, type_start = $3, type_end = $4 WHERE type_id = $5 RETURNING *',
            [type_name, price, type_start, type_end, type_id]
        );
        if (result.rowCount === 0) {
            console.log('Update failed: Type not found');
            return res.status(404).json({ error: 'Type not found' });
        }
        console.log('Type updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Type update error:', err);
        next(err);
    }
});

// ----- Institute Table -----
app.get('/institutes/:institute_name', async (req, res, next) => {
    const { institute_name } = req.params;
    console.log('Fetching institute:', { institute_name });
    try {
        const result = await pool.query('SELECT * FROM Institute WHERE institute_name = $1', [decodeURIComponent(institute_name)]);
        if (result.rowCount === 0) {
            console.log('Institute not found:', { institute_name });
            return res.status(404).json({ error: 'Institute not found' });
        }
        console.log('Institute fetched:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Institute fetch error:', err);
        next(err);
    }
});

app.get('/institutes', async (req, res, next) => {
    try {
        console.log('Handling GET /institutes');
        let institutes = cache.get('institutes');
        if (!institutes) {
            try {
                const result = await pool.query('SELECT institute_name FROM Institute ORDER BY institute_name');
                institutes = result.rows;
                console.log('Fetched institutes from database:', institutes);
            } catch (dbErr) {
                console.error('Database query failed:', dbErr);
            }
            if (!institutes || institutes.length === 0) {
                console.log('No institutes in database, fetching from Hipolabs API');
                try {
                    const response = await axios.get('http://universities.hipolabs.com/search?country=Thailand');
                    institutes = response.data.map(uni => ({ institute_name: uni.name }));
                    console.log('Fetched institutes from API:', institutes);
                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');
                        for (const inst of institutes) {
                            const type_id = inst.institute_name.includes('Prince of Songkla') ? 'T002' : 'T003';
                            await client.query(
                                'INSERT INTO Institute (institute_name, type_id) VALUES ($1, $2) ON CONFLICT (institute_name) DO NOTHING',
                                [inst.institute_name, type_id]
                            );
                        }
                        await client.query('COMMIT');
                        console.log('Saved institutes to database');
                    } catch (saveErr) {
                        await client.query('ROLLBACK');
                        console.error('Error saving API institutes:', saveErr);
                    } finally {
                        client.release();
                    }
                    cache.set('institutes', institutes);
                } catch (apiErr) {
                    console.error('API fetch failed:', apiErr);
                    return res.status(503).json({ error: 'Unable to fetch institutes from external API' });
                }
            }
        }
        res.status(200).json(institutes);
    } catch (err) {
        console.error('Error fetching institutes:', err);
        next(err);
    }
});

app.post('/institutes', sanitizeInput, async (req, res, next) => {
    const { institute_name, type_id = 'T003' } = req.body;
    console.log('Adding institute:', { institute_name, type_id });
    try {
        const result = await pool.query(
            'INSERT INTO Institute (institute_name, type_id) VALUES ($1, $2) ON CONFLICT (institute_name) DO NOTHING RETURNING *',
            [institute_name, type_id]
        );
        if (result.rowCount === 0) {
            console.log('Institute already exists:', { institute_name });
            return res.status(200).json({ message: 'Institute already exists' });
        }
        cache.del('institutes');
        console.log('Institute added:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Institute add error:', err);
        next(err);
    }
});

// ----- Booth Table -----
app.get('/booths', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM Booth');
        console.log('Booths fetched:', result.rows);
        res.json(result.rows);
    } catch (err) {
        console.error('Booths fetch error:', err);
        next(err);
    }
});
app.get('/booths/:booth_id', async (req, res, next) => {
    const { booth_id } = req.params;
    console.log('Fetching booth:', { booth_id });
    try {
        const result = await pool.query('SELECT * FROM Booth WHERE booth_id = $1', [booth_id]);
        if (result.rowCount === 0) {
            console.log('Booth not found:', { booth_id });
            return res.status(404).json({ error: 'Booth not found' });
        }
        console.log('Booth fetched:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Booth fetch error:', err);
        next(err);
    }
});

app.put('/booths/:booth_id', sanitizeInput, async (req, res, next) => {
    const { booth_id } = req.params;
    const { location, status } = req.body;
    console.log('Updating booth:', { booth_id, location, status });
    try {
        const result = await pool.query(
            'UPDATE Booth SET location = $1, status = $2 WHERE booth_id = $3 RETURNING *',
            [location, status, booth_id]
        );
        if (result.rowCount === 0) {
            console.log('Update failed: Booth not found');
            return res.status(404).json({ error: 'Booth not found' });
        }
        console.log('Booth updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Booth update error:', err);
        next(err);
    }
});

app.post('/booths', sanitizeInput, async (req, res, next) => {
    const { booth_id, location, user_id } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ตรวจสอบและปรับรูปแบบ location ให้เป็น "Row X Column Y"
        let normalizedLocation = location;
        const locationMatch = location.match(/Row (\d+)(?:,)?\s*(Column|Col)\s*(\d+)/i);
        if (locationMatch) {
            const row = locationMatch[1];
            const col = locationMatch[3];
            normalizedLocation = `Row ${row} Column ${col}`;
        } else {
            return res.status(400).json({ error: 'รูปแบบตำแหน่งต้องเป็น Row X Column Y (เช่น Row 1 Column 1)' });
        }

        // ตรวจสอบ booth_id ซ้ำ
        const checkBooth = await client.query('SELECT booth_id FROM Booth WHERE booth_id = $1', [booth_id]);
        if (checkBooth.rowCount > 0) {
            return res.status(400).json({ error: 'รหัสบูธนี้มีอยู่ในระบบแล้ว' });
        }

        // ตรวจสอบ location ซ้ำ
        const checkLocation = await client.query('SELECT booth_id FROM Booth WHERE location = $1', [normalizedLocation]);
        if (checkLocation.rowCount > 0) {
            return res.status(400).json({ error: 'ตำแหน่งนี้มีบูธอยู่แล้ว' });
        }

        // ตรวจสอบรูปแบบ booth_id
        if (!booth_id.match(/^[A-Z][0-9]{3}$/)) {
            return res.status(400).json({ error: 'รหัสบูธต้องอยู่ในรูปแบบ Xxxx (เช่น A003, B123)' });
        }

        // เพิ่มบูธ
        const result = await client.query(
            'INSERT INTO Booth (booth_id, location, status) VALUES ($1, $2, $3) RETURNING *',
            [booth_id, normalizedLocation, 'available']
        );

        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Booth create error:', err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสร้างบูธ', details: err.message });
    } finally {
        client.release();
    }
});
app.put('/booths/:booth_id', sanitizeInput, async (req, res, next) => {
    const { booth_id } = req.params;
    const { location, status } = req.body;
    console.log('Updating booth:', { booth_id, location, status });
    try {
        const client = await pool.connect();
        await client.query('BEGIN');
        const existingBooth = await client.query(
            'SELECT location FROM Booth WHERE booth_id = $1',
            [booth_id]
        );
        if (existingBooth.rowCount === 0) {
            return res.status(404).json({ error: 'Booth not found' });
        }
        if (location) {
            const checkLocation = await client.query(
                'SELECT booth_id FROM Booth WHERE location = $1 AND booth_id != $2',
                [location, booth_id]
            );
            if (checkLocation.rowCount > 0) {
                return res.status(400).json({ error: 'ตำแหน่งนี้มีบูธอยู่แล้ว' });
            }
        }
        const result = await client.query(
            'UPDATE Booth SET location = $1, status = $2 WHERE booth_id = $3 RETURNING *',
            [location || existingBooth.rows[0].location, status || 'available', booth_id]
        );
        await client.query('COMMIT');
        console.log('Booth updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Booth update error:', err);
        next(err);
    } finally {
        client.release();
    }
});
app.delete('/booths/:booth_id', requireAdmin, async (req, res, next) => {
    const { booth_id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const bookingCheck = await client.query(
            'SELECT booking_id FROM Booking WHERE booth_id = $1 AND booking_status != $2',
            [booth_id, 'cancelled']
        );
        if (bookingCheck.rowCount > 0) {
            return res.status(400).json({ error: 'ไม่สามารถลบบูธได้ เนื่องจากมีการจองที่ยังไม่ยกเลิก' });
        }
        const result = await client.query(
            'DELETE FROM Booth WHERE booth_id = $1 RETURNING *',
            [booth_id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'ไม่พบบูธ' });
        }
        await client.query('COMMIT');
        res.json({ message: 'ลบบูธสำเร็จ' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Booth delete error:', err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการลบบูธ' });
    } finally {
        client.release();
    }
});
// ----- Electricity Table -----
app.get('/electricities', async (req, res, next) => {
    console.log('Fetching all electricity options');
    try {
        const result = await pool.query('SELECT * FROM Electricity ORDER BY electricity_quantity');
        console.log('Electricity options fetched:', result.rows);
        res.json(result.rows);
    } catch (err) {
        console.error('Electricity fetch error:', err);
        next(err);
    }
});

app.post('/electricities', sanitizeInput, async (req, res, next) => {
    const { electricity_quantity, electricity_price } = req.body;
    console.log('Adding electricity option:', { electricity_quantity, electricity_price });
    try {
        const result = await pool.query(
            'INSERT INTO Electricity (electricity_quantity, electricity_price) VALUES ($1, $2) RETURNING *',
            [electricity_quantity, electricity_price]
        );
        console.log('Electricity option added:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Electricity add error:', err);
        next(err);
    }
});

app.delete('/electricities', async (req, res, next) => {
    console.log('Deleting all electricity options');
    try {
        await pool.query('DELETE FROM Electricity');
        console.log('Electricity options deleted');
        res.sendStatus(204);
    } catch (err) {
        console.error('Electricity delete error:', err);
        next(err);
    }
});
app.put('/electricities', async (req, res) => {
    const electricities = req.body;
    try {
        // ลบข้อมูลเก่าในตาราง electricities
        await pool.query('DELETE FROM electricity');

        // เพิ่มข้อมูลใหม่
        for (const e of electricities) {
            if (e.electricity_quantity <= 0 || e.electricity_price < 0) {
                return res.status(400).json({ error: 'จำนวนวัตต์ต้องเป็นตัวเลขบวกและราคาต้องไม่เป็นลบ' });
            }
            await pool.query(
                'INSERT INTO electricity (electricity_quantity, electricity_price) VALUES ($1, $2)',
                [e.electricity_quantity, e.electricity_price]
            );
        }
        res.status(200).json({ message: 'Updated electricities successfully' });
    } catch (error) {
        console.error('Error updating electricities:', error);
        res.status(500).json({ error: error.message });
    }
});
// ----- Config Table -----
app.get('/config', async (req, res, next) => {
    console.log('Fetching config');
    try {
        const result = await pool.query('SELECT * FROM Config');
        console.log('Config fetched:', result.rows);
        res.json(result.rows);
    } catch (err) {
        console.error('Config fetch error:', err);
        next(err);
    }
});

app.put('/config', sanitizeInput, async (req, res, next) => {
    const { booth_max } = req.body;
    console.log('Updating config:', { booth_max });
    try {
        const result = await pool.query(
            'UPDATE Config SET booth_max = $1 RETURNING *',
            [booth_max]
        );
        if (result.rowCount === 0) {
            const insertResult = await pool.query(
                'INSERT INTO Config (booth_max) VALUES ($1) RETURNING *',
                [booth_max]
            );
            console.log('Config inserted:', insertResult.rows[0]);
            return res.json(insertResult.rows[0]);
        }
        console.log('Config updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Config update error:', err);
        next(err);
    }
});

// ----- Booking Table -----
app.get('/bookings', async (req, res, next) => {
    console.log('Fetching all bookings');
    try {
        const result = await pool.query('SELECT * FROM Booking');
        console.log('Bookings fetched:', result.rows);
        res.json(result.rows);
    } catch (err) {
        console.error('Bookings fetch error:', err);
        next(err);
    }
});

app.get('/bookings/:booking_id', async (req, res, next) => {
    const { booking_id } = req.params;
    console.log('Fetching booking:', { booking_id });
    try {
        const result = await pool.query('SELECT * FROM Booking WHERE booking_id = $1', [booking_id]);
        if (result.rowCount === 0) {
            console.log('Booking not found:', { booking_id });
            return res.status(404).json({ error: 'Booking not found' });
        }
        console.log('Booking fetched:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Booking fetch error:', err);
        next(err);
    }
});

app.post('/bookings', sanitizeInput, async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {
            booking_id, booth_id, booth_quantity, booking_datetime, booth_nameplate, amount,
            booking_status, electricity_request, electricity_quantity, staff_count, user_id, payment_status
        } = req.body;
        console.log('Creating booking:', {
            booking_id, booth_id, booth_quantity, booking_datetime, booth_nameplate, amount,
            booking_status, electricity_request, electricity_quantity, staff_count, user_id, payment_status
        });

        // Validate input
        if (!booking_id || !booth_id || !booth_quantity || !booking_datetime || !booth_nameplate || 
            amount == null || isNaN(amount) || !booking_status || !user_id || !payment_status) {
            console.log('Validation failed: Missing or invalid required fields', { amount });
            throw new Error('Missing or invalid required fields');
        }
        if (staff_count < 0) {
            console.log('Validation failed: Negative staff count');
            throw new Error('Staff count cannot be negative');
        }

        // Fetch user
        console.log('Fetching user for booking:', { user_id });
        const userResult = await client.query('SELECT institute_name FROM "User" WHERE user_id = $1', [user_id]);
        if (userResult.rowCount === 0) {
            console.log('Validation failed: User not found');
            throw new Error('User not found');
        }
        const institute_name = userResult.rows[0].institute_name;
        console.log('User institute:', { institute_name });

        // Fetch institute type
        console.log('Fetching institute type:', { institute_name });
        const instituteResult = await client.query('SELECT type_id FROM Institute WHERE institute_name = $1', [institute_name]);
        if (instituteResult.rowCount === 0) {
            console.log('Validation failed: Institute not found');
            throw new Error('Institute not found');
        }
        const type_id = instituteResult.rows[0].type_id;
        console.log('Institute type:', { type_id });

        // Fetch type details
        console.log('Fetching type details:', { type_id });
        const typeResult = await client.query('SELECT type_start, type_end, price FROM Type WHERE type_id = $1', [type_id]);
        if (typeResult.rowCount === 0) {
            console.log('Validation failed: Type not found');
            throw new Error('Type not found');
        }
        const { type_start, type_end, price } = typeResult.rows[0];
        console.log('Type details:', { type_start, type_end, price });

        // Validate booking time
        const bookingDate = new Date(booking_datetime);
        if (bookingDate < new Date(type_start) || bookingDate > new Date(type_end)) {
            console.log('Validation failed: Booking time outside allowed period');
            throw new Error('Booking time is outside the allowed period for your institute type');
        }

        // Apply early bird discount
        const earlyBirdStart = new Date('2025-05-01');
        const earlyBirdEnd = new Date('2025-05-10');
        let calculatedAmount = parseFloat(price) * booth_quantity;
        if (isNaN(calculatedAmount)) {
            console.error('Calculated amount is NaN', { price, booth_quantity });
            throw new Error('Invalid base price calculation');
        }
        if (type_id === 'T001' && bookingDate >= earlyBirdStart && bookingDate <= earlyBirdEnd) {
            calculatedAmount *= 0.8;
            console.log('Applied early bird discount: 20%');
        }
        console.log('Calculated base amount:', calculatedAmount);

        // Validate electricity
        let electricityPrice = 0;
        if (electricity_request && electricity_quantity) {
            console.log('Checking electricity:', { electricity_quantity });
            const electricityCheck = await client.query(
                'SELECT electricity_price FROM Electricity WHERE electricity_quantity = $1',
                [electricity_quantity]
            );
            if (electricityCheck.rowCount === 0) {
                console.log('Validation failed: Invalid electricity quantity');
                throw new Error('Invalid electricity quantity');
            }
            electricityPrice = parseFloat(electricityCheck.rows[0].electricity_price);
            calculatedAmount += electricityPrice * booth_quantity;
            console.log('Updated amount with electricity:', { calculatedAmount, electricityPrice, booth_quantity });
        }

        // Validate amount
        console.log('Validating amount:', { sentAmount: amount, calculatedAmount });
        if (Math.abs(calculatedAmount - amount) > 0.01) {
            console.log('Validation failed: Invalid booking amount', { sentAmount: amount, calculatedAmount });
            throw new Error('Invalid booking amount');
        }

        // Validate booth
        console.log('Checking booth availability:', { booth_id });
        const boothCheck = await client.query(
            'SELECT booth_id FROM Booth WHERE booth_id = $1 AND status = $2',
            [booth_id, 'available']
        );
        if (boothCheck.rowCount === 0) {
            console.log('Validation failed: Booth not available');
            throw new Error('Booth is not available');
        }

        // Validate booth_max
        console.log('Checking booth limit');
        const configResult = await client.query('SELECT booth_max FROM Config LIMIT 1');
        const booth_max = configResult.rows[0]?.booth_max || 2;
        const userBookings = await client.query(
            'SELECT COUNT(*) FROM Booking WHERE user_id = $1 AND booking_status != $2',
            [user_id, 'cancelled']
        );
        if (parseInt(userBookings.rows[0].count) + booth_quantity > booth_max) {
            console.log('Validation failed: Exceeds booth limit');
            throw new Error(`Cannot book more than ${booth_max} booths`);
        }

        // Update booth status
        console.log('Updating booth status to booked:', { booth_id });
        await client.query(
            'UPDATE Booth SET status = $1 WHERE booth_id = $2',
            ['booked', booth_id]
        );

        // Create booking
        console.log('Inserting booking:', { booking_id, booth_id, user_id });
        const result = await client.query(
            'INSERT INTO Booking (booking_id, booth_id, booth_quantity, booking_datetime, booth_nameplate, amount, ' +
            'booking_status, electricity_request, electricity_quantity, staff_count, user_id, payment_status) ' +
            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *',
            [booking_id, booth_id, booth_quantity, booking_datetime, booth_nameplate, calculatedAmount,
             booking_status, electricity_request, electricity_quantity, staff_count, user_id, payment_status]
        );
        console.log('Booking created:', result.rows[0]);

        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Booking creation error:', err);
        next(err);
    } finally {
        client.release();
    }
});

app.put('/bookings/:booking_id', sanitizeInput, async (req, res, next) => {
    const { booking_id } = req.params;
    const {
        booth_id, booth_quantity, booking_datetime, booth_nameplate, amount,
        booking_status, electricity_request, electricity_quantity, staff_count, user_id, payment_status
    } = req.body;
    console.log('Updating booking:', { booking_id, booth_id, user_id, booking_status, payment_status });

    try {
        // ตรวจสอบว่า booking_id มีอยู่ในฐานข้อมูล
        const bookingCheck = await pool.query(
            'SELECT * FROM Booking WHERE booking_id = $1',
            [booking_id]
        );
        if (bookingCheck.rowCount === 0) {
            console.log('Update failed: Booking not found', { booking_id });
            return res.status(404).json({ error: 'Booking not found' });
        }

        // สร้าง query โดยอัปเดตเฉพาะฟิลด์ที่มีใน req.body
        const updates = [];
        const values = [];
        let index = 1;

        if (booth_id !== undefined) {
            updates.push(`booth_id = $${index++}`);
            values.push(booth_id);
        }
        if (booth_quantity !== undefined) {
            updates.push(`booth_quantity = $${index++}`);
            values.push(booth_quantity);
        }
        if (booking_datetime !== undefined) {
            updates.push(`booking_datetime = $${index++}`);
            values.push(booking_datetime);
        }
        if (booth_nameplate !== undefined) {
            updates.push(`booth_nameplate = $${index++}`);
            values.push(booth_nameplate);
        }
        if (amount !== undefined) {
            updates.push(`amount = $${index++}`);
            values.push(amount);
        }
        if (booking_status !== undefined) {
            updates.push(`booking_status = $${index++}`);
            values.push(booking_status);
        }
        if (electricity_request !== undefined) {
            updates.push(`electricity_request = $${index++}`);
            values.push(electricity_request);
        }
        if (electricity_quantity !== undefined) {
            updates.push(`electricity_quantity = $${index++}`);
            values.push(electricity_quantity);
        }
        if (staff_count !== undefined) {
            updates.push(`staff_count = $${index++}`);
            values.push(staff_count);
        }
        if (user_id !== undefined) {
            updates.push(`user_id = $${index++}`);
            values.push(user_id);
        }
        if (payment_status !== undefined) {
            updates.push(`payment_status = $${index++}`);
            values.push(payment_status);
        }

        // เพิ่ม booking_id ใน values
        values.push(booking_id);

        if (updates.length === 0) {
            console.log('No fields to update', { booking_id });
            return res.status(400).json({ error: 'No fields provided to update' });
        }

        const query = `UPDATE Booking SET ${updates.join(', ')} WHERE booking_id = $${index} RETURNING *`;
        console.log('Executing query:', query, values);

        const result = await pool.query(query, values);
        console.log('Booking updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Booking update error:', err.message, err.stack);
        if (err.code === '23502') {
            return res.status(400).json({ error: `Missing required field: ${err.column}` });
        }
        if (err.code === '23503') {
            return res.status(400).json({ error: `Foreign key violation: ${err.detail}` });
        }
        if (err.code === '22001') {
            return res.status(400).json({ error: `Value too long for column: ${err.column}` });
        }
        next(err);
    }
});
app.delete('/bookings/:booking_id', async (req, res, next) => {
    const { booking_id } = req.params;
    console.log('Deleting booking:', { booking_id });
    try {
        const result = await pool.query('DELETE FROM Booking WHERE booking_id = $1 RETURNING *', [booking_id]);
        if (result.rowCount === 0) {
            console.log('Booking not found:', { booking_id });
            return res.status(404).json({ error: 'Booking not found' });
        }
        console.log('Booking deleted:', result.rows[0]);
        res.json({ message: 'Booking deleted successfully' });
    } catch (err) {
        console.error('Booking delete error:', err);
        next(err);
    }
});
app.put('/bookings/:booking_id/reject', sanitizeInput, async (req, res, next) => {
    const { booking_id } = req.params;
    console.log('Rejecting booking:', { booking_id });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ตรวจสอบการจอง
        const bookingResult = await client.query(
            'SELECT booth_id FROM Booking WHERE booking_id = $1',
            [booking_id]
        );
        if (bookingResult.rowCount === 0) {
            console.log('Booking not found:', { booking_id });
            return res.status(404).json({ error: 'Booking not found' });
        }
        const { booth_id } = bookingResult.rows[0];

        // อัปเดตสถานะการจองเป็น 'cancelled'
        await client.query(
            `UPDATE Booking 
             SET booking_status = $1, payment_status = $2
             WHERE booking_id = $3`,
            ['cancelled', 'cancelled', booking_id]
        );

        // อัปเดตสถานะบูธ
        const boothResult = await client.query(
            'SELECT location FROM Booth WHERE booth_id = $1',
            [booth_id]
        );
        if (boothResult.rowCount === 0) {
            console.log('Booth not found:', { booth_id });
            return res.status(404).json({ error: 'Booth not found' });
        }

        await client.query(
            `UPDATE Booth 
             SET status = $1 
             WHERE booth_id = $2`,
            ['available', booth_id]
        );

        await client.query('COMMIT');
        console.log('Booking cancelled and booth updated:', { booking_id, booth_id });
        res.json({ message: 'Booking cancelled and booth updated' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Booking reject error:', err.message, err.stack);
        if (err.code === '23503') {
            return res.status(400).json({ error: `Foreign key violation: ${err.detail}` });
        }
        if (err.code === '23514') {
            return res.status(400).json({ error: `Check constraint violation: ${err.detail}` });
        }
        next(err);
    } finally {
        client.release();
    }
});
// ----- Payment Verification -----
app.post('/verify-payment', sanitizeInput, async (req, res, next) => {
    const { booking_id, payment_reference } = req.body;
    console.log('Verifying payment:', { booking_id, payment_reference });
    try {
        const paymentValid = payment_reference.startsWith('PAY-');
        if (!paymentValid) {
            console.log('Verification failed: Invalid payment reference');
            return res.status(400).json({ error: 'Invalid payment reference' });
        }
        const result = await pool.query(
            'UPDATE Booking SET payment_status = $1 WHERE booking_id = $2 RETURNING *',
            ['confirmed', booking_id]
        );
        if (result.rowCount === 0) {
            console.log('Verification failed: Booking not found');
            return res.status(404).json({ error: 'Booking not found' });
        }
        console.log('Payment verified:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Payment verification error:', err);
        next(err);
    }
});

// ----- Admin Notification -----
app.post('/notify-admin', sanitizeInput, async (req, res, next) => {
    const { booking_id } = req.body;
    console.log('Notifying admin for booking:', { booking_id });
    try {
        const result = await pool.query('SELECT * FROM Booking WHERE booking_id = $1', [booking_id]);
        if (result.rowCount === 0) {
            console.log('Notification failed: Booking not found');
            return res.status(404).json({ error: 'Booking not found' });
        }
        const booking = result.rows[0];
        console.log('Admin notification sent:', booking);
        res.json({ message: 'Admin notified' });
    } catch (err) {
        console.error('Admin notification error:', err);
        next(err);
    }
});


app.post('/upload-profile-image', upload.single('profile_image'), sanitizeInput, async (req, res, next) => {
    let { user_id } = req.body;
    console.log('Uploading profile image:', { user_id });

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'กรุณาเลือกไฟล์รูปภาพ' });
        }

        if (!user_id) {
            const errorFilePath = path.join(__dirname, 'public', 'uploads', req.file.filename);
            if (fs.existsSync(errorFilePath)) {
                fs.unlinkSync(errorFilePath);
            }
            return res.status(400).json({ error: 'ต้องระบุ user_id' });
        }

        // ดึง username จากฐานข้อมูล
        const userResult = await pool.query('SELECT username, profile_image FROM "User" WHERE user_id = $1', [user_id]);
        if (userResult.rowCount === 0) {
            const errorFilePath = path.join(__dirname, 'public', 'uploads', req.file.filename);
            if (fs.existsSync(errorFilePath)) {
                fs.unlinkSync(errorFilePath);
            }
            return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
        }

        const { username, profile_image: oldImage } = userResult.rows[0];
        req.body.username = username; // เพิ่ม username ให้ Multer ใช้

        const filename = req.file.filename;
        const fileSystemPath = path.join(__dirname, 'public', 'uploads', filename);
        const imagePath = `/uploads/${filename}`;

        const oldImagePath = oldImage ? path.join(__dirname, 'public', oldImage) : null;
        if (
            oldImage &&
            oldImage !== '/uploads/default-profile.png' &&
            fs.existsSync(oldImagePath)
        ) {
            fs.unlinkSync(oldImagePath);
            console.log('Deleted old profile image:', oldImage);
        }

        const updateResult = await pool.query(
            'UPDATE "User" SET profile_image = $1 WHERE user_id = $2 RETURNING *',
            [imagePath, user_id]
        );

        console.log('Profile image updated:', updateResult.rows[0]);
        res.json({ profile_image: imagePath });

    } catch (err) {
        if (req.file) {
            const errorFilePath = path.join(__dirname, 'public', 'uploads', req.file.filename);
            if (fs.existsSync(errorFilePath)) {
                fs.unlinkSync(errorFilePath);
            }
        }
        console.error('Profile image upload error:', err);
        next(err);
    }
});
// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});