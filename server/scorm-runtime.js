const express = require('express');
const { db } = require('./db');
const { requireAuth, ownsCourse } = require('./middleware');

const router = express.Router();

const getState = db.prepare('SELECT data FROM scorm_state WHERE user_id = ? AND course_id = ?');
const upsertState = db.prepare(`
  INSERT INTO scorm_state (user_id, course_id, data, updated_at)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(user_id, course_id) DO UPDATE SET
    data = excluded.data,
    updated_at = CURRENT_TIMESTAMP
`);

router.get('/state', requireAuth, ownsCourse, (req, res) => {
  const row = getState.get(req.session.userId, req.courseId);
  let data = {};
  if (row && row.data) {
    try { data = JSON.parse(row.data); } catch { data = {}; }
  }
  res.json({ courseId: req.courseId, data });
});

router.post('/state', requireAuth, ownsCourse, (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data object required' });
  upsertState.run(req.session.userId, req.courseId, JSON.stringify(data));
  res.status(204).end();
});

module.exports = router;
