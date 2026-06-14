import dotenv from 'dotenv';
dotenv.config();

import { getMemoryContext } from './memory.js';
import db from '../db.js';
import { withRetry } from '../utils/retry.js';
import { parseLLMJson } from '../utils/parseLLM.js';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;
const THREADS_USER_ID = process.env.THREADS_USER_ID;

// riset berita market hari ini (tidak berubah)
export async function researchDaily() {
    try {
        const news = await searchTavily([
            'forex market today analysis',
            'crypto bitcoin market update today',
            'trading signals forex crypto today'
        ]);

        const summary = await summarizeWithGroq(news);

        db.prepare(`
            INSERT INTO logs (event, status, detail)
            VALUES (?, ?, ?)
        `).run('research_daily', 'success', summary);

        return summary;
    } catch (error) {
        db.prepare(`
            INSERT INTO logs (event, status, detail)
            VALUES (?, ?, ?)
        `).run('research_daily', 'failed', error.message);

        throw error;
    }
}

// riset ide konten mingguan — sekarang dari post sendiri + memory
export async function researchWeeklyIdeas() {
    try {
        const memory = getMemoryContext();

        // 1. fetch semua post sendiri
        console.log('📥 Fetching semua post dari Threads...');
        const myPosts = await fetchAllMyPosts();
        console.log(`✅ Total ${myPosts.length} post berhasil diambil`);
        console.log('Sample post:', myPosts[0]);

        // 2. analisis pola dari post sendiri
        console.log('🔍 Menganalisis pola konten...');
        const postPatterns = await analyzeMyPostPatterns(myPosts);

        // 3. generate ide dari pola + memory
        const ideas = await generateIdeasWithGroq(postPatterns, memory);

        // 4. simpan ide ke database
        const insertIdea = db.prepare(`
            INSERT INTO ideas (angle, topic, context, status)
            VALUES (?, ?, ?, 'pending')
        `);

        for (const idea of ideas) {
            insertIdea.run(idea.angle, idea.topic, idea.context);
        }

        db.prepare(`
            INSERT INTO logs (event, status, detail)
            VALUES (?, ?, ?)
        `).run('research_weekly', 'success', `${ideas.length} ide disimpan`);

        console.log(`✅ ${ideas.length} ide berhasil disimpan ke database`);
        return ideas;

    } catch (error) {
        db.prepare(`
            INSERT INTO logs (event, status, detail)
            VALUES (?, ?, ?)
        `).run('research_weekly', 'failed', error.message);

        throw error;
    }
}

// fetch semua post sendiri via pagination sampai habis
async function fetchAllMyPosts() {
    const allPosts = [];
    let url = `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads?fields=id,text,timestamp,like_count,replies_count&limit=100&access_token=${THREADS_ACCESS_TOKEN}`;

    while (url) {
        const response = await withRetry(async () => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        });

        const data = await response.json();

        if (data.data && data.data.length > 0) {
            // filter hanya post yang ada teksnya
            const validPosts = data.data.filter(p => p.text && p.text.trim() !== '');
            allPosts.push(...validPosts);
        }

        // cek apakah ada halaman berikutnya
        url = data.paging?.next || null;

        // jeda supaya tidak kena rate limit
        if (url) await new Promise(resolve => setTimeout(resolve, 500));
    }

    return allPosts;
}

// analisis pola dari semua post sendiri via Groq
async function analyzeMyPostPatterns(posts) {
    // ambil teks post saja supaya tidak terlalu besar
    const top50 = posts
        .sort((a, b) => {
            const engA = (a.like_count || 0) + (a.replies_count || 0);
            const engB = (b.like_count || 0) + (b.replies_count || 0);
            return engB - engA;
        })
        .slice(0, 50)
        .map(p => ({
            text: p.text?.slice(0, 300), // ambil baris pertama (hook) saja
            likes: p.like_count || 0,
            replies: p.replies_count || 0
        }));

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
                        content: `Kamu adalah content strategist yang menganalisis pola konten trading di Threads.
Tugasmu adalah menganalisis kumpulan post berikut dan temukan:
1. Topik apa yang paling sering dibahas
2. Angle mana yang paling banyak digunakan (confessional, edukasi, contrary opinion, dll)
3. Format hook seperti apa yang dominan
4. Topik/angle mana yang engagement-nya paling tinggi berdasarkan likes dan replies

Output HARUS berupa JSON dengan format:
{
  "top_topics": ["topik 1", "topik 2", "topik 3"],
  "top_angles": ["angle 1", "angle 2", "angle 3"],
  "high_engagement_patterns": ["pola 1", "pola 2"],
  "untapped_topics": ["topik yang belum pernah dibahas tapi relevan 1", "topik 2"],
  "summary": "ringkasan singkat pola konten"
}

Respond dengan JSON saja, tanpa teks lain.`
                    },
                    {
                        role: 'user',
                        content: `Analisis pola dari ${top50.length} post berikut: ${JSON.stringify(top50)}`
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
    return parseLLMJson(content, 'object');
}

// generate ide konten dari pola post sendiri + memory
async function generateIdeasWithGroq(postPatterns, memoryContext) {
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
                        content: `Kamu adalah content strategist untuk akun Threads trading forex dan crypto.
Tugasmu adalah generate ide konten baru berdasarkan analisis pola post sebelumnya dan evaluasi performa.

${memoryContext}

ATURAN GENERATE IDE:
- Prioritaskan topik yang belum pernah dibahas (lihat untapped_topics)
- Gunakan angle yang terbukti engaging (lihat high_engagement_patterns)
- Jangan duplikasi topik yang sudah ada di top_topics kecuali dengan sudut pandang baru
- Ide harus spesifik dan actionable, bukan terlalu general

Angle yang bisa digunakan:
- Confessional: "Kesalahan yang pernah aku lakuin..."
- Contrary opinion: "Kenapa aku tidak melakukan X..."
- Breakdown: "Breakdown cara gua analisa..."
- Edukasi singkat: "Satu konsep yang wajib kamu tau..."
- Real-time take: "Pendapatku soal kondisi pasar sekarang..."
- Provocative hook: langsung colok masalah audiens

Output HARUS berupa JSON array dengan format:
[
  {
    "angle": "nama angle",
    "topic": "topik spesifik",
    "context": "kenapa topik ini relevan dan belum pernah dibahas"
  }
]

Generate tepat 10 ide. Respond dengan JSON saja, tanpa teks lain.`
                    },
                    {
                        role: 'user',
                        content: `Pola konten dari post sebelumnya: ${JSON.stringify(postPatterns)}`
                    }
                ],
                temperature: 0.7
            })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
    });

    const data = await response.json();
    const content = data.choices[0].message.content;
    return parseLLMJson(content, 'array');
}

// hit tavily api (tetap dipakai untuk researchDaily saja)
async function searchTavily(queries) {
    const result = [];

    for (const query of queries) {
        const response = await withRetry(async () => {
            const res = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TAVILY_API_KEY}`
                },
                body: JSON.stringify({
                    query,
                    search_depth: 'basic',
                    max_results: 5,
                    include_answer: true
                })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        });

        const data = await response.json();
        result.push({
            query,
            answer: data.answer,
            results: data.results?.map(r => ({
                title: r.title,
                content: r.content?.slice(0, 300)
            }))
        });
    }
    return result;
}

// rangkum hasil tavily jadi market context harian
async function summarizeWithGroq(newsData) {
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
                        content: `Kamu adalah analis pasar forex dan crypto. 
Rangkum data berita berikut menjadi market context singkat dalam Bahasa Indonesia.
Format output:
- Kondisi pasar hari ini
- Event penting yang sedang terjadi
- Sentiment umum (bullish/bearish/sideways)
Maksimal 150 kata.`
                    },
                    {
                        role: 'user',
                        content: JSON.stringify(newsData)
                    }
                ],
                temperature: 0.3
            })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
    });

    const data = await response.json();
    return data.choices[0].message.content;
}