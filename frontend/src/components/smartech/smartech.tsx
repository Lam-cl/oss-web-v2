'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { flushSmartechQueue } from '@/lib/smartech';

// Conversion landing pages (gateway redirects) send purchase-success events that
// only retry for ~10s, so load Smartech early there; everywhere else defer it
// until the page has finished loading.
const EARLY_ROUTES = ['/payment/', '/thank-you'];

export default function SmartechInit() {
  const pathname = usePathname() || '/';
  // Decided once from the landing URL; the script loads once per session.
  const [strategy] = useState<'afterInteractive' | 'lazyOnload'>(() =>
    EARLY_ROUTES.some(route => pathname.startsWith(route)) ? 'afterInteractive' : 'lazyOnload',
  );
  return (
    <Script
      src="https://cdnt.netcoresmartech.com/smartechclient.js"
      strategy={strategy}
      onReady={() => {
        const s = (window as any).smartech;
        if (!s) return;
        s('create', 'ADGMOT35CHFLVDHBJNIG50K96BI5GSDTBRLJVR0UB5OVUHE69NOG');
        s('register', 'ce33cbe52a8fcaf7a03e6d6a8ee12d54');
        s('identify', '');
        // Replay events tracked before the script loaded. Done here (not in
        // onLoad) so they are sent after create/register, as before.
        flushSmartechQueue();
      }}
    />
  );
}
