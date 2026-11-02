'use client';

// Pickup Approval and Shipment Monitoring.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { openWaybill, ProofPhotos } from '../SellerOrders';
import { confirmModal } from '../SellerProducts';
import { adminFetch, Badge, dateOnly, dateTime, DataTable, DateFilter, FilterBar, PageHead, postAdmin, SandboxBanner, SelectFilter, Tabs, TextField, useAdminList } from './AdminUI';
import { options, PICKUP_STATUS, SHIPMENT_STATUS, TASK_KIND, TASK_STATUS } from '@/lib/adminLabels';
import { Modal, peso, toast } from '@/lib/ui';

function usePartnerOptions() {
  const [partners, setPartners] = useState([]);
  useEffect(() => {
    fetch('/api/logistics/options').then((r) => r.json()).then((body) => setPartners(body.partners.map((p) => [p.id, p.name]))).catch(() => {});
  }, []);
  return partners;
}

function RescheduleForm({ pickup, onDone }) {
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await postAdmin(`/pickups/${pickup.id}`, { action: 'reschedule', date });
      Modal.close();
      toast('Pickup rescheduled with the courier.', 'success');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
      setSaving(false);
    }
  }
  return (
    <form className="assistant-form" onSubmit={submit}>
      <TextField id="pickup-date" label="New pickup date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Sending to courier…' : 'Reschedule Pickup'}</button>
    </form>
  );
}

function RejectForm({ pickup, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await postAdmin(`/pickups/${pickup.id}`, { action: 'reject', reason });
      Modal.close();
      toast('Request rejected. The seller was notified.', 'success');
      onDone();
    } catch (err) {
      setError(err.fields?.reason || err.message);
      setSaving(false);
    }
  }
  return (
    <form className="assistant-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="pickup-reject">Why is this request rejected?</label>
        <textarea id="pickup-reject" rows={4} minLength={10} maxLength={300} required aria-invalid={Boolean(error)} value={reason} onChange={(e) => setReason(e.target.value)} />
        <small className="field__hint">The seller sees this. 10 to 300 characters.</small>
        {error && <small className="field__error">{error}</small>}
      </div>
      <button className="btn btn--danger btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Reject Request'}</button>
    </form>
  );
}

function CourierChoice({ couriers, value, onChange }) {
  const best = couriers.find((row) => row.recommended);
  return (
    <fieldset className="choice choice--stack">
      <legend>Assign a courier</legend>
      <label><input type="radio" name="courier" value="auto" checked={value === 'auto'} disabled={!best} onChange={() => onChange('auto')} /> Automatic{best && `: ${best.name}, ${peso(best.fee)}`}</label>
      {couriers.map((row) => (
        <label key={row.id}>
          <input type="radio" name="courier" value={row.id} checked={value === row.id} disabled={!row.eligible} onChange={() => onChange(row.id)} />
          {row.name}, {row.fee === null ? 'no rate' : peso(row.fee)}{row.environment === 'sandbox' && ' (Sandbox)'}{row.problem && `. ${row.problem}`}
        </label>
      ))}
    </fieldset>
  );
}

function PickupDetail({ id, onChanged }) {
  const [pickup, setPickup] = useState(null);
  const [error, setError] = useState('');
  const [courier, setCourier] = useState('auto');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => adminFetch(`/pickups/${id}`).then((body) => setPickup(body.pickup), (err) => setError(err.message)), [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(payload, message) {
    setBusy(true);
    try {
      const { pickup: next } = await postAdmin(`/pickups/${id}`, payload);
      setPickup(next);
      toast(message(next), next.bookingError ? 'error' : 'success');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
      await load();
    }
    setBusy(false);
  }

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!pickup) return <div className="skeleton" role="status" aria-label="Loading pickup request" />;

  const { weight, parcels, note } = pickup.parcel;
  const booked = (next) => (next.status === 'scheduled' ? `Booked with ${next.courier}. The seller was notified.` : `Approved, but ${next.courier || 'the courier'} has not confirmed. ${next.bookingError}`);
  const open = ['awaiting_payment', 'scheduled', 'confirmed', 'failed'].includes(pickup.status);

  return (
    <div className="assistant-form">
      <dl className="order-facts order-facts--row">
        <div><dt>Status</dt><dd><Badge status={PICKUP_STATUS[pickup.status]} /></dd></div>
        <div><dt>Handover</dt><dd>{pickup.method}</dd></div>
        <div><dt>Preferred schedule</dt><dd>{dateOnly(pickup.scheduledFor)}{pickup.slot && `, ${pickup.slot}`}</dd></div>
        <div><dt>Seller</dt><dd>{pickup.seller} ({pickup.sellerUsername})</dd></div>
        <div><dt>Contact</dt><dd>{pickup.contactName || '—'}{pickup.contactPhone && `, ${pickup.contactPhone}`}</dd></div>
        <div><dt>Pickup address</dt><dd>{pickup.address}{pickup.area && ` (${pickup.area})`}</dd></div>
        {weight && <div><dt>Parcel</dt><dd>{parcels} parcel{parcels === 1 ? '' : 's'}, {weight} kg{note && `. ${note}`}</dd></div>}
        <div><dt>Contents</dt><dd>{pickup.order.items.map((item) => `${item.qty} x ${item.name}`).join(', ')}</dd></div>
        <div><dt>Deliver to</dt><dd>{pickup.order.deliverTo} ({pickup.order.zone})</dd></div>
        <div><dt>Payment</dt><dd>{pickup.order.payment}, {peso(pickup.order.total)}</dd></div>
        <div><dt>Courier</dt><dd>{pickup.courier || 'Not assigned'}{pickup.preferredCourier && ` (seller prefers ${pickup.preferredCourier})`}</dd></div>
        <div><dt>Booking reference</dt><dd>{pickup.bookingRef || '—'}</dd></div>
        <div><dt>Courier confirmation</dt><dd>{pickup.confirmation || '—'}</dd></div>
        {pickup.reviewedBy && <div><dt>Reviewed by</dt><dd>{pickup.reviewedBy}, {dateTime(pickup.reviewedAt)}</dd></div>}
        {pickup.reviewNote && <div><dt>Rejection reason</dt><dd>{pickup.reviewNote}</dd></div>}
        {pickup.failedReason && <div><dt>Courier said</dt><dd>{pickup.failedReason}</dd></div>}
      </dl>
      {pickup.order.cancelPending && <p className="admin-banner" role="note"><strong>The buyer asked to cancel.</strong> This can&apos;t be approved until the seller answers.</p>}
      {pickup.bookingError && <p className="form-error" role="alert">{pickup.bookingError} {pickup.retries < 5 ? 'Onetap retries automatically.' : 'Automatic retries have stopped.'}</p>}
      {pickup.canApprove && (
        <>
          {pickup.couriers.length > 0 && <CourierChoice couriers={pickup.couriers} value={courier} onChange={setCourier} />}
          <div className="order-card__actions">
            <button className="btn-mini btn-mini--primary" type="button" disabled={busy || pickup.order.cancelPending} onClick={() => act({ action: 'approve', courier }, booked)}>{busy ? 'Booking…' : 'Approve and Book'}</button>
            <button className="btn-mini btn-mini--danger" type="button" disabled={busy} onClick={() => Modal.open({ title: `Reject ${pickup.orderId}`, content: <RejectForm pickup={pickup} onDone={onChanged} /> })}>Reject</button>
          </div>
        </>
      )}
      {pickup.status === 'approved' && (
        <div className="order-card__actions">
          <button className="btn-mini btn-mini--primary" type="button" disabled={busy} onClick={() => act({ action: 'retry' }, booked)}>Retry Booking</button>
          <button className="btn-mini" type="button" disabled={busy} onClick={() => act({ action: 'return' }, () => 'Back in review. Choose another courier.')}>Change Courier</button>
        </div>
      )}
      {open && (
        <div className="order-card__actions">
          <button className="btn-mini btn-mini--primary" type="button" onClick={() => Modal.open({ title: `Reschedule ${pickup.orderId}`, content: <RescheduleForm pickup={pickup} onDone={onChanged} /> })}>Reschedule</button>
          {['scheduled', 'failed'].includes(pickup.status) && <button className="btn-mini" type="button" disabled={busy} onClick={() => act({ action: 'return' }, () => 'Booking released. Choose another courier.')}>Change Courier</button>}
          <button
            className="btn-mini btn-mini--danger"
            type="button"
            onClick={() => confirmModal({
              title: `Cancel pickup for ${pickup.orderId}`,
              body: 'The courier booking stays open, and the seller can request pickup again.',
              label: 'Cancel Pickup',
              danger: true,
              run: async () => {
                await postAdmin(`/pickups/${pickup.id}`, { action: 'cancel' });
                toast('Pickup cancelled.', 'success');
                onChanged();
              },
            })}
          >
            Cancel Pickup
          </button>
        </div>
      )}
      <p className="muted">Confirmed and picked up can only come from the courier, so they can&apos;t be set by hand.</p>
    </div>
  );
}

export function AdminPickups({ initial }) {
  const list = useAdminList('/pickups', initial);
  const partners = usePartnerOptions();
  const counts = list.data?.counts || {};
  const openPickup = (row) => Modal.open({ title: `Pickup for ${row.orderId}`, variant: 'wide', content: <PickupDetail id={row.id} onChanged={list.reload} /> });

  async function setReview(reviewRequired) {
    try {
      await postAdmin('/pickups', { reviewRequired });
      toast(reviewRequired ? 'Every pickup now waits for your approval.' : 'Pickups now go to couriers automatically.', 'success');
      list.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="order-page admin-page">
      <PageHead title="Pickup Approval" text={list.data?.reviewRequired ? 'Review seller schedules and assign a courier. Nothing reaches a courier until you approve it.' : 'Seller schedules go to a courier automatically. Anything no courier can take waits here for you.'} />
      <SandboxBanner />
      {list.data && <label className="switch"><input type="checkbox" checked={list.data.reviewRequired} onChange={(e) => setReview(e.target.checked)} /><span>Review every pickup before it reaches a courier</span></label>}
      <Tabs list={list} name="status" label="Filter by status" tabs={[['', 'All'], ...options(PICKUP_STATUS).map(([value, label]) => [value, label, counts[value] || 0])]} />
      <FilterBar list={list} placeholder="Order, seller or booking reference">
        <SelectFilter list={list} name="partner" label="Courier" options={partners} />
        <DateFilter list={list} name="from" label="From" />
        <DateFilter list={list} name="to" label="To" />
      </FilterBar>
      <DataTable
        list={list}
        label="Pickups"
        empty="No pickups here yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Order', render: (row) => <button className="link" type="button" onClick={() => openPickup(row)}>{row.orderId}</button> },
          { label: 'Seller', sort: 'seller', render: (row) => row.seller },
          { label: 'Contact', render: (row) => row.contactPhone || '—' },
          { label: 'Handover', render: (row) => row.method },
          { label: 'Courier', sort: 'courier', render: (row) => row.courier || 'Not assigned' },
          { label: 'Schedule', sort: 'scheduled', render: (row) => <>{dateOnly(row.scheduledFor)}{row.slot && <small className="admin-cell-note">{row.slot}</small>}</> },
          { label: 'Status', sort: 'status', render: (row) => <Badge status={PICKUP_STATUS[row.status]} /> },
          { label: 'Booking ref', render: (row) => row.bookingRef || '—' },
          { label: 'Problem', render: (row) => row.bookingError || row.failedReason },
        ]}
      />
    </div>
  );
}

const REASONS = { failed_delivery: 'Buyer not available', pickup_failed: 'Seller not available', pickup_rejected: 'No capacity on this date', return_to_sender: 'Buyer refused the parcel' };

function ShipmentDetail({ id, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => adminFetch(`/shipments/${id}`).then(({ shipment }) => setData(shipment), (err) => setError(err.message)), [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(payload, message) {
    setBusy(true);
    try {
      const result = await postAdmin(`/shipments/${id}`, payload);
      toast(message(result), 'success');
      await load();
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  }

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!data) return <div className="skeleton" role="status" aria-label="Loading shipment" />;

  const waybill = () => openWaybill({
    id: data.orderId, tracking: data.tracking, bookingRef: data.bookingRef, sandbox: data.sandbox, courier: data.courier, method: data.method, payment: data.cod ? 'Cash on Delivery' : 'Prepaid', paid: !data.cod, total: data.total,
    buyer: { name: data.customer, phone: data.phone, address: data.address }, items: data.items,
  });

  return (
    <div className="assistant-form">
      {data.sandbox && <p className="admin-banner" role="note"><strong>Sandbox shipment.</strong> No real parcel exists.</p>}
      <dl className="order-facts order-facts--row">
        <div><dt>Status</dt><dd><Badge status={SHIPMENT_STATUS[data.status]} /></dd></div>
        <div><dt>Tracking</dt><dd>{data.tracking || 'Not booked yet'}</dd></div>
        <div><dt>Booking reference</dt><dd>{data.bookingRef || '—'}</dd></div>
        <div><dt>Courier</dt><dd>{data.courier} ({data.method})</dd></div>
        <div><dt>Estimated delivery</dt><dd>{dateOnly(data.eta)}{data.delayed && ' (delayed)'}</dd></div>
        <div><dt>Order total</dt><dd>{peso(data.total)}{data.cod ? ' COD' : ''}</dd></div>
        <div><dt>Seller</dt><dd>{data.seller}</dd></div>
        <div><dt>Customer</dt><dd>{data.customer}</dd></div>
        <div><dt>Deliver to</dt><dd>{data.address}</dd></div>
        {data.pickedUpAt && <div><dt>Picked up</dt><dd>{dateTime(data.pickedUpAt)}</dd></div>}
        {data.deliveredAt && <div><dt>Delivered</dt><dd>{dateTime(data.deliveredAt)}</dd></div>}
        {data.proof?.receivedBy && <div><dt>Received by</dt><dd>{data.proof.receivedBy.name} (rider, {data.proof.receivedBy.phone})</dd></div>}
        {data.proof?.receiver && <div><dt>Recipient</dt><dd>{data.proof.receiver}{data.proof.relationship && ` (${data.proof.relationship})`}</dd></div>}
        {data.proof?.deliveredBy && <div><dt>Confirmed by</dt><dd>{data.proof.deliveredBy}</dd></div>}
      </dl>
      <ProofPhotos proof={data.proof} />
      {data.lastError && <p className="form-error">{data.lastError}</p>}
      {data.siblings.length > 0 && (
        <p className="muted">Same checkout: {data.siblings.map((s) => `${s.order_id} (${s.partner_name}, ${SHIPMENT_STATUS[s.status].label})`).join(', ')}</p>
      )}
      <div className="order-card__actions">
        {data.tracking && <button className="btn-mini" type="button" onClick={waybill}>Print Waybill</button>}
        {data.trackingUrl && <a className="btn-mini" href={data.trackingUrl} target="_blank" rel="noopener noreferrer">Courier Tracking</a>}
        {data.tracking && <button className="btn-mini" type="button" disabled={busy} onClick={() => act({ action: 'sync' }, ({ applied }) => (applied ? `${applied} updates applied.` : 'Already up to date.'))}>Sync with Courier</button>}
        {data.investigating && <button className="btn-mini" type="button" disabled={busy} onClick={() => act({ action: 'resolve' }, () => 'Investigation closed.')}>Close Investigation</button>}
      </div>
      {data.sandbox && data.nextEvents.length > 0 && (
        <section>
          <h3>Simulate courier report</h3>
          <p className="muted">Sends a signed webhook through the real verification path.</p>
          <div className="order-card__actions admin-simulate">
            {data.nextEvents.map((status) => (
              <button className="btn-mini" type="button" key={status} disabled={busy} onClick={() => act({ action: 'simulate', status, reason: REASONS[status], location: 'Sandbox hub' }, ({ outcome }) => `Courier report ${outcome}.`)}>{SHIPMENT_STATUS[status].label}</button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3>Courier riders</h3>
        {data.riderTasks.length ? (
          <ol className="timeline order-timeline">
            {data.riderTasks.map((task) => (
              <li className="is-done" key={task.id}>
                {TASK_KIND[task.kind]}: {task.rider}, {task.phone} <Badge status={TASK_STATUS[task.status]} />{task.note && ` ${task.note}`}
                <small>Assigned {dateTime(task.assignedAt)} by {task.assignedBy}{task.finishedAt && ` · ended ${dateTime(task.finishedAt)}`}</small>
              </li>
            ))}
          </ol>
        ) : <p className="muted">{data.courier} hasn&apos;t assigned a rider yet.</p>}
      </section>
      <section>
        <h3>Investigation notes</h3>
        {data.notes.map((item) => <p className="muted" key={item.at}><strong>{item.admin}</strong> · {dateTime(item.at)}: {item.text}</p>)}
        <div className="field">
          <label htmlFor="shipment-note">Add a note</label>
          <textarea id="shipment-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button
          className="btn-mini"
          type="button"
          disabled={busy || !note.trim()}
          onClick={() => {
            act({ action: 'note', note }, () => 'Note added.');
            setNote('');
          }}
        >
          Add Note
        </button>
      </section>
      <section>
        <h3>Tracking history</h3>
        <ol className="timeline order-timeline">
          {data.events.map((event) => (
            <li className="is-done" key={`${event.at}-${event.status}-${event.note}`}>
              {SHIPMENT_STATUS[event.status]?.label || event.status}{event.note && `: ${event.note}`}
              <small>{dateTime(event.at)}{event.location && ` · ${event.location}`} · {event.source}</small>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function AdminShipments({ initial }) {
  const list = useAdminList('/shipments', initial);
  const partners = usePartnerOptions();
  const openDetail = (row) => Modal.open({ title: `Shipment for ${row.orderId}`, variant: 'wide', content: <ShipmentDetail id={row.id} onChanged={list.reload} /> });

  return (
    <div className="order-page admin-page">
      <PageHead title="Shipment Monitoring" text="Every shipment, from booking to delivery." />
      <SandboxBanner />
      <Tabs list={list} name="status" label="Filter by status" tabs={[['', 'All'], ...options(SHIPMENT_STATUS).slice(0, 10)]} />
      <FilterBar list={list} placeholder="Tracking, order, seller or customer">
        <SelectFilter list={list} name="partner" label="Courier" options={partners} />
        <DateFilter list={list} name="from" label="From" />
        <DateFilter list={list} name="to" label="To" />
        <label className="switch"><input type="checkbox" checked={Boolean(list.filters.delayed)} onChange={(e) => list.setFilter('delayed', e.target.checked ? '1' : '')} /><span>Delayed only</span></label>
      </FilterBar>
      <DataTable
        list={list}
        label="Shipments"
        empty="No shipments here yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Tracking', render: (row) => <button className="link" type="button" onClick={() => openDetail(row)}>{row.tracking || 'Not booked'}</button> },
          { label: 'Order', render: (row) => row.orderId },
          { label: 'Courier', sort: 'courier', render: (row) => row.courier },
          { label: 'Status', sort: 'status', render: (row) => <><Badge status={SHIPMENT_STATUS[row.status]} />{row.delayed && <> <Badge status={{ label: 'Delayed', tone: 'danger' }} /></>}{row.investigating && <> <Badge status={{ label: 'Investigating', tone: 'warn' }} /></>}</> },
          { label: 'Seller', render: (row) => row.seller },
          { label: 'Customer', render: (row) => row.customer },
          { label: 'Deliver to', render: (row) => row.address },
          { label: 'Estimated', sort: 'eta', render: (row) => dateOnly(row.eta) },
          { label: 'Updated', sort: 'updated', render: (row) => dateTime(row.updatedAt) },
        ]}
      />
      <p className="muted">Failed bookings stay Pending with the courier&apos;s error, and sellers can retry without creating a duplicate. <Link className="link" href="/admin/api">See API logs</Link></p>
    </div>
  );
}
