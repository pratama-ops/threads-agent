import dotenv from 'dotenv';
dotenv.config();

import db from './db.js';
import { startScheduler } from './scheduler.js';
import { runWeeklyWorkflow, runDailyWorkflow } from './agent.js';

//menangkap kalimat yang di ketik di terminal
const args = process.argv.slice(2);

async function main() {
  console.log('🤖 Threads Agent starting...');

  // Inisialisasi database
  db;

  // menjalakan function weekly jika yg diketik "node ... --weekly"
  if (args.includes('--weekly')) {
    console.log('🔧 Manual trigger: weekly workflow');
    await runWeeklyWorkflow();
    process.exit(0);
  }

  //menjalankan fungsi daily jika yg diketik "node... --dailt"
  if (args.includes('--daily')) {
    console.log('🔧 Manual trigger: daily workflow');
    await runDailyWorkflow();
    process.exit(0);
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