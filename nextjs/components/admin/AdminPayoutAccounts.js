'use client';

// Payout Accounts: sellers' saved bank and e-wallet accounts, waiting to be verified before any
// withdrawal can go to them, and the list of banks and e-wallets sellers can choose from.

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, Badge, DataTable, dateTime, FilterBar, PageHead, postAdmin, Tabs, TextField, useAdminList, useRefresh } from './AdminUI';
import { confirmModal } from '../SellerProducts';
import { Modal, toast } from '@/lib/ui';

const STATUS = {
  pending: { label: 'Waiting for Verification', tone: 'warn' },
  verified: { label: 'Verified', tone: 'ok' },
  rejected: { label: 'Not Verified', tone: 'danger' },
};
const KINDS = { bank: 'Bank Account', ewallet: 'E-Wallet' };

function RejectForm({ onSubmit }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="assistant-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(note);
        } catch (err) {
          setError(err.fields?.note || err.message);
          setBusy(false);
        }
      }}
    >
      <TextField id="account-reject" label="Why can't it be verified?" required value={note} error={error} hint="The seller sees this and can edit the account to try again." onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn--danger btn--block" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Mark as Not Verified'}</button>
    </form>
  );
}

// Opening the details shows the full number, which is audited.
function AccountDetail({ id, onChanged }) {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    adminFetch(`/payout-accounts/${id}`).then((body) => setAccount(body.account), (err) => setError(err.message));
  }, [id]);
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!account) return <div className="skeleton" role="status" aria-label="Loading the account" />;
  const review = async (action, note) => {
    await postAdmin(`/payout-accounts/${id}`, { action, note });
    Modal.close();
    toast(action === 'verify' ? 'Account verified. The seller was told.' : 'Marked as not verified. The seller was told.', 'success');
    onChanged();
  };
  return (
    <div className="assistant-form">
      <div className="approval-head"><Badge status={STATUS[account.status]} /><span className="muted">Saved {dateTime(account.createdAt)}{account.reviewedBy && ` · reviewed by ${account.reviewedBy}`}</span></div>
      <dl className="order-facts order-facts--row">
        <div><dt>{account.kind === 'bank' ? 'Bank' : 'E-wallet'}</dt><dd>{account.provider}</dd></div>
        <div><dt>{account.kind === 'bank' ? 'Account number' : 'Registered mobile'}</dt><dd className="valid-id__number">{account.number}</dd></div>
        <div><dt>Account holder</dt><dd>{account.holderName}</dd></div>
        {account.accountType && <div><dt>Bank account type</dt><dd>{account.accountType}</dd></div>}
      </dl>
      <h3>Seller</h3>
      <dl className="order-facts order-facts--row">
        <div><dt>Shop</dt><dd>{account.owner.shopName || account.seller}</dd></div>
        <div><dt>Registered owner</dt><dd>{account.owner.name || '—'}</dd></div>
        <div><dt>Business name</dt><dd>{account.owner.businessName || '—'}</dd></div>
      </dl>
      <p className="muted">Check that the account belongs to the seller (the holder name matches the owner or business), for example with a small test transfer.</p>
      {account.reviewNote && <p className="order-card__note"><strong>Reason:</strong> {account.reviewNote}</p>}
      {account.status === 'pending' && (
        <div className="order-card__actions">
          <button className="btn-mini btn-mini--primary" type="button" onClick={() => confirmModal({ title: `Verify ${account.provider} ${account.number}`, body: 'The seller can then withdraw to this account.', label: 'Verify Account', run: () => review('verify') })}>Verify</button>
          <button className="btn-mini btn-mini--danger" type="button" onClick={() => Modal.open({ title: 'Not verified', content: <RejectForm onSubmit={(note) => review('reject', note)} /> })}>Not Verified</button>
        </div>
      )}
    </div>
  );
}

function ProviderForm({ provider, onSaved }) {
  const [values, setValues] = useState({ kind: provider?.kind || 'bank', name: provider?.name || '', minDigits: String(provider?.minDigits ?? 10), maxDigits: String(provider?.maxDigits ?? 12) });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (name) => (e) => setValues({ ...values, [name]: e.target.value });
  return (
    <form
      className="assistant-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          if (provider) await postAdmin(`/payout-providers/${provider.id}`, { ...values, active: provider.active }, 'PATCH');
          else await postAdmin('/payout-providers', values);
          Modal.close();
          toast(provider ? 'Provider updated.' : 'Provider added. Sellers can choose it now.', 'success');
          onSaved();
        } catch (err) {
          setErrors(err.fields || { name: err.message });
          setBusy(false);
        }
      }}
    >
      {!provider && (
        <div className="field">
          <label htmlFor="provider-kind">Type</label>
          <select id="provider-kind" value={values.kind} onChange={set('kind')}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
      )}
      <TextField id="provider-name" label="Name" required value={values.name} error={errors.name} onChange={set('name')} />
      {values.kind === 'bank' && (
        <>
          <TextField id="provider-min" label="Fewest digits in an account number" inputMode="numeric" value={values.minDigits} error={errors.minDigits} onChange={set('minDigits')} />
          <TextField id="provider-max" label="Most digits in an account number" inputMode="numeric" value={values.maxDigits} error={errors.maxDigits} hint="6 to 20." onChange={set('maxDigits')} />
        </>
      )}
      <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Saving…' : provider ? 'Save Provider' : 'Add Provider'}</button>
    </form>
  );
}

function Providers() {
  const [providers, setProviders] = useState(null);
  const load = useCallback(() => adminFetch('/payout-providers').then((body) => setProviders(body.providers)).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!providers) return <div className="skeleton" role="status" aria-label="Loading providers" />;
  const toggle = async (p) => {
    try {
      await postAdmin(`/payout-providers/${p.id}`, { ...p, active: !p.active }, 'PATCH');
      toast(p.active ? `${p.name} is hidden from new accounts. Saved ones keep working.` : `${p.name} is available again.`, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <section className="panel" aria-labelledby="providers-title">
      <div className="panel__head">
        <h2 id="providers-title">Banks and E-Wallets</h2>
        <span className="muted">What sellers can choose when they add an account</span>
        <button className="btn-mini btn-mini--primary income-head-action" type="button" onClick={() => Modal.open({ title: 'Add a provider', content: <ProviderForm onSaved={load} /> })}>Add Provider</button>
      </div>
      <div className="admin-table" role="region" aria-label="Payout providers" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Account number</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.name}</th>
                <td>{KINDS[p.kind]}</td>
                <td>{p.kind === 'ewallet' ? 'Mobile number' : p.minDigits === p.maxDigits ? `${p.minDigits} digits` : `${p.minDigits} to ${p.maxDigits} digits`}</td>
                <td><Badge status={p.active ? { label: 'Offered', tone: 'ok' } : { label: 'Hidden', tone: 'neutral' }} /></td>
                <td>
                  <span className="order-card__actions">
                    <button className="btn-mini" type="button" onClick={() => Modal.open({ title: `Edit ${p.name}`, content: <ProviderForm provider={p} onSaved={load} /> })}>Edit</button>
                    <button className="btn-mini" type="button" onClick={() => toggle(p)}>{p.active ? 'Hide' : 'Offer'}</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AdminPayoutAccounts({ initial }) {
  const list = useAdminList('/payout-accounts', initial);
  useRefresh(list.reload);
  const counts = list.data?.counts || {};
  const open = (row) => Modal.open({ title: `${row.seller}: ${row.provider}`, variant: 'wide', content: <AccountDetail id={row.id} onChanged={list.reload} /> });
  return (
    <div className="order-page admin-page">
      <PageHead title="Payout Accounts" text="Verify sellers' bank and e-wallet accounts before withdrawals can go to them, and manage the providers sellers can choose." />
      <Tabs list={list} name="status" label="Filter accounts" tabs={[['', 'All'], ...Object.entries(STATUS).map(([key, s]) => [key, s.label, counts[key]])]} />
      <FilterBar list={list} placeholder="Seller, holder name, provider or last 4 digits" exportable={false} />
      <DataTable
        list={list}
        label="Seller payout accounts"
        empty="No accounts here"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Seller', render: (row) => <button className="link" type="button" onClick={() => open(row)}>{row.seller}</button> },
          { label: 'Provider', render: (row) => <>{row.provider}<small className="muted"> {row.kindLabel}</small></> },
          { label: 'Account', render: (row) => row.number },
          { label: 'Holder', render: (row) => row.holderName },
          { label: 'Status', render: (row) => <><Badge status={STATUS[row.status]} />{row.isDefault && <small className="muted"> default</small>}</> },
          { label: 'Updated', render: (row) => dateTime(row.updatedAt) },
        ]}
      />
      <Providers />
    </div>
  );
}
