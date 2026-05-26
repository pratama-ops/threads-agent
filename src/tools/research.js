import dotenv from 'dotenv';
dotenv.config();

import { getMemoryContext } from './memory.js';
import db from '../db.js';
import { withRetry } from '../utils/retry.js';
import { parseLLMJson } from '../utils/parseLLM.js';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

//riset berita market hari ini
export async function researchDaily() {
    try {
        //cari berita forex & crypto terkini via tavily
        const news = await searchTavily([
            'forex market today analysis',
            'crypto bitcoin market update today',
            'trading signals forex crypto today'
        ]);

        //rangkum hasil riset 
        const summary = await summarizeWithGroq(news);

        //insert db
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

//riset ide konten untuk stok 7 hari
export async function researchWeeklyIdeas() {
    try {
        const memory = getMemoryContext();

        //1. cari trending angle di niche trading
        const trending = await searchTavily([
            'forex trading tips trending 2025',
            'crypto trading strategy viral content',
            'trading mistakes beginners forex crypto',
            'price action trading explained simple'
        ]);

        //2. generate 7-14 ide via groq
        const ideas = await generateIdeasWithGroq(trending, memory);

        //3. simpen ide ke database
        const insertIdea = db.prepare(`
      INSERT INTO ideas (angle, topic, context, status)
      VALUES (?, ?, ?, 'pending')
    `);

        //karena isi dari generatte groq ideas adalah array, sehingga perlu loop untuk insert ke db
        for (const idea of ideas) {
            insertIdea.run(idea.angle, idea.topic, idea.context)
        }

        //4. log
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

//hit tavily api
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

//rangkum hasil dari tavily jadi market context harian
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
    const content = data.choices[0].message.content;
    return content; // Returns string summary, no JSON parsing needed
}

//generate ide konten mingguan
async function generateIdeasWithGroq(trendingData, memoryContext) {
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
                        content: `Kamu adalah content strategist untuk akun Threads tentang trading forex dan crypto.
Tugasmu adalah generate ide konten yang engaging berdasarkan data trending dan evaluasi sebelumnya.

${memoryContext}

Angle yang bisa digunakan:
- Confessional: "Kesalahan yang pernah aku lakuin..."
- Contrary opinion: "Kenapa aku tidak melakukan X..."
- Breakdown trade: "Breakdown trade aku minggu ini..."
- Edukasi singkat: "Satu konsep yang wajib kamu tau..."
- Real-time take: "Pendapatku soal kondisi pasar sekarang..."

Output HARUS berupa JSON array dengan format:
[
  {
    "angle": "nama angle",
    "topic": "topik spesifik",
    "context": "kenapa topik ini relevan sekarang"
  }
]

Generate tepat 10 ide. Respond dengan JSON saja, tanpa teks lain.`
                    },
                    {
                        role: 'user',
                        content: `Data trending minggu ini: ${JSON.stringify(trendingData)}`
                    }
                ],
                temperature: 0.7
            })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
    });
    const data = await response.json()
    console.log('Groq response:', JSON.stringify(data, null, 2)); 
    const content = data.choices[0].message.content;

    // Parse dan validasi output JSON dari LLM sebagai array
    return parseLLMJson(content, 'array');
}