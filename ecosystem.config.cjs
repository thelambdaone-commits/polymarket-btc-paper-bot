module.exports = {
  apps: [
    {
      name: 'polymarket-btc-paper-bot',
      cwd: __dirname,
      script: 'src/main.js',
      node_args: '--env-file-if-exists=.env',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      min_uptime: '10s',
      time: true,
      env: {
        NODE_ENV: 'production',
        PAPER_STARTING_BALANCE: '5',
        PAPER_STAKE: '1',
      },
    },
  ],
};
