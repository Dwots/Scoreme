const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { db, STORAGE_DIR } = require('./db');
const { requireAuth } = require('./middleware');
const authRouter = require('./auth');
const { router: coursesRouter, COURSES_DIR } = require('./courses');
const scormRuntimeRouter = require('./scorm-runtime');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  console.warn('[ScoreMe] SESSION_SECRET not set; generating random secret (sessions reset on restart)');
  return crypto.randomBytes(32).toString('hex');
})();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: STORAGE_DIR, table: 'sessions' }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
  name: 'scoreme.sid',
}));

app.use('/api/auth', authRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/scorm', scormRuntimeRouter);

const ownerStmt = db.prepare('SELECT owner_id FROM courses WHERE id = ?');
const staticCache = new Map();
function staticForCourse(id) {
  if (!staticCache.has(id)) {
    staticCache.set(id, express.static(path.join(COURSES_DIR, id), { fallthrough: false }));
  }
  return staticCache.get(id);
}

app.use('/content/:id', requireAuth, (req, res, next) => {
  const row = ownerStmt.get(req.params.id);
  if (!row) return res.status(404).end();
  if (row.owner_id !== req.session.userId) return res.status(403).end();
  staticForCourse(req.params.id)(req, res, next);
});

app.use(express.static(PUBLIC_DIR));

app.use((req, res) => res.status(404).json({ error: 'not found' }));

app.use((err, req, res, _next) => {
  console.error('[ScoreMe] error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: err.message || 'internal error' });
});

app.listen(PORT, () => {
  console.log(`[ScoreMe] listening on http://localhost:${PORT}`);
  console.log(`[ScoreMe] storage: ${STORAGE_DIR}`);
});
