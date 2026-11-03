'use client';

import qrcode from 'qrcode-generator';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { openCustomerLogin, openCustomerSignup } from './Auth';
import Icon from './Icon';
import { openCart, useStorefront } from './Storefront';
import { cartCount as countItems, useCart } from '@/lib/cart';
import { CONFIG, HOT_DEALS, NOTIFICATIONS } from '@/lib/data';
import { send } from '@/lib/productsApi';
import { Auth, Store, useStored } from '@/lib/store';
import { isSellerApp, Theme, toast, useLanguage } from '@/lib/ui';

export function QrCode({ text, label }) {
  const { box, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const size = qr.getModuleCount();
    const quiet = 4;
    let d = '';
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (qr.isDark(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
      }
    }
    return { box: size + quiet * 2, path: d };
  }, [text]);

  return (
    <svg className="qr" viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" role="img" aria-label={label}>
      <rect width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

function DownloadPanel() {
  const [selected, setSelected] = useState(0);
  const app = CONFIG.appLinks[selected];
  return (
    <>
      <QrCode text={app.url} label={`QR code for Onetap on ${app.store}`} />
      <div className="store-links" role="group" aria-label="Choose your app store">
        {CONFIG.appLinks.map((option, i) => (
          <button className="store-link" type="button" key={option.store} aria-pressed={i === selected} onClick={() => setSelected(i)}>
            <Icon name={option.icon} />{option.store}
          </button>
        ))}
      </div>
      <a className="store-open link" href={app.url} target="_blank" rel="noopener">Open in {app.store}</a>
    </>
  );
}

export function ThemeToggle() {
  const theme = Theme.use();
  const next = theme === 'dark' ? 'light' : 'dark';

  useEffect(() => {
    // Follow the OS only until the visitor makes an explicit choice.
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => {
      if (!Store.get('theme')) Theme.apply(e.matches ? 'dark' : 'light');
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return (
    <button className="theme-toggle" type="button" aria-label={`Switch to ${next} mode`} onClick={() => Theme.toggle()}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      <span>{next === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  );
}

const NOTICE_REFRESH_MS = 30000;

// Delivery updates for the signed-in buyer, from the server.
function useDeliveryNotices() {
  const username = useStored('session.customer')?.username;
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!username) {
      setItems([]);
      return undefined;
    }
    const load = () => send('/api/customer/notifications', undefined, 'customer').then((body) => setItems(body.notifications)).catch(() => {});
    load();
    const timer = setInterval(load, NOTICE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [username]);

  function markRead() {
    send('/api/customer/notifications', { method: 'POST' }, 'customer').catch(() => {});
    setItems((current) => current.map((item) => ({ ...item, read: true })));
  }

  return { items, unread: items.filter((item) => !item.read).length, markRead };
}

function NotificationsPanel({ notices }) {
  const read = useStored('notifRead', []);
  const unread = NOTIFICATIONS.filter((n) => !read.includes(n.id)).length + notices.unread;
  return (
    <>
      <div className="popover__head">
        <strong>Notifications</strong>
        <button
          className="link"
          type="button"
          disabled={!unread}
          onClick={() => {
            Store.set('notifRead', NOTIFICATIONS.map((n) => n.id));
            if (notices.unread) notices.markRead();
          }}
        >
          Mark all as read
        </button>
      </div>
      {notices.items.map((n) => (
        <Link className={`notif ${n.read ? '' : 'notif--unread'}`} href={n.link} key={n.id}>
          <strong>{n.title}</strong>
          <span>{n.body}</span>
          <small>{new Date(n.at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })}</small>
        </Link>
      ))}
      {NOTIFICATIONS.map((n) => (
        <div className={`notif ${read.includes(n.id) ? '' : 'notif--unread'}`} key={n.id}>
          <strong>{n.title}</strong>
          <span>{n.body}</span>
          <small>{n.time}</small>
        </div>
      ))}
    </>
  );
}

function AuthSlot({ t }) {
  const user = useStored('session.customer');
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="topnav__auth">
      {user ? (
        <>
          <Link className="topnav__item topnav__user" href="/profile" aria-current={pathname === '/profile' ? 'page' : undefined}>{t.myProfile}</Link>
          {(user.approvalStatus === 'approved' || user.verifiedBefore) && <Link className="topnav__item" href="/orders">{t.myPurchases}</Link>}
          <button
            className="topnav__item"
            type="button"
            onClick={async () => {
              await Auth.logout('customer');
              toast('You have been logged out.');
              if (pathname.startsWith('/orders') || pathname === '/checkout' || pathname === '/profile') router.push('/');
            }}
          >
            {t.logout}
          </button>
        </>
      ) : (
        <>
          <button className="topnav__item" type="button" onClick={openCustomerSignup}>{t.signUp}</button>
          <button className="topnav__item" type="button" onClick={openCustomerLogin}>{t.login}</button>
        </>
      )}
    </div>
  );
}

function SearchBlock({ t }) {
  const { query, setQuery, search } = useStorefront();
  const [text, setText] = useState(query);

  return (
    <div className="search-block">
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          search(text);
        }}
      >
        <label className="sr-only" htmlFor="search-input">Search Onetap</label>
        <input
          id="search-input"
          type="search"
          autoComplete="off"
          placeholder={t.searchPlaceholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value) setQuery('');
          }}
        />
        <button type="submit" className="search__btn">
          <Icon name="search" />
          <span>{t.search}</span>
        </button>
      </form>
      <div className="hot-deals">
        <span className="hot-deals__label">{t.hotDeals}</span>
        {HOT_DEALS.map((term) => (
          <button
            type="button"
            key={term}
            onClick={() => {
              setText(term);
              search(term);
            }}
          >
            {term}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Header() {
  const pathname = usePathname();
  const { lang, t } = useLanguage();
  const [panel, setPanel] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const notifRead = useStored('notifRead', []);
  const cart = useCart();

  const notices = useDeliveryNotices();
  const unread = NOTIFICATIONS.filter((n) => !notifRead.includes(n.id)).length + notices.unread;
  const cartCount = countItems(cart);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    setNavOpen(false);
    setPanel(null);
  }, [pathname]);

  useEffect(() => {
    function onClick(e) {
      if (!e.target.closest('.popover, [data-popover-toggle]')) setPanel(null);
    }
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      const open = document.querySelector('[data-popover-toggle][aria-expanded="true"]');
      if (open) {
        setPanel(null);
        open.focus();
      }
    }
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const toggleProps = (id) => ({
    'data-popover-toggle': id,
    'aria-expanded': panel === id,
    'aria-controls': `${id}-panel`,
    onClick: () => setPanel(panel === id ? null : id),
  });

  if (isSellerApp(pathname)) return null;

  return (
    <header className="site-header">
      <div className={`topbar ${navOpen ? 'is-open' : ''}`} id="topbar">
        <div className="container topbar__row">
          <nav className="topnav" aria-label="Merchants and app">
            <Link className="topnav__item" href="/seller/login">{t.sellerCentre}</Link>
            <Link className="topnav__item" href="/seller/register">{t.startSelling}</Link>
            <div className="topnav__item topnav__slot popover-wrap">
              <button className="topnav__trigger" type="button" {...toggleProps('download')}>{t.downloadApp}</button>
              <div className="popover popover--download" id="download-panel" hidden={panel !== 'download'}>
                <DownloadPanel />
              </div>
            </div>
            <span className="topnav__item topnav__follow">
              <span>{t.followUs}</span>
              <a href={CONFIG.social.facebook} aria-label="Onetap on Facebook" target="_blank" rel="noopener"><Icon name="facebook" /></a>
              <a href={CONFIG.social.instagram} aria-label="Onetap on Instagram" target="_blank" rel="noopener"><Icon name="instagram" /></a>
              <a href={CONFIG.social.tiktok} aria-label="Onetap on TikTok" target="_blank" rel="noopener"><Icon name="tiktok" /></a>
            </span>
          </nav>

          <div className="topnav topnav--right">
            <ThemeToggle />

            <div className="popover-wrap">
              <button className="topnav__item" type="button" {...toggleProps('notif')}>
                <Icon name="bell" />
                <span>{t.notifications}</span>
                <span className="count" hidden={!unread} aria-label={`${unread} unread`}>{unread}</span>
              </button>
              <div className="popover popover--wide" id="notif-panel" hidden={panel !== 'notif'}>
                <NotificationsPanel notices={notices} />
              </div>
            </div>

            <Link className="topnav__item" href="/help">
              <Icon name="help" />
              <span>{t.help}</span>
            </Link>

            <div className="popover-wrap">
              <button className="topnav__item" type="button" {...toggleProps('lang')}>
                <Icon name="globe" />
                <span>{lang === 'fil' ? 'Filipino' : 'English'}</span>
                <Icon name="chevron" className="icon icon--sm" />
              </button>
              <div className="popover" id="lang-panel" hidden={panel !== 'lang'}>
                {[['en', 'English'], ['fil', 'Filipino']].map(([code, label]) => (
                  <button
                    className="popover__option"
                    type="button"
                    key={code}
                    onClick={() => {
                      Store.set('lang', code);
                      setPanel(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <AuthSlot t={t} />
          </div>
        </div>
      </div>

      <div className="container header-main">
        <Link className="brand" href="/" aria-label="Onetap home">
          <img className="brand__mark" src="/logo.svg" alt="" width="56" height="56" />
          <span className="brand__text">
            <span className="brand__name">Onetap</span>
            <span className="brand__tagline">Mall &amp; Marketplace</span>
          </span>
        </Link>

        <SearchBlock t={t} />

        <button className="cart-btn" type="button" aria-label={`Open cart, ${cartCount} items`} onClick={openCart}>
          <Icon name="cart" />
          <span className="cart-btn__count">{cartCount}</span>
        </button>
        <button
          className="menu-toggle"
          type="button"
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={navOpen}
          aria-controls="topbar"
          onClick={() => setNavOpen(!navOpen)}
        >
          <Icon name="menu" />
        </button>
      </div>
    </header>
  );
}
