'use client';

// App-wide hosts: the single modal dialog, toasts, footer and route-change focus.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import Icon from './Icon';
import { openPolicy } from './Support';
import { Auth } from '@/lib/store';
import { isSellerApp, Modal, modalState, toasts } from '@/lib/ui';

export function ModalHost() {
  const { open, key, title, variant, content } = modalState.use();
  const pathname = usePathname();
  const dialog = useRef(null);
  const body = useRef(null);

  useEffect(() => {
    Modal.close();
  }, [pathname]);

  useEffect(() => {
    if (open && !dialog.current.open) dialog.current.showModal();
    if (!open && dialog.current.open) dialog.current.close();
    if (open) body.current.scrollTop = 0;
  }, [open, key]);

  return (
    <dialog
      className={`modal ${variant ? `modal--${variant}` : ''}`}
      id="modal"
      aria-labelledby="modal-title"
      ref={dialog}
      onClose={() => {
        // The close event is queued, so the dialog may already be open again.
        if (!dialog.current.open) Modal.close();
      }}
      onClick={(e) => {
        // A click on the dialog itself is a click on the backdrop.
        if (e.target === dialog.current) Modal.close();
      }}
    >
      <div className="modal__head">
        <h2 id="modal-title">{title}</h2>
        <button className="icon-btn" type="button" aria-label="Close" onClick={() => Modal.close()}><Icon name="close" /></button>
      </div>
      <div className="modal__body" ref={body} key={key}>{open && content}</div>
    </dialog>
  );
}

export function Toasts() {
  const list = toasts.use();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => <div className={`toast toast--${t.type}`} key={t.id}>{t.message}</div>)}
    </div>
  );
}

export function Footer() {
  const pathname = usePathname();
  if (isSellerApp(pathname)) return null;

  return (
    <footer className="site-footer">
      <div className="container site-footer__row">
        <span>© 2026 Onetap. All rights reserved.</span>
        <nav aria-label="Footer">
          <Link href="/help">Help Centre</Link>
          <Link href="/seller/register">Sell on Onetap</Link>
          <button type="button" onClick={openPolicy}>Return &amp; Refund Policy</button>
        </nav>
      </div>
    </footer>
  );
}

// Keeps the browser's copy of the customer in step with their session on the server.
export function CustomerSession() {
  useEffect(() => {
    fetch('/api/customer/auth/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body?.account) Auth.setAccount(body.account);
        else if (body && Auth.session('customer')) Auth.clearAccount('customer');
      })
      .catch(() => {});
  }, []);

  return null;
}

// Moves focus with the page so screen readers announce the new view.
export function RouteFocus() {
  const pathname = usePathname();
  const previous = useRef(pathname);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    document.querySelector('main h1')?.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}
