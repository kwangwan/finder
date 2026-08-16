const path = require('path');

module.exports = {
  apps: [
    {
      name: 'finder-backend',
      cwd: path.join(__dirname, 'backend'),
      script: 'run.py',
      interpreter: path.join(__dirname, 'backend', '.venv', 'bin', 'python'),
      autorestart: true,
      watch: false,
      max_restarts: 20,
      restart_delay: 2000,
      env: {
        PYTHONUNBUFFERED: '1',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(__dirname, 'backend', 'storage_data', 'logs', 'backend-error.log'),
      out_file: path.join(__dirname, 'backend', 'storage_data', 'logs', 'backend-out.log'),
      merge_logs: true,
    },
    {
      name: 'finder-frontend',
      cwd: path.join(__dirname, 'frontend'),
      script: 'npm',
      args: 'run preview -- --host 0.0.0.0 --port 5173',
      autorestart: true,
      watch: false,
      max_restarts: 20,
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(__dirname, 'backend', 'storage_data', 'logs', 'frontend-error.log'),
      out_file: path.join(__dirname, 'backend', 'storage_data', 'logs', 'frontend-out.log'),
      merge_logs: true,
    },
  ],
};
