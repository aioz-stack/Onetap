'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, Badge, dateTime, DataTable, FilterBar, PageHead, postAdmin, Tabs, useAdminList } from './AdminUI';
import { confirmModal } from '../SellerProducts';
import { APPLICATION_STATUS } from '@/lib/adminLabels';
import { Modal, toast } from '@/lib/ui';

const ACTIONS = { submitted: 'Submitted', resubmitted: 'Resubmitted', approve: 'Approved', disapprove: 'Disapproved', request_info: 'Information requested', suspend: 'Suspended' };

function ReasonForm({ title, label, onSubmit }) {
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
        <label htmlFor="application-reason">{title}</label>
        <textarea id="application-reason" rows={4} maxLength={500} required aria-invalid={Boolean(error)} value={reason} onChange={(e) => setReason(e.target.value)} />
        <small className="field__hint">The seller sees this. 10 to 500 characters.</small>
        {error && <small className="field__error">{error}</small>}
      </div>
      <button className="btn btn--danger btn--block" type="submit" disabled={busy}>{busy ? 'Saving…' : label}</button>
    </form>
  );
}

function ApplicationDetail({ username, onChanged }) {
  const [application, setApplication] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => adminFetch(`/sellers/${encodeURIComponent(username)}`).then((body) => setApplication(body.application), (err) => setError(err.message)), [username]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!application) return <div className="skeleton" role="status" aria-label="Loading application" />;

  const { profile, status } = application;
  const decide = async (action, reason, message) => {
    await postAdmin(`/sellers/${encodeURIComponent(username)}`, { action, reason });
    Modal.close();
    toast(message, 'success');
    onChanged();
  };
  const askReason = (action, title, label, message) => Modal.open({ title: profile.shopName, content: <ReasonForm title={title} label={label} onSubmit={(reason) => decide(action, reason, message)} /> });

  return (
    <div className="assistant-form">
      <Badge status={APPLICATION_STATUS[status]} />
      {application.reason && <p className="order-card__note"><strong>Reason:</strong> {application.reason}</p>}
      <section>
        <h3>Business Details</h3>
        <dl className="order-facts order-facts--row">
          <div><dt>Shop name</dt><dd>{profile.shopName}</dd></div>
          <div><dt>Business type</dt><dd>{profile.businessType || '—'}</dd></div>
          <div><dt>Registered name</dt><dd>{profile.businessName || '—'}</dd></div>
          <div><dt>Tax ID</dt><dd>{profile.tin || '—'}</dd></div>
        </dl>
      </section>
      <section>
        <h3>Contact Information</h3>
        <dl className="order-facts order-facts--row">
          <div><dt>Name</dt><dd>{[profile.firstName, profile.middleName, profile.lastName, profile.suffix].filter(Boolean).join(' ')}</dd></div>
          <div><dt>Username</dt><dd>{application.username}</dd></div>
          <div><dt>Email</dt><dd>{application.email}</dd></div>
          <div><dt>Contact number</dt><dd>{profile.contact}</dd></div>
          <div><dt>Address</dt><dd>{[profile.street, profile.barangay, profile.city, profile.province, profile.zip, profile.country].filter(Boolean).join(', ')}</dd></div>
        </dl>
      </section>
      <section>
        <h3>Submitted Documents</h3>
        {application.documents.length ? (
          <ul className="application__docs">
            {application.documents.map((doc) => (
              <li key={doc.id}>
                <a className="link" href={`/api/admin/sellers/${encodeURIComponent(username)}/documents/${doc.id}`} target="_blank" rel="noopener">{doc.label}</a>
                {' '}<span className="muted">{doc.name} · {dateTime(doc.at)}{doc.current ? '' : ' · replaced'}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No documents. This account existed before approvals began.</p>}
      </section>
      <div className="order-card__actions">
        {['pending', 'needs_info', 'suspended'].includes(status) && (
          <button
            className="btn-mini btn-mini--primary"
            type="button"
            onClick={() => confirmModal({
              title: `${status === 'suspended' ? 'Reinstate' : 'Approve'} ${profile.shopName}`,
              body: 'This opens Seller Centre for this seller.',
              label: status === 'suspended' ? 'Reinstate Seller' : 'Approve Seller',
              run: () => decide('approve', '', 'Seller approved and notified.'),
            })}
          >
            {status === 'suspended' ? 'Reinstate' : 'Approve'}
          </button>
        )}
        {status === 'pending' && <button className="btn-mini" type="button" onClick={() => askReason('request_info', 'What do you need from this seller?', 'Send Request', 'Request sent to the seller.')}>Request Information</button>}
        {['pending', 'needs_info'].includes(status) && <button className="btn-mini btn-mini--danger" type="button" onClick={() => askReason('disapprove', 'Why is this application disapproved?', 'Disapprove Application', 'Application disapproved. The seller was notified.')}>Disapprove</button>}
        {status === 'approved' && <button className="btn-mini btn-mini--danger" type="button" onClick={() => askReason('suspend', 'Why is this seller suspended?', 'Suspend Seller', 'Seller suspended. Their products are hidden.')}>Suspend</button>}
      </div>
      <section>
        <h3>Application History</h3>
        <ol className="timeline order-timeline">
          {application.history.map((item) => (
            <li className="is-done" key={`${item.at}-${item.action}`}>
              {ACTIONS[item.action]} by {item.actor}{item.reason && `: ${item.reason}`}
              <small>{dateTime(item.at)}</small>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function AdminSellers({ initial }) {
  const list = useAdminList('/sellers', initial);
  const counts = list.data?.counts || {};
  const open = (row) => Modal.open({ title: row.shopName, variant: 'wide', content: <ApplicationDetail username={row.username} onChanged={list.reload} /> });

  return (
    <div className="order-page admin-page">
      <PageHead title="Seller Registration Approval" text="Review new sellers before Seller Centre opens for them." />
      <Tabs
        list={list}
        label="Filter applications"
        tabs={[['', 'All Applications'], ['pending', 'Pending Approval', counts.pending], ['approved', 'Approved', counts.approved], ['disapproved', 'Disapproved', counts.disapproved], ['suspended', 'Suspended', counts.suspended]]}
      />
      <FilterBar list={list} placeholder="Shop, username, email or business" />
      <DataTable
        list={list}
        label="Seller applications"
        empty="No applications here yet"
        rowKey={(row) => row.username}
        columns={[
          { label: 'Shop', render: (row) => <button className="link" type="button" onClick={() => open(row)}>{row.shopName}</button> },
          { label: 'Seller', sort: 'seller', render: (row) => row.username },
          { label: 'Business type', render: (row) => row.businessType || '—' },
          { label: 'Email', render: (row) => row.email },
          { label: 'Status', sort: 'status', render: (row) => <Badge status={APPLICATION_STATUS[row.status]} /> },
          { label: 'Submitted', sort: 'submitted', render: (row) => dateTime(row.submittedAt) },
          { label: 'Reviewed', sort: 'decided', render: (row) => (row.decidedAt ? `${dateTime(row.decidedAt)} · ${row.decidedBy}` : '—') },
        ]}
      />
    </div>
  );
}
