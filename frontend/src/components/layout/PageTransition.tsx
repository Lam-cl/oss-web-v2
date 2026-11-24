'use client';

import { usePathname } from 'next/navigation';
import { AnimatePresence, LazyMotion, domAnimation, m } from 'framer-motion';

// LazyMotion + m keeps the same animations as motion.div but ships only the
// domAnimation feature bundle on the shared layout path.
// Not `strict`: page content rendered inside (ReferralCapture, SIMSection,
// sim/purchase) still uses <motion.*>, which strict mode turns into a dev-time
// invariant error. Switch those to `m` before enabling strict.

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Payment outcomes replace one another based on gateway/status evidence.
  // Keeping the outgoing route mounted for an exit animation can briefly show
  // the processing spinner after the URL has already become success/failed.
  if (pathname.startsWith('/payment/')) {
    return (
      <div style={{ background: 'var(--bg, #f8fafc)', minHeight: '100vh' }}>
        {children}
      </div>
    );
  }

  return (
    /* overflow:hidden prevents horizontal bleed during slide */
    <div style={{ overflow: 'hidden', position: 'relative' }}>
      <LazyMotion features={domAnimation}>
      <AnimatePresence mode="popLayout" initial={false}>
        <m.div
          key={pathname}
          initial={{ y: '100vh' }}
          animate={{
            y: 0,
            transition: {
              duration: 0.7,
              ease: [0.16, 1, 0.3, 1], // expo-out — fast start, soft settle
            },
          }}
          exit={{
            y: '-12%',
            opacity: 0,
            transition: {
              duration: 0.4,
              ease: [0.4, 0, 1, 1], // ease-in
            },
          }}
          style={{
            background: 'var(--bg, #f8fafc)', // cover loading flash
            minHeight: '100vh',
            willChange: 'transform',
          }}
        >
          {children}
        </m.div>
      </AnimatePresence>
      </LazyMotion>
    </div>
  );
}
