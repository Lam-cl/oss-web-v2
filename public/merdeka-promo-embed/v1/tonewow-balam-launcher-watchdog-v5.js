(() => {
  const GLOBAL_KEY = '__tonewowBalamLauncherWatchdogV5__';
  if (window[GLOBAL_KEY]) return;
  window[GLOBAL_KEY] = true;

  const HOST_ID = 'Assistant-Shadow-Host';
  const LAUNCHER_ATTR = 'data-tonewow-balam-launcher';
  const BRAND_ASSET = 'https://tonewow.xifuhalim.com/images/balam-tonewow-chat.svg';
  const nativeAttachShadow = Element.prototype.attachShadow;
  let assetState = 'loading';
  let documentObserver = null;
  let shadowObserver = null;
  let observedShadow = null;

  Element.prototype.attachShadow = function attachToneWowShadow(init) {
    if (this.id === HOST_ID) {
      this.style.setProperty('visibility', 'hidden', 'important');
      return nativeAttachShadow.call(this, { ...init, mode: 'open' });
    }
    return nativeAttachShadow.call(this, init);
  };

  function revealNative(host, shadow) {
    const toggle = shadow && shadow.getElementById('Assistant-Toggle');
    const nativeIcon = toggle && toggle.querySelector('.Assistant-icon');
    const customIcon = toggle && toggle.querySelector(`img[${LAUNCHER_ATTR}]`);
    if (customIcon) customIcon.remove();
    if (nativeIcon) nativeIcon.style.removeProperty('display');
    if (host) host.style.setProperty('visibility', 'visible', 'important');
  }

  function installLauncher(host, shadow) {
    const toggle = shadow.getElementById('Assistant-Toggle');
    if (!toggle) return false;
    if (assetState === 'failed') {
      revealNative(host, shadow);
      return true;
    }
    if (assetState !== 'ready') return false;

    const nativeIcon = toggle.querySelector('.Assistant-icon');
    if (nativeIcon) nativeIcon.style.setProperty('display', 'none', 'important');
    let launcher = toggle.querySelector(`img[${LAUNCHER_ATTR}]`);
    if (!launcher) {
      launcher = document.createElement('img');
      launcher.setAttribute(LAUNCHER_ATTR, 'true');
      launcher.src = BRAND_ASSET;
      launcher.alt = '';
      launcher.setAttribute('aria-hidden', 'true');
      launcher.draggable = false;
      toggle.appendChild(launcher);
    }
    launcher.style.cssText = 'display:block!important;width:60%!important;height:60%!important;object-fit:contain!important;pointer-events:none!important;position:relative!important;z-index:2!important';
    toggle.style.setProperty('background', '#1a56db', 'important');
    toggle.style.setProperty('border', '2px solid rgba(255,255,255,.95)', 'important');
    toggle.style.setProperty('border-radius', '50%', 'important');
    toggle.style.setProperty('box-shadow', '0 10px 28px rgba(13,27,62,.3)', 'important');
    host.style.setProperty('visibility', 'visible', 'important');
    return true;
  }

  function ensureLauncher() {
    const host = document.getElementById(HOST_ID);
    const shadow = host && host.shadowRoot;
    if (!host || !shadow) return;
    const main = shadow.getElementById('Assistant-Main');
    const transactional = location.pathname.startsWith('/cart') || location.pathname.startsWith('/checkout');
    if (main) main.style.setProperty('bottom', transactional ? 'calc(82px + env(safe-area-inset-bottom))' : 'max(12px, 2%)', 'important');
    if (observedShadow !== shadow) {
      if (shadowObserver) shadowObserver.disconnect();
      observedShadow = shadow;
      shadowObserver = new MutationObserver(ensureLauncher);
      shadowObserver.observe(shadow, { childList: true, subtree: true });
    }
    installLauncher(host, shadow);
  }

  const brandImage = new Image();
  brandImage.onload = () => {
    if (assetState !== 'loading') return;
    assetState = 'ready';
    ensureLauncher();
  };
  brandImage.onerror = () => {
    if (assetState !== 'loading') return;
    assetState = 'failed';
    ensureLauncher();
  };
  brandImage.src = BRAND_ASSET;
  window.setTimeout(() => {
    if (assetState !== 'loading') return;
    assetState = 'failed';
    ensureLauncher();
  }, 3000);

  function start() {
    ensureLauncher();
    documentObserver = new MutationObserver(ensureLauncher);
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
