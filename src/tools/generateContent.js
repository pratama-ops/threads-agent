import db from '../db.js';
import { getMemoryContext } from './memory.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

//generate 3 variasi draft 
export async function generateDrafts(idea, dailyContext) {
  try {
    const memoryContext = getMemoryContext();
    const drafts = await generateWithGroq(idea, dailyContext, memoryContext);

    const insertDraft = db.prepare(`
      INSERT INTO drafts (idea_id, content, variant, status)
      VALUES (?, ?, ?, 'pending')
    `);

    // drafts sekarang array of arrays
    // simpan sebagai JSON string supaya publish.js bisa parse
    for (let i = 0; i < drafts.length; i++) {
      insertDraft.run(idea.id, JSON.stringify(drafts[i]), i + 1);
    }

    db.prepare(`
      UPDATE ideas SET status = 'drafted' WHERE id = ?
    `).run(idea.id);

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
Tugasmu adalah membuat threaded post yang engaging — bukan single post biasa.

FORMAT THREADED POST:
- Post 1 (HOOK): kalimat pembuka yang bikin orang berhenti scroll. Maksimal 2 baris. Harus memancing rasa ingin tahu.
- Post 2-4 (ISI): masing-masing satu poin/insight. Singkat, padat, conversational.
- Post terakhir (CLOSING): kesimpulan atau pertanyaan yang memancing reply.

ATURAN MENULIS:
- Setiap post maksimal 300 karakter
- Bahasa Indonesia yang natural, seperti ngobrol
- Jangan terkesan jualan atau sok formal
- Angka spesifik lebih kuat dari pernyataan umum
- Hook harus bisa berdiri sendiri tanpa context

EVALUASI SEBELUMNYA:
${memoryContext}

CONTEXT PASAR HARI INI:
${dailyContext}

Output HARUS berupa JSON array of arrays — 3 variasi thread, tiap thread berisi array of strings:
[
  [
    "hook thread 1",
    "post ke-2 thread 1",
    "post ke-3 thread 1",
    "closing thread 1"
  ],
  [
    "hook thread 2",
    "post ke-2 thread 2",
    "post ke-3 thread 2",
    "closing thread 2"
  ],
  [
    "hook thread 3",
    "post ke-2 thread 3",
    "post ke-3 thread 3",
    "closing thread 3"
  ]
]

Respond dengan JSON saja, tanpa teks lain.`
        },
        {
          role: 'user',
          content: `Buatkan 3 variasi threaded post dengan:
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