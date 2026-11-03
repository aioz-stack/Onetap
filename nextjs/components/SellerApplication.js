'use client';

// Where a seller follows their application, and fixes and resubmits it when asked.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Form, Sections } from './Forms';
import { Badge } from './SellerOrders';
import { APPLICATION_STATUS } from '@/lib/adminLabels';
import { formatDate } from '@/lib/orders';
import { send } from '@/lib/productsApi';
import { applicationSchema } from '@/lib/schemas';
import { Auth, FieldError } from '@/lib/store';
import { toast } from '@/lib/ui';

const REFRESH_MS = 15000;

const MESSAGES = {
  pending: 'Your registration is waiting for admin review. Seller Centre opens as soon as it is approved.',
  needs_info: 'Our reviewer needs more from you. Update your application below and send it back.',
  approved: 'Your seller account is approved.',
  disapproved: 'Your application was not approved. You can update it and apply again.',
  suspended: 'Your seller account is suspended, and your products are hidden from the marketplace. Contact support for help.',
};

const ACTIONS = { submitted: 'Application submitted', resubmitted: 'Application resubmitted', approve: 'Approved', disapprove: 'Disapproved', request_info: 'More information requested', suspend: 'Suspended' };

function ResubmitForm({ application, onSaved }) {
  return (
    <Form
      id="resubmit-form"
      onSubmit={async (data) => {
        const body = new FormData();
        Object.entries(data).forEach(([key, value]) => body.append(key, value));
        try {
          onSaved(await send('/api/seller/application', { method: 'POST', body }));
          toast('Application resubmitted.', 'success');
        } catch (err) {
          const [field] = Object.keys(err.fields || {});
          throw field ? new FieldError(field, err.fields[field]) : err;
        }
      }}
    >
      <Sections schema={applicationSchema(application.profile)} prefix="resubmit" panel="seller" />
      <p className="form-error" role="alert" />
      <button className="btn btn--primary btn--block" type="submit">Resubmit Application</button>
    </Form>
  );
}

export default function SellerApplication() {
  const router = useRouter();
  const [state, setState] = useState({ loading: true });

  const load = useCallback(() => send('/api/seller/application').then(({ application }) => setState({ application }), (err) => setState((current) => ({ ...current, loading: false, error: err.message }))), []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const { application, loading, error } = state;

  async function logout() {
    await Auth.logout('seller');
    router.replace('/seller/login');
  }

  return (
    <section className="container application">
      <h1 tabIndex={-1}>Seller Application</h1>
      {loading && <div className="skeleton" role="status" aria-label="Loading your application" />}
      {error && !application && <p className="form-error" role="alert">{error}</p>}
      {application && (
        <>
          <div className="panel">
            <div className="application__status"><strong>Status</strong> <Badge status={APPLICATION_STATUS[application.status]} /></div>
            <p role="status">{MESSAGES[application.status]}</p>
            {application.reason && <p className="order-card__note"><strong>From our reviewer:</strong> {application.reason}</p>}
            <p className="muted">Submitted {formatDate(application.submittedAt)}. This page updates by itself.</p>
            <div className="application__actions">
              {application.status === 'approved' && <Link className="btn btn--primary" href="/seller/dashboard">Open Seller Centre</Link>}
              <button className="btn btn--ghost" type="button" onClick={logout}>Log Out</button>
            </div>
          </div>

          {['needs_info', 'disapproved'].includes(application.status) && (
            <div className="panel">
              <div className="panel__head"><h2>Update Your Application</h2></div>
              <ResubmitForm application={application} onSaved={setState} key={application.submittedAt} />
            </div>
          )}

          <div className="panel">
            <div className="panel__head"><h2>Submitted Documents</h2></div>
            <ul className="application__docs">
              {application.documents.map((doc) => <li key={doc.id}><a className="link" href={`/api/seller/application/documents/${doc.id}`} target="_blank" rel="noopener">{doc.label}</a> <span className="muted">{doc.name}</span></li>)}
            </ul>
          </div>

          <div className="panel">
            <div className="panel__head"><h2>History</h2></div>
            <ol className="timeline order-timeline">
              {application.history.map((item) => (
                <li className="is-done" key={`${item.at}-${item.action}`}>
                  {ACTIONS[item.action]}{item.reason && `: ${item.reason}`}
                  <small>{formatDate(item.at)}</small>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
