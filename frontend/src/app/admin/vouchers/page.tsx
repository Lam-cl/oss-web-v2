'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { Icon } from '@/components/admin/Icons';
import { Confirm, Empty, ErrorState, Skeleton, Toast } from '@/components/admin/UI';
import { adminFetch } from '@/lib/admin/client';

type Voucher = {
  id: number;
  code: string;
  description?: string;
  discountType: 'FIXED' | 'PERCENTAGE';
  discountValue: number;
  minSpend?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  maxRedemptions?: number | null;
  redemptionCount?: number;
  oncePerCustomer?: boolean;
  isActive: boolean;
};

type Draft = {
  code: string; description: string; discountType: 'FIXED' | 'PERCENTAGE'; discountValue: string;
  minSpend: string; startsAt: string; expiresAt: string; maxRedemptions: string; oncePerCustomer: boolean; isActive: boolean;
};

const emptyDraft = (): Draft => ({ code: '', description: '', discountType: 'FIXED', discountValue: '', minSpend: '', startsAt: '', expiresAt: '', maxRedemptions: '', oncePerCustomer: false, isActive: true });
const localDate = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 16) : '';
const draftFromVoucher = (voucher: Voucher): Draft => ({ code: voucher.code, description: voucher.description || '', discountType: voucher.discountType, discountValue: String(voucher.discountValue), minSpend: voucher.minSpend == null ? '' : String(voucher.minSpend), startsAt: localDate(voucher.startsAt), expiresAt: localDate(voucher.expiresAt), maxRedemptions: voucher.maxRedemptions == null ? '' : String(voucher.maxRedemptions), oncePerCustomer: Boolean(voucher.oncePerCustomer), isActive: voucher.isActive });
const listFromPayload = (payload: any): Voucher[] => Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];

export default function VouchersPage() {
  const [vouchers, setVouchers] = useState<Voucher[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; kind?: 'success' | 'error' } | null>(null);
  const [editing, setEditing] = useState<Voucher | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Voucher | null>(null);

  const load = useCallback(async () => {
    setError('');
    try { setVouchers(listFromPayload(await adminFetch(`vouchers?includeInactive=true${query ? `&search=${encodeURIComponent(query)}` : ''}`))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load promo codes.'); }
  }, [query]);
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [load]);

  const activeCount = useMemo(() => vouchers?.filter((voucher) => voucher.isActive).length || 0, [vouchers]);
  const openEditor = (voucher?: Voucher) => { setEditing(voucher || 'new'); setDraft(voucher ? draftFromVoucher(voucher) : emptyDraft()); setError(''); };
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((previous) => ({ ...previous, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const discountValue = Number(draft.discountValue);
    if (!draft.code.trim() || !Number.isFinite(discountValue) || discountValue <= 0 || (draft.discountType === 'PERCENTAGE' && discountValue > 100)) { setError('Enter a code and a valid discount value.'); return; }
    if (draft.startsAt && draft.expiresAt && new Date(draft.expiresAt) <= new Date(draft.startsAt)) { setError('Expiry must be after the start date.'); return; }
    const payload = {
      code: draft.code.trim().toUpperCase(), description: draft.description.trim() || undefined,
      discountType: draft.discountType, discountValue,
      minSpend: draft.minSpend === '' ? undefined : Number(draft.minSpend),
      startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : undefined,
      expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : undefined,
      maxRedemptions: draft.maxRedemptions === '' ? undefined : Number(draft.maxRedemptions),
      oncePerCustomer: draft.oncePerCustomer, isActive: draft.isActive,
    };
    setBusy(true); setError('');
    try {
      if (editing === 'new') await adminFetch('vouchers', { method: 'POST', body: JSON.stringify(payload) });
      else await adminFetch(`vouchers/${editing?.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setEditing(null); setToast({ message: editing === 'new' ? 'Promo code created.' : 'Promo code updated.' }); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Promo code could not be saved.'); }
    finally { setBusy(false); }
  }

  async function toggle(voucher: Voucher) {
    setBusy(true);
    try { await adminFetch(`vouchers/${voucher.id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !voucher.isActive }) }); setToast({ message: `${voucher.code} ${voucher.isActive ? 'deactivated' : 'activated'}.` }); await load(); }
    catch (reason) { setToast({ message: reason instanceof Error ? reason.message : 'Status update failed.', kind: 'error' }); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!deleteTarget) return; setBusy(true);
    try { await adminFetch(`vouchers/${deleteTarget.id}`, { method: 'DELETE' }); setToast({ message: `${deleteTarget.code} deleted.` }); setDeleteTarget(null); await load(); }
    catch (reason) { setToast({ message: reason instanceof Error ? reason.message : 'Delete failed.', kind: 'error' }); }
    finally { setBusy(false); }
  }

  return <AdminShell title="Promo Codes" eyebrow="Sales">
    <div className="adm-page-head"><div><h1>Promo codes</h1><p>Create and control fixed or percentage discounts used at checkout.</p></div><button className="adm-button" onClick={() => openEditor()}><Icon name="plus"/>Add promo code</button></div>
    <section className="ship-stats voucher-stats"><article><span>Total codes</span><strong>{vouchers?.length || 0}</strong><small>Including inactive</small></article><article><span>Active</span><strong>{activeCount}</strong><small>Available at checkout</small></article></section>
    <section className="adm-panel"><div className="adm-toolbar"><label className="adm-search"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search promo code…"/></label></div>
      {error && !editing ? <ErrorState message={error} retry={load}/> : !vouchers ? <Skeleton/> : vouchers.length ? <div className="voucher-list">{vouchers.map((voucher) => <article key={voucher.id} className={!voucher.isActive ? 'is-inactive' : ''}><div><strong>{voucher.code}</strong><small>{voucher.description || 'No description'}</small></div><span>{voucher.discountType === 'FIXED' ? `RM ${Number(voucher.discountValue).toFixed(2)}` : `${voucher.discountValue}%`}</span><span>Min. {voucher.minSpend ? `RM ${voucher.minSpend}` : 'none'}</span><span>{voucher.redemptionCount || 0}{voucher.maxRedemptions ? ` / ${voucher.maxRedemptions}` : ''} used</span><button className={`adm-badge ${voucher.isActive ? 'status-paid' : 'status-cancelled'}`} disabled={busy} onClick={() => toggle(voucher)}>{voucher.isActive ? 'Active' : 'Inactive'}</button><div><button className="adm-icon-btn" onClick={() => openEditor(voucher)}><Icon name="edit"/></button><button className="adm-icon-btn" onClick={() => setDeleteTarget(voucher)}><Icon name="trash"/></button></div></article>)}</div> : <Empty title="No promo codes" message="Create the first code for merchandise checkout."/>}
    </section>
    {editing && <div className="adm-modal-wrap"><button className="adm-modal-backdrop" onClick={() => setEditing(null)} aria-label="Close"/><form className="adm-voucher-editor" onSubmit={save}><header><div><h2>{editing === 'new' ? 'New promo code' : `Edit ${editing.code}`}</h2><p>Discount applies to merchandise subtotal only.</p></div><button type="button" className="adm-icon-btn" onClick={() => setEditing(null)}><Icon name="close"/></button></header>{error && <div className="adm-alert is-error">{error}</div>}<div className="adm-form-grid"><label className="adm-field">Code<input value={draft.code} onChange={(event) => update('code', event.target.value.toUpperCase().replace(/\s/g, ''))} required/></label><label className="adm-field">Discount type<select value={draft.discountType} onChange={(event) => update('discountType', event.target.value as Draft['discountType'])}><option value="FIXED">Fixed amount (RM)</option><option value="PERCENTAGE">Percentage</option></select></label><label className="adm-field">Discount value<input type="number" min="0.01" max={draft.discountType === 'PERCENTAGE' ? 100 : undefined} step="0.01" value={draft.discountValue} onChange={(event) => update('discountValue', event.target.value)} required/></label><label className="adm-field">Minimum spend<input type="number" min="0" step="0.01" value={draft.minSpend} onChange={(event) => update('minSpend', event.target.value)} placeholder="No minimum"/></label><label className="adm-field">Starts at<input type="datetime-local" value={draft.startsAt} onChange={(event) => update('startsAt', event.target.value)}/></label><label className="adm-field">Expires at<input type="datetime-local" value={draft.expiresAt} onChange={(event) => update('expiresAt', event.target.value)}/></label><label className="adm-field">Maximum redemptions<input type="number" min="1" step="1" value={draft.maxRedemptions} onChange={(event) => update('maxRedemptions', event.target.value)} placeholder="Unlimited"/></label><label className="adm-field full">Description<textarea value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="Internal campaign note"/></label><label className="adm-check"><input type="checkbox" checked={draft.oncePerCustomer} onChange={(event) => update('oncePerCustomer', event.target.checked)}/>Once per customer</label><label className="adm-check"><input type="checkbox" checked={draft.isActive} onChange={(event) => update('isActive', event.target.checked)}/>Active</label></div><footer><button type="button" className="adm-button secondary" onClick={() => setEditing(null)}>Cancel</button><button className="adm-button" disabled={busy}>{busy ? 'Saving…' : 'Save promo code'}</button></footer></form></div>}
    <Confirm open={Boolean(deleteTarget)} title="Delete promo code?" message={`${deleteTarget?.code || 'This code'} will be deactivated and soft-deleted. Existing orders keep their reference.`} confirmLabel="Delete" danger busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={remove}/>
    {toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)}/>}
  </AdminShell>;
}
