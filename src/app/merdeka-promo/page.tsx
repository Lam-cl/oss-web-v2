'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import type { MerdekaDuration, MerdekaMember, MerdekaPlan } from '@/lib/merdekaPromo';
import styles from './promo.module.css';

type FormState = Omit<MerdekaMember, 'memberId' | 'msisdn' | 'currentPlan'>;

const emptyForm: FormState = {
  fullName: '', documentId: '', email: '', phone: '',
  address1: '', address2: '', address3: '', postcode: '', city: '', state: '',
};

const PLAN_TONES = [
  { accent: '#2166c2', header: '#2166c2', ink: '#ffffff', shape: '#df2935', shapeTwo: '#f4bd26', soft: '#edf5ff' },
  { accent: '#132744', header: '#132744', ink: '#ffffff', shape: '#2f80ed', shapeTwo: '#df2935', soft: '#edf1f6' },
  { accent: '#c48b00', header: '#f4bd26', ink: '#132744', shape: '#1557b0', shapeTwo: '#df2935', soft: '#fff9e7' },
  { accent: '#cf3340', header: '#df3d49', ink: '#ffffff', shape: '#132744', shapeTwo: '#f4bd26', soft: '#fff1f2' },
  { accent: '#132744', header: '#132744', ink: '#ffffff', shape: '#df2935', shapeTwo: '#2f80ed', soft: '#edf1f6' },
];

function money(value: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(value);
}

function totalFor(plan: MerdekaPlan | null, duration: MerdekaDuration | null) {
  if (!plan || !duration) return 0;
  return Math.round(plan.monthlyPrice * (duration === 6 ? 5.5 : 11) * 100) / 100;
}

function TickIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>;
}

export default function MerdekaPromoPage() {
  const [plans, setPlans] = useState<MerdekaPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [duration, setDuration] = useState<MerdekaDuration | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [msisdn, setMsisdn] = useState('');
  const [member, setMember] = useState<MerdekaMember | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);

  useEffect(() => {
    document.body.classList.add('merdeka-promo-active');
    const freshworks = (window as Window & { FreshworksWidget?: (...args: unknown[]) => void }).FreshworksWidget;
    freshworks?.('hide');
    return () => {
      document.body.classList.remove('merdeka-promo-active');
      freshworks?.('show');
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    setPlansError('');
    fetch('/merdeka-promo-api/plans', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load plans.');
        return data.plans as MerdekaPlan[];
      })
      .then((items) => { if (!cancelled) setPlans(items); })
      .catch((error) => { if (!cancelled) setPlansError(error.message); })
      .finally(() => { if (!cancelled) setPlansLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) || null,
    [plans, selectedPlanId],
  );
  const total = totalFor(selectedPlan, duration);
  const regularTotal = selectedPlan && duration ? selectedPlan.monthlyPrice * duration : 0;
  const savings = regularTotal - total;

  const changeMsisdn = (value: string) => {
    const clean = value.replace(/\D/g, '').slice(0, 11);
    setMsisdn(clean);
    if (member && clean !== member.msisdn) {
      setMember(null);
      setForm(emptyForm);
      setAcknowledged(false);
    }
    setVerifyError('');
  };

  useEffect(() => {
    if (!/^01\d{8,9}$/.test(msisdn)) {
      setVerifying(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setVerifying(true);
      setVerifyError('');
      setCheckoutError('');
      try {
        const response = await fetch('/merdeka-promo-api/member', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msisdn }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to verify this number.');
        if (controller.signal.aborted) return;
        const verified = data.member as MerdekaMember;
        setMember(verified);
        setMsisdn(verified.msisdn);
        setForm({
          fullName: verified.fullName,
          documentId: verified.documentId,
          email: verified.email,
          phone: verified.phone,
          address1: verified.address1,
          address2: verified.address2,
          address3: verified.address3,
          postcode: verified.postcode,
          city: verified.city,
          state: verified.state,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setMember(null);
        setForm(emptyForm);
        setVerifyError(error instanceof Error ? error.message : 'Unable to verify this number.');
      } finally {
        if (!controller.signal.aborted) setVerifying(false);
      }
    }, msisdn.length === 10 ? 1200 : 700);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [msisdn]);

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setCheckoutError('');
  };

  const canPay = Boolean(
    duration && selectedPlan && member && acknowledged && form.fullName && form.documentId
    && /^\S+@\S+\.\S+$/.test(form.email) && form.phone && form.address1
    && /^\d{5}$/.test(form.postcode) && form.city && form.state,
  );

  const checkout = async () => {
    if (!canPay || !selectedPlan || !duration || !member) return;
    setSubmitting(true);
    setCheckoutError('');
    try {
      const response = await fetch('/merdeka-promo-api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlan.id,
          duration,
          msisdn: member.msisdn,
          acknowledged,
          ...form,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.paymentUrl) throw new Error(data.error || 'Unable to prepare payment.');
      window.location.assign(data.paymentUrl);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Unable to prepare payment.');
      setSubmitting(false);
    }
  };

  const Summary = ({ compact = false }: { compact?: boolean }) => (
    <div className={compact ? styles.compactSummary : styles.summaryCard}>
      {!compact && <h2>Your package</h2>}
      <div className={styles.summaryRows}>
        {duration && selectedPlan ? (
          <>
            <div className={styles.regularPriceRow}>
              <span>{selectedPlan.displayName} × {duration} months</span>
              <strong>{money(regularTotal)}</strong>
            </div>
            <div className={styles.savingRow}><span>Discount</span><strong>− {money(savings)}</strong></div>
          </>
        ) : (
          <div><span>Plan &amp; duration</span><strong>Not selected</strong></div>
        )}
      </div>
      <div className={styles.totalRow}>
        <span>Total</span>
        <strong>{total ? money(total) : '—'}</strong>
      </div>
    </div>
  );

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>tone wow Merdeka Promo</span>
          <h1>More months.<br />More freedom.</h1>
          <p>Choose your FU plan and enjoy 6 or 12 months with one simple upfront payment.</p>
          <div className={styles.heroBenefits}>
            <span><TickIcon /> Save up to one month</span>
            <span><TickIcon /> One-time payment</span>
            <span><TickIcon /> FU35 and above</span>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <Image
            src="/images/merdeka-promo/hero-gen-z-branded.webp"
            alt="Two Malaysian young adults enjoying tone wow on a smartphone"
            fill
            priority
            unoptimized
            sizes="(max-width: 700px) 100vw, 48vw"
          />
          <span className={styles.heroImageBadge}>One payment. More freedom.</span>
        </div>
      </section>

      <div className={styles.shell}>
        <div className={styles.content}>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <span className={styles.step}>01</span>
              <div><h2>Choose your package</h2><p>Select how long you would like your campaign coverage.</p></div>
            </div>
            <div className={styles.durationGrid}>
              {([6, 12] as MerdekaDuration[]).map((months) => {
                const active = duration === months;
                return (
                  <button key={months} type="button" className={`${styles.durationCard} ${months === 6 ? styles.durationSix : styles.durationTwelve} ${active ? styles.selected : ''}`} onClick={() => setDuration(months)} aria-pressed={active}>
                    <span className={styles.radio}>{active && <TickIcon />}</span>
                    <span className={styles.durationDetails}>
                      <span className={styles.durationCopy}><strong>{months} months</strong></span>
                      <span className={styles.saveTag}>Save {months === 6 ? '½ month' : '1 month'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <span className={styles.step}>02</span>
              <div><h2>Select an FU plan</h2><p>All eligible plans include 30-day validity and unlimited calls.</p></div>
            </div>
            {plansLoading ? (
              <div className={styles.planGrid}>{Array.from({ length: 5 }).map((_, index) => <div key={index} className={styles.skeleton} />)}</div>
            ) : plansError ? (
              <div className={styles.retryState}><strong>Plans could not be loaded</strong><p>{plansError}</p><button type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button></div>
            ) : (
              <div className={styles.planGrid}>
                {plans.map((plan, index) => {
                  const active = selectedPlanId === plan.id;
                  const tone = PLAN_TONES[index] || PLAN_TONES[0];
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      className={`${styles.planCard} ${active ? styles.selected : ''}`}
                      style={{
                        '--plan-accent': tone.accent,
                        '--plan-header': tone.header,
                        '--plan-ink': tone.ink,
                        '--plan-shape': tone.shape,
                        '--plan-shape-two': tone.shapeTwo,
                        '--plan-soft': tone.soft,
                      } as CSSProperties}
                      onClick={() => setSelectedPlanId(plan.id)}
                      aria-pressed={active}
                    >
                      <span className={styles.planHeader}>
                        <span className={styles.planTop}><strong className={styles.planTitle}>{plan.name} <small>plan</small></strong><span className={styles.radio}>{active && <TickIcon />}</span></span>
                        <span className={styles.planPrice}><strong>{money(plan.monthlyPrice)}</strong><small>/ month</small></span>
                      </span>
                      <span className={styles.planBody}>
                        <span className={styles.planBenefits}>{plan.benefits.slice(0, 4).map((benefit) => <span key={benefit}><TickIcon />{benefit}</span>)}</span>
                        <span className={styles.selectLabel}>{active ? 'Selected' : 'Select plan'} <ArrowIcon /></span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {!plansLoading && !plansError && <p className={styles.planFootnote}>*Subject to Fair Usage Policy (FUP).</p>}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <span className={styles.step}>03</span>
              <div><h2>Verify your tone wow number</h2><p>We will retrieve your Member ID and registered details.</p></div>
            </div>
            <div className={styles.verifyCard}>
              <label htmlFor="promo-msisdn">tone wow mobile number</label>
              <div className={styles.verifyRow}>
                <div className={styles.phoneInput}>
                  <input id="promo-msisdn" inputMode="numeric" autoComplete="tel-national" value={msisdn} onChange={(event) => changeMsisdn(event.target.value)} placeholder="0123456789" aria-describedby="promo-msisdn-status" />
                  {(verifying || member) && <small id="promo-msisdn-status" className={`${styles.verifyStatus} ${member && !verifying ? styles.verifiedStatus : ''}`} aria-live="polite">{verifying ? 'Verifying…' : 'Verified'}{member && !verifying && <TickIcon />}</small>}
                </div>
              </div>
              {verifyError && <p className={styles.fieldError}>{verifyError}</p>}
              {member && (
                <div className={styles.memberResult}>
                  <span className={styles.memberCheck}><TickIcon /></span>
                  <div><small>Verified member</small><strong>{member.fullName}</strong><span>{member.memberId}</span></div>
                  <div className={styles.currentPlan}><small>Current active plan</small><strong>{member.currentPlan || 'Not available yet'}</strong></div>
                </div>
              )}
            </div>
          </section>

          {member && (
            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <span className={styles.step}>04</span>
                <div><h2>Customer information</h2><p>Check the details retrieved from your member profile.</p></div>
              </div>
              <div className={styles.formCard}>
                <div className={styles.formGrid}>
                  <label className={styles.full}><span>Full name *</span><input value={form.fullName} onChange={(event) => update('fullName', event.target.value)} /></label>
                  <label><span>NRIC / Passport *</span><input value={form.documentId} onChange={(event) => update('documentId', event.target.value)} /></label>
                  <label><span>Email *</span><input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></label>
                  <label><span>Contact number *</span><input inputMode="tel" value={form.phone} onChange={(event) => update('phone', event.target.value.replace(/\D/g, '').slice(0, 11))} /></label>
                  <div className={styles.formDivider}><span>Billing address</span></div>
                  <label className={styles.full}><span>Address line 1 *</span><input value={form.address1} onChange={(event) => update('address1', event.target.value)} /></label>
                  <label className={styles.full}><span>Address line 2</span><input value={form.address2} onChange={(event) => update('address2', event.target.value)} /></label>
                  <label className={styles.full}><span>Address line 3</span><input value={form.address3} onChange={(event) => update('address3', event.target.value)} /></label>
                  <label><span>Postcode *</span><input inputMode="numeric" value={form.postcode} onChange={(event) => update('postcode', event.target.value.replace(/\D/g, '').slice(0, 5))} /></label>
                  <label><span>City *</span><input value={form.city} onChange={(event) => update('city', event.target.value)} /></label>
                  <label><span>State *</span><input value={form.state} onChange={(event) => update('state', event.target.value)} /></label>
                </div>
              </div>
            </section>
          )}

          <section className={styles.notice}>
            <div className={styles.noticeIcon}>!</div>
            <div><h2>Before you continue</h2><p>Any existing auto-renewal may be cancelled and replaced with this campaign coverage. You will only be charged <strong>once</strong> for the full selected 6 or 12 months.</p>
              <label className={styles.consent}><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I understand and agree to continue with the new campaign subscription.</span></label>
            </div>
          </section>

          <div className={styles.mobileCheckout}>
            <Summary compact />
            {checkoutError && <p className={styles.checkoutError}>{checkoutError}</p>}
            <button type="button" className={styles.payButton} disabled={!canPay || submitting} onClick={checkout}>{submitting ? 'Preparing payment…' : `Pay ${total ? money(total) : 'now'}`}<ArrowIcon /></button>
          </div>
        </div>

        <aside className={styles.sidebar}>
          <Summary />
          {checkoutError && <p className={styles.checkoutError}>{checkoutError}</p>}
          <button type="button" className={styles.payButton} disabled={!canPay || submitting} onClick={checkout}>{submitting ? 'Preparing payment…' : `Pay ${total ? money(total) : 'now'}`}<ArrowIcon /></button>
          <div className={styles.secureNote}><span>✓</span><p><strong>Secure checkout</strong><small>You will be redirected to GKash to complete payment.</small></p></div>
        </aside>
      </div>

      <div className={`${styles.mobileBar} ${mobileSummaryOpen ? styles.open : ''}`}>
        {mobileSummaryOpen && <div className={styles.mobileBarDetails}><Summary compact /></div>}
        <button type="button" className={styles.mobileBarToggle} onClick={() => setMobileSummaryOpen((open) => !open)}><span><small>Total</small><strong>{total ? money(total) : 'Select package'}</strong></span><span>{mobileSummaryOpen ? 'Hide' : 'Summary'}⌃</span></button>
        <button type="button" className={styles.mobileBarPay} disabled={!canPay || submitting} onClick={checkout}>{submitting ? 'Preparing…' : 'Pay now'}</button>
      </div>
    </main>
  );
}
