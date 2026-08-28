import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MerdekaPromoPage from '@/app/merdeka-promo/page';
import MerdekaEmbedChrome from './MerdekaEmbedChrome';
import MerdekaEmbedConfirmation from './MerdekaEmbedConfirmation';

const script = document.currentScript as HTMLScriptElement | null;
const scriptUrl = new URL(script?.src || window.location.href);
const release = scriptUrl.searchParams.get('v') || '1';
const defaultBase = scriptUrl.origin;

class ToneWowMerdekaPromo extends HTMLElement {
  private root?: Root;
  connectedCallback() {
    if (this.root) return;
    const apiBase = this.getAttribute('api-base')?.replace(/\/$/,'') || defaultBase;
    const assetBase = this.getAttribute('asset-base')?.replace(/\/$/,'') || defaultBase;
    const publicPage = this.getAttribute('public-page')?.replace(/\/$/,'') || `${window.location.origin}${window.location.pathname}`;
    window.__TW_MERDEKA_EMBED__ = { apiBase, assetBase, publicPage };
    const shadow = this.shadowRoot || this.attachShadow({mode:'open'});
    const hostStyle = document.createElement('style');
    hostStyle.textContent = ':host{display:block;width:100vw;max-width:100vw;margin-left:calc(50% - 50vw);min-height:100vh;background:#fff;color:#172338}*{box-sizing:border-box}.twmp-loader{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:#fff;font:500 14px Montserrat,Arial,sans-serif;color:#65738a}.twmp-spinner{width:40px;height:40px;margin:0 auto 10px;border:3px solid #e8edf2;border-top-color:#1557b0;border-radius:50%;animation:twmp-spin .8s linear infinite}@keyframes twmp-spin{to{transform:rotate(360deg)}}';
    const font = document.createElement('link');font.rel='stylesheet';font.href='https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap';
    const css = document.createElement('link');css.rel='stylesheet';css.href=`${defaultBase}/merdeka-promo-embed/v1/app.css?v=${encodeURIComponent(release)}`;
    const loader = document.createElement('div');loader.className='twmp-loader';loader.innerHTML='<div><div class="twmp-spinner"></div><div>Loading Merdeka Promo…</div></div>';
    const mount = document.createElement('div');
    shadow.append(hostStyle,font,css,mount,loader);
    let ready=false;
    const reveal=()=>{if(ready)return;ready=true;loader.remove();};
    css.addEventListener('load',()=>window.setTimeout(reveal,50),{once:true});
    css.addEventListener('error',()=>{loader.textContent='The campaign could not be loaded. Please refresh and try again.';},{once:true});
    window.setTimeout(()=>{if(!ready)loader.textContent='The campaign is taking longer than expected. Please refresh and try again.';},12000);
    const confirmation = new URLSearchParams(window.location.search).has('ref') || new URLSearchParams(window.location.search).get('invalid')==='1';
    this.root=createRoot(mount);
    this.root.render(<MerdekaEmbedChrome>{confirmation?<MerdekaEmbedConfirmation/>:<MerdekaPromoPage/>}</MerdekaEmbedChrome>);
  }
  disconnectedCallback(){this.root?.unmount();this.root=undefined;}
}

if(!customElements.get('tonewow-merdeka-promo'))customElements.define('tonewow-merdeka-promo',ToneWowMerdekaPromo);
