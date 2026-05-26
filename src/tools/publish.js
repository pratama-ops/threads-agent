import dotenv from 'dotenv';
dotenv.config();

import db from '../db.js';

const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;
const THREADS_USER_ID = process.env.THREADS_USER_ID;

// Fungsi utama: publish post ke Threads
export async function publishPost(draftId, content) {
  try {
    // Step 1: Buat container post
    const containerId = await createContainer(content);
    console.log(`📦 Container dibuat: ${containerId}`);

    // Step 2: Publish container
    const threadId = await publishContainer(containerId);
    console.log(`🚀 Post berhasil dipublish: ${threadId}`);

    // Step 3: Simpan ke tabel posts
    db.prepare(`
      INSERT INTO posts (draft_id, threads_post_id, content)
      VALUES (?, ?, ?)
    `).run(draftId, threadId, content);

    // Step 4: Update status draft jadi posted
    db.prepare(`
      UPDATE drafts SET status = 'posted' WHERE id = ?
    `).run(draftId);

    // Step 5: Update status idea jadi posted
    db.prepare(`
      UPDATE ideas SET status = 'posted', used_at = datetime('now')
      WHERE id = (SELECT idea_id FROM drafts WHERE id = ?)
    `).run(draftId);

    // Step 6: Log
    db.prepare(`
      INSERT INTO logs (event, status, detail)
      VALUES (?, ?, ?)
    `).run('publish', 'success', `Post ID: ${threadId}`);

    console.log(`✅ Post berhasil disimpan ke database`);
    return threadId;

  } catch (error) {
    db.prepare(`
      INSERT INTO logs (event, status, detail)
      VALUES (?, ?, ?)
    `).run('publish', 'failed', error.message);

    throw error;
  }
}

// Helper: Step 1 - buat media container
async function createContainer(content) {
  const response = await fetch(
    `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'TEXT',
        text: content,
        access_token: THREADS_ACCESS_TOKEN
      })
    }
  );

  const data = await response.json();

  if (data.error) {
    throw new Error(`Threads API error: ${data.error.message}`);
  }

  return data.id;
}

// Helper: Step 2 - publish container yang sudah dibuat
async function publishContainer(containerId) {
  const response = await fetch(
    `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: THREADS_ACCESS_TOKEN
      })
    }
  );

  const data = await response.json();

  if (data.error) {
    throw new Error(`Threads publish error: ${data.error.message}`);
  }

  return data.id;
}

// Ambil post yang sudah diapprove tapi belum diposting
export function getApprovedDraft() {
  return db.prepare(`
    SELECT d.*, i.topic, i.angle
    FROM drafts d
    JOIN ideas i ON d.idea_id = i.id
    WHERE d.status = 'approved'
    ORDER BY d.created_at
    LIMIT 1
  `).get();
}

//dibuat terpisah dengan 2 helper karena cara kerja dari api threads sendiri, threads simpan konten dulu tapi belum di publish, helper publish container untuk publish post ke threads