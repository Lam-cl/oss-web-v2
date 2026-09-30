'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin/client';
import { dateTime, paginationPages } from '@/lib/admin/types';
import { Empty, ErrorState, Skeleton } from './UI';

type Check = {
  status: 'confirmed' | 'processing' | 'unknown'; checkedAt: string; firstConfirmedAt?: string;
  hqLastTransactionAt?: string;
  memberId?: string; msisdn?: string; currentPlan?: string | null; planCheckedAt?: string;
};
type Row = {
  requestId: number; productCode: 'TWE' | 'TWP'; requestDate: string; reference: string;
  purchaserName: string; purchaserEmail: string; contactNo: string; planName: string;
  referralCode: string; adxStatus: string; simSerial: string; trackingNo: string;
  courierType: string; expectedDeliveryDate: string; check: Check | null;
};
type Period = 'today' | 'yesterday' | 'week' | 'month';
const periodLabels: Record<Period, string> = { today: 'Hari ini', yesterday: 'Semalam', week: 'Minggu ini', month: 'Bulan ini' };
type Result = { data: Row[]; meta: { page: number; total: number; totalPages: number;
  refreshedAt: string; period: Period; summary: { orders: number; confirmed: number; pendingHqDates: number } } };

function when(value?: string) {
  if (!value) return 'Belum direkodkan';
  if (/^\d{2}\/\d{2}\/\d{4}\s/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTime(value);
}
function plan(row: Row) {
  const name = row.planName.toUpperCase();
  if (/\bBIZ\b/.test(name)) return 'Preload BIZ';
  if (/\bPRO\b/.test(name)) return 'Preload PRO';
  const match = name.match(/\bWITH\s+(FU\s*\d+)\b/);
  if (match) return `Preload ${match[1].replace(/\s+/g, '')}`;
  if (row.check?.status !== 'confirmed') return 'Belum dapat disahkan';
  return row.check.currentPlan ? `Pelan aktif: ${row.check.currentPlan}` : 'Pelan semasa belum dapat disahkan';
}
function status(row: Row) {
  if (row.check?.status === 'confirmed') return { label: 'SIM disahkan', tone: 'good' };
  if (row.check?.status === 'processing') return { label: 'Sedang diproses', tone: 'pending' };
  return { label: 'Belum dapat disahkan', tone: 'unknown' };
}
function Detail({ row, close }: { row: Row; close: () => void }) {
  const current = status(row);
  const confirmed = row.check?.status === 'confirmed';
  return <>
    <div className="adm-oss-dialog-head"><div><span className="adm-oss-dialog-kicker">PERJALANAN ORDER</span><h2 id="ossJourneyTitle">{row.purchaserName || `Request #${row.requestId}`}</h2><p>{row.productCode} · Request #{row.requestId}</p></div>
      <button onClick={close} aria-label="Tutup dialog">Tutup</button></div>
    <div className="adm-oss-dialog-body">
      <div className="adm-oss-identity"><div className="adm-oss-identity-head"><span>Identiti pelanggan</span><span className={`adm-oss-state ${current.tone}`}>{current.label}</span></div>
        <div className="adm-oss-identity-grid"><div><small>ID {row.productCode} pelanggan</small><strong>{confirmed ? row.check?.memberId || 'Belum dapat disahkan' : 'Belum dapat disahkan'}</strong></div>
          <div><small>Nombor tone wow pelanggan</small><strong>{confirmed ? row.check?.msisdn || 'Belum dapat disahkan' : 'Belum dapat disahkan'}</strong></div></div>
        <p>ID dan nombor dipaparkan selepas profil HQ sepadan dengan SIM serial order ini.</p></div>
      <ol className="adm-oss-journey">
        <li className="reached"><h3>Order diterima</h3><p>{when(row.requestDate)}</p><div className="adm-oss-detail-line"><span>Pakej</span><strong>{row.planName || '—'}</strong></div>
          <div className="adm-oss-detail-line"><span>Rujukan</span><strong>{row.reference || '—'}</strong></div><div className="adm-oss-detail-line"><span>Masuk melalui</span><strong>{row.referralCode || 'Tiada data'} · {row.adxStatus || 'OSS'}</strong></div></li>
        <li className={row.trackingNo ? 'reached' : ''}><h3>Penghantaran SIM</h3><p>{row.trackingNo ? `${row.courierType || 'Courier'} · ${row.trackingNo}` : 'Tracking belum direkodkan'}</p>
          {row.expectedDeliveryDate && <p>Anggaran sampai: {row.expectedDeliveryDate}</p>}</li>
        <li className={confirmed ? 'reached' : ''}><h3>SIM disahkan HQ</h3><p>{confirmed ? `Pertama kali disahkan sistem: ${when(row.check?.firstConfirmedAt || row.check?.checkedAt)}` : current.label}</p>
          {row.check?.hqLastTransactionAt && <p>Transaksi terakhir HQ: {when(row.check.hqLastTransactionAt)}</p>}
          <p>Semakan terakhir: {row.check ? when(row.check.checkedAt) : 'Belum disemak'}</p><div className="adm-oss-detail-line"><span>SIM serial</span><strong>{row.simSerial || '—'}</strong></div></li>
        <li className={confirmed && row.check?.currentPlan ? 'reached' : ''}><h3>Topup &amp; subscribe plan</h3><p>{plan(row)}</p>
          {row.check?.planCheckedAt && <p>Pelan disemak: {when(row.check.planCheckedAt)}</p>}
          <p>Pelan semasa ialah petunjuk sahaja. HQ tidak menyatakan sama ada transaksi terakhir ialah topup atau subscribe.</p></li>
      </ol>
      <div className="adm-oss-contact"><span>Maklumat hubungan order</span><strong>{row.contactNo || '—'}</strong><small>{row.purchaserEmail || '—'}</small></div>
    </div>
  </>;
}

export default function OssOrders() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [code, setCode] = useState('ALL');
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25', search, period });
      if (code !== 'ALL') params.set('productCode', code);
      setData(await adminFetch<Result>(`oss-journey?${params}`));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load OSS requests.'); }
  }, [page, search, code, period]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected && !dialog.current?.open) dialog.current?.showModal(); }, [selected]);
  const close = () => dialog.current?.close();
  const summary = data?.meta.summary;
  return <>
    <div className="adm-oss-overview-head"><div><h2>OSS journey</h2><p>Ringkasan permintaan dan semakan SIM daripada HQ.</p></div>
      <div className="adm-oss-period" aria-label="Tempoh ringkasan">{(Object.keys(periodLabels) as Period[]).map(value => <button key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{periodLabels[value]}</button>)}</div></div>
    <section className="adm-oss-stats" aria-label="Ringkasan OSS">
      <div className="adm-oss-stat"><span>SIM dijual · {periodLabels[period]}</span><strong>{summary?.orders ?? '—'}</strong><small>Berdasarkan tarikh request OSS</small></div>
      <div className="adm-oss-stat"><span>SIM berdaftar · transaksi HQ {periodLabels[period].toLowerCase()}</span><strong>{summary?.confirmed ?? '—'}</strong><small>Ikut lastTransaction HQ, bukan tarikh daftar asal{summary?.pendingHqDates ? ` · ${summary.pendingHqDates} tarikh masih disemak` : ''}</small></div>
    </section>
    <div className="adm-oss-toolbar"><label className="adm-oss-search-wrap"><span>Cari order</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Nama, request, referral atau serial…" aria-label="Cari order OSS"/></label>
      <label className="adm-oss-network"><span>Rangkaian</span><select value={code} onChange={event => { setCode(event.target.value); setPage(1); }}><option value="ALL">Semua</option><option value="TWE">TWE</option><option value="TWP">TWP</option></select></label>
      <button className="adm-oss-refresh" onClick={load}>Segar semula</button></div>
    <p className="adm-oss-note">Data OSS: {data?.meta.refreshedAt ? when(data.meta.refreshedAt) : 'Belum disegerakkan'} · Tiada rekod bukan bukti SIM belum aktif.</p>
    {error ? <ErrorState message={error} retry={load}/> : !data ? <Skeleton/> : !data.data.length ? <Empty title="Tiada order OSS dijumpai" message="Cuba carian atau rangkaian lain."/> : <>
      <div className="adm-oss-list">{data.data.map(row => { const current = status(row); return <article className="adm-oss-card" key={`${row.productCode}:${row.requestId}`}>
        <div className="adm-oss-card-main"><div className="adm-oss-avatar" aria-hidden="true">{(row.purchaserName || 'O').slice(0, 1).toUpperCase()}</div><div className="adm-oss-card-copy"><div className="adm-oss-card-title"><strong>{row.purchaserName || 'Pelanggan OSS'}</strong><span className={`adm-oss-state ${current.tone}`}>{current.label}</span></div>
          <p>{row.planName || 'Pakej tidak direkodkan'}</p><small>#{row.requestId} · {row.productCode} · {when(row.requestDate)}</small></div></div>
        <div className="adm-oss-card-identity"><div><span>ID {row.productCode}</span><strong>{row.check?.status === 'confirmed' ? row.check.memberId || '—' : 'Belum disahkan'}</strong></div>
          <div><span>Nombor tone wow</span><strong>{row.check?.status === 'confirmed' ? row.check.msisdn || '—' : 'Belum disahkan'}</strong></div></div>
        <button className="adm-oss-open" onClick={() => setSelected(row)}>Lihat perjalanan <span aria-hidden="true">↗</span></button>
      </article>; })}</div>
      <div className="adm-pagination"><span>{data.meta.total} order · halaman {page} daripada {data.meta.totalPages}</span><div><button disabled={page <= 1} onClick={() => setPage(value => value - 1)} aria-label="Halaman sebelumnya">←</button>
        {paginationPages(page, data.meta.totalPages).map(number => <button key={number} className={number === page ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}<button disabled={page >= data.meta.totalPages} onClick={() => setPage(value => value + 1)} aria-label="Halaman seterusnya">→</button></div></div>
    </>}
    <dialog ref={dialog} className="adm-oss-dialog" aria-labelledby="ossJourneyTitle" onClose={() => setSelected(null)} onClick={event => { if (event.target === dialog.current) close(); }}>
      {selected && <Detail row={selected} close={close}/>}
    </dialog>
  </>;
}
