// app.js
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();

// Middleware
app.use(express.json());

// Database connection
const pool = mysql.createPool({
  host: 'localhost',
  user: 'your_username',
  password: 'your_password',
  database: 'railway_management',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Secret keys
const JWT_SECRET = 'your_jwt_secret';
const ADMIN_API_KEY = 'your_admin_api_key';

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Unauthorized' });
    req.userId = decoded.id;
    next();
  });
};

// Middleware to verify admin API key
const verifyAdminApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  next();
};

// 1. Register a User
app.post('/register', async (req, res) => {
  const { username, password, isAdmin } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const [result] = await pool.execute(
      'INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)',
      [username, hashedPassword, isAdmin]
    );
    res.status(201).json({ message: 'User registered successfully', userId: result.insertId });
  } catch (error) {
    res.status(500).json({ error: 'Error registering user' });
  }
});

// 2. Login User
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, isAdmin: user.is_admin }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Error logging in' });
  }
});

// 3. Add a New Train (Admin only)
app.post('/trains', verifyAdminApiKey, async (req, res) => {
  const { name, source, destination, totalSeats } = req.body;

  try {
    const [result] = await pool.execute(
      'INSERT INTO trains (name, source, destination, total_seats, available_seats) VALUES (?, ?, ?, ?, ?)',
      [name, source, destination, totalSeats, totalSeats]
    );
    res.status(201).json({ message: 'Train added successfully', trainId: result.insertId });
  } catch (error) {
    res.status(500).json({ error: 'Error adding train' });
  }
});

// 4. Get Seat Availability
app.get('/availability', async (req, res) => {
  const { source, destination } = req.query;

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM trains WHERE source = ? AND destination = ?',
      [source, destination]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching availability' });
  }
});

// 5. Book a Seat
app.post('/bookings', verifyToken, async (req, res) => {
  const { trainId } = req.body;
  const userId = req.userId;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Check seat availability and update in a single query
    const [updateResult] = await connection.execute(
      'UPDATE trains SET available_seats = available_seats - 1 WHERE id = ? AND available_seats > 0',
      [trainId]
    );

    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'No seats available' });
    }

    // Create booking
    const [bookingResult] = await connection.execute(
      'INSERT INTO bookings (user_id, train_id) VALUES (?, ?)',
      [userId, trainId]
    );

    await connection.commit();
    res.status(201).json({ message: 'Booking successful', bookingId: bookingResult.insertId });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Error booking seat' });
  } finally {
    connection.release();
  }
});

// 6. Get Specific Booking Details
app.get('/bookings/:id', verifyToken, async (req, res) => {
  const bookingId = req.params.id;
  const userId = req.userId;

  try {
    const [rows] = await pool.execute(
      'SELECT b.id, t.name, t.source, t.destination FROM bookings b JOIN trains t ON b.train_id = t.id WHERE b.id = ? AND b.user_id = ?',
      [bookingId, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching booking details' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});