const { db } = require('./db');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'unauthorized' });
}

const findOwnerStmt = db.prepare('SELECT owner_id FROM courses WHERE id = ?');

function ownsCourse(req, res, next) {
  const id = req.params.id || req.params.courseId || req.query.courseId || req.body.courseId;
  if (!id) return res.status(400).json({ error: 'course id required' });
  const row = findOwnerStmt.get(id);
  if (!row) return res.status(404).json({ error: 'course not found' });
  if (row.owner_id !== req.session.userId) return res.status(403).json({ error: 'forbidden' });
  req.courseId = id;
  next();
}

module.exports = { requireAuth, ownsCourse };
