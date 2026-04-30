module.exports = {
  apps: [
    {
      name: 'sniper',
      script: 'index.js',
      cwd: '.',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PAPER_TRADING: 'true'
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 8000,
      kill_timeout: 5000,
      wait_ready: true
    }
  ]
};