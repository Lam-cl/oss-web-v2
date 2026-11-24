'use client';

import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import Script from 'next/script';
import Header from './Header';
import Footer from './Footer';
import PageTransition from './PageTransition';

// Client-only and code-split: keeps framer-motion and qrcode.react out of the
// shared bundle. The widget is a fixed-position button that already animated in
// after hydration, so rendering it only on the client does not change layout.
const FloatingReferralQR = dynamic(() => import('@/components/referral/FloatingReferralQR'), { ssr: false });

const GTM_ID='GTM-KKWBVFJS';

export default function RouteChrome({children}:{children:React.ReactNode}){
  const pathname=usePathname()||'/';
  const admin=pathname.startsWith('/admin');
  if(admin)return <>{children}</>;
  return <>
    <Script id="google-tag-manager" strategy="afterInteractive" dangerouslySetInnerHTML={{__html:`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}}/>
    {/* NOTE: direct gtag G-5XC8PGE7CD may duplicate a GA4 tag inside GTM-KKWBVFJS (double-counted page views).
        Kept until marketing confirms; remove both gtag scripts below if GTM already fires it. */}
    <Script async src="https://www.googletagmanager.com/gtag/js?id=G-5XC8PGE7CD" strategy="afterInteractive"/>
    <Script id="google-analytics" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-5XC8PGE7CD');`}</Script>
    <noscript><iframe title="Google Tag Manager" src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`} height="0" width="0" style={{display:'none',visibility:'hidden'}}/></noscript>
    <Header/><main><PageTransition>{children}</PageTransition></main><Footer/><FloatingReferralQR/>
    <Script id="freshdesk-settings" strategy="afterInteractive" dangerouslySetInnerHTML={{__html:`window.fwSettings={'widget_id':4786741};!function(){if('function'!=typeof window.FreshworksWidget){var n=function(){n.q.push(arguments)};n.q=[],window.FreshworksWidget=n}}()`}}/>
    {/* Freshworks chat widget loads after window load (idle); fwSettings above stays afterInteractive so it is defined first. */}
    <Script src="//fw-cdn.com/12344265/4786741.js" strategy="lazyOnload" data-chat="true" data-widgetid="0ea239f2-5ea8-4d9c-82cf-7a75fb61665f"/>
  </>;
}