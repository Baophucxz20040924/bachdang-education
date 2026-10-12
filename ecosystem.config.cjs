// PM2 process config for the Education AI backend on a single small VPS.
//
// Fork mode (single instance) is intentional:
//  - Uploaded PDFs/DOCX are stored on the LOCAL filesystem (backend/storage/)
//    and document processing runs in-process via setImmediate. Cluster mode
//    would run multiple workers that don't share those background jobs and
//    could race on the same files. Keep ONE instance.
//  - On a 2 vCPU / 4 GB VPS, one instance + Nginx is the right size.
//
// Usage (on the VPS, from the backend/ directory):
//   npm ci --omit=dev
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save && pm2 startup   # survive reboots
//   pm2 logs education-ai-backend
module.exports = {
  apps: [
    {
      name: 'education-ai-backend',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // --- Memory tuning for a 2 vCPU / 2 GB RAM VPS ---
      // Restart the app if RSS exceeds ~900 MB. On a 2 GB box this leaves room
      // for Nginx + OS (+ swap). If you later move to 4 GB, raise to ~1200M.
      max_memory_restart: '900M',
      // Cap Node's heap so a huge PDF/DOCX fails that one request instead of
      // OOM-killing the whole VPS. ~768 MB is safe on 2 GB.
      node_args: '--max-old-space-size=768',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      restart_delay: 3000,
      watch: false,
      env: {
        NODE_ENV: 'production',
        // PORT and all secrets come from backend/.env (loaded by dotenv in config/env.js).
      },
      // Timestamped logs under backend/logs/ (create the dir or let PM2 create it).
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      time: true,
    },
  ],
};
