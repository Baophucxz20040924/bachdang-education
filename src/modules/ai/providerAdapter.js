const env = require('../../config/env');
const mockProvider = require('./providers/mockProvider');

/**
 * Returns the active AI provider based on AI_PROVIDER env.
 * Real providers (gemini/openai) require their API key; if missing we fall back
 * to the mock provider and warn (never crash, never expose keys to the client).
 */
function getProvider() {
  // Tests must stay offline and deterministic.
  if (env.NODE_ENV === 'test') return mockProvider;
  switch (env.AI_PROVIDER) {
    case 'gemini':
      if (!env.GEMINI_API_KEY) {
        // eslint-disable-next-line no-console
        console.warn('[ai] AI_PROVIDER=gemini nhưng thiếu GEMINI_API_KEY — dùng tạm MockProvider.');
        return mockProvider;
      }
      // A real GeminiProvider would be wired here. Kept as mock fallback for MVP.
      // eslint-disable-next-line global-require
      return (() => { try { return require('./providers/geminiProvider'); } catch { return mockProvider; } })();
    case 'openai':
      if (!env.OPENAI_API_KEY) {
        // eslint-disable-next-line no-console
        console.warn('[ai] AI_PROVIDER=openai nhưng thiếu OPENAI_API_KEY — dùng tạm MockProvider.');
        return mockProvider;
      }
      // eslint-disable-next-line global-require
      return (() => { try { return require('./providers/openaiProvider'); } catch { return mockProvider; } })();
    case 'beeknoee':
      if (!env.BEEKNOEE_API_KEY) {
        // eslint-disable-next-line no-console
        console.warn('[ai] AI_PROVIDER=beeknoee nhưng thiếu BEEKNOEE_API_KEY — dùng tạm MockProvider.');
        return mockProvider;
      }
      // eslint-disable-next-line global-require
      return require('./providers/beeknoeeProvider');
    case 'mock':
    default:
      return mockProvider;
  }
}

module.exports = { getProvider };
