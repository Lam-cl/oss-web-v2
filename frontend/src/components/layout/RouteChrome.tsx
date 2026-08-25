'use client';

import { usePathname } from 'next/navigation';
import Script from 'next/script';
import Header from './Header';
import Footer from './Footer';
import PageTransition from './PageTransition';
import FloatingReferralQR from '@/components/referral/FloatingReferralQR';

const GTM_ID = 'GTM-KKWBVFJS';

export default function RouteChrome({ children }: { children: React.ReactNode }) {
  const admin = usePathname()?.startsWith('/admin');
  if (admin) return <>{children}</>;

  return (
    <>
      <Script id="google-tag-manager" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');` }} />
      <Script async src="https://www.googletagmanager.com/gtag/js?id=G-5XC8PGE7CD" strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-5XC8PGE7CD');`}</Script>
      <noscript><iframe title="Google Tag Manager" src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`} height="0" width="0" style={{ display: 'none', visibility: 'hidden' }} /></noscript>
      <Header />
      <main><PageTransition>{children}</PageTransition></main>
      <Footer />
      <FloatingReferralQR />
      <Script src="https://widget.ibalam.ai/assistant" data-balam-assistant="10682d00-7c37-4ec8-95e6-22aeb9e94b49" data-balam-origin="https://admin.ibalam.ai" crossOrigin="anonymous" strategy="afterInteractive" />
    </>
  );
}
