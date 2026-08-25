import type { Metadata } from 'next';
import 'react-day-picker/style.css';
import './globals.css';
import RouteChrome from '@/components/layout/RouteChrome';

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
    <html lang="en">
      <head><style>{'#Assistant-Shadow-Host{visibility:hidden!important}'}</style><script src="/js/tonewow-balam-launcher-watchdog-20260821-v4.js" /></head>
      <body><RouteChrome>{children}</RouteChrome></body>
    </html>
  );
}
