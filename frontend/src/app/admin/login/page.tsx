'use client';

import Script from 'next/script';
import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { resolveAdminNextPath } from '@/lib/admin/navigation';

type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
};

declare global { interface Window { turnstile?: TurnstileApi } }

function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileScriptReady, setTurnstileScriptReady] = useState(false);
  const turnstileContainer = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || '';
  const renderTurnstile = useCallback(() => {
    if (!turnstileSiteKey || !window.turnstile || !turnstileContainer.current || turnstileWidgetId.current) return;
    turnstileWidgetId.current = window.turnstile.render(turnstileContainer.current, {
      sitekey: turnstileSiteKey,
      action: 'admin_login',
      theme: 'auto',
      callback: (token: string) => { setTurnstileToken(token); setError(''); },
      'expired-callback': () => { setTurnstileToken(''); setError('Security verification expired. Please verify again.'); },
      'error-callback': () => { setTurnstileToken(''); setError('Security verification could not load. Please try again.'); },
    });
  }, [turnstileSiteKey]);
  useEffect(() => { if (window.turnstile) setTurnstileScriptReady(true); }, []);
  useEffect(() => { if (turnstileScriptReady) renderTurnstile(); }, [renderTurnstile, turnstileScriptReady]);
  function resetTurnstile() {
    setTurnstileToken('');
    if (turnstileWidgetId.current && window.turnstile) window.turnstile.reset(turnstileWidgetId.current);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/admin-api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password'), turnstileToken }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message || 'Login failed. Please try again.');
      window.location.replace(resolveAdminNextPath(params.get('next')));
    } catch (reason) {
      const message = reason instanceof Error && reason.name === 'TimeoutError'
        ? 'Sign in took too long. Please check your connection and try again.'
        : reason instanceof Error ? reason.message : 'Login failed. Please try again.';
      resetTurnstile(); setError(message); setBusy(false);
    }
  }
  return <main className="adm-login-page"><section className="adm-login-card"><div className="adm-login-brand"><img src="https://cdn.prod.website-files.com/697381edd70cb137c12f7e90/6975222aeef428a2420e370c_brand-logo.svg" alt="tone wow"/><span>Admin operations</span></div><div className="adm-login-copy"><span>SECURE ACCESS</span><h1>Welcome back</h1><p>Log in using your existing Bundle API staff account.</p></div><form onSubmit={submit}><label>Email address<input name="email" type="email" autoComplete="username" placeholder="name@tonewow.com" required autoFocus /></label><label>Password<input name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required /></label><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={() => setTurnstileScriptReady(true)} /><div className="adm-turnstile" ref={turnstileContainer} />{!turnstileSiteKey && <div className="adm-form-error" role="alert">Security verification is not configured.</div>}{error && <div className="adm-form-error" role="alert">{error}</div>}<button className="adm-button wide" disabled={busy || !turnstileToken}>{busy ? 'Signing in…' : 'Sign in'}</button></form><p className="adm-login-note">Access is limited to ADMIN and STAFF accounts. Sessions expire within 24 hours.</p></section></main>;
}

export default function AdminLogin() {
  return <Suspense fallback={<main className="adm-login-page"/>}><LoginForm/></Suspense>;
}
