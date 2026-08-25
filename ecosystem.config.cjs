module.exports = {
  apps: [
    {
      name: 'tonewow',
      cwd: '/www/wwwroot/tonewow.xifuhalim.com',
      script: 'node_modules/.bin/next',
      args: 'start -p 3002',
      env: {
        NEXT_TELEMETRY_DISABLED: '1',
        NODE_ENV: 'production',
        TONEWOW_DATA_DIR: '/www/wwwroot/tonewow.xifuhalim.com/.data',
        ENABLE_LOCAL_ORDER_METADATA: 'true',
        NEXT_PUBLIC_CHAT_PROVIDER: 'balam',
        DIRECT_CHECKOUT_TOKEN: '013868075853b466183e62adb880036433adb31869df0f0bc951252cd1e9accf',
      },
    },
  ],
};
