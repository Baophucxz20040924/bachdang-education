const { gradeQuestion, gradeAttempt } = require('../src/utils/grading');
const { QUESTION_TYPES } = require('../src/config/constants');

describe('gradeQuestion - objective types graded consistently (REQ-ST-2)', () => {
  test('multiple_choice correct/incorrect', () => {
    const q = { type: QUESTION_TYPES.MULTIPLE_CHOICE, options: ['a', 'b'], correctIndex: 1, points: 2 };
    expect(gradeQuestion(q, 1)).toMatchObject({ correct: true, earned: 2 });
    expect(gradeQuestion(q, 0)).toMatchObject({ correct: false, earned: 0 });
  });

  test('true_false', () => {
    const q = { type: QUESTION_TYPES.TRUE_FALSE, correctValue: true, points: 1 };
    expect(gradeQuestion(q, true).correct).toBe(true);
    expect(gradeQuestion(q, false).correct).toBe(false);
  });

  test('fill_blank lenient (trim/case) with Vietnamese diacritics', () => {
    const q = { type: QUESTION_TYPES.FILL_BLANK, answer: 'Đông', acceptable: [], points: 1 };
    expect(gradeQuestion(q, '  đông ').correct).toBe(true);
    expect(gradeQuestion(q, 'tây').correct).toBe(false);
  });

  test('matching compares pair sets', () => {
    const q = { type: QUESTION_TYPES.MATCHING, left: ['x', 'y'], right: ['1', '2'], pairs: [[0, 0], [1, 1]], points: 1 };
    expect(gradeQuestion(q, [[1, 1], [0, 0]]).correct).toBe(true);
    expect(gradeQuestion(q, [[0, 1], [1, 0]]).correct).toBe(false);
  });

  test('short_answer defers to manual grading when no acceptable set', () => {
    // With NO answer key at all (no expectedAnswer, no acceptable), still manual.
    const q = { type: QUESTION_TYPES.SHORT_ANSWER, prompt: 'Hãy viết một câu.', points: 1 };
    const r = gradeQuestion(q, 'bất kỳ');
    expect(r.correct).toBeNull();
    expect(r.needsManual).toBe(true);
  });
});

describe('gradeAttempt', () => {
  test('aggregates score and flags needsGrading when short_answer has NO key', () => {
    const snapshot = [
      { qid: 'q1', type: QUESTION_TYPES.MULTIPLE_CHOICE, options: ['a', 'b'], correctIndex: 0, points: 1 },
      { qid: 'q2', type: QUESTION_TYPES.SHORT_ANSWER, prompt: 'Viết câu tự do', points: 1 },
    ];
    const answers = [{ qid: 'q1', response: 0 }, { qid: 'q2', response: 'bất kỳ' }];
    const r = gradeAttempt(snapshot, answers);
    expect(r.autoScore).toBe(1);
    expect(r.maxScore).toBe(2);
    expect(r.needsGrading).toBe(true);
  });

  test('short_answer WITH acceptable answers -> no manual grading needed', () => {
    const snapshot = [
      { qid: 'q1', type: QUESTION_TYPES.SHORT_ANSWER, expectedAnswer: 'Hà Nội', acceptable: ['Hà Nội'], points: 1 },
    ];
    const r = gradeAttempt(snapshot, [{ qid: 'q1', response: 'ha noi' }]);
    expect(r.needsGrading).toBe(false);
    expect(r.autoScore).toBe(1);
  });
});
