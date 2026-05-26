import fs, { write } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_PATH = path.join(__dirname, '../../data/memory.json');

//baca file memory
export function readMemory() {
    const raw = fs.readFileSync(MEMORY_PATH, 'utf-8');
    return JSON.parse(raw);
}

//tulis ke dalam file memory
export function writeMemory(data) {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(data, null, 2));
}

//tambahkan learning baru setelah selesai evaluasi
export function addLearning(learning) {
    const memory = readMemory();

    //kalau learning itu belum ada di list, baru tambahkan
    if (!memory.learnings.includes(learning)) {
        memory.learnings.push(learning)
    }
    memory.last_updated = new Date().toISOString().split('T')[0];
    writeMemory(memory);
}

//tambahkan hal yang harus dihindari
export function addAvoid(item) {
    const memory = readMemory();

    //kalau list avoid itu belum ada, baru tambahkan
    if (!memory.avoid.includes(item)) {
        memory.avoid.push(item)
    }
    writeMemory(memory)
}

//ambil data dari memory untuk di inject di prompt
export function getMemoryContext() {
    const memory = readMemory();
    if (memory.learnings.length == 0) {
        return 'Belum ada data yang di evaluasi sebelumnya!'
    }

    return `
LEARNINGS DARI SIKLUS SEBELUMNYA:
- ${memory.learnings.join('\n- ')}

YANG HARUS DIHINDARI:
- ${memory.avoid.join('\n- ')}

ANGLE TERBAIK: ${memory.best_performing.angles.join(', ')}
FORMAT TERBAIK: ${memory.best_performing.formats.join(', ')}
JAM POSTING TERBAIK: ${memory.best_performing.posting_time || 'belum ada data'}
  `.trim();
}

//update summary mingguan 
export function updateWeeklySummary(summary) {
    const memory = readMemory();
    
    //tambahkan ringkasan minggu ini ke array weekly_summary
    memory.weekly_summary.push(summary);
    memory.cycles_completed += 1
    memory.last_updated = new Date().toISOString().split('T')[0]
    writeMemory(memory)
}

// masukkan aktivitas agent ke SQLite
export function logActivity(event, status, detail = null) {
  db.prepare(`
    INSERT INTO logs (event, status, detail)
    VALUES (?, ?, ?)
  `).run(event, status, detail);
}