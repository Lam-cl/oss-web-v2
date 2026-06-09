import type { Metadata } from 'next';
import { getReferralProfile } from '@/lib/referralProfile';
import { createRegistrationTransport } from '@/lib/registerToken';
import { readTokenRecord } from '@/lib/tokenStore';
import RegisterActions from '../RegisterActions';

const APP_ICON_URL = 'https://bijakbuatduit.com/uploadxxx/uploads/696b17f1e34d5_1768626161.png';

type RegisterTokenPageProps = {
  params: {
    token: string;
  };
};

export const metadata: Metadata = {
  title: 'Register tone wow 2.0',
  description: 'Download the tone wow 2.0 app and register with your secure registration token.',
};

type RegisterTokenRecord = {
  clipboardText: string;
  referralName?: string;
  referralId?: string;
};

type EsimSuccessRecord = {
  registration?: RegisterTokenRecord;
};

function parseReferralPathToken(token: string) {
  const match = token.match(/^(TWE|TWP)-(.+)$/i);
  const code = match?.[2]?.trim();

  if (!match || !code) return null;

  return {
    prefix: match[1].toUpperCase(),
    code,
  };
}

export default async function RegisterTokenPage({ params }: RegisterTokenPageProps) {
  const token = decodeURIComponent(params.token || '').trim();
  const referralPathToken = parseReferralPathToken(token);
  const directRecord = token.includes('.') || referralPathToken ? null : await readTokenRecord<RegisterTokenRecord>('register', token);
  const esimRecord = token.includes('.') || referralPathToken || directRecord ? null : await readTokenRecord<EsimSuccessRecord>('esim-success', token);
  const record = directRecord || esimRecord?.registration || null;
  const referralTransport = referralPathToken
    ? createRegistrationTransport({
        twe: referralPathToken.prefix === 'TWE' ? referralPathToken.code : '',
        twp: referralPathToken.prefix === 'TWP' ? referralPathToken.code : '',
      })
    : null;
  const referralProfile = referralPathToken
    ? await getReferralProfile(referralPathToken.prefix as 'TWE' | 'TWP', referralPathToken.code)
    : null;
  const displayReferralId = referralPathToken
    ? referralProfile?.memberID || `${referralPathToken.prefix}-${referralPathToken.code}`
    : record?.referralId === 'TWE-8937777' ? '' : record?.referralId;
  const displayReferralName = referralPathToken ? referralProfile?.fullName || '' : record?.referralName || (record?.referralId === 'TWE-8937777' ? 'Tone Wow HQ' : '');
  const displayReferralLabel = referralPathToken ? 'Referral ID' : 'Referral';
  const clipboardText = referralTransport?.clipboardText || record?.clipboardText || (token.includes('.') ? `tonewow_register_token:${token}` : '');

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
            Your secure registration token is ready. Open the app and continue your eSIM registration.
          </p>

          {(displayReferralName || displayReferralId) && (
            <div
              style={{
                border: '1px solid rgba(45, 98, 255, 0.16)',
                background: 'linear-gradient(135deg, rgba(45, 98, 255, 0.08) 0%, rgba(250, 204, 21, 0.08) 100%)',
                borderRadius: 18,
                padding: 18,
                marginBottom: 20,
                textAlign: 'center',
              }}
            >
              <p style={{ margin: '0 0 5px', color: '#64748b', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {displayReferralLabel}
              </p>
              {displayReferralName && (
                <strong style={{ display: 'block', color: '#0f172a', fontSize: 20, lineHeight: 1.2, marginBottom: 6 }}>
                  {displayReferralName}
                </strong>
              )}
              {displayReferralId && (
                <span style={{ display: 'block', color: '#475569', fontSize: 14, fontWeight: 800 }}>
                  {displayReferralId}
                </span>
              )}
            </div>
          )}

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
              }}
            >
              Registration token is missing. Please open this page from your eSIM success screen.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
