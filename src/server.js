const createApp = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');

async function start() {
  try {
    await connectDB(env.MONGODB_URI);
    // eslint-disable-next-line no-console
    console.log('[db] Đã kết nối MongoDB Atlas.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[db] Không thể kết nối MongoDB:', err.message);
    process.exit(1);
  }

  const app = createApp();
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] API chạy tại http://localhost:${env.PORT}/api`);
  });
}

start();
