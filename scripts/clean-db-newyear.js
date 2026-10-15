#!/usr/bin/env node
/* ===========================================================================
 * New-school-year database cleanup — MANUAL script.
 *
 * Resets per-year ACTIVITY data while keeping accounts and teaching materials,
 * so you can start a fresh school year with a clean slate.
 *
 * WHAT IT CLEANS (default):
 *   • Attempt       — every student submission / score from last year
 *   • Membership    — every student↔class enrollment (students re-enroll)
 *   • AuditLog      — housekeeping action logs
 *
 * WHAT IT KEEPS (default):
 *   • User          — admin / teacher / student accounts
 *   • Class         — class shells (Lớp 2A, Lớp 2/1, ...)
 *   • Subject       — subjects (Toán, Tiếng Việt, ...)
 *   • Session       — teaching sessions / assignments
 *   • KnowledgeDocument + DocumentChunk + uploaded files
 *
 * OPT-IN extra cleanup (add the flag):
 *   --sessions    also delete all Session documents (assignments)
 *   --classes     also delete all Class documents (class shells)
 *   --knowledge   also delete KnowledgeDocument + DocumentChunk + stored files
 *   --all         shorthand for --sessions --classes --knowledge
 *
 * SAFETY:
 *   • DRY-RUN by default: prints what WOULD be deleted and changes nothing.
 *   • Nothing is deleted unless you pass --confirm.
 *   • Never deletes User / Subject (accounts & reference data always survive).
 *
 * USAGE (run from backend/):
 *   node scripts/clean-db-newyear.js                 # dry-run, see counts
 *   node scripts/clean-db-newyear.js --confirm       # clean activity data
 *   node scripts/clean-db-newyear.js --sessions --confirm
 *   node scripts/clean-db-newyear.js --all --confirm
 *
 * It uses MONGODB_URI from backend/.env — point that at the DB you intend to
 * clean. DOUBLE-CHECK you are not pointed at a production DB by accident.
 * =========================================================================== */

const path = require('path');
const fs = require('fs');
const readline = require('readline');

const env = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');

const Attempt = require('../src/models/Attempt');
const Membership = require('../src/models/Membership');
const AuditLog = require('../src/models/AuditLog');
const Session = require('../src/models/Session');
const Class = require('../src/models/Class');
const KnowledgeDocument = require('../src/models/KnowledgeDocument');
const DocumentChunk = require('../src/models/DocumentChunk');

// --- Parse flags -----------------------------------------------------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const flags = {
  confirm: has('--confirm') || has('-y'),
  sessions: has('--sessions') || has('--all'),
  classes: has('--classes') || has('--all'),
  knowledge: has('--knowledge') || has('--all'),
};
const DRY_RUN = !flags.confirm;

function log(...a) { console.log(...a); } // eslint-disable-line no-console

function maskUri(uri) {
  // Hide credentials when echoing the connection string.
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

// Delete every file stored for the knowledge base (local driver only).
function wipeLocalKnowledgeStorage(dryRun) {
  const dir = path.resolve(__dirname, '..', 'storage', 'knowledge');
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir).filter((n) => n !== '.gitkeep');
  if (!dryRun) {
    for (const name of entries) {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  }
  return entries.length;
}

async function askConfirmation(summary) {
  // Interactive double-check before a real (non-dry-run) delete.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(
      `\n⚠️  Về việc này KHÔNG THỂ HOÀN TÁC.\n${summary}\nGõ "XOA" để xác nhận xóa: `,
      resolve,
    );
  });
  rl.close();
  return answer.trim() === 'XOA';
}

async function run() {
  if (!env.MONGODB_URI) {
    console.error('Thiếu MONGODB_URI. Hãy cấu hình backend/.env trước khi chạy.'); // eslint-disable-line no-console
    process.exit(1);
  }

  await connectDB(env.MONGODB_URI);
  log('\n=== Dọn dẹp CSDL cho năm học mới ===');
  log('Kết nối:', maskUri(env.MONGODB_URI));
  log('Chế độ :', DRY_RUN ? 'DRY-RUN (chỉ xem, không xóa)' : 'XÓA THẬT (--confirm)');

  // Count everything up front so dry-run and the confirmation prompt are honest.
  const counts = {
    attempts: await Attempt.estimatedDocumentCount(),
    memberships: await Membership.estimatedDocumentCount(),
    auditLogs: await AuditLog.estimatedDocumentCount(),
    sessions: await Session.estimatedDocumentCount(),
    classes: await Class.estimatedDocumentCount(),
    knowledgeDocs: await KnowledgeDocument.estimatedDocumentCount(),
    chunks: await DocumentChunk.estimatedDocumentCount(),
  };

  // Build the plan: always-on targets + opt-in targets.
  const plan = [
    { label: 'Attempt (bài làm)', n: counts.attempts, on: true },
    { label: 'Membership (ghi danh lớp)', n: counts.memberships, on: true },
    { label: 'AuditLog (nhật ký)', n: counts.auditLogs, on: true },
    { label: 'Session (buổi học/bài tập)', n: counts.sessions, on: flags.sessions },
    { label: 'Class (lớp học)', n: counts.classes, on: flags.classes },
    { label: 'KnowledgeDocument (tài liệu)', n: counts.knowledgeDocs, on: flags.knowledge },
    { label: 'DocumentChunk (đoạn tài liệu)', n: counts.chunks, on: flags.knowledge },
  ];

  log('\nSẽ XÓA:');
  for (const p of plan.filter((x) => x.on)) log(`  - ${p.label}: ${p.n}`);
  log('\nSẽ GIỮ LẠI:');
  log('  - User (tài khoản admin/giáo viên/học sinh)');
  log('  - Subject (môn học)');
  for (const p of plan.filter((x) => !x.on)) log(`  - ${p.label}: ${p.n} (dùng cờ để xóa)`);

  if (DRY_RUN) {
    log('\nĐây là DRY-RUN — chưa xóa gì.');
    log('Chạy lại kèm --confirm để xóa thật. Ví dụ:');
    log('  node scripts/clean-db-newyear.js --confirm');
    await disconnectDB();
    return;
  }

  const summary = plan.filter((x) => x.on).map((p) => `  - ${p.label}: ${p.n}`).join('\n');
  const ok = await askConfirmation(summary);
  if (!ok) {
    log('\nĐã HỦY. Không có gì bị xóa.');
    await disconnectDB();
    return;
  }

  log('\nĐang xóa...');
  const r = {};
  r.attempts = (await Attempt.deleteMany({})).deletedCount;
  r.memberships = (await Membership.deleteMany({})).deletedCount;
  r.auditLogs = (await AuditLog.deleteMany({})).deletedCount;
  if (flags.sessions) r.sessions = (await Session.deleteMany({})).deletedCount;
  if (flags.classes) r.classes = (await Class.deleteMany({})).deletedCount;
  if (flags.knowledge) {
    r.chunks = (await DocumentChunk.deleteMany({})).deletedCount;
    r.knowledgeDocs = (await KnowledgeDocument.deleteMany({})).deletedCount;
    // Remove stored files too (local driver). S3 objects are left to a bucket
    // lifecycle policy — this script only manages the local filesystem driver.
    if (env.STORAGE_DRIVER === 'local') {
      r.files = wipeLocalKnowledgeStorage(false);
    }
  }

  log('\n✅ Hoàn tất. Đã xóa:');
  for (const [k, v] of Object.entries(r)) log(`  - ${k}: ${v}`);
  log('\nGợi ý: chạy "npm run seed" nếu muốn tạo lại dữ liệu mẫu.');

  await disconnectDB();
}

run().catch(async (err) => {
  console.error('\n❌ Lỗi khi dọn dẹp:', err); // eslint-disable-line no-console
  try { await disconnectDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
