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

const GTM_ID = 'GTM-KKWBVFJS';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Google Tag Manager */}
        <Script
          id="google-tag-manager"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function(w,d,s,l,i){w[l]=w[l]||[];
              w[l].push({'gtm.start': new Date().getTime(),event:'gtm.js'});
              var f=d.getElementsByTagName(s)[0],
              j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
              j.async=true;
              j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
              f.parentNode.insertBefore(j,f);
              })(window,document,'script','dataLayer','${GTM_ID}');
            `,
          }}
        />
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>
        {/* End Google Tag Manager */}
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
