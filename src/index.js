import dotenv from 'dotenv';
dotenv.config();

import db from './db.js';
import { startScheduler } from './scheduler.js';
import { runWeeklyWorkflow, runDailyWorkflow } from './agent.js';
import TelegramBot from 'node-telegram-bot-api';

//menangkap kalimat yang di entry dari terminal
const args = process.argv.slice(2);

// Setup Telegram bot listener
function startTelegramListener() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('⚠️ Telegram belum dikonfigurasi, skip listener');
    return;
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log('📱 Telegram bot aktif, menunggu approval...');

  bot.on('message', async (msg) => {
    // Pastikan pesan dari chat ID kamu sendiri
    if (msg.chat.id.toString() !== chatId.toString()) return;

    const text = msg.text?.trim();

    // Ambil draft pending dari database
    const pendingDraft = db.prepare(`
      SELECT d.*, i.topic, i.angle 
      FROM drafts d
      JOIN ideas i ON d.idea_id = i.id
      WHERE d.status = 'pending'
      ORDER BY d.created_at DESC
      LIMIT 3
    `).all();

    if (pendingDraft.length === 0) {
      bot.sendMessage(chatId, '⚠️ Tidak ada draft yang menunggu approval');
      return;
    }

    // Pilih draft berdasarkan reply kamu
    if (['1', '2', '3'].includes(text)) {
      const chosen = pendingDraft.find(d => d.variant === parseInt(text));

      if (!chosen) {
        bot.sendMessage(chatId, '⚠️ Draft tidak ditemukan');
        return;
      }

      // Update status draft yang dipilih jadi approved
      db.prepare(`
        UPDATE drafts SET status = 'approved' WHERE id = ?
      `).run(chosen.id);

      // Reject draft lainnya
      for (const draft of pendingDraft) {
        if (draft.id !== chosen.id) {
          db.prepare(`
            UPDATE drafts SET status = 'rejected' WHERE id = ?
          `).run(draft.id);
        }
      }

      bot.sendMessage(chatId, `✅ Draft ${text} diapprove!\n\n"${chosen.content}"\n\nSedang dipost ke Threads...`);
      console.log(`✅ Draft ${text} diapprove: ${chosen.content}`);

    } else if (text.toLowerCase().startsWith('edit:')) {
      // Pakai versi custom dari kamu
      const customContent = text.slice(5).trim();

      // Reject semua draft pending
      for (const draft of pendingDraft) {
        db.prepare(`
          UPDATE drafts SET status = 'rejected' WHERE id = ?
        `).run(draft.id);
      }

      // Simpan versi custom sebagai draft baru yang approved
      const ideaId = pendingDraft[0].idea_id;
      db.prepare(`
        INSERT INTO drafts (idea_id, content, variant, status)
        VALUES (?, ?, 0, 'approved')
      `).run(ideaId, customContent);

      bot.sendMessage(chatId, `✅ Versi custom disimpan!\n\n"${customContent}"\n\nSedang dipost ke Threads...`);
      console.log(`✅ Custom draft approved: ${customContent}`);

    } else if (text.toLowerCase() === 'skip') {
      // Skip semua draft hari ini
      for (const draft of pendingDraft) {
        db.prepare(`
          UPDATE drafts SET status = 'rejected' WHERE id = ?
        `).run(draft.id);
      }

      // Update status ide jadi skipped
      db.prepare(`
        UPDATE ideas SET status = 'skipped' WHERE id = ?
      `).run(pendingDraft[0].idea_id);

      bot.sendMessage(chatId, '⏭️ Draft hari ini di-skip');
      console.log('⏭️ Draft di-skip');

    } else {
      bot.sendMessage(chatId, `Perintah tidak dikenali. Kirim:\n*1*, *2*, atau *3* → pilih draft\n*edit: [teks]* → pakai versi kamu\n*skip* → skip hari ini`, { parse_mode: 'Markdown' });
    }
  });

  return bot;
}

async function main() {
  console.log('🤖 Threads Agent starting...');

  // Inisialisasi database
  db;

  // Start Telegram listener
  startTelegramListener();

  // jalankan fungsi ini jika yg diketik "node... --weekly"
  if (args.includes('--weekly')) {
    console.log('🔧 Manual trigger: weekly workflow');
    await runWeeklyWorkflow();
    process.exit(0);
  }

  //jalankan fungsi ini jika yg diketik "node... --daily"
  if (args.includes('--daily')) {
    console.log('🔧 Manual trigger: daily workflow');
    await runDailyWorkflow();
    //jangan exit, biarkan listener tetap aktif
    console.log('Menunggu approval dari telegram')
  }

  // Kalau tidak ada argument, jalankan scheduler
  startScheduler();
  console.log('🚀 Agent berjalan, menunggu jadwal...');
  console.log('   Tekan Ctrl+C untuk berhenti\n');
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});