(() => {
  const HOST_ID = 'Assistant-Shadow-Host';
  const THEME_ID = 'tonewow-balam-theme';
  const THEME_HREF = '/css/tonewow-balam-theme-20260821.css';
  const nativeAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    if (this.id === HOST_ID) this.style.setProperty('visibility', 'hidden', 'important');
    return nativeAttachShadow.call(this, this.id === HOST_ID ? { ...init, mode: 'open' } : init);
  };
  let documentObserver = null;
  let shadowObserver = null;
  let observedShadow = null;

  function ensureTheme() {
    const host = document.getElementById(HOST_ID);
    const shadow = host && host.shadowRoot;
    if (!host || !shadow) return;
    const currentToggle = shadow.getElementById('Assistant-Toggle');
    const branded = currentToggle && getComputedStyle(currentToggle).backgroundColor === 'rgb(26, 86, 219)';
    if (!branded && host.style.getPropertyValue('visibility') !== 'hidden') {
      host.style.setProperty('visibility', 'hidden', 'important');
    }
    const transactional = location.pathname.startsWith('/cart') || location.pathname.startsWith('/checkout');
    host.style.setProperty('--tonewow-balam-closed-bottom', transactional ? 'calc(82px + env(safe-area-inset-bottom))' : 'max(12px, 2%)');
    if (observedShadow !== shadow) {
      if (shadowObserver) shadowObserver.disconnect();
      observedShadow = shadow;
      shadowObserver = new MutationObserver(ensureTheme);
      shadowObserver.observe(shadow, { childList: true });
    }
    let theme = shadow.getElementById(THEME_ID);
    if (!theme || theme.tagName !== 'LINK') {
      if (theme) theme.remove();
      theme = document.createElement('link');
      theme.id = THEME_ID;
      theme.rel = 'stylesheet';
      theme.href = THEME_HREF;
      shadow.appendChild(theme);
    } else if (theme !== shadow.lastElementChild) {
      shadow.appendChild(theme);
    }
    const reveal = () => {
      if (theme !== shadow.getElementById(THEME_ID) || theme !== shadow.lastElementChild) return;
      const toggle = shadow.getElementById('Assistant-Toggle');
      const icon = toggle && toggle.querySelector('.Assistant-icon');
      if (toggle && getComputedStyle(toggle).backgroundColor === 'rgb(26, 86, 219)' && (!icon || getComputedStyle(icon).display === 'none')) {
        if (host.style.getPropertyValue('visibility') !== 'visible') host.style.setProperty('visibility', 'visible', 'important');
      } else requestAnimationFrame(reveal);
    };
    if (theme.sheet) reveal();
    else {
      theme.addEventListener('load', reveal, { once: true });
      theme.addEventListener('error', () => theme.remove(), { once: true });
    }
  }
  function start() {
    ensureTheme();
    documentObserver = new MutationObserver(ensureTheme);
    documentObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
