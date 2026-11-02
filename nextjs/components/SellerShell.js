'use client';

// Seller Centre frame: session guard, top bar and sidebar around every signed-in seller page.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThemeToggle } from './Header';
import Icon from './Icon';
import { SELLER_NAV } from '@/lib/data';
import { send } from '@/lib/productsApi';
import { Auth, useStored } from '@/lib/store';
import { Modal, notBuilt } from '@/lib/ui';

function openShopInfo(seller) {
  const address = [seller.street, seller.barangay, seller.city, seller.province, seller.zip, seller.country].join(', ');
  Modal.open({
    title: 'Shop information',
    content: (
      <dl className="shop-info">
        <dt>Shop name</dt><dd>{seller.shopName}</dd>
        <dt>Username</dt><dd>{seller.username}</dd>
        <dt>Shop address</dt><dd>{address}</dd>
      </dl>
    ),
  });
}

const NOTIFICATION_REFRESH_MS = 30000;

function SellerNotifications() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const unread = items.filter((item) => !item.read).length;

  useEffect(() => {
    const load = () => send('/api/seller/notifications').then((body) => setItems(body.notifications)).catch(() => {});
    load();
    const timer = setInterval(load, NOTIFICATION_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  function toggle() {
    setOpen(!open);
    if (!open && unread) {
      send('/api/seller/notifications', { method: 'POST' }).catch(() => {});
      setItems(items.map((item) => ({ ...item, read: true })));
    }
  }

  return (
    <div className="popover-wrap">
      <button className="seller-bar__icon" type="button" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={toggle}>
        <Icon name="bell" />
        {unread > 0 && <span className="count seller-bar__count">{unread}</span>}
      </button>
      {open && (
        <div className="popover popover--wide seller-notices">
          <div className="popover__head"><strong>Notifications</strong></div>
          {items.map((item) => (
            <Link className="notif" href={item.link} key={item.id} onClick={() => setOpen(false)}>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
              <small>{new Date(item.at).toLocaleString()}</small>
            </Link>
          ))}
          {!items.length && <p className="muted notif">Nothing new yet.</p>}
        </div>
      )}
    </div>
  );
}

function SellerBar({ seller, navOpen, onToggleNav }) {
  return (
    <header className="seller-bar">
      <button
        className="seller-bar__menu"
        type="button"
        aria-label={navOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={navOpen}
        aria-controls="seller-nav"
        onClick={onToggleNav}
      >
        <Icon name="menu" />
      </button>
      <Link className="seller-bar__brand" href="/" aria-label="Onetap home">
        <img src="/logo.svg" alt="" width="34" height="34" />
        <span>Onetap</span>
      </Link>
      <span className="seller-bar__title">Seller Centre</span>

      <div className="seller-bar__actions">
        <ThemeToggle />
        <SellerNotifications />
        <Link className="seller-bar__icon" href="/help" aria-label="Help Centre"><Icon name="help" /></Link>
        <span className="seller-bar__shop">
          <span className="chat__avatar" aria-hidden="true">{seller.shopName[0].toUpperCase()}</span>
          <span className="seller-bar__name">{seller.shopName}</span>
        </span>
        <button className="seller-bar__logout" type="button" onClick={() => Auth.logout('seller')}>Log Out</button>
      </div>
    </header>
  );
}

function SellerNav({ seller, open }) {
  const pathname = usePathname();
  const actions = { shop: () => openShopInfo(seller) };
  return (
    <nav className={`seller-nav ${open ? 'is-open' : ''}`} id="seller-nav" aria-label="Seller Centre">
      <Link className="seller-nav__home" href="/seller/dashboard" aria-current={pathname === '/seller/dashboard' ? 'page' : undefined}><Icon name="chart" /> Dashboard</Link>
      {SELLER_NAV.map((group) => (
        <details className="seller-nav__group" key={group.label} open={group.open}>
          <summary>
            <Icon name={group.icon} />
            <span>{group.label}</span>
            <Icon name="chevron" className="icon icon--sm seller-nav__chevron" />
          </summary>
          <ul>
            {group.items.map((item) => (
              <li key={item.label}>
                {item.href ? (
                  <Link href={item.href} aria-current={pathname === item.href ? 'page' : undefined}>{item.label}</Link>
                ) : (
                  <button type="button" onClick={() => (actions[item.action] || (() => notBuilt(item.label)))()}>{item.label}</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </nav>
  );
}

// The layout has already checked the session on the server. This keeps the browser's copy of
// the profile in step with it, and leaves when that copy goes (log out, expired session).
export default function SellerShell({ account, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const seller = useStored('session.seller');
  const [synced, setSynced] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    Auth.setAccount(account);
    setSynced(true);
  }, [account]);

  useEffect(() => {
    if (synced && !seller) router.replace('/seller/login');
  }, [synced, seller, router]);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (!seller) return null;

  return (
    <div className="seller">
      <SellerBar seller={seller} navOpen={navOpen} onToggleNav={() => setNavOpen(!navOpen)} />
      <div className="seller-shell">
        <SellerNav seller={seller} open={navOpen} />
        {children}
      </div>
    </div>
  );
}
