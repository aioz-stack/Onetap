'use client';

// Seller Payouts: sellers' requests to withdraw their available income. An administrator starts
// processing one, sends the money outside Onetap, then records the transfer reference, or
// rejects it with a reason, which returns the amount to the seller's balance.

import { useState } from 'react';
import { Badge, DataTable, dateTime, FilterBar, PageHead, postAdmin, StatCards, Tabs, useAdminList, useRefresh } from './AdminUI';
import { confirmModal } from '../SellerProducts';
import { PAYOUT_STATUS } from '@/lib/adminLabels';
import { Modal, peso, toast } from '@/lib/ui';

function NoteForm({ label, field, hint, submit, danger, onSubmit }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="assistant-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(value);
        } catch (err) {
          setError(err.fields?.[field] || err.message);
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor={`payout-${field}`}>{label}</label>
        <input id={`payout-${field}`} required aria-invalid={Boolean(error)} aria-describedby={`payout-${field}-hint`} value={value} onChange={(e) => setValue(e.target.value)} />
        <small className="field__hint" id={`payout-${field}-hint`}>{hint}</small>
        {error && <small className="field__error" role="alert">{error}</small>}
      </div>
      <button className={`btn btn--block ${danger ? 'btn--danger' : 'btn--primary'}`} type="submit" disabled={busy}>{busy ? 'Saving…' : submit}</button>
    </form>
  );
}

export function AdminPayouts({ initial }) {
  const list = useAdminList('/payouts', initial);
  useRefresh(list.reload);
  const counts = list.data?.counts || {};
  const amounts = list.data?.amounts || {};

  const act = async (payout, action, extra, message) => {
    await postAdmin(`/payouts/${payout.id}`, { action, ...extra });
    Modal.close();
    toast(message, 'success');
    list.reload();
  };

  const actions = (p) => (
    <span className="order-card__actions">
      {p.status === 'pending' && (
        <button className="btn-mini btn-mini--primary" type="button" onClick={() => confirmModal({ title: `Process ${p.reference}`, body: `Send ${peso(p.amount)} to ${p.accountName}, ${p.provider} ${p.accountNumber}. The seller is told it's on its way.`, label: 'Start Processing', run: () => act(p, 'process', {}, 'Marked as processing. The seller was told.') })}>Process</button>
      )}
      {p.status === 'processing' && (
        <button className="btn-mini btn-mini--primary" type="button" onClick={() => Modal.open({ title: `Complete ${p.reference}`, content: <NoteForm label="Transfer reference" field="reference" hint={`From the bank or wallet, after sending ${peso(p.amount)}.`} submit="Mark as Sent" onSubmit={(reference) => act(p, 'complete', { reference }, 'Payout completed. The seller was told.')} /> })}>Mark Sent</button>
      )}
      {['pending', 'processing'].includes(p.status) && (
        <button className="btn-mini btn-mini--danger" type="button" onClick={() => Modal.open({ title: `Reject ${p.reference}`, content: <NoteForm label="Reason" field="note" hint="The seller sees this, and the amount returns to their balance." submit="Reject Payout" danger onSubmit={(note) => act(p, 'reject', { note }, 'Payout rejected. The amount is back in the seller\'s balance.')} /> })}>Reject</button>
      )}
    </span>
  );

  return (
    <div className="order-page admin-page">
      <PageHead title="Seller Payouts" text="Sellers withdraw income that is settled and past its return window. Send the money, then record the transfer reference." />
      <StatCards items={[
        { label: `Pending (${counts.pending || 0})`, value: peso(amounts.pending || 0) },
        { label: `Processing (${counts.processing || 0})`, value: peso(amounts.processing || 0) },
        { label: `Completed (${counts.completed || 0})`, value: peso(amounts.completed || 0) },
      ]} />
      <Tabs list={list} name="status" label="Filter payouts" tabs={[['', 'All'], ...Object.entries(PAYOUT_STATUS).map(([key, s]) => [key, s.label, counts[key]])]} />
      <FilterBar list={list} placeholder="Reference, seller or account name" />
      <DataTable
        list={list}
        label="Seller payouts"
        empty="No payout requests here"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Reference', render: (row) => <strong>{row.reference}</strong> },
          { label: 'Seller', render: (row) => row.seller },
          { label: 'Amount', render: (row) => peso(row.amount) },
          { label: 'Send to', render: (row) => <>{row.provider}<small className="muted"> {row.method} · {row.accountName} · {row.accountNumber}</small></> },
          { label: 'Status', render: (row) => <><Badge status={PAYOUT_STATUS[row.status]} />{row.payoutReference && <small className="muted"> {row.payoutReference}</small>}{row.note && <small className="muted"> {row.note}</small>}</> },
          { label: 'Requested', render: (row) => dateTime(row.requestedAt) },
          { label: 'Actions', render: actions },
        ]}
      />
    </div>
  );
}
