// src/utils/parseLLM.js

/**
 * Parse JSON output dari LLM dengan validasi
 * @param {string} content - raw output dari LLM
 * @param {string} expectedType - 'array' atau 'object'
 */
export function parseLLMJson(content, expectedType = 'array') {
  // 1. Bersihkan markdown code block kalau ada
  const clean = content.replace(/```json|```/g, '').trim();

  // 2. Coba parse JSON
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (error) {
    throw new Error(`LLM return JSON yang tidak valid: ${clean.slice(0, 100)}`);
  }

  // 3. Validasi tipe data sesuai ekspektasi
  if (expectedType === 'array') {
    if (!Array.isArray(parsed)) {
      throw new Error(`LLM return bukan array, tapi ${typeof parsed}`);
    }
    if (parsed.length === 0) {
      throw new Error('LLM return array kosong');
    }
  }

  if (expectedType === 'object') {
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`LLM return bukan object, tapi ${typeof parsed}`);
    }
  }

  return parsed;
}