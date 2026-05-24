'use client';

import { useEffect, useState } from 'react';

const GOOGLE_PLAY_BASE_URL = 'https://play.google.com/store/apps/details?id=com.mywow2.app';
const APP_STORE_URL = 'https://apps.apple.com/my/app/tone-wow-2-0/id6751451439';
const APP_OPEN_FALLBACK_DELAY_MS = 1600;
const ANDROID_PACKAGE_NAME = 'com.mywow2.app';
const APP_DEEP_LINK_SCHEME = 'myapp';

type RegisterActionsProps = {
  clipboardText: string;
};

type DeviceType = 'ios' | 'android' | 'other';

const buttonStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 54,
  borderRadius: 999,
  color: '#fff',
  font: 'inherit',
  fontWeight: 800,
  cursor: 'pointer',
  boxShadow: '0 10px 24px rgba(45, 98, 255, 0.24)',
} as const;

export default function RegisterActions({ clipboardText }: RegisterActionsProps) {
  const [deviceType, setDeviceType] = useState<DeviceType>('other');
  const playStoreUrl = `${GOOGLE_PLAY_BASE_URL}&referrer=${encodeURIComponent(clipboardText)}`;

  useEffect(() => {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const isIpadOS = platform === 'MacIntel' && navigator.maxTouchPoints > 1;

    if (/iPhone|iPad|iPod/i.test(ua) || isIpadOS) {
      setDeviceType('ios');
    } else if (/Android/i.test(ua)) {
      setDeviceType('android');
    }
  }, []);

  const getStoreUrl = () => {
    if (deviceType === 'ios') return APP_STORE_URL;
    return playStoreUrl;
  };

  const getWebAppLinkUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('openApp', Date.now().toString());
    return url.toString();
  };

  const getAppDeepLinkUrl = () => {
    return `${APP_DEEP_LINK_SCHEME}://`;
  };

  const getAndroidIntentUrl = () => {
    const appLink = new URL(getWebAppLinkUrl());
    const fallbackUrl = encodeURIComponent(playStoreUrl);
    return `intent://open#Intent;scheme=${APP_DEEP_LINK_SCHEME};package=${ANDROID_PACKAGE_NAME};S.browser_fallback_url=${fallbackUrl};S.web_link=${encodeURIComponent(appLink.toString())};end`;
  };

  const openAppThenFallback = async () => {
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

    window.addEventListener('pagehide', markAppOpened, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) markAppOpened();
    }, { once: true });

    if (deviceType === 'android') {
      window.location.href = getAndroidIntentUrl();
      return;
    }

    if (appLinkWindow && !appLinkWindow.closed) {
      appLinkWindow.location.href = getAppDeepLinkUrl();
    } else {
      window.location.href = getAppDeepLinkUrl();
      return;
    }

    window.setTimeout(() => {
      if (!appOpened && !document.hidden) {
        window.location.href = getStoreUrl();
      }
    }, APP_OPEN_FALLBACK_DELAY_MS);
  };

  return (
    <button
      type="button"
      onClick={openAppThenFallback}
      style={{
        ...buttonStyle,
        width: '100%',
        marginBottom: 24,
        border: 0,
        background: 'linear-gradient(135deg, #2d62ff 0%, #1e4fd6 100%)',
      }}
    >
      Open tone wow 2.0 App
    </button>
  );
}
