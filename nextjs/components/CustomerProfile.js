'use client';

// My Profile: a customer's account, personal details, address, valid ID and verification status.
// They can edit their details and password here. A new ID, or a new name, goes to an
// administrator again, because the two must match.

import { useCallback, useEffect, useState } from 'react';
import { Form, Sections } from './Forms';
import Icon from './Icon';
import { Badge } from './SellerOrders';
import { confirmModal } from './SellerProducts';
import { CUSTOMER_APPROVAL_STATUS } from '@/lib/adminLabels';
import { CUSTOMER_PASSWORD_SCHEMA, customerIdentitySchema, customerProfileSchema } from '@/lib/schemas';
import { Auth, FieldError, useStored } from '@/lib/store';
import { Modal, toast } from '@/lib/ui';

const NAME_FIELDS = ['firstName', 'middleName', 'lastName', 'suffix'];

async function request(path, options = {}) {
  const response = await fetch(`/api/customer/profile${path}`, options).catch(() => null);
  if (!response) throw new Error('We could not reach the server. Check your connection and try again.');
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const [field] = Object.keys(body.fields || {});
    throw field ? new FieldError(field, body.fields[field]) : new Error(body.error || 'Something went wrong. Please try again.');
  }
  return body.account;
}

const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

// The header and banners read the browser's copy of the account, so it follows every change here.
const refreshSession = () => fetch('/api/customer/auth/me').then((r) => r.json()).then((body) => body.account && Auth.setAccount(body.account)).catch(() => {});

const STATUS_TEXT = {
  approved: 'Your identity is verified. You can check out, see your purchases and chat with shops.',
  pending: 'Our team is checking your details and valid ID. We\'ll notify you when it\'s done.',
  pendingAgain: 'Our team is checking your updated details. Your orders stay in My Purchases, and checkout opens again once they\'re approved.',
  rejected: 'Your verification was not approved. Update your valid ID below to apply again.',
};

function Fact({ label, children }) {
  return <div><dt>{label}</dt><dd>{children || '—'}</dd></div>;
}

function IdentityForm({ account, onSaved }) {
  return (
    <Form
      id="identity-form"
      onSubmit={async (data) => {
        const body = new FormData();
        Object.entries(data).forEach(([key, value]) => body.append(key, value));
        const next = await request('/identity', { method: 'POST', body });
        Modal.close();
        toast('Valid ID sent. Your account is waiting for approval.', 'success');
        onSaved(next);
      }}
    >
      <p className="admin-banner" role="note"><strong>This needs approval again.</strong> Until our team checks your new ID, checkout and shop chat pause. Your existing orders stay in My Purchases.</p>
      <Sections schema={customerIdentitySchema(account)} prefix="identity" />
      <p className="form-error" role="alert" />
      <button className="btn btn--primary btn--block" type="submit">Send for Approval</button>
    </Form>
  );
}

function PasswordForm() {
  return (
    <Form
      id="password-form"
      onSubmit={async (data) => {
        if (data.next !== data.confirm) throw new FieldError('confirm', 'The passwords do not match.');
        await request('/password', json('POST', data));
        document.getElementById('password-form').reset();
        toast('Password changed. Other devices were signed out.', 'success');
      }}
    >
      <Sections schema={CUSTOMER_PASSWORD_SCHEMA} prefix="password" />
      <p className="form-error" role="alert" />
      <button className="btn btn--primary" type="submit">Update Password</button>
    </Form>
  );
}

export default function CustomerProfile() {
  const [state, setState] = useState({ loading: true });
  const status = useStored('session.customer')?.approvalStatus;
  const { account, loading, error } = state;

  const load = useCallback(() => request('').then((next) => setState({ account: next }), (err) => setState({ loading: false, error: err.message })), []);
  // Reloads when an administrator's decision reaches this browser.
  useEffect(() => {
    load();
  }, [load, status]);

  const saved = (next) => {
    setState({ account: next });
    refreshSession();
  };

  async function save(data) {
    const next = await request('', json('PATCH', data));
    saved(next);
    toast(next.reviewing ? 'Changes saved. Your new name is waiting for approval.' : 'Changes saved.', 'success');
  }

  if (loading && !account) return <section className="container profile"><div className="skeleton" role="status" aria-label="Loading your profile" /></section>;
  if (!account) return <section className="container profile"><p className="form-error" role="alert">{error}</p></section>;

  const { profile, approval } = account;
  const name = [profile.firstName, profile.middleName, profile.lastName, profile.suffix].filter(Boolean).join(' ');
  const statusText = approval.status === 'pending' && approval.verifiedBefore ? STATUS_TEXT.pendingAgain : STATUS_TEXT[approval.status];
  const idUrl = `/api/customer/profile/id?v=${account.idFile?.at || 0}`;

  return (
    <section className="container profile">
      <div className="profile__head">
        <h1 tabIndex={-1}>My Profile</h1>
        <p className="muted">Your account, personal details and identity verification.</p>
      </div>

      <div className="panel profile__summary">
        <span className="chat__avatar profile__avatar" aria-hidden="true">{(profile.firstName || account.username).slice(0, 1).toUpperCase()}</span>
        <div className="profile__who">
          <strong>{name || account.username}</strong>
          <span className="muted">@{account.username} · {account.email}</span>
        </div>
        <div className="profile__status">
          <Badge status={CUSTOMER_APPROVAL_STATUS[approval.status]} />
          <small className="muted">Account Verification Status</small>
        </div>
        <p className="profile__status-text">{statusText}</p>
        {approval.reason && <p className="order-card__note"><strong>Reason:</strong> {approval.reason}</p>}
      </div>

      <div className="profile__grid">
        <div className="profile__main">
          <section className="panel" aria-labelledby="profile-details">
            <div className="panel__head"><h2 id="profile-details">Account and Personal Details</h2></div>
            <dl className="order-facts order-facts--row">
              <Fact label="Username">{account.username}</Fact>
              <Fact label="Member since">{new Date(account.registeredAt).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' })}</Fact>
            </dl>
            <p className="muted profile__note">Your username can&apos;t be changed. Changing your name sends your account for approval again, because it must match your valid ID.</p>
            <Form
              id="profile-form"
              key={`${account.email}|${JSON.stringify(profile)}`}
              onSubmit={async (data) => {
                const renamed = NAME_FIELDS.some((field) => (data[field] || '').trim() !== (profile[field] || ''));
                if (renamed && approval.status !== 'pending') {
                  confirmModal({
                    title: 'Change your name?',
                    body: 'Your name must match your valid ID, so our team checks it again. Checkout and shop chat pause until it\'s approved. Your orders stay in My Purchases.',
                    label: 'Save and Send for Approval',
                    run: () => save(data),
                  });
                  return;
                }
                await save(data);
              }}
            >
              <Sections schema={customerProfileSchema(account)} prefix="profile" />
              <p className="form-error" role="alert" />
              <div className="profile__actions">
                <button className="btn btn--primary" type="submit">Save Changes</button>
              </div>
            </Form>
          </section>
        </div>

        <aside className="profile__side">
          <section className="panel" aria-labelledby="profile-identity">
            <div className="panel__head">
              <h2 id="profile-identity">Identity Verification</h2>
              <Badge status={CUSTOMER_APPROVAL_STATUS[approval.status]} />
            </div>
            {account.idFile ? (
              <a className="profile__id" href={idUrl} target="_blank" rel="noopener" aria-label="Open your valid ID full size in a new tab">
                <img src={idUrl} alt="Your uploaded valid ID" />
              </a>
            ) : <p className="muted">No valid ID on file. Your account was verified before ID photos were required.</p>}
            <dl className="order-facts">
              <Fact label="ID Number"><span className="valid-id__number">{account.idNumber}</span></Fact>
              <Fact label="Last submitted">{new Date(approval.submittedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })}</Fact>
            </dl>
            <button className="btn btn--ghost btn--block" type="button" onClick={() => Modal.open({ title: 'Update your valid ID', content: <IdentityForm account={account} onSaved={saved} /> })}>
              <Icon name="shield" /> Update Valid ID
            </button>
          </section>

          <section className="panel" aria-labelledby="profile-password">
            <div className="panel__head"><h2 id="profile-password">Password</h2></div>
            <p className="muted profile__note">Use at least 8 characters. Changing it signs you out on your other devices.</p>
            <PasswordForm />
          </section>
        </aside>
      </div>
    </section>
  );
}
