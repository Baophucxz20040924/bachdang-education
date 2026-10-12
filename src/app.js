const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const env = require('./config/env');
const { generalLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFound } = require('./middleware/error');

const health = require('./modules/health/health.routes');
const auth = require('./modules/auth/auth.routes');
const users = require('./modules/users/users.routes');
const subjects = require('./modules/subjects/subjects.routes');
const classes = require('./modules/classes/classes.routes');
const sessions = require('./modules/sessions/sessions.routes');
const ai = require('./modules/ai/ai.routes');
const knowledge = require('./modules/knowledge/knowledge.routes');
const student = require('./modules/student/student.routes');
const analytics = require('./modules/analytics/analytics.routes');

function createApp() {
  const app = express();

  // Behind a reverse proxy (Nginx), trust X-Forwarded-* so req.ip and the
  // rate limiter see the real client IP. TRUST_PROXY: number of proxies in
  // front (1 = Nginx), or 'false' to disable. Defaults to 1 in production.
  if (env.TRUST_PROXY !== 'false') {
    const hops = Number.parseInt(env.TRUST_PROXY, 10);
    app.set('trust proxy', Number.isNaN(hops) ? (env.NODE_ENV === 'production' ? 1 : false) : hops);
  }

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  if (env.NODE_ENV !== 'test') app.use(morgan('dev'));
  app.use(generalLimiter);

  app.use('/api/health', health);
  app.use('/api/auth', auth);
  app.use('/api/users', users);
  app.use('/api/subjects', subjects);
  app.use('/api/classes', classes);
  app.use('/api/sessions', sessions);
  app.use('/api/ai', ai);
  app.use('/api/knowledge', knowledge);
  app.use('/api/student', student);
  app.use('/api/analytics', analytics);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
