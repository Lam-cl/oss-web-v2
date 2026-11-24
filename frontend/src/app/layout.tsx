import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import Script from 'next/script';
import 'react-day-picker/style.css';
import './globals.css';
import './merchandise-parity.css';
import RouteChrome from '@/components/layout/RouteChrome';
import SmartechInit from '@/components/smartech/smartech';

// Self-hosted Montserrat (replaces the render-blocking Google Fonts @import).
// Only weights referenced in CSS/TSX are loaded; 650/750/850/950 snap to the
// nearest static face (700/800/900/900) exactly as they did with the old import.
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-montserrat',
});

export const metadata: Metadata = {
  title: 'tone wow Shop',
  description: "Malaysia's most rewarding prepaid. Shop devices, SIM cards, and more.",
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={montserrat.variable}>
      <head>
        <style>{'#Assistant-Shadow-Host{visibility:hidden!important}'}</style>
      </head>
      <body><RouteChrome>{children}</RouteChrome>
      <SmartechInit />
      </body>
    </html>
  );
}
