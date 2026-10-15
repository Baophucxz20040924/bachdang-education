const { QUESTION_TYPES } = require('../../../config/constants');

// Deterministic-ish Vietnamese content templates per subject.
// This provides realistic, valid output at zero cost (default provider).

const MATH_FILL = [
  { prompt: 'Phép tính: 7 + 5 = ___', answer: '12', bank: ['12', '11', '13', '10'] },
  { prompt: 'Phép tính: 9 + 6 = ___', answer: '15', bank: ['15', '14', '16', '13'] },
  { prompt: 'Phép tính: 8 + 7 = ___', answer: '15', bank: ['15', '16', '14', '13'] },
  { prompt: 'Phép tính: 6 + 6 = ___', answer: '12', bank: ['12', '11', '13', '14'] },
  { prompt: 'Phép tính: 10 + 4 = ___', answer: '14', bank: ['14', '13', '15', '12'] },
];

const TV_MISSING = [
  { text: 'Mặt trời mọc ở phía ___.', answer: 'đông', bank: ['đông', 'tây', 'nam', 'bắc'] },
  { text: 'Hôm nay, em ___ đến trường cùng bạn.', answer: 'đi', bank: ['đi', 'ngủ', 'ăn', 'chạy'] },
  { text: 'Con mèo đang ___ chuột.', answer: 'bắt', bank: ['bắt', 'nằm', 'hát', 'vẽ'] },
  { text: 'Mùa xuân, cây cối ___ chồi nảy lộc.', answer: 'đâm', bank: ['đâm', 'rụng', 'héo', 'khô'] },
  { text: 'Chúng em ___ bài trước khi đến lớp.', answer: 'học', bank: ['học', 'quên', 'xé', 'đốt'] },
];

const TV_MC = [
  {
    prompt: 'Từ nào dưới đây chỉ hoạt động?',
    options: ['chạy', 'cái bàn', 'màu đỏ', 'ngôi nhà'],
    correctIndex: 0,
    explanation: '"chạy" là động từ chỉ hoạt động.',
  },
  {
    prompt: 'Từ nào dưới đây là từ chỉ sự vật?',
    options: ['quyển sách', 'nhảy', 'vui vẻ', 'nhanh'],
    correctIndex: 0,
    explanation: '"quyển sách" là danh từ chỉ sự vật.',
  },
  {
    prompt: 'Từ nào dưới đây chỉ đặc điểm?',
    options: ['xinh đẹp', 'đi', 'con chó', 'cái ghế'],
    correctIndex: 0,
    explanation: '"xinh đẹp" là từ chỉ đặc điểm.',
  },
];

const TV_TF = [
  { prompt: '"Học sinh" là từ chỉ người.', correctValue: true, explanation: 'Đúng, đây là danh từ chỉ người.' },
  { prompt: '"Chạy nhảy" là từ chỉ sự vật.', correctValue: false, explanation: 'Sai, đó là từ chỉ hoạt động.' },
];

const TV_SHORT = [
  { prompt: 'Hãy đặt một câu có từ chỉ hoạt động.', expectedAnswer: 'Em đang đọc sách.', acceptable: ['Em đang đọc sách.', 'Em đọc sách.', 'Bé chạy.'] },
  { prompt: 'Kể tên hai từ chỉ sự vật.', expectedAnswer: 'cái bàn, quyển sách', acceptable: ['cái bàn, quyển sách', 'quyển sách, cái bàn', 'bàn, ghế'] },
];

const TV_MATCH = [
  {
    prompt: 'Nối từ với loại từ phù hợp.',
    left: ['chạy', 'quyển vở', 'xanh'],
    right: ['chỉ hoạt động', 'chỉ sự vật', 'chỉ đặc điểm'],
    pairs: [[0, 0], [1, 1], [2, 2]],
  },
];

function pick(arr, i) {
  return arr[i % arr.length];
}

// Derive a short TOPIC phrase from source text WITHOUT copying a full sentence:
// prefer a chapter/lesson heading if present, else the most frequent meaningful words.
const VI_STOPWORDS = new Set([
  'và', 'là', 'của', 'các', 'những', 'một', 'cho', 'với', 'trong', 'được', 'này', 'đó',
  'khi', 'em', 'học', 'sinh', 'bài', 'câu', 'the', 'a', 'an', 'to', 'of', 'in', 'on',
]);
function topicFromSource(sourceContext, explicitTopic, i) {
  if (explicitTopic && explicitTopic.trim()) return explicitTopic.trim().slice(0, 60);
  const text = String(sourceContext || '');
  // Prefer a heading like "Chương N: ..." / "Bài N: ..." (short label only — stop
  // at the first sentence boundary so we never pull in a full copied sentence).
  const heading = text.match(/(?:ch[uư][ơo]ng|bài)\s+[0-9ivxIVX]+\s*[:.\-–]\s*([^.\n]{3,40})/i);
  if (heading) return heading[1].trim().replace(/[,;:]+$/, '');
  // Else: frequent meaningful words (keywords, not a sentence).
  const freq = new Map();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || VI_STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
  if (top.length === 0) return '';
  // Rotate a bit per question index so questions aren't all identical.
  const rotated = top.slice(i % top.length).concat(top.slice(0, i % top.length));
  return rotated.join(', ');
}

function buildQuestion(type, subjectCode, i) {
  const isMath = subjectCode === 'toan';
  switch (type) {
    case QUESTION_TYPES.MULTIPLE_CHOICE: {
      const t = pick(TV_MC, i);
      return { type, prompt: t.prompt, options: t.options, correctIndex: t.correctIndex, explanation: t.explanation, points: 1 };
    }
    case QUESTION_TYPES.TRUE_FALSE: {
      const t = pick(TV_TF, i);
      return { type, prompt: t.prompt, correctValue: t.correctValue, explanation: t.explanation, points: 1 };
    }
    case QUESTION_TYPES.FILL_BLANK: {
      const t = isMath ? pick(MATH_FILL, i) : { prompt: pick(TV_MISSING, i).text, answer: pick(TV_MISSING, i).answer, bank: pick(TV_MISSING, i).bank };
      return { type, prompt: t.prompt, answer: t.answer, acceptable: [], wordBank: t.bank || [], points: 1 };
    }
    case QUESTION_TYPES.MISSING_WORD: {
      const t = pick(TV_MISSING, i);
      return { type, prompt: 'Điền từ còn thiếu vào câu sau:', text: t.text, answer: t.answer, acceptable: [], wordBank: t.bank, points: 1 };
    }
    case QUESTION_TYPES.SHORT_ANSWER: {
      const t = pick(TV_SHORT, i);
      return { type, prompt: t.prompt, expectedAnswer: t.expectedAnswer, acceptable: t.acceptable || [], points: 1 };
    }
    case QUESTION_TYPES.MATCHING: {
      const t = pick(TV_MATCH, i);
      return { type, prompt: t.prompt, left: t.left, right: t.right, pairs: t.pairs, points: 1 };
    }
    default:
      return pick(TV_MC, i) && { type: QUESTION_TYPES.MULTIPLE_CHOICE, ...pick(TV_MC, i), points: 1 };
  }
}

const mockProvider = {
  name: 'mock',
  async generateQuestions(ctx) {
    const count = Math.min(Math.max(ctx.count || 5, 1), 30);
    const types = ctx.types && ctx.types.length ? ctx.types : [QUESTION_TYPES.MULTIPLE_CHOICE, QUESTION_TYPES.MISSING_WORD];
    const subjectCode = (ctx.subjectCode || '').toLowerCase();
    const questions = [];
    for (let i = 0; i < count; i += 1) {
      const type = types[i % types.length];
      const q = buildQuestion(type, subjectCode, i);
      // When grounding context is provided (RAG), we only REFERENCE the material
      // to understand the topic — we do NOT copy sentences from it. Extract a few
      // keywords and frame an original question around that learning topic.
      if (ctx.sourceContext && ctx.sourceContext.trim()) {
        const topic = topicFromSource(ctx.sourceContext, ctx.topic, i);
        if (topic) {
          q.prompt = `${q.prompt} (ôn luyện chủ đề: ${topic})`;
          q.explanation = `Câu hỏi luyện tập theo chủ đề "${topic}" mà học sinh đang học (dựa trên tài liệu tham khảo, không sao chép nguyên văn).`;
        }
      }
      questions.push(q);
    }
    return questions;
  },
  async regenerateQuestion(ctx) {
    const type = ctx.type || QUESTION_TYPES.MULTIPLE_CHOICE;
    const seed = Math.floor(Math.random() * 97) + (ctx.seed || 0);
    return buildQuestion(type, (ctx.subjectCode || '').toLowerCase(), seed);
  },

  // Offline, deterministic student-tutor chat that OBEYS the guardrails so the
  // app (and tests) behave safely without a real AI key:
  //   • If no lesson dataset was provided -> invite the student back, no outside info.
  //   • If the student asks for the direct answer -> politely refuse, give method
  //     + a SIMILAR practice example instead.
  //   • If the question is clearly outside the dataset -> steer back to lessons.
  //   • Otherwise -> a friendly, encouraging, on-topic nudge.
  async chat(messages) {
    // Combine all system messages (SYSTEM_PROMPT also mentions "DỮ LIỆU BÀI HỌC",
    // so we must look for the actual data marker across every system message).
    const datasetText = messages
      .filter((m) => m.role === 'system' && typeof m.content === 'string')
      .map((m) => m.content)
      .join('\n');
    const hasDataset = datasetText.includes('<<<DU_LIEU_BAI_HOC');
    const dsLower = datasetText.toLowerCase();
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const q = (lastUser?.content || '').toLowerCase();

    // 1) Clearly NON-educational / unsafe topics -> gently steer back to learning.
    const OFF_TOPIC = ['bitcoin', 'crypto', 'tiền ảo', 'tổng thống', 'president', 'bạo lực', 'cá cược', 'bóng đá', 'tiktok'];
    const offHit = OFF_TOPIC.find((w) => q.includes(w) && !dsLower.includes(w));
    if (offHit) {
      return 'Chuyện này không thuộc việc học của chúng mình em nhé 😊. '
        + 'Mình quay lại chuyện học thôi — em muốn cô giúp em hiểu bài nào, hay cần mẹo học bài không?';
    }

    // 2) Asking for the DIRECT answer to an exercise -> refuse + method + example.
    const wantsAnswer = /(đáp án|đáp số|kết quả|giải giúp|giải hộ|làm hộ|làm giúp|cho mình đáp|cho em đáp|answer|là bao nhiêu|bằng mấy|bằng bao nhiêu)/.test(q);
    if (wantsAnswer) {
      return 'Cô sẽ không cho đáp án trực tiếp đâu, vì tự tìm ra em sẽ nhớ lâu hơn nhiều! 😊 '
        + 'Cô gợi ý cách làm: đọc kỹ đề, xem đề cho gì và hỏi gì, rồi làm từng bước nhỏ. '
        + 'Thử một VÍ DỤ TƯƠNG TỰ nhé: nếu đề là "3 + 4 = ?" thì em đếm thêm 4 đơn vị từ 3. '
        + 'Em áp dụng cách đó vào bài của mình xem sao nha! 🌟';
    }

    // 3) General study-skills questions (how to learn / remember) -> helpful tips.
    const studyTip = /(nhớ bài|học thuộc|ghi nhớ|học hiệu quả|tập trung|ôn tập|học giỏi|làm sao để học|cách học)/.test(q);
    if (studyTip) {
      return 'Câu hỏi hay lắm em! 🌟 Vài mẹo nhỏ giúp em nhớ bài lâu hơn: '
        + '(1) học thành từng phần nhỏ rồi tự nhắc lại; (2) đọc xong hãy kể lại bằng lời của em; '
        + '(3) ôn lại sau 1 ngày rồi sau vài ngày; (4) vừa học vừa cho ví dụ gần gũi. '
        + 'Em thử áp dụng khi học bài trên lớp nhé, cô tin em làm được! 😊';
    }

    // 4) No specific lesson yet -> still welcome general learning help.
    if (!hasDataset) {
      return 'Chào em! 😊 Lớp mình chưa có bài học nào được giao, nhưng cô vẫn có thể giúp em '
        + 'những điều chung về học tập như mẹo ghi nhớ, cách học hiệu quả hay giải thích một khái niệm. '
        + 'Khi nào có bài, em quay lại để cô hướng dẫn đúng nội dung lớp đang học nhé! 🌟';
    }

    // 5) Default: friendly, encouraging, on-topic help without revealing answers.
    return 'Câu hỏi hay lắm em! 🌟 Cô sẽ cùng em ôn lại nhé. Em thử nêu cách em định làm, '
      + 'rồi cô sẽ gợi ý thêm bằng một ví dụ tương tự để em luyện tập. '
      + 'Em đang thắc mắc ở phần nào nhất? 😊';
  },
};

module.exports = mockProvider;
