const request = require('supertest');
const createApp = require('../src/app');
const h = require('./helpers');
const KnowledgeDocument = require('../src/models/KnowledgeDocument');
const DocumentChunk = require('../src/models/DocumentChunk');
const { processDocument, chunkText, hashChunk } = require('../src/modules/knowledge/processing.service');
const retrieval = require('../src/modules/knowledge/retrieval.service');
const { embedTexts, cosineSimilarity } = require('../src/utils/embeddings');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function login(username, password = 'matkhau123') {
  return (await request(app).post('/api/auth/login').send({ username, password })).body.token;
}

// Minimal buffer that passes the %PDF- magic-byte check for upload validation.
// (Processing in tests uses an injected extractor, so extractability is not required here.)
const PDF_HEADER = Buffer.concat([Buffer.from('%PDF-1.4\n', 'latin1'), Buffer.from('Nội dung thử nghiệm tiếng Việt.\n'), Buffer.from('%%EOF\n')]);

// Fake extractor returning Vietnamese text with diacritics (tests unicode handling).
const fakeExtractor = async () => ({
  text: 'Mặt trời mọc ở phía đông.\n\nHọc sinh lớp 3 chăm chỉ học bài mỗi ngày để tiến bộ. '
    + 'Buổi sáng các em đến trường cùng bạn bè và thầy cô.',
  pageCount: 2,
});
const emptyExtractor = async () => { throw new Error('PDF không có văn bản trích xuất được (bản scan).'); };

beforeAll(h.connect);
afterAll(h.close);
afterEach(h.clear);

describe('Knowledge base — upload validation & authorization', () => {
  let teacherToken; let otherToken;
  beforeEach(async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.a' });
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.b' });
    await h.makeUser(h.ROLES.STUDENT, { username: 'hs.x' });
    teacherToken = await login('gv.a');
    otherToken = await login('gv.b');
  });

  test('rejects non-PDF file (REQ 2.3)', async () => {
    const res = await request(app)
      .post('/api/knowledge').set(auth(teacherToken))
      .field('title', 'Tài liệu')
      .attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  test('rejects a .pdf whose content is not a real PDF (magic bytes)', async () => {
    const res = await request(app)
      .post('/api/knowledge').set(auth(teacherToken))
      .field('title', 'Giả PDF')
      .attach('file', Buffer.from('this is not a pdf'), { filename: 'fake.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
  });

  test('requires a title', async () => {
    const res = await request(app)
      .post('/api/knowledge').set(auth(teacherToken))
      .attach('file', PDF_HEADER, { filename: 'sgk.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
  });

  test('students cannot access the knowledge library (REQ 2.9)', async () => {
    const stToken = await login('hs.x');
    const res = await request(app).get('/api/knowledge').set(auth(stToken));
    expect(res.status).toBe(403);
  });

  test('a teacher cannot view another teacher\'s document (REQ 2.9)', async () => {
    const up = await request(app)
      .post('/api/knowledge').set(auth(teacherToken))
      .field('title', 'SGK Tiếng Việt 3')
      .attach('file', PDF_HEADER, { filename: 'sgk.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    const res = await request(app).get(`/api/knowledge/${up.body._id}`).set(auth(otherToken));
    expect(res.status).toBe(403);
  });
});

describe('Knowledge base — chunking & hashing (units)', () => {
  test('chunkText preserves Vietnamese unicode (REQ #9)', () => {
    const text = 'Mặt trời mọc ở phía đông.\n\nHọc sinh chăm chỉ học bài mỗi ngày để tiến bộ.';
    const chunks = chunkText(text, { size: 40, overlap: 10 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join(' ')).toContain('Mặt trời');
  });

  test('hashChunk is stable and index-sensitive (dedup key)', () => {
    expect(hashChunk('d1', 0, 'abc')).toBe(hashChunk('d1', 0, 'abc'));
    expect(hashChunk('d1', 0, 'abc')).not.toBe(hashChunk('d1', 1, 'abc'));
  });

  test('embeddings local fallback: identical text -> cosine ~1', async () => {
    const { vectors } = await embedTexts(['mặt trời mọc', 'mặt trời mọc']);
    expect(cosineSimilarity(vectors[0], vectors[1])).toBeCloseTo(1, 5);
  });
});

describe('Knowledge base — processing, retrieval, dedup, deletion', () => {
  let teacher; let token; let docId;

  async function createReadyDoc(ownerToken, title = 'Bài học về mặt trời') {
    const up = await request(app)
      .post('/api/knowledge').set(auth(ownerToken))
      .field('title', title).field('gradeLevel', '3')
      .attach('file', PDF_HEADER, { filename: 'bai.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    // Run processing synchronously with the fake extractor.
    await processDocument(up.body._id, { extractor: fakeExtractor });
    return up.body._id;
  }

  beforeEach(async () => {
    teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.proc' });
    token = await login('gv.proc');
    docId = await createReadyDoc(token);
  });

  test('processed document is marked ready with chunks (REQ 2.4)', async () => {
    const doc = await KnowledgeDocument.findById(docId);
    expect(doc.status).toBe('ready');
    expect(doc.chunkCount).toBeGreaterThan(0);
  });

  test('owner can retrieve relevant chunks (REQ 2.6)', async () => {
    const user = { id: teacher._id.toString(), role: 'teacher' };
    const { chunks } = await retrieval.retrieve(user, { query: 'mặt trời mọc', documentIds: [docId] });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text).toContain('Mặt trời');
  });

  test('reprocessing does not create duplicate chunks (REQ 2.5)', async () => {
    const before = await DocumentChunk.countDocuments({ document: docId });
    await processDocument(docId, { extractor: fakeExtractor });
    const after = await DocumentChunk.countDocuments({ document: docId });
    expect(after).toBe(before);
  });

  test('retrieval is authorization-scoped: other teacher gets nothing (REQ 2.9)', async () => {
    const other = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.other' });
    const otherUser = { id: other._id.toString(), role: 'teacher' };
    const { chunks } = await retrieval.retrieve(otherUser, { query: 'mặt trời', documentIds: [docId] });
    expect(chunks.length).toBe(0);
  });

  test('deleting a document removes its chunks and future retrieval (REQ 2.9/#15)', async () => {
    await request(app).delete(`/api/knowledge/${docId}`).set(auth(token));
    expect(await DocumentChunk.countDocuments({ document: docId })).toBe(0);
    const user = { id: teacher._id.toString(), role: 'teacher' };
    const { chunks } = await retrieval.retrieve(user, { query: 'mặt trời', documentIds: [docId] });
    expect(chunks.length).toBe(0);
  });

  test('a PDF with no extractable text is marked failed, not ready (REQ 2.4/#13)', async () => {
    const up = await request(app)
      .post('/api/knowledge').set(auth(token))
      .field('title', 'Bản scan')
      .attach('file', PDF_HEADER, { filename: 'scan.pdf', contentType: 'application/pdf' });
    await processDocument(up.body._id, { extractor: emptyExtractor });
    const doc = await KnowledgeDocument.findById(up.body._id);
    expect(doc.status).toBe('failed');
    expect(doc.error).toBeTruthy();
  });

  test('retry re-processes a failed document to ready (REQ 2.5)', async () => {
    const up = await request(app)
      .post('/api/knowledge').set(auth(token))
      .field('title', 'Thử lại')
      .attach('file', PDF_HEADER, { filename: 'retry.pdf', contentType: 'application/pdf' });
    await processDocument(up.body._id, { extractor: emptyExtractor });
    expect((await KnowledgeDocument.findById(up.body._id)).status).toBe('failed');
    // Retry with a working extractor.
    await processDocument(up.body._id, { extractor: fakeExtractor });
    expect((await KnowledgeDocument.findById(up.body._id)).status).toBe('ready');
  });
});

describe('RAG generation grounding (REQ 2.7/2.8)', () => {
  let teacher; let token; let docId; let subject;

  beforeEach(async () => {
    teacher = await h.makeUser(h.ROLES.TEACHER, { username: 'gv.rag' });
    token = await login('gv.rag');
    subject = await h.makeSubject();
    const up = await request(app)
      .post('/api/knowledge').set(auth(token))
      .field('title', 'SGK bài mặt trời').field('gradeLevel', '3').field('subject', subject._id.toString())
      .attach('file', PDF_HEADER, { filename: 'sgk.pdf', contentType: 'application/pdf' });
    docId = up.body._id;
    await processDocument(docId, { extractor: fakeExtractor });
  });

  test('generate with selected document returns source references (REQ 2.7)', async () => {
    const res = await request(app)
      .post('/api/ai/generate').set(auth(token))
      .send({ grade: 3, subject: subject._id.toString(), topic: 'mặt trời', count: 3, documentIds: [docId] });
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBeGreaterThan(0);
    expect(res.body.sources.length).toBeGreaterThan(0);
    expect(res.body.sources[0].documentTitle).toContain('mặt trời');
  });

  test('requireSources + no relevant content -> honest 422 fallback (REQ 2.7)', async () => {
    // Delete chunks so retrieval finds nothing, but doc stays ready.
    await DocumentChunk.deleteMany({ document: docId });
    const res = await request(app)
      .post('/api/ai/generate').set(auth(token))
      .send({ grade: 3, subject: subject._id.toString(), topic: 'xyz', count: 3, documentIds: [docId], requireSources: true });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_SOURCE_CONTENT');
  });

  test('cannot ground on another teacher\'s document (REQ 2.9)', async () => {
    await h.makeUser(h.ROLES.TEACHER, { username: 'gv.intruder' });
    const intruderToken = await login('gv.intruder');
    const res = await request(app)
      .post('/api/ai/generate').set(auth(intruderToken))
      .send({ grade: 3, topic: 'mặt trời', count: 2, documentIds: [docId], requireSources: true });
    // Intruder has no access -> no chunks -> 422 (not someone else's content).
    expect(res.status).toBe(422);
  });
});
