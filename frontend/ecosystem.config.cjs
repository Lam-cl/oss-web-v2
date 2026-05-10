module.exports = {
  apps: [
    {
      name: 'tonewow-frontend',
      cwd: '/www/wwwroot/v2.tonewow.xifuhalim.com/frontend',
      script: 'node_modules/.bin/next',
      args: 'start',
      env: {
        NEXT_TELEMETRY_DISABLED: '1',
        NODE_ENV: 'production',
      },
    },
  ],
};
