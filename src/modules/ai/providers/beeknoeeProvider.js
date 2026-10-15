const env = require('../../../config/env');
const { buildMessages, buildRegenerateMessages, parseJsonArray } = require('../prompts');

const TIMEOUT_MS = 60000;

async function callChatCompletions(messages, { maxTokens = 2000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${env.BEEKNOEE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.BEEKNOEE_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.BEEKNOEE_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Beeknoee API ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Beeknoee API trả về nội dung rỗng.');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

const beeknoeeProvider = {
  name: 'beeknoee',

  async generateQuestions(ctx) {
    const content = await callChatCompletions(buildMessages(ctx), { maxTokens: 3000 });
    const arr = parseJsonArray(content);
    if (!arr) {
      // Returning a non-array makes the pipeline raise AI_FAILED (no fabricated success).
      throw new Error('Không phân tích được JSON câu hỏi từ Beeknoee.');
    }
    return arr;
  },

  async regenerateQuestion(ctx) {
    const content = await callChatCompletions(buildRegenerateMessages(ctx), { maxTokens: 1200 });
    const arr = parseJsonArray(content);
    if (!arr || !arr.length) throw new Error('Không phân tích được câu hỏi từ Beeknoee.');
    return arr[0];
  },

  // Free-form chat for the student tutor. `messages` is a full OpenAI-style
  // array (system + context + history + user). Returns plain assistant text.
  async chat(messages) {
    const content = await callChatCompletions(messages, { maxTokens: 700 });
    return String(content).trim();
  },
};

module.exports = beeknoeeProvider;
