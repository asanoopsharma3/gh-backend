module.exports = {
  apps: [
    {
      name: "ghsuperwinnings",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 5000,
      },
      merge_logs: true,
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_file: "./logs/combined.log",
    },
  ],
};
