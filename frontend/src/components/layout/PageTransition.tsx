'use client';

import { useRef } from 'react';
import { usePathname } from 'next/navigation';

// CSS-only route transition (see .page-transition-enter in globals.css).
// Replaces the framer-motion version so framer stays off the shared bundle.
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const initialPathname = useRef(pathname);
  const hasNavigated = useRef(false);
  if (pathname !== initialPathname.current) hasNavigated.current = true;

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
      {/* Keyed so each route change remounts and replays the enter animation.
          No animation on the first page load (was AnimatePresence initial={false}). */}
      <div
        key={pathname}
        className={hasNavigated.current ? 'page-transition-enter' : undefined}
        style={{
          background: 'var(--bg, #f8fafc)', // cover loading flash
          minHeight: '100vh',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  );
}
