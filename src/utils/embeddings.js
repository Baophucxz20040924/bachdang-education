const crypto = require('crypto');
const env = require('../config/env');

const LOCAL_DIM = 256;

/**
 * Deterministic local embedding fallback (no network, for dev/tests).
 * Hash-based bag-of-words projection into a fixed-dim vector, L2-normalized.
 * Not as good as a real model but gives stable, meaningful cosine similarity
 * for overlapping Vietnamese text so the RAG pipeline is fully testable offline.
 */
function localEmbed(text) {
  const vec = new Array(LOCAL_DIM).fill(0);
  const tokens = String(text || '')
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (const tok of tokens) {
    const h = crypto.createHash('md5').update(tok).digest();
    const idx = h.readUInt16LE(0) % LOCAL_DIM;
    const sign = (h[2] & 1) ? 1 : -1;
    vec[idx] += sign;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

async function beeknoeeEmbed(inputs) {
  const res = await fetch(`${env.BEEKNOEE_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.BEEKNOEE_API_KEY}`,
    },
    body: JSON.stringify({ model: env.BEEKNOEE_EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Beeknoee embeddings ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

/**
 * Embed an array of texts. Uses Beeknoee when AI_PROVIDER=beeknoee and a key is
 * present; otherwise falls back to the deterministic local embedder.
 * Returns { vectors, model } so callers can record which embedder was used.
 */
async function embedTexts(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  if (env.NODE_ENV !== 'test' && env.AI_PROVIDER === 'beeknoee' && env.BEEKNOEE_API_KEY) {
    try {
      const vectors = await beeknoeeEmbed(list);
      return { vectors, model: env.BEEKNOEE_EMBED_MODEL };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[embeddings] Beeknoee lỗi, dùng tạm local embedder:', err.message);
    }
  }
  return { vectors: list.map(localEmbed), model: 'local-hash-256' };
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

module.exports = { embedTexts, cosineSimilarity, localEmbed, LOCAL_DIM };
