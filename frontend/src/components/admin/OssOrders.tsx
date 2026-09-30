'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin/client';
import { dateTime, paginationPages } from '@/lib/admin/types';
import { Empty, ErrorState, Skeleton } from './UI';

type Row = { requestId: number; productCode: string; requestDate: string; reference: string; purchaserName: string;
  purchaserEmail: string; contactNo: string; planName: string; referralCode: string; adxStatus: string;
  simSerial: string; trackingNo: string; courierType: string; expectedDeliveryDate: string;
  check: { status: string; checkedAt: string; memberId?: string; msisdn?: string; currentPlan?: string | null; planCheckedAt?: string } | null };
type Result = { data: Row[]; meta: { page: number; total: number; totalPages: number; refreshedAt: string } };
const when = (value?: string) => value ? (/^\d{2}\/\d{2}\/\d{4}\s/.test(value) ? value : dateTime(value)) : 'Belum disemak';
function plan(row: Row) {
  const name = row.planName.toUpperCase();
  if (/\bBIZ\b/.test(name)) return 'Preload BIZ';
  if (/\bPRO\b/.test(name)) return 'Preload PRO';
  const match = name.match(/\bWITH\s+(FU\s*\d+)\b/);
  if (match) return `Preload ${match[1].replace(/\s+/g, '')}`;
  if (row.check?.status !== 'confirmed') return 'Belum dapat disahkan';
  return row.check.currentPlan ? `Pelan aktif: ${row.check.currentPlan}` : 'Tiada pelan aktif disahkan';
}

export default function OssOrders() {
  const [page, setPage] = useState(1); const [query, setQuery] = useState(''); const [search, setSearch] = useState('');
  const [code, setCode] = useState('ALL'); const [data, setData] = useState<Result | null>(null); const [error, setError] = useState('');
  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  const load = useCallback(async () => {
    setError('');
    try { const params = new URLSearchParams({ page: String(page), limit: '25', search }); if (code !== 'ALL') params.set('productCode', code);
      setData(await adminFetch<Result>(`oss-journey?${params}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load OSS requests.'); }
  }, [page, search, code]);
  useEffect(() => { void load(); }, [load]);
  return <><div className="adm-toolbar"><input className="adm-oss-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search request, customer, referral or SIM serial…" aria-label="Search OSS requests"/>
    <select value={code} onChange={event => { setCode(event.target.value); setPage(1); }} aria-label="OSS network"><option value="ALL">All networks</option><option value="TWE">TWE</option><option value="TWP">TWP</option></select>
    <button className="adm-button" onClick={load}>Refresh</button></div>
    <p className="adm-oss-note">OSS data: {data?.meta.refreshedAt ? when(data.meta.refreshedAt) : 'Belum disegerakkan'} · Tiada rekod bukan bukti SIM belum aktif.</p>
    <section className="adm-panel">{error ? <ErrorState message={error} retry={load}/> : !data ? <Skeleton/> : !data.data.length ? <Empty title="No OSS requests found" message="Try another search or network."/> : <>
      <div className="adm-table-wrap"><table className="adm-table adm-oss-table"><thead><tr><th>Request</th><th>Customer</th><th>Package / source</th><th>SIM journey</th><th>Topup & Subscribe</th><th>Delivery</th></tr></thead><tbody>
        {data.data.map(row => <tr key={`${row.productCode}:${row.requestId}`}><td data-label="Request"><strong>#{row.requestId}</strong><br/><small>{row.productCode} · {row.adxStatus || '—'}</small><br/><small>{when(row.requestDate)}</small><br/><small>{row.reference}</small></td>
          <td data-label="Customer"><strong>{row.purchaserName || '—'}</strong><br/><small>{row.purchaserEmail || '—'}</small><br/><small>{row.contactNo || '—'}</small></td>
          <td data-label="Package / source"><strong>{row.planName || '—'}</strong><br/><small>Referral: {row.referralCode || 'Tiada data'}</small><br/><small>Kempen: Tiada data</small></td>
          <td data-label="SIM journey"><strong>{row.check?.status === 'confirmed' ? 'Berdaftar' : row.check?.status === 'processing' ? 'Dalam proses' : 'Belum dapat disahkan'}</strong><br/><small>Serial: {row.simSerial || '—'}</small>
            {row.check?.status === 'confirmed' && <><br/><small>ID: {row.check.memberId}</small><br/><small>No: {row.check.msisdn}</small></>}<br/><small>Semak: {when(row.check?.checkedAt)}</small></td>
          <td data-label="Topup & Subscribe"><strong>{plan(row)}</strong>{row.check?.planCheckedAt && <><br/><small>Pelan disemak: {when(row.check.planCheckedAt)}</small></>}</td>
          <td data-label="Delivery"><strong>{row.courierType || '—'}</strong><br/><small>Tracking: {row.trackingNo || '—'}</small><br/><small>Anggaran: {row.expectedDeliveryDate || '—'}</small></td></tr>)}
      </tbody></table></div><div className="adm-pagination"><span>{data.meta.total} requests · page {page} of {data.meta.totalPages}</span><div>
        <button disabled={page <= 1} onClick={() => setPage(value => value - 1)} aria-label="Previous page">←</button>{paginationPages(page, data.meta.totalPages).map(number => <button key={number} className={number === page ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}<button disabled={page >= data.meta.totalPages} onClick={() => setPage(value => value + 1)} aria-label="Next page">→</button>
      </div></div></>}</section></>;
}
