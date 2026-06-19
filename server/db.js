const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const STORAGE_DIR = path.resolve(__dirname, '..', 'storage');
const DB_PATH = path.join(STORAGE_DIR, 'data.db');

fs.mkdirSync(STORAGE_DIR, { recursive: true });
fs.mkdirSync(path.join(STORAGE_DIR, 'zips'), { recursive: true });
fs.mkdirSync(path.join(STORAGE_DIR, 'courses'), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name    TEXT,
    last_name     TEXT,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS courses (
    id                TEXT PRIMARY KEY,
    owner_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    scorm_version     TEXT NOT NULL,
    entry_point       TEXT NOT NULL,
    original_filename TEXT,
    mastery_score     REAL,
    uploaded_at       TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scorm_state (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id  TEXT    NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, course_id)
  );

  CREATE INDEX IF NOT EXISTS idx_courses_owner ON courses(owner_id);
`);

// Миграции для баз, созданных до появления новых колонок.
try { db.exec('ALTER TABLE courses ADD COLUMN mastery_score REAL'); } catch (_) { /* уже есть */ }
try { db.exec('ALTER TABLE users ADD COLUMN first_name TEXT'); } catch (_) { /* уже есть */ }
try { db.exec('ALTER TABLE users ADD COLUMN last_name TEXT'); } catch (_) { /* уже есть */ }

module.exports = { db, STORAGE_DIR };
