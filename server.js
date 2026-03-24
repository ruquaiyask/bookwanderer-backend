require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path'); 
const nodemailer = require('nodemailer'); 

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); 

const dbPath = path.join(__dirname, 'library.db'); 
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error(err.message);
    console.log('Connected to the Imperial SQL Archive at:', dbPath);
});

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // This uses SSL, which Render prefers over Port 587
    auth: {
        user: 'book.wanderer13@gmail.com',        
        pass: process.env.EMAIL_PASSWORD 
    },
    tls: {
        // This ensures the cloud network doesn't block the handshake
        rejectUnauthorized: false 
    }
});
// --- DATABASE INITIALIZATION ---
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password TEXT, is_admin INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS otp_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, otp TEXT NOT NULL, expires_at INTEGER NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, author TEXT, category TEXT, condition TEXT, price INTEGER, notes TEXT, image TEXT, seller_email TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, total_amount INTEGER, items JSON, date DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS carts (user_email TEXT UNIQUE, cart_data TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS addresses (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, name TEXT, address_text TEXT, city TEXT, pin TEXT, phone TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS support_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, subject TEXT, message TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    
    // NEW: Promo Code Table with Offer Name
    db.run(`CREATE TABLE IF NOT EXISTS promotions (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, discount INTEGER, offer_name TEXT, is_active INTEGER DEFAULT 1)`);
    
    // Safety check: Upgrades existing databases automatically to include the new column
    db.run(`ALTER TABLE promotions ADD COLUMN offer_name TEXT`, (err) => { /* Ignore if it already exists */ });

    db.get("SELECT COUNT(*) as count FROM promotions", [], (err, row) => {
        if (row && row.count === 0) {
            db.run("INSERT INTO promotions (code, discount, offer_name) VALUES ('LIBRARY20', 20, 'WELCOME OFFER')");
        }
    });
});

// --- ADMIN ROLE MANAGEMENT ---
app.put('/admin/toggle-role/:id', (req, res) => {
    const { is_admin } = req.body;
    db.run("UPDATE users SET is_admin = ? WHERE id = ?", [is_admin, req.params.id], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Scholar status revised." });
    });
});

// --- ADMIN ROUTES ---
app.get('/admin/users', (req, res) => {
    const sql = "SELECT id, name, email, password, is_admin FROM users ORDER BY id DESC";
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.delete('/admin/users/:id', (req, res) => {
    const sql = "DELETE FROM users WHERE id = ?";
    db.run(sql, req.params.id, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Scholar exiled from the Guild." });
    });
});

app.delete('/admin/books/:id', (req, res) => {
    const sql = "DELETE FROM books WHERE id = ?";
    db.run(sql, req.params.id, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Volume purged from the Archive." });
    });
});

app.get('/admin/orders', (req, res) => {
    const sql = `SELECT orders.*, users.name as buyer_name FROM orders LEFT JOIN users ON orders.user_email = users.email ORDER BY orders.date DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.get('/admin/stats', (req, res) => {
    db.get("SELECT COUNT(*) as users FROM users", [], (err, userRow) => {
        db.get("SELECT COUNT(*) as books FROM books", [], (err, bookRow) => {
            db.get("SELECT COUNT(*) as orders, SUM(total_amount) as total_revenue FROM orders", [], (err, orderRow) => {
                res.json({ users: userRow.users, books: bookRow.books, orders: orderRow.orders || 0, revenue: orderRow.total_revenue || 0 });
            });
        });
    });
});

// --- SUPPORT MESSAGES ROUTES ---
app.post('/contact', (req, res) => {
    const { name, email, subject, message } = req.body;
    const sql = `INSERT INTO support_messages (name, email, subject, message) VALUES (?, ?, ?, ?)`;
    db.run(sql, [name, email, subject, message], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ success: true, message: "Delivered to vault." });
    });
});

app.get('/admin/messages', (req, res) => {
    const sql = "SELECT * FROM support_messages ORDER BY date DESC";
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.delete('/admin/messages/:id', (req, res) => {
    const sql = "DELETE FROM support_messages WHERE id = ?";
    db.run(sql, req.params.id, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- ADDRESS ROUTES ---
app.get('/addresses/:email', (req, res) => {
    const sql = "SELECT * FROM addresses WHERE user_email = ?";
    db.all(sql, [req.params.email], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.post('/addresses', (req, res) => {
    const { user_email, name, address_text, city, pin, phone } = req.body;
    const sql = `INSERT INTO addresses (user_email, name, address_text, city, pin, phone) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [user_email, name, address_text, city, pin, phone], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Address saved to archive", id: this.lastID });
    });
});

app.put('/addresses/:id', (req, res) => {
    const { name, address_text, city, pin, phone } = req.body;
    const sql = `UPDATE addresses SET name=?, address_text=?, city=?, pin=?, phone=? WHERE id=?`;
    db.run(sql, [name, address_text, city, pin, phone, req.params.id], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Address updated" });
    });
});

app.delete('/addresses/:id', (req, res) => {
    const sql = "DELETE FROM addresses WHERE id = ?";
    db.run(sql, req.params.id, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Address removed" });
    });
});

// --- BOOK & CATALOG ROUTES ---
app.get('/books', (req, res) => {
    const sql = "SELECT * FROM books ORDER BY timestamp DESC";
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "success", data: rows });
    });
});

app.get('/books/search', (req, res) => {
    const term = `%${req.query.q}%`; 
    const sql = "SELECT * FROM books WHERE title LIKE ? OR author LIKE ?";
    db.all(sql, [term, term], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "success", data: rows });
    });
});

app.post('/books', (req, res) => {
    const { title, author, category, condition, price, notes, image, seller_email } = req.body;
    const sql = `INSERT INTO books (title, author, category, condition, price, notes, image, seller_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [title, author, category, condition, price, notes, image, seller_email];
    db.run(sql, params, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Tome successfully inscribed", id: this.lastID });
    });
});

// --- AUTH & OTP ROUTES ---
app.post('/send-otp', (req, res) => {
    const { email } = req.body;
    
    // We remove the "if (row) return error" check so that 
    // registered users can actually receive a reset code.
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 600000; // 10 mins

    db.run("DELETE FROM otp_verifications WHERE email = ?", [email], () => {
        db.run("INSERT INTO otp_verifications (email, otp, expires_at) VALUES (?, ?, ?)", [email, otp, expiresAt], (err) => {
            if (err) return res.status(500).json({ error: "Failed to save seal" });
            const mailOptions = {
                from: 'book.wanderer13@gmail.com',
                to: email,
                subject: 'Archive Access Recovery Code',
                text: `Your recovery code is: ${otp}. It expires in 10 minutes.`
            };
            transporter.sendMail(mailOptions, (error) => {
                if (error) return res.status(500).json({ error: "Failed to send email." });
                res.status(200).json({ message: "OTP sent successfully!" });
            });
        });
    });
});
app.post('/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    const currentTime = Date.now();
    const sql = "SELECT * FROM otp_verifications WHERE email = ? AND otp = ?";
    db.get(sql, [email, otp], (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (row && row.expires_at > currentTime) {
            db.run("DELETE FROM otp_verifications WHERE email = ?", [email]); 
            res.status(200).json({ message: "Seal Verified successfully" });
        } else {
            res.status(400).json({ error: "Invalid or expired seal" });
        }
    });
});

app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    
    try {
        // Scramble the password using a "salt" of 10 rounds
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const sql = `INSERT INTO users (name, email, password) VALUES (?, ?, ?)`;
        // Save the HASHED password, not the raw one
        db.run(sql, [name, email, hashedPassword], function(err) {
            if (err) return res.status(400).json({ error: "Email already exists" });
            res.json({ message: "Scholar registered", id: this.lastID });
        });
    } catch (error) {
        res.status(500).json({ error: "Error securing password" });
    }
});
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const sql = `SELECT id, name, email, password, is_admin FROM users WHERE email = ?`;
    
    db.get(sql, [email], async (err, row) => {
        if (err) return res.status(400).json({ error: err.message });
        
        if (row) {
            const isMatch = await bcrypt.compare(password, row.password);
            
            if (isMatch) {
                delete row.password; 
                
                // --- NEW: Generate the VIP Token ---
                // This token is sealed with your secret key and expires in 24 hours
                const token = jwt.sign(
                    { id: row.id, email: row.email, is_admin: row.is_admin }, 
                    process.env.JWT_SECRET, 
                    { expiresIn: '24h' }
                );
                
                // Send BOTH the user data and the token back to the frontend
                res.json({ message: "Access Granted", user: row, token: token });
            } else {
                res.status(401).json({ message: "Invalid Credentials" });
            }
        } else {
            res.status(401).json({ message: "Invalid Credentials" });
        }
    });
});
app.post('/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const now = Date.now();

    db.get(`SELECT * FROM otp_verifications WHERE email = ? AND otp = ? AND expires_at > ?`, 
    [email, otp, now], async (err, row) => {
        if (err || !row) return res.status(400).json({ error: "Invalid or expired code." });

        try {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            db.run(`UPDATE users SET password = ? WHERE email = ?`, [hashedPassword, email], (err) => {
                if (err) return res.status(500).json({ error: "Failed to update." });
                db.run(`DELETE FROM otp_verifications WHERE email = ?`, [email]);
                res.json({ message: "Password updated successfully!" });
            });
        } catch (e) { res.status(500).json({ error: "Encryption error" }); }
    });
});
// --- FORGOT PASSWORD: SEND OTP ---
app.post('/send-otp', (req, res) => {
    const { email } = req.body;
    
    // Check if user exists first
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (!user) return res.status(404).json({ error: "Email not found in Archives." });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 600000; // 10 mins

        db.run(`REPLACE INTO otp_verifications (email, otp, expires_at) VALUES (?, ?, ?)`, 
        [email, otp, expiresAt], (err) => {
            if (err) return res.status(500).json({ error: "Database error" });

            const mailOptions = {
                from: 'book.wanderer13@gmail.com',
                to: email,
                subject: 'Archive Access Recovery Code',
                text: `Your recovery code is: ${otp}. It expires in 10 minutes.`
            };

            transporter.sendMail(mailOptions, (error) => {
                if (error) return res.status(500).json({ error: "Mail delivery failed" });
                res.json({ message: "OTP Sent" });
            });
        });
    });
});

// --- FORGOT PASSWORD: RESET LOGIC ---
app.post('/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const now = Date.now();

    db.get(`SELECT * FROM otp_verifications WHERE email = ? AND otp = ? AND expires_at > ?`, 
    [email, otp, now], async (err, row) => {
        if (err || !row) return res.status(400).json({ error: "Invalid or expired code." });

        try {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            db.run(`UPDATE users SET password = ? WHERE email = ?`, [hashedPassword, email], (err) => {
                if (err) return res.status(500).json({ error: "Failed to update." });
                db.run(`DELETE FROM otp_verifications WHERE email = ?`, [email]);
                res.json({ message: "Password updated!" });
            });
        } catch (e) { res.status(500).json({ error: "Encryption error" }); }
    });
});
// --- THE SECURITY GUARD MIDDLEWARE ---
function authenticateToken(req, res, next) {
    // Look for the wristband in the request headers
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <token>"

    if (!token) return res.status(401).json({ error: "Access Denied. No VIP wristband found." });

    // Verify the wristband is real and hasn't expired
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid or expired wristband." });
        
        // Security Check: Does the token email match the email they are asking for?
        if (req.params.email && req.params.email !== user.email && user.is_admin !== 1) {
             return res.status(403).json({ error: "You cannot access another scholar's archives." });
        }

        req.user = user; // Attach the decoded user info
        next(); // Let them pass!
    });
}
// --- CART & ORDER ROUTES ---
app.post('/orders', (req, res) => {
    const { user_email, total_amount, items } = req.body;

    // 1. Safety Check: Is the cart empty?
    if (!items || items.length === 0) {
        return res.status(400).json({ error: "Cart is empty." });
    }

    // 2. Extract book IDs from the frontend request
    const bookIds = items.map(item => item.id);
    const placeholders = bookIds.map(() => '?').join(',');

    // 3. Fetch the REAL prices from the database for these specific books
    db.all(`SELECT id, price FROM books WHERE id IN (${placeholders})`, bookIds, (err, rows) => {
        if (err) return res.status(500).json({ error: "Database error while verifying prices." });

        // Calculate the true subtotal based ONLY on database prices
        let realSubtotal = 0;
        rows.forEach(row => {
            realSubtotal += row.price;
        });

        // 4. Fetch the currently active promo code to check for valid discounts
        db.get("SELECT discount FROM promotions WHERE is_active = 1", [], (err, promoRow) => {
            let validDiscountedTotal = realSubtotal;

            if (promoRow && promoRow.discount) {
                const discountAmt = Math.floor(realSubtotal * (promoRow.discount / 100));
                validDiscountedTotal = realSubtotal - discountAmt;
            }

            // 5. THE SECURITY CHECK: Does the frontend total match reality?
            // We allow a tiny 1-rupee margin of error for JavaScript rounding differences.
            const isTotalValid = 
                Math.abs(total_amount - realSubtotal) <= 1 || 
                Math.abs(total_amount - validDiscountedTotal) <= 1;

            if (!isTotalValid) {
                console.error(`🚨 SECURITY ALERT: User ${user_email} tried to pay ₹${total_amount} for ₹${realSubtotal} worth of books.`);
                return res.status(403).json({ error: "Price mismatch detected. Transaction aborted for security." });
            }

            // 6. If safe, save the order securely
            const sql = `INSERT INTO orders (user_email, total_amount, items) VALUES (?, ?, ?)`;
            db.run(sql, [user_email, total_amount, JSON.stringify(items)], function(err) {
                if (err) return res.status(400).json({ error: err.message });
                res.json({ message: "Order confirmed and verified securely", id: this.lastID });
            });
        });
    });
});

app.post('/cart', authenticateToken, (req, res) => {
    // 1. Ditch user_email from req.body. Only extract cart_data.
    const { cart_data } = req.body;
    
    // 2. Pull the guaranteed, verified email directly from the security token
    const verifiedEmail = req.user.email; 

    const sql = `REPLACE INTO carts (user_email, cart_data) VALUES (?, ?)`;
    
    // 3. Use the verifiedEmail in your database query
    db.run(sql, [verifiedEmail, JSON.stringify(cart_data)], (err) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Cart synced to vault" });
    });
});// --- SECURE CART & DATA ROUTES ---

app.get('/cart/:email', authenticateToken, (req, res) => {
    // 🔒 We ignore req.params.email and use the verified token email!
    const sql = `SELECT cart_data FROM carts WHERE user_email = ?`;
    db.get(sql, [req.user.email], (err, row) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ cart_data: row ? JSON.parse(row.cart_data) : [] });
    });
});

app.get('/user/orders/:email', authenticateToken, (req, res) => {
    // 🔒 Securely fetch only the logged-in user's orders
    const sql = "SELECT * FROM orders WHERE user_email = ? ORDER BY date DESC";
    db.all(sql, [req.user.email], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.get('/user/books/:email', authenticateToken, (req, res) => {
    // 🔒 Securely fetch only the logged-in user's listed books
    const sql = "SELECT * FROM books WHERE seller_email = ? ORDER BY timestamp DESC";
    db.all(sql, [req.user.email], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.put('/user/:id', authenticateToken, async (req, res) => {
    // 🔒 Check if they are editing their own profile (or if they are an admin)
    if (req.user.id !== parseInt(req.params.id) && req.user.is_admin !== 1) {
        return res.status(403).json({ error: "Cannot modify another scholar's profile." });
    }

    const { name, password } = req.body;
    let sql = "UPDATE users SET name = ? WHERE id = ?";
    let params = [name, req.params.id];
    
    // 🔒 If they want to change their password, we MUST hash it first!
    if (password) {
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            sql = "UPDATE users SET name = ?, password = ? WHERE id = ?";
            params = [name, hashedPassword, req.params.id];
        } catch (err) {
            return res.status(500).json({ error: "Failed to secure new password." });
        }
    }
    
    db.run(sql, params, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Designation revised successfully." });
    });
});

// ==========================================
// 🎟️ DYNAMIC PROMO CODE ROUTES
// ==========================================

// This route remains PUBLIC so the frontend can display the banner
app.get('/promo', (req, res) => {
    db.get("SELECT code, discount, offer_name FROM promotions WHERE is_active = 1 ORDER BY id DESC LIMIT 1", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || { code: '', discount: 0, offer_name: '' });
    });
});

// This route remains PUBLIC so users can test promo codes at checkout
app.post('/validate-promo', (req, res) => {
    const { code } = req.body;
    db.get("SELECT discount FROM promotions WHERE code = ? AND is_active = 1 COLLATE NOCASE", [code], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) res.json({ valid: true, discount: row.discount });
        else res.json({ valid: false, message: "Invalid or expired code" });
    });
});

// 🔒 This route is LOCKED. Only Admins can change the active promo code.
app.post('/admin/promo', authenticateToken, (req, res) => {
    // Verify they have Admin privileges
    if (req.user.is_admin !== 1) {
        return res.status(403).json({ error: "Only the Grand Master can alter promotions." });
    }

    const { code, discount, offer_name } = req.body;
    db.run("UPDATE promotions SET is_active = 0", [], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run("INSERT INTO promotions (code, discount, offer_name, is_active) VALUES (?, ?, ?, 1)", [code.toUpperCase(), discount, offer_name], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: "Promo updated successfully!" });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Vault is live and secured on port ${PORT}`);
});
