import dotenv from 'dotenv';
dotenv.config();

import db from '../db.js';

const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;
const THREADS_USER_ID = process.env.THREADS_USER_ID;

// Fungsi utama: publish threaded post ke Threads
export async function publishPost(draftId, content) {
  try {
    // content sekarang JSON string dari array, perlu di-parse dulu
    const posts = JSON.parse(content);

    let previousPostId = null;

    for (let i = 0; i < posts.length; i++) {
      const isFirst = i === 0;

      // Buat container — kalau bukan post pertama, reply ke post sebelumnya
      const containerId = await createContainer(posts[i], isFirst ? null : previousPostId);
      console.log(`📦 Container post ${i + 1} dibuat: ${containerId}`);

      // Tambah jeda 3 detik setelah create container
  await new Promise(resolve => setTimeout(resolve, 3000));

      // Publish container
      const threadId = await publishContainer(containerId);
      console.log(`🚀 Post ${i + 1} dipublish: ${threadId}`);

      // Post pertama yang disimpan ke tabel posts
      if (isFirst) {
        db.prepare(`
          INSERT INTO posts (draft_id, threads_post_id, content)
          VALUES (?, ?, ?)
        `).run(draftId, threadId, posts[0]);

        db.prepare(`
          UPDATE drafts SET status = 'posted' WHERE id = ?
        `).run(draftId);

        db.prepare(`
          UPDATE ideas SET status = 'posted', used_at = datetime('now')
          WHERE id = (SELECT idea_id FROM drafts WHERE id = ?)
        `).run(draftId);
      }

      // Simpan ID post ini untuk dijadikan reply_to_id post berikutnya
      previousPostId = threadId;

      // Jeda sebentar supaya tidak kena rate limit
      if (i < posts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    db.prepare(`
      INSERT INTO logs (event, status, detail)
      VALUES (?, ?, ?)
    `).run('publish', 'success', `Thread ${posts.length} post dipublish`);

    console.log(`✅ Thread berhasil dipublish (${posts.length} post)`);
    return previousPostId;

  } catch (error) {
    db.prepare(`
      INSERT INTO logs (event, status, detail)
      VALUES (?, ?, ?)
    `).run('publish', 'failed', error.message);

    throw error;
  }
}

// Helper: buat container — kalau ada replyToId berarti ini reply ke post sebelumnya
async function createContainer(text, replyToId = null) {
  const body = {
    media_type: 'TEXT',
    text,
    access_token: THREADS_ACCESS_TOKEN
  };

  // Kalau bukan post pertama, tambahkan reply_to_id
  if (replyToId) {
    body.reply_to_id = replyToId;
  }

  const response = await fetch(
    `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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