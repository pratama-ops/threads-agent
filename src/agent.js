import dotenv from 'dotenv';
dotenv.config();

import { researchWeeklyIdeas, researchDaily } from './tools/research.js';
import { generateDrafts, getNextIdea } from './tools/generateContent.js';
import { readMemory, writeMemory, addLearning, addAvoid, updateWeeklySummary, logActivity } from './tools/memory.js';
import { publishPost, getApprovedDraft } from './tools/publish.js';
import { fetchAllMetrics } from './tools/analytic.js';
import db from './db.js';
import { withRetry } from './utils/retry.js';
import { parseLLMJson } from './utils/parseLLM.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// WEEKLY WORKFLOW
// Jalan setiap Senin pagi
export async function runWeeklyWorkflow() {
  console.log('🔄 Memulai weekly workflow...');

  try {
    // 1. Cek stok ide yang tersisa
    const remainingIdeas = db.prepare(`
      SELECT COUNT(*) as count FROM ideas WHERE status = 'pending'
    `).get();

    console.log(`📦 Stok ide tersisa: ${remainingIdeas.count}`);

    // Ambil metrics dulu sebelum evaluasi
    console.log('📊 Mengambil metrics post minggu lalu...');
    await fetchAllMetrics();

    // Baru evaluasi dengan data metrics yang sudah ada
    await runEvaluation();

    // 2. Riset ide baru
    console.log('🔍 Riset ide minggu ini...');
    await researchWeeklyIdeas();

    console.log('✅ Weekly workflow selesai');

  } catch (error) {
    console.error('❌ Weekly workflow error:', error.message);
    logActivity('weekly_workflow', 'failed', error.message);
  }
}

// DAILY WORKFLOW
// Jalan setiap hari jam 6 sore
export async function runDailyWorkflow() {
  console.log('🔄 Memulai daily workflow...');

  try {
    // 1. Ambil ide berikutnya dari stok
    const idea = getNextIdea();

    if (!idea) {
      console.log('⚠️ Tidak ada ide tersisa, skip hari ini');
      logActivity('daily_workflow', 'failed', 'Stok ide kosong');
      return;
    }

    console.log(`💡 Ide hari ini: [${idea.angle}] ${idea.topic}`);

    // 2. Riset market context hari ini
    console.log('📰 Riset market context hari ini...');
    const dailyContext = await researchDaily();

    // 3. Generate 3 draft
    console.log('✍️ Generate draft postingan...');
    const drafts = await generateDrafts(idea, dailyContext);

    // 4. Kirim ke Telegram untuk review
    await sendToTelegram(idea, drafts);

    logActivity('daily_workflow', 'success', `Draft dibuat untuk ide: ${idea.topic}`);
    console.log('✅ Daily workflow selesai, menunggu approval kamu');

  } catch (error) {
    console.error('❌ Daily workflow error:', error.message);
    logActivity('daily_workflow', 'failed', error.message);
  }
}

// EVALUATION
// Dijalankan setiap Senin sebagai bagian weekly workflow
async function runEvaluation() {
  console.log('📊 Menjalankan evaluasi minggu lalu...');

  try {
    // 1. Ambil semua post minggu lalu beserta metricsnya
    const posts = db.prepare(`
      SELECT 
        p.id,
        p.content,
        p.posted_at,
        d.idea_id,
        i.angle,
        i.topic,
        m.views,
        m.likes,
        m.replies,
        m.reposts
      FROM posts p
      JOIN drafts d ON p.draft_id = d.id
      JOIN ideas i ON d.idea_id = i.id
      LEFT JOIN metrics m ON m.post_id = p.id
      WHERE p.posted_at >= datetime('now', '-7 days')
      ORDER BY m.likes DESC
    `).all();

    if (posts.length === 0) {
      console.log('⚠️ Belum ada post minggu lalu untuk dievaluasi');
      return;
    }

    // 2. Kirim data ke Groq untuk analisa pola
    const evaluation = await evaluateWithGroq(posts);

    // 3. Update memory.json dengan hasil evaluasi
    for (const learning of evaluation.learnings) {
      addLearning(learning);
    }

    for (const avoid of evaluation.avoid) {
      addAvoid(avoid);
    }

    // 4. Update best performing
    const memory = readMemory();
    if (evaluation.best_angles?.length > 0) {
      memory.best_performing.angles = evaluation.best_angles;
    }
    if (evaluation.best_formats?.length > 0) {
      memory.best_performing.formats = evaluation.best_formats;
    }
    if (evaluation.best_time) {
      memory.best_performing.posting_time = evaluation.best_time;
    }
    writeMemory(memory);

    // 5. Simpan weekly summary
    //menghitung rata rata like/post
    const avgLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0) / posts.length;
    const avgReplies = posts.reduce((sum, p) => sum + (p.replies || 0), 0) / posts.length;

    updateWeeklySummary({
      week: new Date().toISOString().split('T')[0],
      total_posts: posts.length,
      avg_likes: Math.round(avgLikes),
      avg_replies: Math.round(avgReplies),
      top_post_id: posts[0]?.id
    });

    logActivity('evaluation', 'success', `${evaluation.learnings.length} learnings baru ditambahkan`);
    console.log(`✅ Evaluasi selesai: ${evaluation.learnings.length} learnings baru`);

  } catch (error) {
    console.error('❌ Evaluasi error:', error.message);
    logActivity('evaluation', 'failed', error.message);
  }
}

// Evaluasi dengan Groq
async function evaluateWithGroq(posts) {
  const response = await withRetry(async () => {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `Kamu adalah analis konten media sosial yang spesialis di niche trading forex dan crypto.
Tugasmu adalah menganalisa performa postingan Threads dan menghasilkan insights yang actionable.

Output HARUS berupa JSON dengan format:
{
  "learnings": ["insight 1", "insight 2", ...],
  "avoid": ["hal yang harus dihindari 1", ...],
  "best_angles": ["angle terbaik 1", "angle terbaik 2"],
  "best_formats": ["format terbaik 1", "format terbaik 2"],
  "best_time": "jam posting terbaik atau null"
}

Respond dengan JSON saja, tanpa teks lain.`
          },
          {
            role: 'user',
            content: `Analisa performa postingan berikut dan berikan insights:
${JSON.stringify(posts, null, 2)}`
          }
        ],
        temperature: 0.3
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  });

  const data = await response.json();
  const content = data.choices[0].message.content;
  // Parse dan validasi output JSON dari LLM sebagai object
  return parseLLMJson(content, 'object');
}

// Kirim draft ke Telegram
async function sendToTelegram(idea, drafts) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('\n📝 DRAFT HARI INI:');
    console.log(`Ide: [${idea.angle}] ${idea.topic}\n`);
    drafts.forEach((thread, i) => {
      console.log(`--- Thread ${i + 1} ---`);
      thread.forEach((post, j) => {
        console.log(`Post ${j + 1}: ${post}`);
      });
      console.log('');
    });
    return;
  }

  // Format tiap thread supaya keliatan struktur layering-nya
  const formatThread = (thread, index) => {
    return `*Thread ${index + 1}:*\n` + thread.map((post, i) => {
      const label = i === 0 ? '🪝 Hook' : i === thread.length - 1 ? '🔚 Closing' : `📌 Post ${i + 1}`;
      return `${label}:\n${post}`;
    }).join('\n\n');
  };

  const message = `
🤖 *Draft Threads Hari Ini*
💡 *Ide:* ${idea.topic}
🎯 *Angle:* ${idea.angle}

${formatThread(drafts[0], 0)}

${formatThread(drafts[1], 1)}

${formatThread(drafts[2], 2)}

Reply dengan:
*1* → pilih thread 1
*2* → pilih thread 2
*3* → pilih thread 3
*edit: [teks]* → pakai versi kamu sendiri
*skip* → skip hari ini
  `.trim();

  await withRetry(async () => {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  });

  console.log('📨 Draft dikirim ke Telegram');
}

// Jalankan function publish ke threads setelah approval
export async function runPublishWorkflow() {
  const approved = getApprovedDraft();

  if (!approved) {
    console.log('⚠️ Tidak ada draft yang approved');
    return;
  }

  console.log(`📤 Publishing: ${approved.content}`);
  await publishPost(approved.id, approved.content);
}