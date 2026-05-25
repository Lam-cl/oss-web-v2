'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import RegisterActions from '../RegisterActions';

const APP_ICON_URL = 'https://bijakbuatduit.com/uploadxxx/uploads/696b17f1e34d5_1768626161.png';
const SESSION_KEY = 'tw_register_clipboard_text';

export default function RegisterTokenPage() {
  const [clipboardText, setClipboardText] = useState('');

  useEffect(() => {
    try {
      setClipboardText(sessionStorage.getItem(SESSION_KEY) || '');
    } catch {
      setClipboardText('');
    }
  }, []);

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 120px)',
        padding: '56px 16px 72px',
        background: 'linear-gradient(135deg, rgba(45, 98, 255, 0.06) 0%, rgba(250, 204, 21, 0.05) 100%)',
      }}
    >
      <section style={{ maxWidth: 440, margin: '0 auto' }}>
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            border: '1px solid rgba(255, 255, 255, 0.85)',
            borderRadius: 24,
            padding: '34px 26px 28px',
            background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
            boxShadow: '0 20px 50px rgba(15, 23, 42, 0.14)',
            textAlign: 'center',
          }}
        >
          <img
            src={APP_ICON_URL}
            alt="tone wow 2.0 app"
            style={{
              width: 82,
              height: 82,
              borderRadius: 22,
              objectFit: 'cover',
              boxShadow: '0 12px 30px rgba(15, 23, 42, 0.18)',
              marginBottom: 18,
            }}
          />
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.15, color: '#111827', fontWeight: 900 }}>
            Register tone wow 2.0
          </h1>
          <p style={{ margin: '10px auto 24px', maxWidth: 320, color: '#64748b', fontSize: 14, lineHeight: 1.55 }}>
            Your registration token is ready. Open the app and continue your eSIM registration.
          </p>

          {clipboardText ? (
            <RegisterActions clipboardText={clipboardText} />
          ) : (
            <div
              style={{
                borderRadius: 14,
                background: '#fff7ed',
                border: '1px solid #fed7aa',
                padding: 16,
                color: '#9a3412',
                fontSize: 13,
                lineHeight: 1.6,
                marginBottom: 20,
              }}
            >
              Registration token is not available on this tab. Please open this page from your eSIM success screen.
            </div>
          )}

          <Link href="/sim/esim-success" style={{ color: '#2563eb', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>
            Back to eSIM success
          </Link>
        </div>
      </section>
    </div>
  );
}
