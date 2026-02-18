/**
 * PM2 Ecosystem Config
 * Codex recommendation: env separation + restart policy
 */
module.exports = {
  apps: [{
    name: 'revenio-caller',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'development',
      PORT: 3001
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    // Healthcheck restart (Codex recommendation)
    restart_delay: 5000,
    exp_backoff_restart_delay: 100
  }]
};
