'use client';

// Pickup Requests in Seller Centre: every request and where it stands.

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { dateOnly, dateTime, DataTable, FilterBar, Tabs, useAdminList, useRefresh } from './admin/AdminUI';
import { Badge, FormModal, tomorrow } from './SellerOrders';
import { confirmModal } from './SellerProducts';
import { options, PICKUP_STATUS } from '@/lib/adminLabels';
import { SHIPPING_ZONES } from '@/lib/data';
import { logisticsOptions, send } from '@/lib/productsApi';
import { pickupScheduleSchema } from '@/lib/schemas';
import { Modal, peso, toast } from '@/lib/ui';

const CLIENT = { fetch: (url) => send(`/api/seller${url}`), base: '/api/seller' };
const CHANGEABLE = ['awaiting_payment', 'pending', 'scheduled', 'failed'];

const post = (id, data) => send(`/api/seller/pickups/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

function openReschedule(pickup, reload) {
  Modal.open({
    title: `Reschedule ${pickup.orderId}`,
    content: (
      <FormModal
        id="pickup-reschedule"
        schema={pickupScheduleSchema(pickup, tomorrow())}
        submitLabel="Reschedule"
        onSubmit={async ({ date, slot }) => {
          await post(pickup.id, { action: 'reschedule', date, slot });
          Modal.close();
          toast(pickup.courier ? `Rescheduled with ${pickup.courier}.` : 'Your schedule was updated.', 'success');
          reload();
        }}
      />
    ),
  });
}

function openCancel(pickup, reload) {
  confirmModal({
    title: `Cancel pickup for ${pickup.orderId}`,
    body: 'The order stays open, and you can request a pickup again.',
    label: 'Cancel Pickup',
    danger: true,
    run: async () => {
      await post(pickup.id, { action: 'cancel' });
      toast('Pickup cancelled.', 'success');
      reload();
    },
  });
}

function openDetail(pickup) {
  const { weight, parcels, note } = pickup.parcel;
  Modal.open({
    title: `Pickup for ${pickup.orderId}`,
    content: (
      <dl className="order-facts">
        <div><dt>Status</dt><dd><Badge status={PICKUP_STATUS[pickup.status]} /></dd></div>
        {pickup.reviewNote && <div><dt>Onetap said</dt><dd>{pickup.reviewNote}</dd></div>}
        {pickup.failedReason && <div><dt>Courier said</dt><dd>{pickup.failedReason}</dd></div>}
        <div><dt>Handover</dt><dd>{pickup.method}</dd></div>
        <div><dt>Schedule</dt><dd>{dateOnly(pickup.scheduledFor)}{pickup.slot && `, ${pickup.slot}`}</dd></div>
        <div><dt>Pickup address</dt><dd>{pickup.address}</dd></div>
        <div><dt>Contact</dt><dd>{pickup.contactName || '—'}{pickup.contactPhone && `, ${pickup.contactPhone}`}</dd></div>
        {weight && <div><dt>Parcel</dt><dd>{parcels} parcel{parcels === 1 ? '' : 's'}, {weight} kg{note && `. ${note}`}</dd></div>}
        <div><dt>Courier</dt><dd>{pickup.courier || 'Not assigned yet'}</dd></div>
        <div><dt>Booking reference</dt><dd>{pickup.bookingRef || '—'}</dd></div>
        {pickup.pickedUpAt && <div><dt>Picked up</dt><dd>{dateTime(pickup.pickedUpAt)}</dd></div>}
      </dl>
    ),
  });
}

// Every active courier offered to sellers, as Onetap holds it right now.
function AvailableCouriers() {
  const [couriers, setCouriers] = useState(null);
  const load = useCallback(() => logisticsOptions().then((partners) => setCouriers(partners.filter((partner) => partner.forSellers))).catch(() => {}), []);
  useRefresh(load);

  if (!couriers) return null;
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Available Couriers</h2>
        <p className="panel__note">Updates every 15 seconds.</p>
      </div>
      {couriers.length === 0 ? <p className="muted">No courier is available right now.</p> : (
        <div className="admin-table" role="region" aria-label="Available couriers" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Courier</th><th scope="col">Services</th><th scope="col">Service coverage</th><th scope="col">Pickup locations</th><th scope="col">Delivery locations</th><th scope="col">{SHIPPING_ZONES[0]} rate</th></tr></thead>
            <tbody>
              {couriers.map((courier) => (
                <tr key={courier.id}>
                  <td>{courier.name}</td>
                  <td>{courier.services.join(', ')}</td>
                  <td>{courier.zones.join(', ') || 'None'}</td>
                  <td>{courier.pickupLocations.join(', ') || 'None'}</td>
                  <td>{courier.deliveryLocations.join(', ') || 'None'}</td>
                  <td>{peso(Number(courier.base[SHIPPING_ZONES[0]]))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function SellerPickups({ initial }) {
  const list = useAdminList('/pickups', initial, CLIENT);
  const counts = list.data?.counts || {};
  useRefresh(list.reload);

  return (
    <div className="order-page admin-page">
      <div className="order-head">
        <div>
          <h1 tabIndex={-1}>Pickup Requests</h1>
          <p className="muted">Track each request from approval to collection. New requests start from <Link className="link" href="/seller/orders/to-ship">To Ship</Link>.</p>
        </div>
      </div>
      <AvailableCouriers />
      <Tabs list={list} name="status" label="Filter by status" tabs={[['', 'All'], ...options(PICKUP_STATUS).map(([value, label]) => [value, label, counts[value] || 0])]} />
      <FilterBar list={list} placeholder="Order or booking reference" exportable={false} />
      <DataTable
        list={list}
        label="Pickup requests"
        empty="No pickup requests yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Order', render: (row) => <button className="link" type="button" onClick={() => openDetail(row)}>{row.orderId}</button> },
          { label: 'Handover', render: (row) => row.method },
          { label: 'Schedule', sort: 'scheduled', render: (row) => <>{dateOnly(row.scheduledFor)}{row.slot && <small className="admin-cell-note">{row.slot}</small>}</> },
          { label: 'Courier', sort: 'courier', render: (row) => row.courier || 'Not assigned yet' },
          { label: 'Rider', render: (row) => (row.rider ? <>{row.rider.rider}<small className="admin-cell-note">{row.rider.phone}</small></> : '—') },
          { label: 'Status', sort: 'status', render: (row) => <Badge status={PICKUP_STATUS[row.status]} /> },
          {
            label: 'Actions',
            render: (row) => (CHANGEABLE.includes(row.status) ? (
              <span className="order-card__actions">
                <button className="btn-mini" type="button" onClick={() => openReschedule(row, list.reload)}>Reschedule<span className="sr-only"> {row.orderId}</span></button>
                <button className="btn-mini" type="button" onClick={() => openCancel(row, list.reload)}>Cancel<span className="sr-only"> pickup for {row.orderId}</span></button>
              </span>
            ) : <Link className="btn-mini" href={`/seller/orders/${row.orderId}`}>View Order<span className="sr-only"> {row.orderId}</span></Link>),
          },
        ]}
      />
    </div>
  );
}
