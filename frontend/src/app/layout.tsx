import type { Metadata } from 'next';
import './globals.css';
import './merchandise-parity.css';
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
      <body><RouteChrome>{children}</RouteChrome></body>
    </html>
  );
}
