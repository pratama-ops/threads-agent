import dotenv from 'dotenv';
dotenv.config();

import db from '../db.js';

const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;

/**
 * Ambil metrics dari Threads API untuk semua post yang belum diukur.
 * Dipanggil setiap Senin sebagai bagian dari weekly workflow.
 */
export async function fetchAllMetrics() {
  try {
    // Ambil semua post yang belum ada metricsnya
    const posts = db.prepare(`
      SELECT p.id, p.threads_post_id, p.posted_at
      FROM posts p
      LEFT JOIN metrics m ON m.post_id = p.id
      WHERE m.id IS NULL
    `).all();

    if (posts.length === 0) {
      console.log('⚠️ Tidak ada post baru yang perlu diambil metricsnya');
      return [];
    }

    console.log(`📊 Mengambil metrics untuk ${posts.length} post...`);

    const results = [];

    for (const post of posts) {
      try {
        const metrics = await fetchPostMetrics(post.threads_post_id);

        // Simpan ke tabel metrics
        db.prepare(`
          INSERT INTO metrics (post_id, views, likes, replies, reposts)
          VALUES (?, ?, ?, ?, ?)
        `).run(post.id, metrics.views, metrics.likes, metrics.replies, metrics.reposts);

        results.push({ post_id: post.id, ...metrics });
        console.log(`✅ Metrics post ${post.threads_post_id}: views=${metrics.views} likes=${metrics.likes} replies=${metrics.replies}`);

        // Jeda supaya tidak kena rate limit
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`❌ Gagal ambil metrics post ${post.threads_post_id}:`, error.message);
      }
    }

    db.prepare(`
      INSERT INTO logs (event, status, detail)
      VALUES (?, ?, ?)
    `).run('analytics', 'success', `Metrics diambil untuk ${results.length} post`);

    return results;

  } catch (error) {
    db.prepare(`
      INSERT INTO logs (event, status, detail)
      VALUES (?, ?, ?)
    `).run('analytics', 'failed', error.message);

    throw error;
  }
}

/**
 * Ambil metrics satu post dari Threads API.
 * @param {string} threadsPostId - ID post dari Threads
 * @returns {object} views, likes, replies, reposts
 */
async function fetchPostMetrics(threadsPostId) {
  const response = await fetch(
    `https://graph.threads.net/v1.0/${threadsPostId}/insights?metric=views,likes,replies,reposts&access_token=${THREADS_ACCESS_TOKEN}`,
    { method: 'GET' }
  );

  const data = await response.json();

  if (data.error) {
    throw new Error(`Threads API error: ${data.error.message}`);
  }

  // Parse response dari Threads API
  const result = { views: 0, likes: 0, replies: 0, reposts: 0 };

  //(data.data) = array metrics yg ada di dalam output dari variabel data, itu karena design api dari meta
  if (data.data) {
    //pakai loop karena tiap metric adalah item terpisah dalam array untuk mengambil nilai
    for (const item of data.data) {
      if (item.name === 'views') result.views = item.values?.[0]?.value || 0;
      if (item.name === 'likes') result.likes = item.values?.[0]?.value || 0;
      if (item.name === 'replies') result.replies = item.values?.[0]?.value || 0;
      if (item.name === 'reposts') result.reposts = item.values?.[0]?.value || 0;
    }
  }

  return result;
}