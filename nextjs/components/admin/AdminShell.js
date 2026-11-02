'use client';

// Admin Console frame and login.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../Icon';
import { ThemeToggle } from '../Header';
import { adminFetch, dateTime, postAdmin, TextField, useRefresh } from './AdminUI';
import { ADMIN_ROLES, can } from '@/lib/adminRoles';
import { Modal, toast } from '@/lib/ui';

const NAV = [
  { label: 'Overview', href: '/admin', icon: 'chart' },
  { label: 'Logistics Partners', href: '/admin/logistics', icon: 'truck', permission: 'logistics' },
  { label: 'API Configuration', href: '/admin/api', icon: 'globe', permission: 'api' },
  { label: 'Pickup Approval', href: '/admin/pickups', icon: 'store', permission: 'pickups' },
  { label: 'Shipment Monitoring', href: '/admin/shipments', icon: 'box', permission: 'shipments' },
  { label: 'COD Monitoring', href: '/admin/cod', icon: 'wallet', permission: 'cod' },
  { label: 'Financial Collections', href: '/admin/collections', icon: 'chart', permission: 'cod' },
  { label: 'Seller Payouts', href: '/admin/payouts', icon: 'wallet', permission: 'cod' },
  { label: 'Payout Accounts', href: '/admin/payout-accounts', icon: 'shield', permission: 'cod' },
  { label: 'Seller Registration Approval', href: '/admin/sellers', icon: 'store', permission: 'sellers' },
  { label: 'Customer Approval', href: '/admin/customers', icon: 'user', permission: 'customers' },
  { label: 'Product Listings', href: '/admin/products', icon: 'shield', permission: 'products' },
  { label: 'Audit Log', href: '/admin/audit', icon: 'eye', permission: 'audit' },
  { label: 'Team', href: '/admin/team', icon: 'help', permission: 'team' },
];

function PasswordForm() {
  const [values, setValues] = useState({ current: '', next: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await postAdmin('/auth/password', values);
      Modal.close();
      toast('Password changed.', 'success');
    } catch (err) {
      setErrors(err.fields || {});
      toast(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit}>
      <TextField id="password-current" label="Current password" type="password" autoComplete="current-password" required value={values.current} error={errors.current} onChange={(e) => setValues({ ...values, current: e.target.value })} />
      <TextField id="password-next" label="New password" type="password" autoComplete="new-password" required minLength={12} hint="At least 12 characters." value={values.next} error={errors.next} onChange={(e) => setValues({ ...values, next: e.target.value })} />
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Change Password'}</button>
    </form>
  );
}

export function AdminShell({ admin, children }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  async function logout() {
    await adminFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.assign('/admin/login');
  }

  return (
    <div className="seller admin">
      <header className="seller-bar">
        <button className="seller-bar__menu" type="button" aria-label={navOpen ? 'Close menu' : 'Open menu'} aria-expanded={navOpen} aria-controls="admin-nav" onClick={() => setNavOpen(!navOpen)}><Icon name="menu" /></button>
        <Link className="seller-bar__brand" href="/admin" aria-label="Admin overview">
          <img src="/logo.svg" alt="" width="34" height="34" />
          <span>Onetap</span>
        </Link>
        <span className="seller-bar__title">Admin Console</span>
        <div className="seller-bar__actions">
          <ThemeToggle />
          <AdminNotifications />
          <button className="seller-bar__logout" type="button" onClick={() => Modal.open({ title: 'Change password', content: <PasswordForm /> })}>{admin.name}<span className="admin-role"> · {ADMIN_ROLES[admin.adminRole].label}</span></button>
          <button className="seller-bar__logout" type="button" onClick={logout}>Log Out</button>
        </div>
      </header>
      <div className="seller-shell">
        <nav className={`seller-nav ${navOpen ? 'is-open' : ''}`} id="admin-nav" aria-label="Admin Console">
          {NAV.filter((item) => !item.permission || can(admin, item.permission)).map((item) => (
            <Link className="seller-nav__home" href={item.href} key={item.href} aria-current={pathname === item.href ? 'page' : undefined}><Icon name={item.icon} /> {item.label}</Link>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}

// Notices for the administrator's role, such as customers waiting for verification. Checks every
// 15 seconds, and opening the list marks them read.
function AdminNotifications() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const unread = items.filter((item) => !item.read).length;

  const load = useCallback(() => adminFetch('/notifications').then((body) => setItems(body.notifications)).catch(() => {}), []);
  useRefresh(load);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !e.composedPath().some((el) => el.matches?.('.panel-pop, [data-admin-notices]'))) setOpen(false);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  function toggle() {
    setOpen(!open);
    if (!open && unread) {
      postAdmin('/notifications', {}).catch(() => {});
      setItems(items.map((item) => ({ ...item, read: true })));
    }
  }

  return (
    <div className="popover-wrap">
      <button className="seller-bar__icon" type="button" data-admin-notices aria-label={`Notifications, ${unread} unread`} aria-expanded={open} aria-controls="admin-notices" onClick={toggle}>
        <Icon name="bell" />
        {unread > 0 && <span className="count seller-bar__count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="popover popover--wide seller-notices panel-pop" id="admin-notices" role="region" aria-label="Notifications">
          <div className="popover__head"><strong>Notifications</strong></div>
          {items.map((item) => (
            <Link className={`notif${item.read ? '' : ' notif--unread'}`} href={item.link} key={item.id} onClick={() => setOpen(false)}>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
              <small>{dateTime(item.at)}</small>
            </Link>
          ))}
          {!items.length && <p className="muted notif">Nothing new yet.</p>}
        </div>
      )}
    </div>
  );
}

export function AdminLogin() {
  const [values, setValues] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await postAdmin('/auth/login', values);
      window.location.assign('/admin');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <section className="admin-login">
      <form className="panel" onSubmit={submit}>
        <h1 tabIndex={-1}>Admin Console</h1>
        <p className="muted">Sign in with your Onetap administrator account.</p>
        <TextField id="admin-identifier" label="Username or email" autoComplete="username" required value={values.identifier} onChange={(e) => setValues({ ...values, identifier: e.target.value })} />
        <TextField id="admin-password" label="Password" type="password" autoComplete="current-password" required value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Log In'}</button>
      </form>
    </section>
  );
}
