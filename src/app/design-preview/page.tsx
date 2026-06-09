'use client';

import { useState, useEffect, useRef } from 'react';

/* ─── Shared icons ─────────────────────────────────────────────── */
const CheckSVG = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const PhoneIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
);
const StarIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);
const BotIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" /><path d="M9 11V7a3 3 0 016 0v4" /><circle cx="9" cy="16" r="1" fill="currentColor" /><circle cx="15" cy="16" r="1" fill="currentColor" />
  </svg>
);

/* ─── Concept A: Gen Z Radio Select ────────────────────────────── */
function ConceptA() {
  const [selected, setSelected] = useState<null | 'normal' | 'special'>(null);

  const options = [
    {
      type: 'normal' as const,
      emoji: '📱',
      label: 'Keep it chill — Normal SIM',
      sub: 'your vibe, your plan. customize & go.',
      accent: '#1a56db',
      activeBg: '#eff6ff',
      activeBorder: '#1a56db',
    },
    {
      type: 'special' as const,
      emoji: '👑',
      label: "It's giving VIP — Special Number",
      sub: 'secure ur digits. flex ur status. iconic.',
      accent: '#7c3aed',
      activeBg: '#f5f3ff',
      activeBorder: '#7c3aed',
    },
  ];

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {/* Question */}
      <div style={{ marginBottom: 28, textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: '#1a56db', textTransform: 'uppercase', marginBottom: 8 }}>Step 1 of 1</div>
        <h3 style={{ fontSize: 24, fontWeight: 900, color: '#0d1b3e', margin: 0, lineHeight: 1.3 }}>
          what's ur vibe? 🤙
        </h3>
        <p style={{ fontSize: 14, color: '#94a3b8', margin: '8px 0 0' }}>pick one to get started</p>
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {options.map(o => {
          const active = selected === o.type;
          return (
            <div
              key={o.type}
              onClick={() => setSelected(active ? null : o.type)}
              style={{
                cursor: 'pointer',
                borderRadius: 16,
                padding: '18px 20px',
                background: active ? o.activeBg : '#fafafa',
                border: `2px solid ${active ? o.activeBorder : '#e5e7eb'}`,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                transition: 'all 0.2s cubic-bezier(0.16,1,0.3,1)',
                boxShadow: active ? `0 4px 20px ${o.accent}22` : 'none',
              }}
            >
              {/* Radio */}
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                border: `2.5px solid ${active ? o.accent : '#d1d5db'}`,
                background: active ? o.accent : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
              }}>
                {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
              </div>

              {/* Emoji */}
              <div style={{ fontSize: 26, flexShrink: 0, lineHeight: 1 }}>{o.emoji}</div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 15, fontWeight: 800,
                  color: active ? o.accent : '#0d1b3e',
                  transition: 'color 0.2s',
                  lineHeight: 1.3,
                }}>
                  {o.label}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{o.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div style={{
        marginTop: 20,
        overflow: 'hidden',
        maxHeight: selected ? 64 : 0,
        opacity: selected ? 1 : 0,
        transition: 'max-height 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.25s',
      }}>
        <button style={{
          width: '100%', padding: '15px',
          borderRadius: 50,
          background: selected === 'special' ? '#7c3aed' : '#1a56db',
          color: '#fff', fontWeight: 800, fontSize: 15,
          border: 'none', cursor: 'pointer',
          letterSpacing: 0.3,
          boxShadow: `0 4px 16px ${selected === 'special' ? '#7c3aed44' : '#1a56db44'}`,
          transition: 'background 0.2s, box-shadow 0.2s',
        }}>
          {selected === 'normal' ? "let's go 🚀" : selected === 'special' ? 'show me the numbers 👑' : ''}
        </button>
      </div>
    </div>
  );
}

/* ─── Concept B: Chatbot ────────────────────────────────────────── */
type Msg = { from: 'bot' | 'user'; text: string; key: number };

function ConceptB() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [showOptions, setShowOptions] = useState(false);
  const [chosen, setChosen] = useState<null | 'normal' | 'special'>(null);
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages([{ from: 'bot', text: 'Hi! 👋 Welcome to tone wow. What are you looking for today?', key: 0 }]);
      setTimeout(() => setShowOptions(true), 400);
    }, 1200);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing, showOptions]);

  const pick = (type: 'normal' | 'special') => {
    if (chosen) return;
    setChosen(type);
    setShowOptions(false);
    const userText = type === 'normal' ? '📱 I want a Normal SIM with a data plan' : '⭐ I want a Special / VIP Number';
    setMessages(p => [...p, { from: 'user', text: userText, key: p.length }]);
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      const reply = type === 'normal'
        ? 'Great choice! 🎉 We have plans from RM35/month with 5G speed, unlimited calls & free insurance. Tap below to continue!'
        : 'Excellent taste! 👑 Our Special Numbers start from RM988. You can search by your favourite digits — let\'s find your perfect number!';
      setMessages(p => [...p, { from: 'bot', text: reply, key: p.length }]);
      setTimeout(() => {
        setMessages(p => [...p, {
          from: 'bot',
          text: type === 'normal' ? '→ _cta_normal_' : '→ _cta_special_',
          key: p.length,
        }]);
      }, 500);
    }, 1400);
  };

  const reset = () => {
    setMessages([]);
    setChosen(null);
    setShowOptions(false);
    setTyping(true);
    started.current = false;
    setTimeout(() => {
      setTyping(false);
      setMessages([{ from: 'bot', text: 'Hi! 👋 Welcome to tone wow. What are you looking for today?', key: 0 }]);
      setTimeout(() => setShowOptions(true), 400);
      started.current = true;
    }, 1000);
  };

  return (
    <div style={{ background: '#f1f5f9', borderRadius: 20, overflow: 'hidden', border: '1px solid #e5e7eb', boxShadow: '0 8px 32px rgba(0,0,0,0.10)' }}>
      {/* Header */}
      <div style={{ background: '#0d1b3e', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#1a56db,#fbbf24)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <BotIcon />
        </div>
        <div>
          <div style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>tone wow Assistant</div>
          <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            Online
          </div>
        </div>
        <button onClick={reset} style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8', background: 'none', border: '1px solid #334155', borderRadius: 20, padding: '4px 12px', cursor: 'pointer' }}>
          Reset
        </button>
      </div>

      {/* Chat area */}
      <div style={{ padding: '20px 20px 8px', minHeight: 260, maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map(m => (
          <div key={m.key} style={{ display: 'flex', justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start', animation: 'fadeSlideUp 0.3s ease' }}>
            {m.text.startsWith('→ _cta_') ? (
              <div style={{
                background: m.text.includes('normal') ? '#1a56db' : '#0d1b3e',
                borderRadius: 14, padding: '12px 20px', maxWidth: '75%',
                border: `1px solid ${m.text.includes('normal') ? '#2563eb' : '#fbbf24'}`,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ fontSize: 20 }}>{m.text.includes('normal') ? '📱' : '⭐'}</span>
                <div>
                  <div style={{ fontWeight: 700, color: '#fff', fontSize: 13 }}>{m.text.includes('normal') ? 'View Data Plans' : 'Browse Special Numbers'}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{m.text.includes('normal') ? 'FU35 · FU60 · FU80 · FU120' : 'PREMIUM · VIP · VVIP'}</div>
                </div>
                <span style={{ marginLeft: 'auto', color: '#fbbf24', fontSize: 16 }}>→</span>
              </div>
            ) : (
              <div style={{
                background: m.from === 'bot' ? '#fff' : '#1a56db',
                color: m.from === 'bot' ? '#1e293b' : '#fff',
                borderRadius: m.from === 'bot' ? '4px 18px 18px 18px' : '18px 4px 18px 18px',
                padding: '10px 16px', maxWidth: '75%', fontSize: 14, lineHeight: 1.5,
                boxShadow: m.from === 'bot' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}>
                {m.text}
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {typing && (
          <div style={{ display: 'flex', gap: 4, padding: '10px 16px', background: '#fff', borderRadius: '4px 18px 18px 18px', width: 'fit-content', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 8, height: 8, borderRadius: '50%', background: '#94a3b8',
                animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        )}

        {/* Option buttons */}
        {showOptions && !chosen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', animation: 'fadeSlideUp 0.3s ease' }}>
            {[
              { type: 'normal' as const, icon: '📱', label: 'Normal SIM with data plan', sub: 'RM35/month onwards' },
              { type: 'special' as const, icon: '⭐', label: 'Special / VIP Number', sub: 'from RM988' },
            ].map(o => (
              <button key={o.type} onClick={() => pick(o.type)} style={{
                background: '#fff', border: '2px solid #e2e8f0', borderRadius: '18px 4px 18px 18px',
                padding: '10px 18px', cursor: 'pointer', textAlign: 'right',
                display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.15s',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#1a56db'; (e.currentTarget as HTMLButtonElement).style.background = '#eff6ff'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#e2e8f0'; (e.currentTarget as HTMLButtonElement).style.background = '#fff'; }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>{o.label}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{o.sub}</div>
                </div>
                <span style={{ fontSize: 20 }}>{o.icon}</span>
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>
      <div style={{ padding: '8px 20px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 50, padding: '10px 18px', fontSize: 13, color: '#94a3b8' }}>
          Select an option above…
        </div>
      </div>
    </div>
  );
}

/* ─── Concept C: Boarding Pass / Ticket ─────────────────────────── */
function ConceptC() {
  const [selected, setSelected] = useState<null | 'normal' | 'special'>(null);

  const Ticket = ({ type }: { type: 'normal' | 'special' }) => {
    const isNormal = type === 'normal';
    const active = selected === type;
    return (
      <div
        onClick={() => setSelected(active ? null : type)}
        style={{
          cursor: 'pointer', borderRadius: 20, overflow: 'hidden',
          boxShadow: active ? `0 8px 32px ${isNormal ? 'rgba(26,86,219,0.35)' : 'rgba(251,191,36,0.35)'}` : '0 4px 16px rgba(0,0,0,0.10)',
          transform: active ? 'translateY(-4px) scale(1.015)' : 'none',
          transition: 'all 0.3s cubic-bezier(0.16,1,0.3,1)',
          border: `2px solid ${active ? (isNormal ? '#1a56db' : '#fbbf24') : '#e5e7eb'}`,
        }}
      >
        {/* Ticket top */}
        <div style={{
          background: isNormal ? 'linear-gradient(135deg,#1a56db 0%,#0c1e3f 100%)' : 'linear-gradient(135deg,#0d1b3e 0%,#1c3263 100%)',
          padding: '22px 28px 18px',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Decorative circles */}
          <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: 4 }}>
                tone wow · {isNormal ? 'Economy' : 'VIP Class'}
              </div>
              <div style={{ fontWeight: 800, fontSize: 22, color: isNormal ? '#fff' : '#fbbf24' }}>
                {isNormal ? 'Normal SIM' : 'Special Number'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {active && <div style={{ fontSize: 10, fontWeight: 700, background: '#fbbf24', color: '#111', padding: '3px 10px', borderRadius: 20, marginBottom: 6 }}>✓ SELECTED</div>}
              <div style={{ width: 44, height: 44, borderRadius: 12, background: isNormal ? 'rgba(255,255,255,0.15)' : 'rgba(251,191,36,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isNormal ? '#fff' : '#fbbf24', marginLeft: 'auto' }}>
                {isNormal ? <PhoneIcon /> : <StarIcon />}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 32 }}>
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>From</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#fbbf24' }}>{isNormal ? 'RM35/mo' : 'RM988'}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Category</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{isNormal ? 'Prepaid 5G' : 'Premium · VIP · VVIP'}</div>
            </div>
          </div>
        </div>

        {/* Perforated divider */}
        <div style={{ background: isNormal ? '#1a56db' : '#0d1b3e', position: 'relative', height: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', left: -16, width: 32, height: 32, borderRadius: '50%', background: '#f9fafb', zIndex: 2 }} />
          <div style={{ position: 'absolute', right: -16, width: 32, height: 32, borderRadius: '50%', background: '#f9fafb', zIndex: 2 }} />
          <div style={{ width: 'calc(100% - 20px)', borderTop: '2px dashed rgba(255,255,255,0.18)', position: 'absolute', zIndex: 1 }} />
        </div>

        {/* Ticket bottom */}
        <div style={{ background: '#fff', padding: '18px 28px 22px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 18 }}>
            {(isNormal
              ? ['FU35 — 150 GB / month', 'FU60 — 500 GB / month', 'Free Insurance']
              : ['PREMIUM — RM988', 'VIP — RM2,298', 'VVIP — RM3,088']
            ).map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151' }}>
                <div style={{ color: isNormal ? '#1a56db' : '#ea580c' }}><CheckSVG /></div>
                {f}
              </div>
            ))}
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13,
            background: isNormal ? '#1a56db' : '#0d1b3e', color: '#fff',
            padding: '10px 22px', borderRadius: 50, letterSpacing: 0.3,
          }}>
            {isNormal ? 'Get My SIM →' : 'Pick My Number →'}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      <Ticket type="normal" />
      <Ticket type="special" />
    </div>
  );
}

/* ─── Main preview page ─────────────────────────────────────────── */
export default function DesignPreviewPage() {
  const concepts = [
    {
      id: 'A',
      label: 'Radio Select',
      desc: 'Simple dan minimalist. Dua pilihan sebagai radio button cards — tiada icon, tiada senarai feature. Terus pilih.',
      badge: '✦ New',
      badgeColor: '#6366f1',
      component: <ConceptA />,
    },
    {
      id: 'B',
      label: 'Chatbot / Conversational',
      desc: 'Assistant tanya soalan. User pilih jawapan dari bubble. Rasa personal dan interactive.',
      badge: '🔥 Most Creative',
      badgeColor: '#ea580c',
      component: <ConceptB />,
    },
    {
      id: 'C',
      label: 'Boarding Pass / Ticket',
      desc: 'Setiap option styled macam tiket airline. Normal SIM = economy. Special Number = VIP pass.',
      badge: '✦ Most Unique',
      badgeColor: '#d97706',
      component: <ConceptC />,
    },
  ];

  return (
    <div style={{ background: '#f1f5f9', minHeight: '100vh' }}>
      {/* Page header */}
      <div style={{ background: '#0d1b3e', padding: '40px 24px 36px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: '#fbbf24', textTransform: 'uppercase', marginBottom: 10 }}>Design Preview</div>
          <h1 style={{ fontSize: 32, fontWeight: 900, color: '#fff', margin: '0 0 10px', lineHeight: 1.2 }}>SIM Category UI Concepts</h1>
          <p style={{ color: '#94a3b8', fontSize: 15, margin: 0, lineHeight: 1.6 }}>
            3 pilihan design untuk section pilih SIM. Semua fully interactive — cuba hover, klik, dan explore. Pilih yang paling sesuai dengan tone wow.
          </p>
        </div>
      </div>

      {/* Concepts */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 80px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 56 }}>
          {concepts.map((c, idx) => (
            <div key={c.id}>
              {/* Section header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: '#0d1b3e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18, color: '#fbbf24', flexShrink: 0 }}>
                  {c.id}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0d1b3e', margin: 0 }}>{c.label}</h2>
                    <span style={{ fontSize: 11, fontWeight: 700, background: c.badgeColor, color: '#fff', padding: '3px 10px', borderRadius: 20 }}>{c.badge}</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0', lineHeight: 1.5 }}>{c.desc}</p>
                </div>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#e2e8f0', flexShrink: 0 }}>0{idx + 1}</div>
              </div>

              {/* Component */}
              <div style={{ background: '#fff', borderRadius: 20, padding: '32px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
                {c.component}
              </div>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div style={{ marginTop: 56, padding: '24px 28px', background: '#0d1b3e', borderRadius: 20, textAlign: 'center' }}>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: 0, lineHeight: 1.7 }}>
            Semua concept di atas boleh dikombinasikan. Contoh: guna visual Concept C (ticket) dengan interaction Concept B (chatbot).<br />
            <span style={{ color: '#fbbf24', fontWeight: 600 }}>Pilih satu dan beritahu — kami akan implement terus.</span>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
