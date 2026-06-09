'use client';

import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    /* overflow:hidden prevents horizontal bleed during slide */
    <div style={{ overflow: 'hidden', position: 'relative' }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
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
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
