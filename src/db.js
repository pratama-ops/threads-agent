// src/db.js
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../data/threads.db');

const db = new Database(DB_PATH);

// Aktifkan WAL mode supaya lebih performa
db.pragma('journal_mode = WAL');

// Tabel stok ide mingguan
db.exec(`
  CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    angle TEXT NOT NULL,
    topic TEXT NOT NULL,
    context TEXT,
    status TEXT DEFAULT 'pending',  -- pending, drafted, posted, skipped
    created_at TEXT DEFAULT (datetime('now')),
    used_at TEXT
  )
`);

// Tabel draft postingan harian
db.exec(`
  CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id INTEGER,
    content TEXT NOT NULL,
    variant INTEGER DEFAULT 1,  -- 1, 2, atau 3
    status TEXT DEFAULT 'pending',  -- pending, approved, posted, rejected
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (idea_id) REFERENCES ideas(id)
  )
`);

// Tabel post yang sudah dipublish
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id INTEGER,
    threads_post_id TEXT,          -- ID dari Threads API
    content TEXT NOT NULL,
    posted_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (draft_id) REFERENCES drafts(id)
  )
`);

// Tabel metrics performa tiap post
db.exec(`
  CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    reposts INTEGER DEFAULT 0,
    fetched_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  )
`);

// Tabel log aktivitas agent
db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,           -- research, generate, post, evaluate
    status TEXT NOT NULL,          -- success, failed
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

console.log('✅ Database initialized');

export default db;