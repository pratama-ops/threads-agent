import cron from 'node-cron';
import { runWeeklyWorkflow, runDailyWorkflow } from './agent.js';

export function startScheduler() {
  console.log('⏰ Scheduler aktif...');

  // WEEKLY: Setiap Senin jam 08:00 pagi
  cron.schedule('0 8 * * 1', async () => {
    console.log('📅 Senin pagi — jalankan weekly workflow');
    await runWeeklyWorkflow();
  }, {
    timezone: 'Asia/Jakarta'
  });

  // DAILY: Setiap hari jam 18:00 sore
  cron.schedule('0 18 * * *', async () => {
    console.log('📅 Jam 6 sore — jalankan daily workflow');
    await runDailyWorkflow();
  }, {
    timezone: 'Asia/Jakarta'
  });

  console.log('✅ Scheduler terdaftar:');
  console.log('   - Weekly workflow: Senin jam 08:00 WIB');
  console.log('   - Daily workflow : Setiap hari jam 18:00 WIB');
}