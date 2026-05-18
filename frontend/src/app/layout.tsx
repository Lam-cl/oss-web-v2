import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import PageTransition from '@/components/layout/PageTransition';
import FloatingReferralQR from '@/components/referral/FloatingReferralQR';

export const metadata: Metadata = {
  title: 'tone wow Shop',
  description: "Malaysia's most rewarding prepaid. Shop devices, SIM cards, and more.",
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main>
          <PageTransition>{children}</PageTransition>
        </main>
        <Footer />
        <FloatingReferralQR />

        {/* Freshdesk Widget */}
        <Script
          id="freshdesk-settings"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.fwSettings = { 'widget_id': 4786741 };
              !function(){if("function"!=typeof window.FreshworksWidget){var n=function(){n.q.push(arguments)};n.q=[],window.FreshworksWidget=n}}()
            `,
          }}
        />
        <Script
          src="//fw-cdn.com/12344265/4786741.js"
          strategy="afterInteractive"
          data-chat="true"
          data-widgetid="0ea239f2-5ea8-4d9c-82cf-7a75fb61665f"
        />
      </body>
    </html>
  );
}
