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
        DIRECT_CHECKOUT_TOKEN: '013868075853b466183e62adb880036433adb31869df0f0bc951252cd1e9accf',
      },
    },
  ],
};
