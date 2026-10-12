const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');

/**
 * Storage abstraction. Default: private local filesystem under backend/storage/
 * (outside any static/public directory). An S3 adapter can be added later and
 * selected via STORAGE_DRIVER=s3 without changing callers.
 *
 * Never trust client filenames: callers pass desired extension; we generate a
 * safe random key. Path traversal is impossible because keys are hex + fixed ext.
 */

const LOCAL_ROOT = path.resolve(__dirname, '..', '..', 'storage', 'knowledge');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateKey(ext = '.pdf') {
  const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : '.bin';
  return `${Date.now().toString(36)}-${crypto.randomBytes(16).toString('hex')}${safeExt}`;
}

const localDriver = {
  async save(key, buffer) {
    ensureDir(LOCAL_ROOT);
    const full = path.join(LOCAL_ROOT, key);
    // Guard: resolved path must stay within LOCAL_ROOT.
    if (!path.resolve(full).startsWith(LOCAL_ROOT)) throw new Error('Khóa lưu trữ không hợp lệ.');
    await fs.promises.writeFile(full, buffer);
    return key;
  },
  async read(key) {
    const full = path.join(LOCAL_ROOT, key);
    if (!path.resolve(full).startsWith(LOCAL_ROOT)) throw new Error('Khóa lưu trữ không hợp lệ.');
    return fs.promises.readFile(full);
  },
  async remove(key) {
    const full = path.join(LOCAL_ROOT, key);
    if (!path.resolve(full).startsWith(LOCAL_ROOT)) return;
    await fs.promises.unlink(full).catch(() => {});
  },
};

// S3 extension point: implement when STORAGE_DRIVER=s3 (uses IAM role / env creds,
// never hardcoded). Kept as a stub so the abstraction is clear.
function getDriver() {
  if ((env.STORAGE_DRIVER || 'local') === 's3') {
    try {
      // eslint-disable-next-line global-require
      return require('./s3Driver');
    } catch (_) {
      // eslint-disable-next-line no-console
      console.warn('[storage] STORAGE_DRIVER=s3 nhưng chưa cấu hình — dùng tạm local.');
    }
  }
  return localDriver;
}

const storage = {
  generateKey,
  save: (key, buffer) => getDriver().save(key, buffer),
  read: (key) => getDriver().read(key),
  remove: (key) => getDriver().remove(key),
  LOCAL_ROOT,
};

module.exports = storage;
