'use client';

// Customer Approval: new customers wait here until an administrator checks their details and
// valid ID. Approving opens checkout, purchases and shop chat for them. Rejecting tells them why.

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, Badge, DataTable, DateFilter, dateTime, FilterBar, PageHead, postAdmin, Tabs, useAdminList, useRefresh } from './AdminUI';
import { confirmModal } from '../SellerProducts';
import { CUSTOMER_APPROVAL_STATUS } from '@/lib/adminLabels';
import { Modal, toast } from '@/lib/ui';

const ACTIONS = { submitted: 'Registered', resubmitted: 'Sent a new ID', approve: 'Approved', reject: 'Rejected' };
const path = (username) => `/customers/${encodeURIComponent(username)}`;

function RejectForm({ onSubmit }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="assistant-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(reason);
        } catch (err) {
          setError(err.fields?.reason || err.message);
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="customer-reason">Why is this registration rejected?</label>
        <textarea id="customer-reason" rows={4} minLength={10} maxLength={500} required aria-invalid={Boolean(error)} aria-describedby="customer-reason-hint" value={reason} onChange={(e) => setReason(e.target.value)} />
        <small className="field__hint" id="customer-reason-hint">The customer sees this, and can send a new ID. 10 to 500 characters.</small>
        {error && <small className="field__error" role="alert">{error}</small>}
      </div>
      <button className="btn btn--danger btn--block" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Reject Registration'}</button>
    </form>
  );
}

function CustomerDetail({ username, onChanged }) {
  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState('');
  const [idChecked, setIdChecked] = useState(false);

  const load = useCallback(() => adminFetch(path(username)).then((body) => setCustomer(body.customer), (err) => setError(err.message)), [username]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!customer) return <div className="skeleton" role="status" aria-label="Loading registration" />;

  const { profile, status } = customer;
  const idUrl = `/api/admin${path(username)}/id`;
  const decide = async (action, reason, message) => {
    await postAdmin(path(username), { action, reason });
    Modal.close();
    toast(message, 'success');
    onChanged();
  };

  return (
    <div className="assistant-form">
      <div className="approval-head">
        <Badge status={CUSTOMER_APPROVAL_STATUS[status]} />
        <span className="muted">Registered {dateTime(customer.registeredAt)}{customer.decidedAt && ` · ${CUSTOMER_APPROVAL_STATUS[status].label.toLowerCase()} ${dateTime(customer.decidedAt)} by ${customer.decidedBy}`}</span>
      </div>
      {customer.reason && <p className="order-card__note"><strong>Reason:</strong> {customer.reason}</p>}
      <section>
        <h3>Account Information</h3>
        <dl className="order-facts order-facts--row">
          <div><dt>Name</dt><dd>{customer.name || '—'}</dd></div>
          <div><dt>Username</dt><dd>{customer.username}</dd></div>
          <div><dt>Email</dt><dd>{customer.email}</dd></div>
          <div><dt>Contact number</dt><dd>{customer.contact || '—'}</dd></div>
        </dl>
        {customer.sameContact.length > 0 && <p className="admin-banner" role="note"><strong>Check for a repeat sign-up.</strong> This contact number is also on {customer.sameContact.join(', ')}.</p>}
      </section>
      <section>
        <h3>Complete Address</h3>
        <dl className="order-facts order-facts--row">
          <div><dt>Street</dt><dd>{profile.street || '—'}</dd></div>
          <div><dt>Barangay</dt><dd>{profile.barangay || '—'}</dd></div>
          <div><dt>City</dt><dd>{profile.city || '—'}</dd></div>
          <div><dt>Province</dt><dd>{profile.province || '—'}</dd></div>
          <div><dt>Country</dt><dd>{profile.country || '—'}</dd></div>
          <div><dt>ZIP code</dt><dd>{profile.zip || '—'}</dd></div>
        </dl>
      </section>
      <section>
        <h3>Identity Verification</h3>
        {customer.idFile ? (
          <div className="valid-id">
            <a href={idUrl} target="_blank" rel="noopener" aria-label="Open the valid ID full size in a new tab">
              <img src={idUrl} alt={`Valid ID uploaded by ${customer.username}`} />
            </a>
            <dl className="order-facts">
              <div><dt>ID number</dt><dd className="valid-id__number">{customer.idNumber}</dd></div>
              <div><dt>File</dt><dd>{customer.idFile.name} · {Math.max(1, Math.round(customer.idFile.size / 1024))} KB</dd></div>
            </dl>
            {status === 'pending' && (
              <label className="check">
                <input type="checkbox" checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} />
                <span>The ID number matches the photo, and the name and photo on the ID match this customer.</span>
              </label>
            )}
          </div>
        ) : <p className="muted">No ID on file. This account existed before Customer Approval began.</p>}
      </section>
      {status === 'pending' && (
        <div className="order-card__actions">
          <button
            className="btn-mini btn-mini--primary"
            type="button"
            disabled={!idChecked}
            title={idChecked ? undefined : 'Check the ID first'}
            onClick={() => confirmModal({
              title: `Approve ${customer.username}`,
              body: 'They can check out, see their purchases and chat with shops straight away.',
              label: 'Approve Customer',
              run: () => decide('approve', '', 'Customer approved and notified.'),
            })}
          >
            Approve
          </button>
          <button className="btn-mini btn-mini--danger" type="button" onClick={() => Modal.open({ title: `Reject ${customer.username}`, content: <RejectForm onSubmit={(reason) => decide('reject', reason, 'Registration rejected. The customer was notified.')} /> })}>Reject</button>
        </div>
      )}
      {status === 'pending' && !idChecked && <p className="muted">Tick the ID check to approve.</p>}
      <section>
        <h3>History</h3>
        <ol className="timeline order-timeline">
          {customer.history.map((item) => (
            <li className="is-done" key={`${item.at}-${item.action}`}>
              {ACTIONS[item.action] || item.action} by {item.actor}{item.reason && `: ${item.reason}`}
              <small>{dateTime(item.at)}</small>
            </li>
          ))}
          {!customer.history.length && <li className="is-done">Approved as an existing account</li>}
        </ol>
      </section>
    </div>
  );
}

export function AdminCustomers({ initial }) {
  const list = useAdminList('/customers', initial);
  const counts = list.data?.counts || {};
  // New registrations show up without a reload.
  useRefresh(list.reload);
  const open = (row) => Modal.open({ title: row.name || row.username, variant: 'wide', content: <CustomerDetail username={row.username} onChanged={list.reload} /> });

  return (
    <div className="order-page admin-page">
      <PageHead title="Customer Approval" text="Check new customers' details and valid ID before they can buy." />
      <Tabs
        list={list}
        label="Filter registrations"
        tabs={[['', 'All Customers'], ['pending', 'Pending Approval', counts.pending], ['approved', 'Approved', counts.approved], ['rejected', 'Rejected', counts.rejected]]}
      />
      <FilterBar list={list} placeholder="Name, username, email, contact or ID number">
        <DateFilter list={list} name="from" label="Registered from" />
        <DateFilter list={list} name="to" label="To" />
      </FilterBar>
      <DataTable
        list={list}
        label="Customer registrations"
        empty="No registrations here yet"
        rowKey={(row) => row.username}
        columns={[
          { label: 'Customer', sort: 'customer', render: (row) => <button className="link" type="button" onClick={() => open(row)}>{row.name || row.username}</button> },
          { label: 'Username', render: (row) => row.username },
          { label: 'Email', render: (row) => row.email },
          { label: 'Contact', render: (row) => row.contact || '—' },
          { label: 'ID number', render: (row) => row.idNumber || '—' },
          { label: 'Status', sort: 'status', render: (row) => <Badge status={CUSTOMER_APPROVAL_STATUS[row.status]} /> },
          { label: 'Registered', sort: 'submitted', render: (row) => dateTime(row.submittedAt) },
          { label: 'Reviewed', sort: 'decided', render: (row) => (row.decidedAt ? `${dateTime(row.decidedAt)} · ${row.decidedBy}` : '—') },
        ]}
      />
    </div>
  );
}
