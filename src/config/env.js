require('dotenv').config();

const env = {
  PORT: parseInt(process.env.PORT, 10) || 4000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || '',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  JWT_EXPIRES: process.env.JWT_EXPIRES || '7d',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // Reverse-proxy hops to trust (Nginx = 1). 'false' disables. Default: 1 in prod.
  TRUST_PROXY: process.env.TRUST_PROXY || (process.env.NODE_ENV === 'production' ? '1' : 'false'),
  AI_PROVIDER: (process.env.AI_PROVIDER || 'mock').toLowerCase(),
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  // Beeknoee (OpenAI-compatible). https://platform.beeknoee.com/docs
  BEEKNOEE_API_KEY: process.env.BEEKNOEE_API_KEY || '',
  BEEKNOEE_BASE_URL: process.env.BEEKNOEE_BASE_URL || 'https://platform.beeknoee.com/v1',
  BEEKNOEE_MODEL: process.env.BEEKNOEE_MODEL || 'deepseek/deepseek-v3.2',
  BEEKNOEE_EMBED_MODEL: process.env.BEEKNOEE_EMBED_MODEL || 'gemini-embedding-001',
  // Knowledge base / storage
  STORAGE_DRIVER: (process.env.STORAGE_DRIVER || 'local').toLowerCase(),
  MAX_UPLOAD_MB: parseInt(process.env.MAX_UPLOAD_MB, 10) || 20,
  SEED_DEFAULT_PASSWORD: process.env.SEED_DEFAULT_PASSWORD || 'matkhau123',
};

// Fail fast in production-ish runs if critical secrets are missing.
if (env.NODE_ENV !== 'test') {
  if (!env.MONGODB_URI) {
    // eslint-disable-next-line no-console
    console.warn('[config] MONGODB_URI chưa được thiết lập. Hãy cấu hình trong .env (MongoDB Atlas).');
  }
}

module.exports = env;
