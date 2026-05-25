import db from '../db.js';
import { getMemoryContext } from './memory.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Fungsi utama: generate 3 variasi draft dari 1 ide
export async function generateDrafts(idea, dailyContext) {
  try {
    const memoryContext = getMemoryContext();

    // 1. Generate 3 variasi draft
    const drafts = await generateWithGroq(idea, dailyContext, memoryContext);

    // 2. Simpan semua variasi ke database
    const insertDraft = db.prepare(`
      INSERT INTO drafts (idea_id, content, variant, status)
      VALUES (?, ?, ?, 'pending')
    `);

    for (let i = 0; i < drafts.length; i++) {
      insertDraft.run(idea.id, drafts[i], i + 1);
    }

    // 3. Update status ide jadi 'drafted'
    db.prepare(`
      UPDATE ideas SET status = 'drafted' WHERE id = ?
    `).run(idea.id);

    // 4. Log
    db.prepare(`
      INSERT INTO logs (event, status, detail)
      VALUES (?, ?, ?)
    `).run('generate_content', 'success', `3 draft dibuat untuk ide id ${idea.id}`);

    console.log(`✅ 3 draft berhasil digenerate untuk: ${idea.topic}`);
    return drafts;

  } catch (error) {
    db.prepare(`
      INSERT INTO logs (event, status, detail)
      VALUES (?, ?, ?)
    `).run('generate_content', 'failed', error.message);

    throw error;
  }
}

// Ambil 1 ide dari database untuk diproses
export function getNextIdea() {
  const idea = db.prepare(`
    SELECT * FROM ideas
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
  `).get();

  if (!idea) {
    console.log('⚠️ Stok ide habis, perlu riset mingguan dulu');
    return null;
  }

  return idea;
}

// hit Groq API untuk generate 3 variasi draft
async function generateWithGroq(idea, dailyContext, memoryContext) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
          content: `Kamu adalah copywriter ahli untuk konten Threads tentang trading forex dan crypto.
Tugasmu adalah membuat postingan Threads yang engaging, singkat, dan memancing interaksi.

ATURAN MENULIS:
- Maksimal 400 karakter per postingan
- Baris pertama HARUS berupa hook yang kuat — orang harus berhenti scroll
- Gunakan bahasa Indonesia yang natural dan conversational
- Hindari terkesan jualan atau promosi
- Boleh pakai angka spesifik untuk hook (contoh: "3 kesalahan yang...")
- Akhiri dengan pertanyaan atau statement yang memancing reply

EVALUASI SEBELUMNYA:
${memoryContext}

CONTEXT PASAR HARI INI:
${dailyContext}

Output HARUS berupa JSON array berisi tepat 3 string postingan:
["draft 1", "draft 2", "draft 3"]

Respond dengan JSON saja, tanpa teks lain.`
        },
        {
          role: 'user',
          content: `Buatkan 3 variasi postingan Threads dengan:
Angle: ${idea.angle}
Topik: ${idea.topic}
Konteks: ${idea.context}`
        }
      ],
      temperature: 0.8
    })
  });

  const data = await response.json();
  const content = data.choices[0].message.content;

  const clean = content.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}