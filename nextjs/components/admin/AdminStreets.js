'use client';

// Street Requests in the Admin Console: missing streets reported from address forms, and each
// barangay's street list. Approving adds a street to its barangay, rejecting asks for a reason.
// Administrators can also add a street they have checked, or hide a wrong one. The server decides
// everything and audits it.

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, Badge, dateTime, DataTable, FilterBar, PageHead, postAdmin, SelectFilter, Tabs, useAdminList, useRefresh } from './AdminUI';
import { STREET_REQUEST_STATUS, STREET_SOURCE } from '@/lib/adminLabels';
import { BARANGAYS } from '@/lib/address';
import { Modal, toast } from '@/lib/ui';

function RejectStreet({ request, onDone }) {
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
          await postAdmin(`/streets/requests/${request.id}`, { action: 'reject', reason });
          toast(`${request.name} was rejected.`, 'success');
          Modal.close();
          onDone();
        } catch (err) {
          setError(err.fields?.reason || err.message);
        }
        setBusy(false);
      }}
    >
      <div className="field">
        <label htmlFor="street-reason">Why isn&apos;t {request.name} a street in {request.barangay}?</label>
        <textarea id="street-reason" rows={3} minLength={5} maxLength={300} required aria-invalid={Boolean(error)} aria-describedby="street-reason-hint" value={reason} onChange={(e) => setReason(e.target.value)} />
        <small className="field__hint" id="street-reason-hint">{request.username ? 'The person who reported it sees this. ' : ''}{request.inUse ? `${request.inUse} saved address${request.inUse === 1 ? ' uses' : 'es use'} it and will be asked to choose another street. ` : ''}5 to 300 characters.</small>
        {error && <small className="field__error" role="alert">{error}</small>}
      </div>
      <button className="btn btn--primary btn--block" type="submit" disabled={busy}>Reject Street</button>
    </form>
  );
}

function StreetList() {
  const [barangay, setBarangay] = useState(BARANGAYS[0]);
  const [streets, setStreets] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => adminFetch(`/streets?barangay=${encodeURIComponent(barangay)}`).then((body) => setStreets(body.streets), (err) => toast(err.message, 'error')), [barangay]);
  useEffect(() => {
    setStreets(null);
    load();
  }, [load]);

  async function change(data, done) {
    setBusy(true);
    try {
      const body = await postAdmin('/streets', data);
      setStreets(body.streets);
      toast(done, 'success');
      return true;
    } catch (err) {
      toast(err.fields?.name || err.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const shown = streets?.filter((street) => !street.hidden).length ?? 0;
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Street List</h2>
        <label className="admin-select">
          <span className="sr-only">Barangay</span>
          <select value={barangay} onChange={(e) => setBarangay(e.target.value)}>
            {BARANGAYS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </div>
      <p className="muted">{streets ? `${shown} street${shown === 1 ? '' : 's'} offered in ${barangay}.` : 'Loading…'} Hidden streets can&apos;t be chosen, and addresses that use one are asked to choose again.</p>
      <form
        className="street-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await change({ action: 'add', barangay, name }, `${name.trim()} added to ${barangay}.`)) setName('');
        }}
      >
        <label className="sr-only" htmlFor="street-add-name">Street name</label>
        <input id="street-add-name" type="text" maxLength={80} required placeholder={`Add a checked street to ${barangay}`} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-mini btn-mini--primary" type="submit" disabled={busy}>Add Street</button>
      </form>
      {streets && (
        <div className="admin-table" role="region" aria-label={`Streets in ${barangay}`} tabIndex={0}>
          <table>
            <caption className="sr-only">Streets in {barangay}</caption>
            <thead><tr><th scope="col">Street</th><th scope="col">Source</th><th scope="col">Addresses</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {streets.length === 0 && <tr><td colSpan={5} className="muted">No streets listed yet. Approved reports and streets you add appear here.</td></tr>}
              {streets.map((street) => (
                <tr key={street.id}>
                  <td>{street.name}</td>
                  <td>{STREET_SOURCE[street.source] || street.source}</td>
                  <td>{street.inUse}</td>
                  <td>{street.hidden ? 'Hidden' : 'Offered'}</td>
                  <td><button className="btn-mini" type="button" disabled={busy} onClick={() => change({ action: street.hidden ? 'show' : 'hide', id: street.id }, street.hidden ? `${street.name} is offered again.` : `${street.name} is hidden.`)}>{street.hidden ? 'Show' : 'Hide'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AdminStreets({ initial }) {
  const list = useAdminList('/streets/requests', { tab: 'pending', ...initial });
  useRefresh(list.reload);
  const counts = list.data?.counts || {};
  const source = list.data?.source;

  async function approve(row) {
    try {
      await postAdmin(`/streets/requests/${row.id}`, { action: 'approve' });
      toast(`${row.name} added to ${row.barangay}.`, 'success');
      list.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="order-page admin-page">
      <PageHead title="Street Requests" text="Streets reported missing from address forms. Check each one, for example against the barangay hall or a map, before approving it." />
      <Tabs list={list} label="Filter requests" tabs={[['pending', 'Pending', counts.pending], ['approved', 'Approved', counts.approved], ['rejected', 'Rejected', counts.rejected], ['', 'All']]} />
      <FilterBar list={list} placeholder="Street, barangay, username or note">
        <SelectFilter list={list} name="barangay" label="Barangay" options={BARANGAYS.map((name) => [name, name])} />
      </FilterBar>
      <DataTable
        list={list}
        label="Street requests"
        empty="No street requests here"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Street', sort: 'name', render: (row) => <>{row.name}{row.note && <small className="admin-cell-note">{row.note}</small>}</> },
          { label: 'Barangay', sort: 'barangay', render: (row) => row.barangay },
          { label: 'Reported by', render: (row) => (row.username ? `${row.role} ${row.username}` : 'Someone signing up') },
          { label: 'In use', render: (row) => row.inUse },
          { label: 'Reported', sort: 'created', render: (row) => dateTime(row.createdAt) },
          { label: 'Status', render: (row) => <>{<Badge status={STREET_REQUEST_STATUS[row.status]} />}{row.reason && <small className="admin-cell-note">{row.reason}</small>}{row.decidedBy && <small className="admin-cell-note">{dateTime(row.decidedAt)} · {row.decidedBy}</small>}</> },
          {
            label: 'Actions',
            render: (row) => (row.status === 'pending' ? (
              <div className="order-card__actions">
                <button className="btn-mini btn-mini--primary" type="button" onClick={() => approve(row)}>Approve</button>
                <button className="btn-mini" type="button" onClick={() => Modal.open({ title: `Reject ${row.name}`, content: <RejectStreet request={row} onDone={list.reload} /> })}>Reject</button>
              </div>
            ) : '—'),
          },
        ]}
      />
      <StreetList />
      {source && <p className="muted admin-source">Street list started from {source.source} ({source.method}) {source.license}.</p>}
    </div>
  );
}
