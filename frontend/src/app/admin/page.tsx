'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { Icon } from '@/components/admin/Icons';
import { ErrorState, Skeleton, StatusBadge } from '@/components/admin/UI';
import { adminFetch } from '@/lib/admin/client';
import { dateTime, money, Order, orderCustomer, orderTotal, Paged, Product } from '@/lib/admin/types';

export default function Dashboard() {
  const [products, setProducts] = useState<Paged<Product> | null>(null); const [orders, setOrders] = useState<Paged<Order> | null>(null); const [error, setError] = useState('');
  const load = useCallback(async () => { setError(''); try { const [p, o] = await Promise.all([adminFetch<Paged<Product>>('products?page=1&limit=100'), adminFetch<Paged<Order>>('orders?page=1&limit=100')]); setProducts(p); setOrders(o); } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error'); } }, []);
  useEffect(() => { load(); }, [load]);
  const stats = useMemo(() => { const list = orders?.data || []; const count = (s: string) => list.filter((o) => String(o.status).toUpperCase() === s).length; return { pending: count('PENDING'), paid: count('PAID'), processing: count('PROCESSING') }; }, [orders]);
  return <AdminShell title="Dashboard" eyebrow="Overview">
    <div className="adm-page-head"><div><h1>Operations at a glance</h1><p>Live product and order activity from Bundle API.</p></div><Link className="adm-button" href="/admin/products?create=1"><Icon name="plus"/> New product</Link></div>
    {error ? <ErrorState message={error} retry={load}/> : !products || !orders ? <Skeleton rows={6}/> : <>
      <section className="adm-stats">
        <article className="adm-stat"><header><span>Total products</span><span>LIVE</span></header><strong>{products.meta?.total ?? products.data.length}</strong><p>{products.data.filter((p) => p.type === 'MOBILE').length} mobile · {products.data.filter((p) => p.type === 'MERCHANDISE').length} merchandise shown</p></article>
        <article className="adm-stat"><header><span>Total orders</span><span>LIVE</span></header><strong>{orders.meta?.total ?? orders.data.length}</strong><p>Across all available order records</p></article>
        <article className="adm-stat"><header><span>Awaiting action</span><span>PENDING</span></header><strong>{stats.pending}</strong><p>Orders not yet processed</p></article>
        <article className="adm-stat"><header><span>Paid / processing</span><span>ACTIVE</span></header><strong>{stats.paid + stats.processing}</strong><p>{stats.paid} paid · {stats.processing} processing</p></article>
      </section>
      <section className="adm-grid-2"><div className="adm-panel"><header className="adm-panel-head"><h2>Recent orders</h2><Link href="/admin/orders">View all</Link></header><div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th>Created</th></tr></thead><tbody>{orders.data.slice(0, 7).map((order) => <tr key={order.id}><td data-label="Order"><strong>#{order.id}</strong></td><td data-label="Customer">{orderCustomer(order)}</td><td data-label="Status"><StatusBadge status={order.status}/></td><td data-label="Total">{money(orderTotal(order))}</td><td data-label="Created">{dateTime(order.createdAt)}</td></tr>)}</tbody></table></div></div>
      <aside className="adm-panel"><header className="adm-panel-head"><h2>Quick actions</h2></header><div className="adm-quick"><Link href="/admin/products?create=1"><span><Icon name="plus"/></span><span><strong>Create product</strong><small>Add mobile or merchandise</small></span><Icon name="arrow"/></Link><Link href="/admin/products"><span><Icon name="products"/></span><span><strong>Manage inventory</strong><small>Prices, variants and stock</small></span><Icon name="arrow"/></Link><Link href="/admin/orders?status=PENDING"><span><Icon name="orders"/></span><span><strong>Pending orders</strong><small>Review orders awaiting action</small></span><Icon name="arrow"/></Link></div></aside></section>
    </>}
  </AdminShell>;
}
