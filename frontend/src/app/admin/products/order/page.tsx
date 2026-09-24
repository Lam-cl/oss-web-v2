'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '@/components/admin/AdminShell';
import { orderMerchandiseForAll } from '@/lib/merchandiseDisplayOrder';
import type { MerchandiseOrderEntry } from '@/lib/merchandiseOrder.server';

type Product = { catalogueId: string; currentBundleProductId: number | null; status: 'draft' | 'published'; model: { details: { title: string } } };
type OrderResponse = { revision: number; entries: MerchandiseOrderEntry[] };

export default function MerchandiseOrderPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/admin-api/catalogue-products', { cache: 'no-store' }),
      fetch('/admin-api/merchandise-order', { cache: 'no-store' }),
    ]).then(async ([catalogueResponse, orderResponse]) => {
      if (!catalogueResponse.ok || !orderResponse.ok) throw new Error('Product order could not be loaded.');
      const catalogue = await catalogueResponse.json() as { products: Product[] };
      const order = await orderResponse.json() as OrderResponse;
      if (!active) return;
      const byId = new Map(catalogue.products.map(product => [product.catalogueId, product]));
      const ranked = orderMerchandiseForAll(catalogue.products.map(product => ({
        id: product.catalogueId,
        apiProductId: product.currentBundleProductId ?? undefined,
      })), order.entries);
      setProducts(ranked.flatMap(item => {
        const product = byId.get(item.id);
        return product ? [product] : [];
      }));
      setRevision(order.revision);
    }).catch(problem => { if (active) setMessage(problem instanceof Error ? problem.message : 'Product order could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const move = (index: number, delta: number) => {
    setProducts(current => {
      const next = [...current], target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setMessage('');
  };

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/admin-api/merchandise-order', {
        method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision, entries: products.map(product => ({
          catalogueId: product.catalogueId, bundleProductId: product.currentBundleProductId,
        })) }),
      });
      const result = await response.json() as OrderResponse & { message?: string };
      if (!response.ok) throw new Error(result.message || 'Product order could not be saved.');
      setRevision(result.revision);
      setMessage('All tab order saved. Draft products will appear only after Publish.');
    } catch (problem) { setMessage(problem instanceof Error ? problem.message : 'Product order could not be saved.'); }
    finally { setSaving(false); }
  };

  return <AdminShell title="All tab order" eyebrow="Catalogue">
    <div className="adm-page-head"><div><h1>All tab order</h1><p>Move products into their storefront order. Draft products stay hidden until Publish.</p></div><Link className="adm-button" href="/admin/products">Back to products</Link></div>
    {message && <p role="status">{message}</p>}
    {loading ? <p>Loading products…</p> : <section className="adm-panel" aria-label="Merchandise All tab product order">
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>{products.map((product, index) => <li key={product.catalogueId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderBottom: '1px solid #e2e8f0' }}>
        <span style={{ minWidth: 28 }}>{index + 1}.</span><strong style={{ flex: 1 }}>{product.model.details.title}</strong>
        <span>{product.status === 'draft' ? 'Draft' : 'Published'}</span>
        <button type="button" className="adm-button" aria-label={`Move ${product.model.details.title} up`} disabled={index === 0 || saving} onClick={() => move(index, -1)}>↑</button>
        <button type="button" className="adm-button" aria-label={`Move ${product.model.details.title} down`} disabled={index === products.length - 1 || saving} onClick={() => move(index, 1)}>↓</button>
      </li>)}</ol>
      <div style={{ padding: 16 }}><button type="button" className="adm-button" disabled={loading || saving || !products.length} onClick={save}>{saving ? 'Saving…' : 'Save order'}</button></div>
    </section>}
  </AdminShell>;
}
