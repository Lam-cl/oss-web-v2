import { useState, type ReactNode } from 'react';
import styles from './MerdekaEmbedChrome.module.css';

const LOGO = 'https://cdn.prod.website-files.com/697381edd70cb137c12f7e90/6975222aeef428a2420e370c_brand-logo.svg';

function SocialIcon({ path }: { path: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>;
}
export default function MerdekaEmbedChrome({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = [
    ['Prepaid plans', 'https://www.tonewow.com/Prepaid_Plans'],
    ['Lifestyle', 'https://www.tonewow.com/Lifestyle'],
    ['Side hustle', 'https://www.tonewow.com/side-hustle'],
    ['FAQ', 'https://www.tonewow.com/faq'],
    ['Login', 'https://www.tonewow.com/login'],
  ];
  return <div className={styles.frame}>
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <a className={styles.logo} href="https://www.tonewow.com/"><img src={LOGO} alt="tone wow" /></a>
        <nav className={styles.nav} aria-label="Primary navigation">
          {links.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
          <a className={`${styles.shop} ${styles.active}`} href="https://shop.tonewow.com/">Shop</a>
          <a className={styles.cart} href="https://shop.tonewow.com/cart" aria-label="Cart">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
          </a>
        </nav>
        <button className={styles.hamburger} type="button" aria-label="Open menu" onClick={() => setMobileOpen(true)}><span /><span /><span /></button>
      </div>
      <nav className={`${styles.mobile} ${mobileOpen ? styles.open : ''}`} aria-label="Mobile navigation" aria-hidden={!mobileOpen}>
        <button className={styles.close} type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)}>×</button>
        {links.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
        <a href="https://shop.tonewow.com/">Shop</a>
        <a href="https://shop.tonewow.com/cart">Cart</a>
      </nav>
    </header>
    {children}
    <footer className={styles.footer}>
      <div className={styles.apps}>
        <a href="https://play.google.com/store/apps/details?id=com.mywow2.app&hl=en" target="_blank" rel="noopener"><img src="https://cdn.prod.website-files.com/697381edd70cb137c12f7e90/697522315fbcb6b84439a3bb_Store-download-button_2.svg" alt="Get it on Google Play" /></a>
        <a href="https://apps.apple.com/my/app/tone-wow-2-0/id6751451439" target="_blank" rel="noopener"><img src="https://cdn.prod.website-files.com/697381edd70cb137c12f7e90/6975223236dc3f8101aee32d_Store-download-button.svg" alt="Download on App Store" /></a>
      </div>
      <div className={styles.social}>
        <a href="https://www.facebook.com/toneWOWHq/" target="_blank" rel="noopener" aria-label="Facebook"><SocialIcon path="M24 12.073C24 5.446 18.627.073 12 .073S0 5.446 0 12.073c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></a>
        <a href="https://www.youtube.com/channel/UCeixjMQg2idWQuVtt7ZVvrA" target="_blank" rel="noopener" aria-label="YouTube"><SocialIcon path="M23.5 6.2A3 3 0 0 0 21.4 4C19.5 3.5 12 3.5 12 3.5S4.5 3.5 2.6 4A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8A3 3 0 0 0 2.6 20c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.2C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.5 15.6V8.4l6.3 3.6-6.3 3.6z" /></a>
        <a href="https://www.instagram.com/tonewowhq" target="_blank" rel="noopener" aria-label="Instagram"><SocialIcon path="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2 0-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c0-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zM12 0C8.7 0 8.3 0 7.1.1 5.8.1 4.9.3 4.1.6 3.3.9 2.7 1.3 2 2S.9 3.3.6 4.1C.3 4.9.1 5.8.1 7.1 0 8.3 0 8.7 0 12s0 3.7.1 4.9c0 1.3.2 2.2.5 3 .3.8.7 1.4 1.4 2.1.7.7 1.3 1.1 2.1 1.4.8.3 1.7.5 3 .5 1.2.1 1.6.1 4.9.1s3.7 0 4.9-.1c1.3 0 2.2-.2 3-.5.8-.3 1.4-.7 2.1-1.4.7-.7 1.1-1.3 1.4-2.1.3-.8.5-1.7.5-3 .1-1.2.1-1.6.1-4.9s0-3.7-.1-4.9c0-1.3-.2-2.2-.5-3-.3-.8-.7-1.4-1.4-2.1-.7-.7-1.3-1.1-2.1-1.4-.8-.3-1.7-.5-3-.5C15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4zm0 10.2a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-10.4a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0z" /></a>
      </div>
      <div className={styles.regulatory}><img src="https://cdn.prod.website-files.com/697381edd70cb137c12f7e90/6975222cc2ae5d44804d3560_footer-media_1.png" alt="MCMC and CFM regulatory logos" /></div>
      <div className={styles.legal}><a href="https://www.tonewow.net/en/tnc" target="_blank" rel="noopener">Terms &amp; Conditions</a><span>|</span><a href="https://www.tonewow.net/en/PrivacyPolicy" target="_blank" rel="noopener">Privacy Policy</a></div>
      <div className={styles.copyright}>TONE WOW SDN BHD (1225327-U)<br />Powered by CelcomDigi<br />All Rights Reserved {new Date().getFullYear()}</div>
    </footer>
  </div>;
}
