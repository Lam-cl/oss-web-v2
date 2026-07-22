'use client';

const GOOGLE_PLAY_BASE_URL = 'https://play.google.com/store/apps/details?id=com.mywow2.app';
const APP_STORE_URL = 'https://apps.apple.com/my/app/tone-wow-2-0/id6751451439';
const APP_OPEN_FALLBACK_DELAY_MS = 2500;
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

function copyRegistrationText(clipboardText: string) {
  const textarea = document.createElement('textarea');
  textarea.value = clipboardText;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, clipboardText.length);

  try {
    document.execCommand('copy');
  } catch {
    // The modern Clipboard API attempt below may still succeed.
  } finally {
    textarea.remove();
  }

  try {
    void navigator.clipboard?.writeText(clipboardText).catch(() => undefined);
  } catch {
    // Continue to app launch even when clipboard access is unavailable.
  }
}

export function openToneWowAppWithRegistration(clipboardText: string, deviceType: DeviceType) {
  const playStoreUrl = `${GOOGLE_PLAY_BASE_URL}&referrer=${encodeURIComponent(clipboardText)}`;
  copyRegistrationText(clipboardText);

  const webLink = new URL(window.location.href);
  webLink.searchParams.set('openApp', Date.now().toString());

  if (deviceType === 'android') {
    const fallbackUrl = encodeURIComponent(playStoreUrl);
    window.location.href = `intent://open#Intent;scheme=${APP_DEEP_LINK_SCHEME};package=${ANDROID_PACKAGE_NAME};S.browser_fallback_url=${fallbackUrl};S.web_link=${encodeURIComponent(webLink.toString())};end`;
    return;
  }

  const deepLinkUrl = `${APP_DEEP_LINK_SCHEME}://`;
  if (deviceType !== 'ios') {
    window.location.href = deepLinkUrl;
    return;
  }

  let appOpened = false;
  let fallbackTimer: number | undefined;

  const cleanup = () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', handlePageHide);
  };
  const markAppOpened = () => {
    appOpened = true;
    if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    cleanup();
  };
  const handleVisibilityChange = () => {
    if (document.hidden) markAppOpened();
  };
  const handlePageHide = () => markAppOpened();

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  fallbackTimer = window.setTimeout(() => {
    cleanup();
    if (!appOpened && document.visibilityState === 'visible') {
      window.location.replace(APP_STORE_URL);
    }
  }, APP_OPEN_FALLBACK_DELAY_MS);

  window.location.href = deepLinkUrl;
}
