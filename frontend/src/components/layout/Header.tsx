'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCartStore } from '@/store/cartStore';

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hideHeader, setHideHeader] = useState(false);
  const count = useCartStore((s) => s.getCount());
  const pathname = usePathname();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const simID = params.get('simID');
    setHideHeader(pathname === '/sim/purchase' && (simID === 'superlite' || simID === 'superliteplus'));
    setMobileOpen(false);
  }, [pathname]);

  if (hideHeader) {
    return null;
  }

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="header-logo">
          <img
            src="https://cdn.prod.website-files.com/697381edd70cb137c12f7e90/6975222aeef428a2420e370c_brand-logo.svg"
            alt="tone wow"
          />
        </Link>

        <nav className="header-nav">
          <a href="https://www.tonewow.com/Prepaid_Plans">Prepaid plans</a>
          <a href="https://www.tonewow.com/Lifestyle">Lifestyle</a>
          <a href="https://www.tonewow.com/side-hustle">Side hustle</a>
          <a href="https://www.tonewow.com/faq">FAQ</a>
          <a href="https://www.tonewow.com/login">Login</a>
          <Link href="/" className="nav-shop active">Shop</Link>
          <Link href="/cart" className="nav-cart relative">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {count > 0 && (
              <span className="cart-badge">{count}</span>
            )}
          </Link>
        </nav>

        <button className="header-hamburger" onClick={() => setMobileOpen(true)}>
          <span /><span /><span />
        </button>
      </div>

      {/* Mobile Menu */}
      <div className={`mobile-menu ${mobileOpen ? 'open' : ''}`}>
        <button className="mobile-menu-close" onClick={() => setMobileOpen(false)}>&times;</button>
        <a href="https://www.tonewow.com/Prepaid_Plans">Prepaid plans</a>
        <a href="https://www.tonewow.com/Lifestyle">Lifestyle</a>
        <a href="https://www.tonewow.com/side-hustle">Side hustle</a>
        <a href="https://www.tonewow.com/faq">FAQ</a>
        <a href="https://www.tonewow.com/login">Login</a>
        <Link href="/" onClick={() => setMobileOpen(false)}>Shop</Link>
        <Link href="/cart" onClick={() => setMobileOpen(false)}>
          Cart {count > 0 && <span className="cart-badge inline">{count}</span>}
        </Link>
      </div>
    </header>
  );
}
