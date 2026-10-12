const request = require('supertest');
const createApp = require('../src/app');
const h = require('./helpers');
const KnowledgeDocument = require('../src/models/KnowledgeDocument');
const DocumentChunk = require('../src/models/DocumentChunk');
const Session = require('../src/models/Session');
const Attempt = require('../src/models/Attempt');
const { processDocument, chunkPages, detectHeading, extractDocx } = require('../src/modules/knowledge/processing.service');
const { parseScope, retrieve } = require('../src/modules/knowledge/retrieval.service');
const { makeMixedPdf, makePdfBuffer, makeDocxBuffer } = require('./pdfFixture');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const login = async (u, p = 'matkhau123') => (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token;
const PDF_HEADER = Buffer.from('%PDF-1.4\nNội dung thử nghiệm.\n%%EOF\n', 'latin1');

beforeAll(h.connect);
afterAll(h.close);
afterEach(h.clear);

describe('Heading detection (Chương / Bài)', () => {
  test('detects chapter with Arabic number', () => {
    expect(detectHeading('Chương 1: Số tự nhiên')).toMatchObject({ kind: 'chapter', number: 1 });
  });
  test('detects chapter with Roman number', () => {
    expect(detectHeading('CHƯƠNG II - Phép cộng')).toMatchObject({ kind: 'chapter', number: 2 });
  });
  test('detects lesson (Bài)', () => {
    expect(detectHeading('Bài 3. Từ chỉ hoạt động')).toMatchObject({ kind: 'lesson', number: 3 });
  });
  test('ignores normal prose lines', () => {
    expect(detectHeading('Hôm nay em đi học cùng bạn bè rất vui vẻ.')).toBeNull();
  });
});

describe('chunkPages tags chunks with chapter/lesson + page', () => {
  test('propagates chapter/lesson tags and page numbers', () => {
    const pages = [
      { page: 1, text: 'Chương 1: Mở đầu\nĐây là nội dung của chương một về số tự nhiên và phép đếm.' },
      { page: 2, text: 'Bài 2: Phép cộng\nHọc sinh học cách cộng hai số trong phạm vi 100 một cách thành thạo.' },
    ];
    const chunks = chunkPages(pages, { size: 300 });
    const ch1 = chunks.find((c) => c.chapterNumber === 1);
    const bai2 = chunks.find((c) => c.lessonNumber === 2);
    expect(ch1).toBeTruthy();
    expect(ch1.page).toBe(1);
    expect(bai2).toBeTruthy();
    expect(bai2.chapterNumber).toBe(1); // chapter persists across the lesson
    expect(bai2.page).toBe(2);
  });
});

describe('parseScope reads chapter/lesson from Vietnamese prompts', () => {
  test('"tạo bài tập chương 1" -> chapter 1', () => {
    expect(parseScope('tạo bài tập chương 1')).toMatchObject({ chapter: 1 });
  });
  test('"bài 1 chương 2" -> chapter 2, lesson 1', () => {
    expect(parseScope('làm bài 1 chương 2')).toMatchObject({ chapter: 2, lesson: 1 });
  });
  test('no reference -> nulls', () => {
    expect(parseScope('tạo bài tập về động vật')).toMatchObject({ chapter: null, lesson: null });
  });
});

describe('Image-only pages are skipped, text pages kept (whole-book upload)', () => {
  test('processDocument skips image pages, indexes text pages, records skippedPages', async () => {
    const teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.book' });
    const token = await login('gv.book');
    const up = await request(app)
      .post('/api/knowledge').set(auth(token))
      .field('title', 'Sách giáo khoa Lớp 3').field('gradeLevel', '3')
      .attach('file', PDF_HEADER, { filename: 'sgk.pdf', contentType: 'application/pdf' });

    // Extractor that mimics a book where page 2 is an image (empty) -> skipped by extractor.
    const bookExtractor = async () => ({
      pages: [
        { page: 1, text: 'Chương 1: Số tự nhiên\nSố tự nhiên là các số 0, 1, 2, 3 dùng để đếm đồ vật xung quanh em.' },
        { page: 3, text: 'Bài 1: Đếm số\nEm hãy đếm số quả táo trên bàn và viết kết quả vào chỗ trống cho đúng.' },
      ],
      pageCount: 3,
      skippedPages: 1,
    });
    await processDocument(up.body._id, { extractor: bookExtractor });

    const doc = await KnowledgeDocument.findById(up.body._id);
    expect(doc.status).toBe('ready');
    expect(doc.skippedPages).toBe(1);
    expect(doc.chunkCount).toBeGreaterThan(0);
    const tagged = await DocumentChunk.findOne({ document: doc._id, chapterNumber: 1 });
    expect(tagged).toBeTruthy();
  });

  test('a fully image-only book (no text at all) still fails honestly', async () => {
    const teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.scan2' });
    const token = await login('gv.scan2');
    const up = await request(app)
      .post('/api/knowledge').set(auth(token))
      .field('title', 'Sách scan').attach('file', PDF_HEADER, { filename: 's.pdf', contentType: 'application/pdf' });
    const scanExtractor = async () => { throw new Error('PDF không có trang nào chứa văn bản (toàn bộ là ảnh/scan).'); };
    await processDocument(up.body._id, { extractor: scanExtractor });
    const doc = await KnowledgeDocument.findById(up.body._id);
    expect(doc.status).toBe('failed');
  });
});

describe('Chapter/lesson-aware retrieval', () => {
  test('retrieving "chương 2" only returns chapter-2 chunks', async () => {
    const teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.rag2' });
    const token = await login('gv.rag2');
    const up = await request(app)
      .post('/api/knowledge').set(auth(token))
      .field('title', 'SGK nhiều chương').field('gradeLevel', '3')
      .attach('file', PDF_HEADER, { filename: 'multi.pdf', contentType: 'application/pdf' });

    const multiExtractor = async () => ({
      pages: [
        { page: 1, text: 'Chương 1: Số tự nhiên\nSố tự nhiên dùng để đếm các đồ vật quen thuộc với học sinh tiểu học.' },
        { page: 2, text: 'Chương 2: Phép cộng\nPhép cộng giúp em gộp hai nhóm đồ vật lại thành một nhóm lớn hơn.' },
      ],
      pageCount: 2,
      skippedPages: 0,
    });
    await processDocument(up.body._id, { extractor: multiExtractor });

    const user = { id: teacher._id.toString(), role: 'teacher' };
    const res = await retrieve(user, { query: 'tạo bài tập chương 2', documentIds: [up.body._id.toString()] });
    expect(res.scope.chapter).toBe(2);
    expect(res.chunks.length).toBeGreaterThan(0);
    // Every returned chunk must belong to chapter 2 (hard filter).
    for (const c of res.chunks) {
      expect(c.text).toContain('Phép cộng');
    }
  });

  test('generate grounded by chapter returns source refs with chapter label', async () => {
    const teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.gench' });
    const token = await login('gv.gench');
    const subject = await h.makeSubject();
    const up = await request(app)
      .post('/api/knowledge').set(auth(token))
      .field('title', 'SGK Toán 3').field('gradeLevel', '3').field('subject', subject._id.toString())
      .attach('file', PDF_HEADER, { filename: 't.pdf', contentType: 'application/pdf' });
    const ext = async () => ({
      pages: [{ page: 5, text: 'Chương 1: Số và phép tính\nEm học cách so sánh các số tự nhiên bé hơn 1000 và sắp xếp chúng.' }],
      pageCount: 5,
      skippedPages: 0,
    });
    await processDocument(up.body._id, { extractor: ext });

    const res = await request(app).post('/api/ai/generate').set(auth(token)).send({
      grade: 3, subject: subject._id.toString(), topic: 'bài tập chương 1', count: 2,
      documentIds: [up.body._id.toString()], requireSources: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.sources.length).toBeGreaterThan(0);
    expect(res.body.sources[0].chapterLabel).toMatch(/Chương 1/i);
  });

  test('grounded generation references the topic but does NOT copy source sentences verbatim', async () => {
    const teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.noverbatim' });
    const token = await login('gv.noverbatim');
    const subject = await h.makeSubject();
    const up = await request(app)
      .post('/api/knowledge').set(auth(token))
      .field('title', 'SGK Toán 3').field('gradeLevel', '3').field('subject', subject._id.toString())
      .attach('file', PDF_HEADER, { filename: 't.pdf', contentType: 'application/pdf' });
    const uniqueSentence = 'Con cáo tím nhảy qua hàng rào gỗ cũ kỹ vào buổi chiều mưa phùn lạnh giá.';
    const ext = async () => ({
      pages: [{ page: 1, text: `Chương 1: Luyện đọc\n${uniqueSentence}` }],
      pageCount: 1,
      skippedPages: 0,
    });
    await processDocument(up.body._id, { extractor: ext });

    const res = await request(app).post('/api/ai/generate').set(auth(token)).send({
      grade: 3, subject: subject._id.toString(), topic: 'luyện đọc', count: 3,
      documentIds: [up.body._id.toString()], requireSources: true,
    });
    expect(res.status).toBe(200);
    // The AI must NOT reproduce the exact source sentence in any generated question.
    for (const q of res.body.questions) {
      expect(q.prompt).not.toContain(uniqueSentence);
      if (q.text) expect(q.text).not.toContain(uniqueSentence);
    }
  });
});

describe('Real PDF extraction with embedded images (pdfjs-dist)', () => {
  jest.setTimeout(60000);
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFileSync } = require('child_process');

  // Run the REAL extractor out-of-process so Jest does not transpile the ESM
  // dynamic import() inside processing.service.js.
  function runExtract(buf) {
    const tmp = path.join(os.tmpdir(), `kbtest-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(tmp, buf);
    try {
      const out = execFileSync('node', [path.join(__dirname, '..', 'scripts', 'extract-pdf.js'), tmp], {
        encoding: 'utf8',
      });
      // pdfjs may emit warnings to stdout; the script prints JSON as the last line.
      const line = out.trim().split('\n').filter((l) => l.trim().startsWith('{')).pop();
      return JSON.parse(line);
    } finally {
      fs.unlinkSync(tmp);
    }
  }

  test('a PDF containing images extracts the text and does NOT fail', async () => {
    const buf = await makeMixedPdf([
      { text: 'Chương 1: Số tự nhiên. Học sinh học đếm số quả táo trên bàn.', image: true },
      { text: 'Bài 2: Phép cộng. Em học cộng hai số trong phạm vi 100.', image: true },
    ]);
    const r = runExtract(buf);
    expect(r.error).toBeUndefined();
    expect(r.textPageCount).toBeGreaterThanOrEqual(1);
    // Note: pdfkit's built-in Helvetica mangles Vietnamese diacritics, but the
    // structure (chapter/lesson numbers, ASCII) extracts fine — which proves the
    // image PDF was read instead of failing. Real PDFs with Unicode fonts keep diacritics.
    expect(r.text).toMatch(/ng 1|Bài 2|nhiên|Phép|c.ng/i);
  });

  test('an image-only page is skipped but a text page in the same PDF is kept', async () => {
    const buf = await makeMixedPdf([
      { text: 'Chương 1: Giới thiệu. Đây là nội dung bài học về thiên nhiên quanh em.' },
      { image: true }, // image-only page, no text
      { text: 'Bài 3: Ôn tập. Em hãy trả lời các câu hỏi dưới đây cho đúng.' },
    ]);
    const r = runExtract(buf);
    expect(r.error).toBeUndefined();
    expect(r.pageCount).toBe(3);
    expect(r.skippedPages).toBeGreaterThanOrEqual(1);
    expect(r.textPageCount).toBeGreaterThanOrEqual(2);
  });

  test('a text-only PDF still extracts (no regression)', async () => {
    const buf = await makePdfBuffer('Mat troi moc o phia dong. Hoc sinh di hoc moi ngay cham chi.');
    const r = runExtract(buf);
    expect(r.error).toBeUndefined();
    expect(r.textPageCount).toBe(1);
    expect(r.skippedPages).toBe(0);
  });
});

describe('Word (.docx) support', () => {
  jest.setTimeout(30000);

  test('extractDocx reads Vietnamese text with diacritics', async () => {
    const buf = await makeDocxBuffer([
      'Chương 1: Số tự nhiên',
      'Học sinh học đếm số quả táo trên bàn một cách thành thạo mỗi ngày.',
    ]);
    const r = await extractDocx(buf);
    expect(r.pages.length).toBe(1);
    expect(r.pages[0].text).toContain('Số tự nhiên');
  });

  test('chapter/lesson headings are detected in a .docx', async () => {
    const buf = await makeDocxBuffer([
      'Chương 2: Phép cộng',
      'Em học cách cộng hai số trong phạm vi 100 một cách chính xác.',
      'Bài 3: Luyện tập',
      'Hãy hoàn thành các bài tập cộng dưới đây cho đúng kết quả.',
    ]);
    const r = await extractDocx(buf);
    const chunks = chunkPages(r.pages);
    expect(chunks.some((c) => c.chapterNumber === 2)).toBe(true);
    expect(chunks.some((c) => c.lessonNumber === 3)).toBe(true);
  });

  test('upload + process a .docx end-to-end -> ready + retrievable', async () => {
    const teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.docx' });
    const token = await login('gv.docx');
    const buf = await makeDocxBuffer([
      'Chương 1: Thế giới động vật',
      'Con mèo kêu meo meo, con chó sủa gâu gâu, con gà gáy ò ó o vào buổi sáng.',
    ]);
    const up = await request(app)
      .post('/api/knowledge').set(auth(token))
      .field('title', 'Tài liệu Word Lớp 3').field('gradeLevel', '3')
      .attach('file', buf, { filename: 'tailieu.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(up.status).toBe(201);
    await processDocument(up.body._id); // real extractDocx (CommonJS) is safe inline
    const doc = await KnowledgeDocument.findById(up.body._id);
    expect(doc.status).toBe('ready');
    expect(doc.chunkCount).toBeGreaterThan(0);

    const user = { id: teacher._id.toString(), role: 'teacher' };
    const { chunks } = await retrieve(user, { query: 'con mèo con chó', documentIds: [up.body._id.toString()] });
    expect(chunks.length).toBeGreaterThan(0);
  });

  test('rejects a .docx whose content is not a real zip (magic bytes)', async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.fakedocx' });
    const token = await login('gv.fakedocx');
    const res = await request(app)
      .post('/api/knowledge').set(auth(token))
      .field('title', 'Giả Word')
      .attach('file', Buffer.from('not a real docx'), { filename: 'fake.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(res.status).toBe(400);
  });
});

describe('Delete exercise (session)', () => {
  let teacherToken; let session; let teacher;
  beforeEach(async () => {
    teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.del' });
    teacherToken = await login('gv.del');
    const subject = await h.makeSubject();
    session = await Session.create({
      title: 'Bài tập cần xóa', gradeLevel: 3, subject: subject._id, createdBy: teacher._id,
    });
  });

  test('owner can delete a session and its attempts', async () => {
    await Attempt.create({ session: session._id, student: teacher._id, class: session._id, questionSnapshot: [] });
    const res = await request(app).delete(`/api/sessions/${session._id}`).set(auth(teacherToken));
    expect(res.status).toBe(200);
    expect(await Session.findById(session._id)).toBeNull();
    expect(await Attempt.countDocuments({ session: session._id })).toBe(0);
  });

  test('a non-owner teacher cannot delete the session (403)', async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.other2' });
    const otherToken = await login('gv.other2');
    const res = await request(app).delete(`/api/sessions/${session._id}`).set(auth(otherToken));
    expect(res.status).toBe(403);
    expect(await Session.findById(session._id)).not.toBeNull();
  });

  test('a student cannot delete a session (403)', async () => {
    await h.makeUser(h.ROLES.STUDENT, { username: 'hs.del' });
    const stToken = await login('hs.del');
    const res = await request(app).delete(`/api/sessions/${session._id}`).set(auth(stToken));
    expect(res.status).toBe(403);
  });
});
