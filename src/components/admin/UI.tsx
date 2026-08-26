'use client';

import { useEffect } from 'react';
import { Icon } from './Icons';

export function StatusBadge({ status }: { status: string }) { return <span className={`adm-badge status-${String(status).toLowerCase()}`}><i />{String(status).replaceAll('_', ' ')}</span>; }
export function Skeleton({ rows = 5 }: { rows?: number }) { return <div className="adm-skeleton-list">{Array.from({ length: rows }, (_, i) => <div className="adm-skeleton" key={i} />)}</div>; }
export function Empty({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) { return <div className="adm-empty"><span>—</span><h3>{title}</h3><p>{message}</p>{action}</div>; }
export function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="adm-error"><div><strong>Data could not be loaded</strong><p>{message}</p></div><button className="adm-button secondary" onClick={retry}><Icon name="retry" /> Try again</button></div>; }
export function Toast({ message, kind = 'success', onClose }: { message: string; kind?: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const timer = setTimeout(onClose, 4200); return () => clearTimeout(timer); }, [onClose]);
  return <div className={`adm-toast ${kind}`}>{message}<button onClick={onClose}>×</button></div>;
}
export function Confirm({ open, title, message, confirmLabel = 'Confirm', danger = false, busy, onConfirm, onClose }: { open: boolean; title: string; message: string; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  if (!open) return null;
  return <div className="adm-modal-wrap"><button className="adm-modal-backdrop" onClick={onClose} aria-label="Close"/><section className="adm-confirm" role="dialog" aria-modal="true"><h3>{title}</h3><p>{message}</p><div><button className="adm-button secondary" onClick={onClose}>Cancel</button><button className={`adm-button ${danger ? 'danger' : ''}`} disabled={busy} onClick={onConfirm}>{busy ? 'Processing…' : confirmLabel}</button></div></section></div>;
}
