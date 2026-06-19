const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('./db');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 10;

const findByEmail = db.prepare('SELECT id, email, password_hash, first_name, last_name FROM users WHERE email = ?');
const insertUser  = db.prepare('INSERT INTO users (email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?)');

function validate(email, password) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) return 'invalid email';
  if (typeof password !== 'string' || password.length < 6) return 'password must be at least 6 characters';
  return null;
}

// Имя/фамилия необязательны: приводим к строке, обрезаем пробелы и длину,
// пустую строку храним как null.
function cleanName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 100);
  return trimmed || null;
}

router.post('/register', async (req, res) => {
  const { email, password, firstName, lastName } = req.body || {};
  const err = validate(email, password);
  if (err) return res.status(400).json({ error: err });

  const normalized = email.toLowerCase().trim();
  if (findByEmail.get(normalized)) {
    return res.status(409).json({ error: 'email already registered' });
  }

  const first = cleanName(firstName);
  const last  = cleanName(lastName);
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const info = insertUser.run(normalized, hash, first, last);
  req.session.userId    = info.lastInsertRowid;
  req.session.email     = normalized;
  req.session.firstName = first;
  req.session.lastName  = last;
  res.status(201).json({ id: info.lastInsertRowid, email: normalized, firstName: first, lastName: last });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password required' });
  }
  const normalized = email.toLowerCase().trim();
  const user = findByEmail.get(normalized);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  req.session.userId    = user.id;
  req.session.email     = user.email;
  req.session.firstName = user.first_name;
  req.session.lastName  = user.last_name;
  res.json({ id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('scoreme.sid');
    res.status(204).end();
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  res.json({
    id: req.session.userId,
    email: req.session.email,
    firstName: req.session.firstName || null,
    lastName: req.session.lastName || null,
  });
});

module.exports = router;
