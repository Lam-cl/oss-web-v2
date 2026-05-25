'use client';

const GOOGLE_PLAY_BASE_URL = 'https://play.google.com/store/apps/details?id=com.mywow2.app';
const APP_STORE_URL = 'https://apps.apple.com/my/app/tone-wow-2-0/id6751451439';
const APP_OPEN_FALLBACK_DELAY_MS = 1600;
const ANDROID_PACKAGE_NAME = 'com.mywow2.app';
const APP_DEEP_LINK_SCHEME = 'myapp';

export type DeviceType = 'ios' | 'android' | 'other';

export function detectDeviceType(): DeviceType {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const isIpadOS = platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  if (/iPhone|iPad|iPod/i.test(ua) || isIpadOS) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

export async function openToneWowAppWithRegistration(clipboardText: string, deviceType: DeviceType) {
  const playStoreUrl = `${GOOGLE_PLAY_BASE_URL}&referrer=${encodeURIComponent(clipboardText)}`;
  const appLinkWindow = deviceType === 'ios' ? window.open('about:blank', '_blank') : null;

  try {
    await navigator.clipboard.writeText(clipboardText);
  } catch {
    // Continue anyway; Android referrer and server token still carry the payload.
  }

  let appOpened = false;
  const markAppOpened = () => {
    appOpened = true;
  };

  const webLink = new URL(window.location.href);
  webLink.searchParams.set('openApp', Date.now().toString());

  window.addEventListener('pagehide', markAppOpened, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) markAppOpened();
  }, { once: true });

  if (deviceType === 'android') {
    const fallbackUrl = encodeURIComponent(playStoreUrl);
    window.location.href = `intent://open#Intent;scheme=${APP_DEEP_LINK_SCHEME};package=${ANDROID_PACKAGE_NAME};S.browser_fallback_url=${fallbackUrl};S.web_link=${encodeURIComponent(webLink.toString())};end`;
    return;
  }

  const deepLinkUrl = `${APP_DEEP_LINK_SCHEME}://`;
  if (appLinkWindow && !appLinkWindow.closed) {
    appLinkWindow.location.href = deepLinkUrl;
  } else {
    window.location.href = deepLinkUrl;
    return;
  }

  window.setTimeout(() => {
    if (!appOpened && !document.hidden) {
      window.location.href = deviceType === 'ios' ? APP_STORE_URL : playStoreUrl;
    }
  }, APP_OPEN_FALLBACK_DELAY_MS);
}
