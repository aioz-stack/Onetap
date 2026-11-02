'use client';

// App-wide hosts: the single modal dialog, toasts, footer and route-change focus.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Form, Sections } from './Forms';
import Icon from './Icon';
import { openPolicy } from './Support';
import { CUSTOMER_RESUBMIT_SCHEMA } from '@/lib/schemas';
import { Auth, FieldError, useStored } from '@/lib/store';
import { isSellerApp, Modal, modalState, toast, toasts } from '@/lib/ui';

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

const APPROVAL_CHECK_MS = 15000;

// Keeps the browser's copy of the customer in step with their session on the server. While a
// customer waits for approval it checks again every 15 seconds, so an administrator's decision
// shows without a reload.
export function CustomerSession() {
  const status = useStored('session.customer')?.approvalStatus;

  useEffect(() => {
    const check = () => fetch('/api/customer/auth/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body?.account) {
          const before = Auth.session('customer')?.approvalStatus;
          Auth.setAccount(body.account);
          if (before && before !== 'approved' && body.account.approvalStatus === 'approved') toast('Your account is approved. You can check out now!', 'success');
        } else if (body && Auth.session('customer')) Auth.clearAccount('customer');
      })
      .catch(() => {});
    check();
    if (!status || status === 'approved') return undefined;
    const timer = setInterval(check, APPROVAL_CHECK_MS);
    return () => clearInterval(timer);
  }, [status]);

  return null;
}

function ResubmitForm() {
  return (
    <Form
      id="resubmit-form"
      onSubmit={async (data) => {
        const body = new FormData();
        Object.entries(data).forEach(([key, value]) => body.append(key, value));
        const response = await fetch('/api/customer/approval', { method: 'POST', body }).catch(() => null);
        const result = await response?.json().catch(() => ({}));
        if (!response?.ok) {
          const [field] = Object.keys(result?.fields || {});
          throw field ? new FieldError(field, result.fields[field]) : new Error(result?.error || 'We could not reach the server. Try again.');
        }
        const account = Auth.session('customer');
        Auth.setAccount({ ...account, approvalStatus: 'pending', approvalReason: '' });
        Modal.close();
        toast('New ID sent. Your account is waiting for approval again.', 'success');
      }}
    >
      <p className="muted">Take a clear photo of the front of your ID, with all four corners and the text readable.</p>
      <Sections schema={CUSTOMER_RESUBMIT_SCHEMA} prefix="resubmit" />
      <p className="form-error" role="alert" />
      <button className="btn btn--primary btn--block" type="submit">Send for Approval</button>
    </Form>
  );
}

// Tells a customer who isn't approved yet what's happening, on every store page.
export function CustomerApprovalBanner() {
  const pathname = usePathname();
  const customer = useStored('session.customer');
  const status = customer?.approvalStatus;
  if (!customer || !status || status === 'approved' || isSellerApp(pathname)) return null;
  const rejected = status === 'rejected';
  const again = customer.verifiedBefore;
  return (
    <div className={`approval-banner${rejected ? ' approval-banner--rejected' : ''}`} role="status">
      <div className="container approval-banner__row">
        <Icon name={rejected ? 'shield' : 'clock'} />
        <p>
          {rejected && <><strong>{again ? 'Your updated details were not approved.' : 'Your registration was not approved.'}</strong> {customer.approvalReason && <>Reason: {customer.approvalReason} </>}Send a new photo of your valid ID to apply again.</>}
          {!rejected && again && <><strong>Your updated details are waiting for approval.</strong> Your orders stay in My Purchases. Checkout and shop chat open again once our team checks them.</>}
          {!rejected && !again && <><strong>Your account is waiting for approval.</strong> You can browse and fill your cart. Checkout, My Purchases and shop chat open once our team checks your valid ID.</>}
          {pathname !== '/profile' && <> <Link className="link" href="/profile">View My Profile</Link></>}
        </p>
        {rejected && <button className="btn btn--primary" type="button" onClick={() => Modal.open({ title: 'Send a new valid ID', content: <ResubmitForm /> })}>Send New ID</button>}
      </div>
    </div>
  );
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
