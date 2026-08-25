'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';
import Header from './Header';
import Footer from './Footer';
import PageTransition from './PageTransition';
import FloatingReferralQR from '@/components/referral/FloatingReferralQR';

const GTM_ID='GTM-KKWBVFJS';
const CHAT_PROVIDER=process.env.NEXT_PUBLIC_CHAT_PROVIDER==='freshworks'?'freshworks':'balam';
const BALAM_ID='10682d00-7c37-4ec8-95e6-22aeb9e94b49';
const BALAM_LAUNCHER_SELECTOR='img[data-tonewow-balam-launcher]';

function installToneWowLauncher(shadow:ShadowRoot){
  const toggle=shadow.getElementById('Assistant-Toggle') as HTMLElement|null;
  if(!toggle)return false;
  toggle.querySelector<HTMLElement>('.Assistant-icon')?.style.setProperty('display','none','important');
  let launcher=toggle.querySelector<HTMLImageElement>(BALAM_LAUNCHER_SELECTOR);
  if(!launcher){
    launcher=document.createElement('img');
    launcher.dataset.tonewowBalamLauncher='true';
    launcher.src=new URL('/images/balam-tonewow-chat.svg',window.location.origin).href;
    launcher.alt='';
    launcher.setAttribute('aria-hidden','true');
    launcher.draggable=false;
    toggle.appendChild(launcher);
  }
  launcher.style.cssText='display:block!important;width:60%!important;height:60%!important;object-fit:contain!important;pointer-events:none!important;position:relative!important;z-index:2!important';
  toggle.style.setProperty('background','#1a56db','important');
  toggle.style.setProperty('border','2px solid rgba(255,255,255,.95)','important');
  toggle.style.setProperty('border-radius','50%','important');
  toggle.style.setProperty('box-shadow','0 10px 28px rgba(13,27,62,.3)','important');
  return true;
}

function useBalamToneWowTheme(pathname:string){
  useEffect(()=>{
    if(CHAT_PROVIDER!=='balam')return;
    let stopped=false;
    let shadowObserver:MutationObserver|null=null;
    let hostObserver:MutationObserver|null=null;
    const sync=()=>{
      const host=document.getElementById('Assistant-Shadow-Host') as HTMLElement|null;
      if(!host)return;
      let wrapper=document.getElementById('tonewow-chat-visibility-wrapper') as HTMLElement|null;
      if(!wrapper){
        wrapper=document.createElement('div');
        wrapper.id='tonewow-chat-visibility-wrapper';
        wrapper.style.setProperty('display', 'contents');
        host.parentNode?.insertBefore(wrapper,host);
      }
      if(host.parentElement!==wrapper)wrapper.appendChild(host);
      if(pathname.startsWith('/checkout')||document.querySelector('[aria-modal="true"]'))wrapper.style.setProperty('display', 'none', 'important');
      else wrapper.style.setProperty('display', 'contents');
    };
    const cleanup=()=>{
      stopped=true;
      shadowObserver?.disconnect();
      hostObserver?.disconnect();
      const host=document.getElementById('Assistant-Shadow-Host');
      host?.style.removeProperty('display');
      host?.shadowRoot?.getElementById('Assistant-Main')?.style.removeProperty('display');
    };
    const install=()=>{
      if(stopped)return true;
      const host=document.getElementById('Assistant-Shadow-Host') as HTMLElement|null;
      const shadow=host?.shadowRoot;
      if(!host||!shadow)return false;
      const main=shadow.getElementById('Assistant-Main') as HTMLElement|null;
      main?.style.setProperty('bottom',pathname.startsWith('/cart')||pathname.startsWith('/checkout')?'calc(82px + env(safe-area-inset-bottom))':'max(12px, 2%)','important');
      sync();
      if(installToneWowLauncher(shadow))host.style.setProperty('visibility','visible','important');
      if(!shadowObserver){
        shadowObserver=new MutationObserver(()=>{sync();installToneWowLauncher(shadow)});
        shadowObserver.observe(shadow,{childList:true,subtree:true});
      }
      return true;
    };
    hostObserver=new MutationObserver(()=>install());
    hostObserver.observe(document.body,{childList:true,subtree:true});
    install();
    return cleanup;
  },[pathname]);
}

export default function RouteChrome({children}:{children:React.ReactNode}){
  const pathname=usePathname()||'/';
  const admin=pathname.startsWith('/admin');
  useBalamToneWowTheme(pathname);
  if(admin)return <>{children}</>;
  return <>
    <Script id="google-tag-manager" strategy="afterInteractive" dangerouslySetInnerHTML={{__html:`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}}/>
    <Script async src="https://www.googletagmanager.com/gtag/js?id=G-5XC8PGE7CD" strategy="afterInteractive"/>
    <Script id="google-analytics" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-5XC8PGE7CD');`}</Script>
    <noscript><iframe title="Google Tag Manager" src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`} height="0" width="0" style={{display:'none',visibility:'hidden'}}/></noscript>
    <Header/><main><PageTransition>{children}</PageTransition></main><Footer/><FloatingReferralQR/>
    {CHAT_PROVIDER==='balam'?<Script src="https://widget.ibalam.ai/assistant" data-balam-assistant={BALAM_ID} data-balam-origin="https://admin.ibalam.ai" crossOrigin="anonymous" strategy="afterInteractive"/>:<><Script id="freshdesk-settings" strategy="afterInteractive" dangerouslySetInnerHTML={{__html:`window.fwSettings={'widget_id':4786741};!function(){if('function'!=typeof window.FreshworksWidget){var n=function(){n.q.push(arguments)};n.q=[],window.FreshworksWidget=n}}()`}}/><Script src="//fw-cdn.com/12344265/4786741.js" strategy="afterInteractive" data-chat="true" data-widgetid="0ea239f2-5ea8-4d9c-82cf-7a75fb61665f"/></>}
  </>;
}
