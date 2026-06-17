const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { nanoid } = require('nanoid');
const { db, STORAGE_DIR } = require('./db');
const { requireAuth, ownsCourse } = require('./middleware');
const { parseManifest } = require('./scorm-parser');

const ZIPS_DIR    = path.join(STORAGE_DIR, 'zips');
const COURSES_DIR = path.join(STORAGE_DIR, 'courses');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const listByOwner = db.prepare(`
  SELECT c.id, c.title, c.scorm_version, c.entry_point, c.original_filename, c.uploaded_at,
         s.data AS state_data
  FROM courses c
  LEFT JOIN scorm_state s ON s.course_id = c.id AND s.user_id = c.owner_id
  WHERE c.owner_id = ?
  ORDER BY c.uploaded_at DESC
`);
const insertCourse = db.prepare(`
  INSERT INTO courses (id, owner_id, title, scorm_version, entry_point, original_filename)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const getCourse = db.prepare(`
  SELECT id, owner_id, title, scorm_version, entry_point, original_filename, uploaded_at
  FROM courses WHERE id = ?
`);
const deleteCourseStmt = db.prepare('DELETE FROM courses WHERE id = ?');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function safeExtract(zipBuffer, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const rootResolved = path.resolve(targetDir) + path.sep;

  for (const entry of entries) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    if (entryName.includes('..')) throw new Error(`zip-slip detected: ${entryName}`);
    if (entryName.startsWith('__MACOSX/') || entryName.endsWith('/.DS_Store')) continue;
    const outPath = path.resolve(targetDir, entryName);
    if (!outPath.startsWith(rootResolved) && outPath !== path.resolve(targetDir)) {
      throw new Error(`zip-slip detected: ${entryName}`);
    }
    if (entry.isDirectory) {
      fs.mkdirSync(outPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, entry.getData());
    }
  }
}

// Если zip упакован как «папка-обёртка» (а не файлы россыпью в корне),
// поднимаем содержимое единственной подпапки наверх, чтобы imsmanifest.xml
// оказался в корне courseDir.
function flattenWrapperDir(courseDir) {
  if (fs.existsSync(path.join(courseDir, 'imsmanifest.xml'))) return;

  const items = fs.readdirSync(courseDir, { withFileTypes: true })
    .filter((d) => d.name !== '__MACOSX' && d.name !== '.DS_Store');
  const dirs  = items.filter((d) => d.isDirectory());
  const files = items.filter((d) => d.isFile());

  if (files.length === 0 && dirs.length === 1) {
    const inner = path.join(courseDir, dirs[0].name);
    if (fs.existsSync(path.join(inner, 'imsmanifest.xml'))) {
      for (const child of fs.readdirSync(inner)) {
        fs.renameSync(path.join(inner, child), path.join(courseDir, child));
      }
      fs.rmdirSync(inner);
    }
  }
}

function pickStatus(stateJson) {
  if (!stateJson) return null;
  try {
    const d = JSON.parse(stateJson);
    const status = d['cmi.completion_status'] || d['cmi.core.lesson_status'] || null;
    const success = d['cmi.success_status'] || null;
    const score = d['cmi.score.raw'] || d['cmi.core.score.raw'] || null;
    return { status, success, score };
  } catch { return null; }
}

router.get('/', requireAuth, (req, res) => {
  const rows = listByOwner.all(req.session.userId);
  res.json(rows.map((r) => ({
    id: r.id,
    title: r.title,
    scorm_version: r.scorm_version,
    entry_point: r.entry_point,
    original_filename: r.original_filename,
    uploaded_at: r.uploaded_at,
    progress: pickStatus(r.state_data),
  })));
});

router.post('/', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required (field name: file)' });

  const id = nanoid(12);
  const courseDir = path.join(COURSES_DIR, id);
  const zipPath   = path.join(ZIPS_DIR, id + '.zip');

  try {
    safeExtract(req.file.buffer, courseDir);
    flattenWrapperDir(courseDir);
    const info = parseManifest(courseDir);
    fs.writeFileSync(zipPath, req.file.buffer);
    insertCourse.run(id, req.session.userId, info.title, info.version, info.entryPoint, req.file.originalname || null);
    res.status(201).json({
      id, title: info.title, scorm_version: info.version,
      entry_point: info.entryPoint, original_filename: req.file.originalname,
    });
  } catch (err) {
    rmrf(courseDir);
    rmrf(zipPath);
    res.status(400).json({ error: err.message || 'upload failed' });
  }
});

router.get('/:id', requireAuth, ownsCourse, (req, res) => {
  const row = getCourse.get(req.params.id);
  res.json({
    id: row.id, title: row.title, scorm_version: row.scorm_version,
    entry_point: row.entry_point, original_filename: row.original_filename,
    uploaded_at: row.uploaded_at,
  });
});

router.delete('/:id', requireAuth, ownsCourse, (req, res) => {
  rmrf(path.join(COURSES_DIR, req.params.id));
  rmrf(path.join(ZIPS_DIR, req.params.id + '.zip'));
  deleteCourseStmt.run(req.params.id);
  res.status(204).end();
});

router.get('/:id/download', requireAuth, ownsCourse, (req, res) => {
  const row = getCourse.get(req.params.id);
  const zipPath = path.join(ZIPS_DIR, req.params.id + '.zip');
  if (!fs.existsSync(zipPath)) return res.status(404).json({ error: 'archive missing' });
  res.download(zipPath, row.original_filename || (row.title + '.zip'));
});

module.exports = { router, COURSES_DIR };
