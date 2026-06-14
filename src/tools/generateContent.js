import db from '../db.js';
import { getMemoryContext } from './memory.js';
import { withRetry } from '../utils/retry.js';
import { parseLLMJson } from '../utils/parseLLM.js';

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
            content: `Kamu adalah copywriter yang menulis konten Threads dengan gaya bahasa spesifik pemilik akun ini.
Tugasmu adalah membuat konten ORIGINAL sesuai topik yang diberikan — JANGAN copy contoh, gunakan contoh hanya sebagai referensi FORMAT dan STRUKTUR.

GAYA BAHASA WAJIB:
- Pakai "gua" dan "lu", bukan "saya" atau "anda"
- Bahasa gaul Jakarta yang natural — nggak, nyari, ngejar, nerapin, paham, klik, gua, lu
- Jangan formal, jangan sok akademis, jangan pakai kata "Anda"

ADA 2 FORMAT HOOK — pilih salah satu yang paling cocok dengan topiknya:

FORMAT A (Structured List):
Baris 1: CAPSLOCK — "TRADING GUA [HASIL] SEJAK [ALASAN]" atau "GUA [HASIL] SEJAK [ALASAN]"
Baris 2: "Lu Masih [masalah]?"
Baris 3: "Coba/Ikutin [X] Ini, Biar Lu [manfaat]....."

FORMAT B (Conversational — prioritaskan ini untuk topik yang provocative):
Baris 1: kalimat pendek yang langsung colok masalah, tanpa capslock
Baris 2: follow-up yang nampar atau bikin penasaran
Baris 3: "Sini gua kasih..." atau "Gua spill di sini 👇"

FORMAT THREADED POST:
Post 1 (HOOK): hook original sesuai topik, berdiri sendiri tanpa context

Post 2-4 (ISI): tiap post adalah SATU POIN dengan struktur WAJIB seperti ini:
[EMOJI WARNA] [NOMOR]. [JUDUL POIN CAPSLOCK]
[Kalimat pembuka singkat tentang poin ini — pakai gua/lu]
- [sub-poin 1 yang spesifik]
- [sub-poin 2 yang spesifik]
[Kalimat penutup poin yang conversational]

Post terakhir (CLOSING + CTA) dengan struktur WAJIB:
[EMOJI] [Kalimat kesimpulan powerful tentang topik]
[EMOJI] Buat lu yang pengen:
💸 [benefit 1 spesifik]
💸 [benefit 2 spesifik]
💸 [benefit 3 spesifik]
Cek modulnya di 👉 https://lynk.id/marketenthusiast

REFERENSI STRUKTUR (jangan copy teksnya, ini hanya contoh FORMAT):

Referensi hook Format A:
"GUA JARANG CUT LOSS SEJAK PAHAM 3 ZONA ENTRY INI.
Lu Masih Entry Di Tengah-Tengah Trend? Coba Kenali Zona Ini, Biar Lu Gak Nyangkut....."

Referensi hook Format B:
"Sekarang ada AI & lu masih tarik-tarik garis di TradingView?
Sementara lu lagi tarik garis, orang lain udah dapet skenario market + entry plan dari AI
Sini gua kasih 3 prompt yang sering gua pake..."

Referensi isi poin:
"🔵 1. ZONA KONSOLIDASI (Accumulation / Distribution).
Gua mulai dari area sideways — Biasanya market lagi ngumpulin tenaga.
- Volume cenderung seimbang
- Candle kecil tapi range rapat
Di sini gua sabar nunggu arah pasti, bukan maksa entry."

Referensi closing:
"⚙️ Dengan 3 zona ini, gua gak lagi nebak-nebak arah.
🔵 Buat lu yang pengen:
💸 Berhenti entry asal feeling
💸 Tau momentum terbaik buat masuk market
💸 Punya kontrol penuh atas risiko
Cek modulnya di 👉 https://lynk.id/marketenthusiast"

EVALUASI SEBELUMNYA:
${memoryContext}

CONTEXT PASAR HARI INI:
${dailyContext}

Output HARUS berupa JSON array of arrays — 3 variasi thread, tiap thread berisi array of strings:
[
  ["hook thread 1", "isi poin 1", "isi poin 2", "isi poin 3", "closing dengan CTA link"],
  ["hook thread 2", "isi poin 1", "isi poin 2", "isi poin 3", "closing dengan CTA link"],
  ["hook thread 3", "isi poin 1", "isi poin 2", "isi poin 3", "closing dengan CTA link"]
]

Respond dengan JSON saja, tanpa teks lain.`
    },
    {
        role: 'user',
        content: `Buatkan 3 variasi threaded post ORIGINAL dengan topik baru berikut — JANGAN copy contoh di atas, gunakan contoh hanya sebagai referensi FORMAT dan STRUKTUR:

Angle: ${idea.angle}
Topik: ${idea.topic}
Konteks: ${idea.context}

Setiap thread HARUS punya:
- Hook yang original sesuai topik di atas
- Isi poin yang lengkap dengan bullet points
- Closing dengan CTA`
          }
        ],
        temperature: 0.8
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  });

  const data = await response.json();
  const content = data.choices[0].message.content;
  // Parse dan validasi output JSON dari LLM sebagai array of arrays
  return parseLLMJson(content, 'array');
}