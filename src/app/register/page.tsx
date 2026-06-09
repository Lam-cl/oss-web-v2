import type { Metadata } from 'next';
import { createRegistrationTransport } from '@/lib/registerToken';
import { getReferralProfile } from '@/lib/referralProfile';
import RegisterActions from './RegisterActions';

const APP_ICON_URL = 'https://bijakbuatduit.com/uploadxxx/uploads/696b17f1e34d5_1768626161.png';

export const dynamic = 'force-dynamic';

type RegisterPageProps = {
  searchParams?: {
    twe?: string;
    twp?: string;
    serial?: string;
  };
};

export const metadata: Metadata = {
  title: 'Register tone wow 2.0',
  description: 'Download the tone wow 2.0 app and register with your referral ID.',
};

async function getReferral(searchParams?: RegisterPageProps['searchParams']) {
  const twe = searchParams?.twe?.trim();
  const twp = searchParams?.twp?.trim();

  if (twp) {
    const profile = await getReferralProfile('TWP', twp);
    return { label: 'Referral ID', name: profile?.fullName || '', id: profile?.memberID || `TWP-${twp}` };
  }
  if (twe) {
    const profile = await getReferralProfile('TWE', twe);
    return { label: 'Referral ID', name: profile?.fullName || '', id: profile?.memberID || `TWE-${twe}` };
  }
  return { label: 'Referral', name: 'Tone Wow HQ', id: '' };
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const referral = await getReferral(searchParams);
  const serial = searchParams?.serial?.trim();
  const transport = createRegistrationTransport({
    serial,
    twe: searchParams?.twe,
    twp: searchParams?.twp,
  });

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 120px)',
        padding: '56px 16px 72px',
        background: 'linear-gradient(135deg, rgba(45, 98, 255, 0.06) 0%, rgba(250, 204, 21, 0.05) 100%)',
      }}
    >
      <section style={{ maxWidth: 440, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 18px',
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.92)',
              border: '1px solid rgba(226, 232, 240, 0.9)',
              boxShadow: '0 10px 26px rgba(15, 23, 42, 0.08)',
              color: '#0f172a',
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 99, background: '#10b981' }} />
            Ready to register
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            border: '1px solid rgba(255, 255, 255, 0.85)',
            borderRadius: 24,
            padding: '34px 26px 28px',
            background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
            boxShadow: '0 20px 50px rgba(15, 23, 42, 0.14)',
          }}
        >
          <div style={{ position: 'absolute', top: -74, right: -74, width: 170, height: 170, borderRadius: 999, background: '#2d62ff', opacity: 0.08 }} />
          <div style={{ position: 'absolute', bottom: -64, left: -64, width: 148, height: 148, borderRadius: 999, background: '#facc15', opacity: 0.12 }} />

          <div style={{ position: 'relative', textAlign: 'center' }}>
            <img
              src={APP_ICON_URL}
              alt="tone wow 2.0 app"
              style={{
                display: 'block',
                width: 82,
                height: 82,
                borderRadius: 22,
                objectFit: 'cover',
                boxShadow: '0 12px 30px rgba(15, 23, 42, 0.18)',
                margin: '0 auto 18px',
              }}
            />
            <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.15, color: '#111827', fontWeight: 900 }}>
              Register tone wow 2.0
            </h1>
            <p style={{ margin: '10px auto 24px', maxWidth: 320, color: '#64748b', fontSize: 14, lineHeight: 1.55 }}>
              Your registration details are ready. Open the app and continue with the referral below.
            </p>
          </div>

          <div
            style={{
              position: 'relative',
              display: 'grid',
              gap: 12,
              border: '1px solid rgba(45, 98, 255, 0.16)',
              background: 'linear-gradient(135deg, rgba(45, 98, 255, 0.08) 0%, rgba(250, 204, 21, 0.08) 100%)',
              borderRadius: 18,
              padding: 18,
              marginBottom: 20,
              textAlign: 'center',
            }}
          >
            <div>
              <p style={{ margin: '0 0 5px', color: '#64748b', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {referral.label}
              </p>
              <strong style={{ display: 'block', color: '#0f172a', fontSize: 28, lineHeight: 1.1, letterSpacing: 0 }}>
                {referral.name || referral.id}
              </strong>
              {referral.name && referral.id && (
                <span style={{ display: 'block', color: '#475569', fontSize: 14, fontWeight: 800, marginTop: 6 }}>
                  {referral.id}
                </span>
              )}
            </div>
            {serial && (
              <div style={{ paddingTop: 12, borderTop: '1px solid rgba(45, 98, 255, 0.12)' }}>
                <p style={{ margin: '0 0 5px', color: '#64748b', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  SIM Serial
                </p>
                <strong style={{ display: 'block', color: '#0f172a', fontSize: 16, lineHeight: 1.35, wordBreak: 'break-all', letterSpacing: 0 }}>
                  {serial}
                </strong>
              </div>
            )}
          </div>

          <RegisterActions clipboardText={transport.clipboardText} />

          <div
            style={{
              position: 'relative',
              borderRadius: 14,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: 16,
              color: '#475569',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            Open the tone wow 2.0 app after download. Your registration details will be passed securely to the app.
          </div>
        </div>
      </section>
    </div>
  );
}
