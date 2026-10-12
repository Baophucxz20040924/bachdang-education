const { validateQuestion } = require('../src/modules/sessions/question.schema');
const { QUESTION_TYPES } = require('../src/config/constants');

describe('validateQuestion - invalid AI output rejected safely (REQ-AI-2)', () => {
  test('accepts a valid multiple_choice', () => {
    const r = validateQuestion({
      type: QUESTION_TYPES.MULTIPLE_CHOICE,
      prompt: 'Từ nào chỉ hoạt động?',
      options: ['chạy', 'cái bàn'],
      correctIndex: 0,
    });
    expect(r.ok).toBe(true);
  });

  test('rejects multiple_choice with correctIndex out of range', () => {
    const r = validateQuestion({
      type: QUESTION_TYPES.MULTIPLE_CHOICE,
      prompt: 'x',
      options: ['a', 'b'],
      correctIndex: 5,
    });
    expect(r.ok).toBe(false);
  });

  test('rejects fill_blank missing answer', () => {
    const r = validateQuestion({ type: QUESTION_TYPES.FILL_BLANK, prompt: 'x ___' });
    expect(r.ok).toBe(false);
  });

  test('rejects missing_word without ___ placeholder', () => {
    const r = validateQuestion({
      type: QUESTION_TYPES.MISSING_WORD,
      prompt: 'Điền từ',
      text: 'Không có chỗ trống',
      answer: 'x',
    });
    expect(r.ok).toBe(false);
  });

  test('rejects unknown type', () => {
    const r = validateQuestion({ type: 'essay', prompt: 'x' });
    expect(r.ok).toBe(false);
  });
});
