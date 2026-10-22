// pm2 process file for self-hosting on a server.
//
//   npm ci && npm run build
//   pm2 start ecosystem.config.js        # or: npm run pm2:start
//   pm2 save && pm2 startup               # restart on reboot
//
// The app listens on 127.0.0.1 only; put Caddy or nginx in front of it for
// HTTPS (see README → Deploy). No API keys are configured here: visitors bring
// their own keys in the browser.

module.exports = {
  apps: [
    {
      name: 'open-generative-ai',
      script: 'node_modules/next/dist/bin/next',
      args: `start --hostname ${process.env.HOST || '127.0.0.1'} --port ${process.env.PORT || 3000}`,
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
