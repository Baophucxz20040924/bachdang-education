const { parseJsonArray, buildMessages } = require('../src/modules/ai/prompts');

describe('Beeknoee prompt helpers', () => {
  test('parseJsonArray handles a plain JSON array', () => {
    const arr = parseJsonArray('[{"type":"true_false","prompt":"x","correctValue":true}]');
    expect(Array.isArray(arr)).toBe(true);
    expect(arr[0].type).toBe('true_false');
  });

  test('parseJsonArray strips ```json code fences', () => {
    const text = '```json\n[{"type":"multiple_choice","prompt":"a","options":["x","y"],"correctIndex":0}]\n```';
    const arr = parseJsonArray(text);
    expect(arr).toHaveLength(1);
    expect(arr[0].options).toEqual(['x', 'y']);
  });

  test('parseJsonArray extracts array from surrounding prose', () => {
    const text = 'Đây là câu hỏi:\n[{"type":"short_answer","prompt":"q","expectedAnswer":"a"}] Cảm ơn!';
    const arr = parseJsonArray(text);
    expect(arr[0].type).toBe('short_answer');
  });

  test('parseJsonArray accepts { questions: [...] } wrapper', () => {
    const arr = parseJsonArray('{"questions":[{"type":"true_false","prompt":"x","correctValue":false}]}');
    expect(arr).toHaveLength(1);
  });

  test('parseJsonArray returns null for unparseable text', () => {
    expect(parseJsonArray('xin chào không có json')).toBeNull();
  });

  test('buildMessages produces a system + user message with Vietnamese context', () => {
    const msgs = buildMessages({ grade: 3, subjectName: 'Tiếng Việt', topic: 'Từ chỉ hoạt động', count: 5, types: ['multiple_choice'] });
    expect(msgs[0].role).toBe('system');
    const user = msgs[msgs.length - 1];
    expect(user.role).toBe('user');
    expect(user.content).toContain('Lớp 3');
    expect(user.content).toContain('Tiếng Việt');
  });
});

describe('Provider selection falls back safely without a key', () => {
  const ORIG = process.env.AI_PROVIDER;
  afterAll(() => { process.env.AI_PROVIDER = ORIG; });

  test('beeknoee without key returns mock provider', () => {
    jest.resetModules();
    process.env.AI_PROVIDER = 'beeknoee';
    delete process.env.BEEKNOEE_API_KEY;
    // eslint-disable-next-line global-require
    const { getProvider } = require('../src/modules/ai/providerAdapter');
    expect(getProvider().name).toBe('mock');
  });
});
