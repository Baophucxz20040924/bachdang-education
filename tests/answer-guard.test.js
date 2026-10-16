const { guardReply, isAnswerSeeking, revealsResult, safeGuidedReply } = require('../src/modules/ai/answerGuard');

describe('answerGuard — blocks direct-answer leakage', () => {
  test('detects answer-seeking questions', () => {
    expect(isAnswerSeeking('đáp án 4+2 là bao nhiêu vậy cô')).toBe(true);
    expect(isAnswerSeeking('7 x 5 bằng mấy')).toBe(true);
    expect(isAnswerSeeking('tính giúp em 12 - 3')).toBe(true);
    expect(isAnswerSeeking('4+2')).toBe(true);
    // Not answer-seeking:
    expect(isAnswerSeeking('làm sao để nhớ bài lâu hơn')).toBe(false);
    expect(isAnswerSeeking('cô ơi em chưa hiểu bài')).toBe(false);
  });

  test('detects replies that reveal a numeric result', () => {
    expect(revealsResult('Đáp án của 4 + 2 = 6 em nhé!')).toBe(true);
    expect(revealsResult('Vậy 4 + 2 là 6 đó em')).toBe(true);
    expect(revealsResult('kết quả là 6')).toBe(true);
    expect(revealsResult('tổng bằng 15')).toBe(true);
    expect(revealsResult('= 6')).toBe(true);
    // Does NOT reveal a result (guiding only):
    expect(revealsResult('Em thử ví dụ 3 + 1 = ? rồi tự tính nhé')).toBe(false);
    expect(revealsResult('Em đếm thêm từng bước nhé, rồi nói cô nghe kết quả')).toBe(false);
  });

  test('guardReply replaces a leaking reply with a safe guided message', () => {
    const leaked = 'Đáp án của phép tính 4 + 2 = 6 em nhé! 🎉';
    const out = guardReply('đáp án 4+2 là bao nhiêu vậy cô', leaked);
    expect(out).toBe(safeGuidedReply());
    expect(out).not.toMatch(/=\s*\d/);
    expect(out).not.toContain('6');
    expect(out).toMatch(/không nói ra kết quả|tự tìm/i);
  });

  test('guardReply leaves a safe guiding reply untouched', () => {
    const good = 'Em thử đếm thêm từng bước rồi nói cô nghe kết quả nhé! 🌟';
    expect(guardReply('đáp án 4+2 là bao nhiêu', good)).toBe(good);
  });

  test('guardReply does NOT alter replies to non-answer-seeking questions', () => {
    // A study-tip reply that happens to mention a number should pass through.
    const tip = 'Mẹo nhớ bài: ôn lại sau 1 ngày, rồi sau 3 ngày nhé!';
    expect(guardReply('làm sao để nhớ bài lâu hơn', tip)).toBe(tip);
  });
});
