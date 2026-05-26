/**
 * Retry sebuah fungsi async maksimal N kali dengan jeda antar percobaan
 * @param {Function} fn - fungsi yang mau dicoba
 * @param {number} maxRetries - maksimal percobaan
 * @param {number} delayMs - jeda antar percobaan dalam ms
 */
export async function withRetry(fn, maxRetries = 3, delayMs = 2000) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.log(`⚠️ Percobaan ${attempt}/${maxRetries} gagal: ${error.message}`);

      if (attempt < maxRetries) {
        console.log(`⏳ Mencoba lagi dalam ${delayMs / 1000} detik...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(`Gagal setelah ${maxRetries} percobaan: ${lastError.message}`);
}