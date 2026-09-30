'use client';

import Script from 'next/script';

export default function SmartechInit() {
  return (
    <Script
      src="https://cdnt.netcoresmartech.com/smartechclient.js"
      strategy="afterInteractive"
      onReady={() => {
        const s = (window as any).smartech;
        if (!s) return;
        s('create', 'ADGMOT35CHFLVDHBJNIG50K96BI5GSDTBRLJVR0UB5OVUHE69NOG');
        s('register', 'ce33cbe52a8fcaf7a03e6d6a8ee12d54');
        s('identify', '');
      }}
    />
  );
}