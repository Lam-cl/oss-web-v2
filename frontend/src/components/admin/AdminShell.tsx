'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from './Icons';

const links = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/products', label: 'Products', icon: 'products' },
  { href: '/admin/orders', label: 'Orders', icon: 'orders' },
  { href: '/admin/vouchers', label: 'Promo Codes', icon: 'voucher' },
  { href: '/admin/shipping', label: 'Shipping', icon: 'shipping' },
];

export default function AdminShell({ title, eyebrow, actions, children }: { title: string; eyebrow?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  useEffect(() => { fetch('/admin-api/auth/session', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((v) => setUser(v?.user || null)); }, []);
  useEffect(() => setOpen(false), [pathname]);

  async function logout() {
    await fetch('/admin-api/auth/logout', { method: 'POST' });
    window.location.replace('/admin/login');
  }

  const navigation = links.map((link) => {
    const active = link.href === '/admin' ? pathname === link.href : pathname.startsWith(link.href);
    return <Link key={link.href} href={link.href} className={active ? 'active' : ''}><Icon name={link.icon} /><span>{link.label}</span></Link>;
  });

  return <div className="adm-app">
    <header className="adm-topbar">
      <div className="adm-topbar-inner">
        <Link href="/admin" className="adm-brand" aria-label="Tone Wow admin dashboard">
          <img src="https://cdn.prod.website-files.com/697381edd70cb137c12f7e90/6975222aeef428a2420e370c_brand-logo.svg" alt="tone wow" />
          <span><strong>Admin</strong><small>{eyebrow || 'Operations'}</small></span>
        </Link>
        <nav className="adm-desktop-nav" aria-label="Admin navigation">{navigation}</nav>
        <div className="adm-account">
          <span className="adm-avatar">{(user?.email || 'A')[0].toUpperCase()}</span>
          <div className="adm-account-copy"><strong>{user?.email || 'Admin'}</strong><small>{user?.role || 'Loading…'}</small></div>
          <button className="adm-icon-btn" onClick={logout} title="Log out" aria-label="Log out"><Icon name="logout" /></button>
        </div>
        <span className="adm-current adm-mobile-only">{title}</span>
        <button className="adm-icon-btn adm-mobile-only" onClick={() => setOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
      </div>
    </header>
    <button className={`adm-scrim ${open ? 'is-open' : ''}`} onClick={() => setOpen(false)} aria-label="Close navigation" />
    <aside className={`adm-sidebar ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="adm-sidebar-head"><strong>Admin menu</strong><button className="adm-icon-btn" onClick={() => setOpen(false)} aria-label="Close navigation"><Icon name="close" /></button></div>
      <nav>{navigation}</nav>
      <div className="adm-sidebar-account"><span className="adm-avatar">{(user?.email || 'A')[0].toUpperCase()}</span><div><strong>{user?.email || 'Admin'}</strong><small>{user?.role || 'Loading…'}</small></div><button className="adm-icon-btn" onClick={logout} title="Log out"><Icon name="logout" /></button></div>
    </aside>
    <div className="adm-main">
      <main className="adm-content">{children}</main>
      {actions && <div className="adm-floating-actions">{actions}</div>}
    </div>
  </div>;
}
