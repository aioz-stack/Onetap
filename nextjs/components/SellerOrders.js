'use client';

// Seller order pages: My Orders, To Ship, Return / Refunds / Cancel and order detail.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Form, Sections } from './Forms';
import { QrCode } from './Header';
import Icon from './Icon';
import { confirmModal } from './SellerProducts';
import { awaitingPayment, awaitingPickup, CANCEL_STATUS, FAILED_STATUS, formatDate, hasOpenAction, needsApproval, needsArranging, Orders, paymentLabel, requestStatus, RETURN_STATUS, sellerGroup, sellerStatus, useOrders } from '@/lib/orders';
import { logisticsOptions } from '@/lib/productsApi';
import { PICKUP_STATUS, TASK_STATUS } from '@/lib/adminLabels';
import { pickupRequestSchema, REJECT_SCHEMA, SELLER_CANCEL_SCHEMA } from '@/lib/schemas';
import { Store } from '@/lib/store';
import { Modal, peso, toast } from '@/lib/ui';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function Badge({ status }) {
  return <span className={`order-badge order-badge--${status.tone}`}>{status.label}</span>;
}

export function FormModal({ id, schema, submitLabel, onSubmit, children }) {
  return (
    <Form id={id} onSubmit={onSubmit}>
      {children}
      <Sections schema={schema} prefix={id} />
      <button className="btn btn--primary btn--block order-modal__submit" type="submit">{submitLabel}</button>
    </Form>
  );
}

const dayInManila = (ms) => new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
export const tomorrow = () => dayInManila(new Date().getTime() + 24 * 60 * 60 * 1000);

async function openPickupRequest(orders) {
  const count = orders.length;
  const couriers = (await logisticsOptions().catch(() => [])).filter((partner) => partner.forSellers && partner.pickupLocations.length).map((partner) => partner.name);
  if (!couriers.length) {
    toast('No courier is available right now. Try again soon.', 'error');
    return;
  }
  Modal.open({
    title: count === 1 ? `Set schedule for ${orders[0].id}` : `Set schedule for ${plural(count, 'order')}`,
    variant: 'wide',
    content: (
      <FormModal
        id="pickup-request"
        schema={pickupRequestSchema(couriers, Store.get('session.seller'), tomorrow())}
        submitLabel="Set Schedule"
        onSubmit={async (data) => {
          const failed = await Orders.requestPickup(orders, data);
          Modal.close();
          if (failed.length) toast(`${plural(failed.length, 'schedule')} failed. ${failed[0].error}`, 'error');
          if (failed.length < count) toast(`${plural(count - failed.length, 'schedule')} saved. You'll be notified when the courier responds.`, 'success');
        }}
      >
        <p className="muted order-modal__text">Your schedule goes to a courier once any payment has cleared. Your waybill will be ready when the courier confirms the booking.</p>
      </FormModal>
    ),
  });
}

function openCancel(order) {
  Modal.open({
    title: `Cancel ${order.id}`,
    content: (
      <FormModal
        id="seller-cancel"
        schema={SELLER_CANCEL_SCHEMA}
        submitLabel="Cancel Order"
        onSubmit={async ({ reason }) => {
          await Orders.cancel(order, reason);
          Modal.close();
          toast(`${order.id} was cancelled.`);
        }}
      >
        <p className="muted order-modal__text">The buyer is told why{order.paid ? ` and refunded ${peso(order.total)}` : ''}. This can&apos;t be undone.</p>
      </FormModal>
    ),
  });
}

function openReject(order, title, reject) {
  Modal.open({
    title,
    content: (
      <FormModal
        id="reject"
        schema={REJECT_SCHEMA}
        submitLabel="Send Rejection"
        onSubmit={async ({ note }) => {
          await reject(order, note.trim());
          Modal.close();
          toast('Your response was sent to the buyer.');
        }}
      />
    ),
  });
}

function confirmAction({ title, body, label, run, done }) {
  confirmModal({
    title,
    body,
    label,
    run: async () => {
      await run();
      toast(done, 'success');
    },
  });
}

function OrdersGate({ state, children }) {
  const { orders, loading, error, reload } = state;
  if (loading) {
    return <div className="order-list" role="status" aria-label="Loading orders"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;
  }
  if (error && !orders.length) {
    return (
      <div className="panel order-empty" role="alert">
        <Icon name="box" />
        <h2>We couldn&apos;t load your orders</h2>
        <p className="muted">{error}</p>
        <button className="btn-mini" type="button" onClick={reload}>Try Again</button>
      </div>
    );
  }
  return children;
}

export function openWaybill(order) {
  Modal.open({
    title: 'Waybill',
    content: (
      <>
        <div className="waybill">
          <div className="waybill__head">
            <strong>Onetap</strong>
            <span>{order.courier} · {order.method}</span>
          </div>
          {order.sandbox && <strong className="waybill__sandbox">Sandbox sample. Not a courier-issued waybill.</strong>}
          <div className="waybill__code">
            <QrCode text={order.tracking} label={`QR code for tracking number ${order.tracking}`} />
            <div>
              <small>Tracking number</small>
              <strong>{order.tracking}</strong>
              <small>Order {order.id}</small>
              {order.bookingRef && <small>Booking {order.bookingRef}</small>}
            </div>
          </div>
          <div className="waybill__block">
            <small>Deliver to</small>
            <strong>{order.buyer.name}</strong>
            <span>{order.buyer.phone}</span>
            <span>{order.buyer.address}</span>
          </div>
          <div className="waybill__block">
            <small>Contents</small>
            {order.items.map((item) => <span key={`${item.product}-${item.variation}`}>{item.qty} x {item.name}</span>)}
          </div>
          {order.payment === 'Cash on Delivery' && !order.paid && <strong className="waybill__cod">Collect {peso(order.total)}</strong>}
        </div>
        <button className="btn btn--primary btn--block order-modal__submit" type="button" onClick={() => window.print()}>Print Waybill</button>
      </>
    ),
  });
}

function OrderActions({ order }) {
  const buttons = [];
  const add = (label, onClick, primary) => buttons.push(
    <button className={`btn-mini ${primary ? 'btn-mini--primary' : ''}`} type="button" key={label} onClick={onClick}>
      {label}<span className="sr-only"> for {order.id}</span>
    </button>,
  );

  if (order.cancel?.status === 'pending') {
    add('Approve Cancellation', () => confirmAction({
      title: `Approve cancellation of ${order.id}`,
      body: `The order is cancelled${order.paid ? ` and ${peso(order.total)} goes back to the buyer` : ''}.`,
      label: 'Approve Cancellation',
      run: () => Orders.approveCancel(order),
      done: `${order.id} was cancelled.`,
    }), true);
    add('Reject', () => openReject(order, `Reject cancellation of ${order.id}`, Orders.rejectCancel));
  } else if (needsApproval(order)) {
    add('Approve Order', () => confirmAction({
      title: `Approve ${order.id}`,
      body: 'You confirm that you accept this order and can fulfil it. You set its pickup schedule next.',
      label: 'Approve Order',
      run: () => Orders.approve(order),
      done: 'Order approved. Set its pickup schedule next.',
    }), true);
    add('Cancel Order', () => openCancel(order));
  } else if (['to_ship', 'unpaid'].includes(order.status)) {
    if (!awaitingPickup(order)) add('Set Schedule', () => openPickupRequest([order]), true);
    add('Cancel Order', () => openCancel(order));
  } else if (order.status === 'ready') {
    if (order.shipmentStatus === 'booking_confirmed' && !awaitingPickup(order)) add('Set Schedule', () => openPickupRequest([order]), true);
    add('Print Waybill', () => openWaybill(order));
  } else if (order.failed?.status === 'pending') {
    add('Reattempt Delivery', () => confirmAction({
      title: `Reattempt delivery of ${order.id}`,
      body: `${order.courier} tries again and the order goes back to Shipping.`,
      label: 'Reattempt Delivery',
      run: () => Orders.reattempt(order),
      done: 'Redelivery was requested.',
    }), true);
    add('Return to Seller', () => confirmAction({
      title: `Return ${order.id} to you`,
      body: `${order.courier} sends the parcel back. This can't be undone.`,
      label: 'Return to Seller',
      run: () => Orders.returnToSeller(order),
      done: 'The parcel is on its way back.',
    }));
  } else if (order.failed?.status === 'returning') {
    add('Confirm Parcel Received', () => confirmAction({
      title: `Confirm return of ${order.id}`,
      body: order.paid ? `${peso(order.total)} goes back to the buyer. This can't be undone.` : 'No refund is due because the buyer has not paid.',
      label: 'Confirm Parcel Received',
      run: () => Orders.receiveFailed(order),
      done: order.paid ? 'The refund was released.' : 'The parcel was marked as received.',
    }), true);
  }

  if (order.return?.status === 'pending') {
    const refundOnly = order.return.type === 'Refund Only';
    add(refundOnly ? 'Approve Refund' : 'Approve Return', () => confirmAction({
      title: `${refundOnly ? 'Refund' : 'Approve return for'} ${order.id}`,
      body: refundOnly
        ? `${peso(order.total)} goes back to the buyer now.`
        : `The buyer sends the item back. You refund ${peso(order.total)} once you confirm it arrived.`,
      label: refundOnly ? 'Approve Refund' : 'Approve Return',
      run: () => Orders.approveReturn(order),
      done: refundOnly ? 'The refund was released.' : 'The return was approved.',
    }), true);
    add('Reject', () => openReject(order, `Reject return for ${order.id}`, Orders.rejectReturn));
  } else if (order.return?.status === 'awaiting') {
    add('Confirm Item Received', () => confirmAction({
      title: `Confirm return of ${order.id}`,
      body: `${peso(order.total)} goes back to the buyer. This can't be undone.`,
      label: 'Confirm and Refund',
      run: () => Orders.receiveReturn(order),
      done: 'The refund was released.',
    }), true);
  }

  return <>{buttons}</>;
}

function OrderCard({ order, showStatus, selectable, selected, onSelect }) {
  return (
    <article className="order-card">
      <header className="order-card__head">
        {selectable && (
          <label className="order-card__check">
            <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} />
            <span className="sr-only">Select {order.id}</span>
          </label>
        )}
        <strong>{order.buyer.name}</strong>
        <Link className="link" href={`/seller/orders/${order.id}`}>{order.id}</Link>
        <span className="muted">{formatDate(order.placedAt)}</span>
        <span className="order-card__status">{showStatus(order)}</span>
      </header>

      <ul className="order-items">
        {order.items.map((item) => (
          <li key={`${item.product}-${item.variation}`}>
            <img className="deal__image" src={item.image} alt="" />
            <span className="order-items__text">
              <strong>{item.name}</strong>
              <small>{item.variation}</small>
            </span>
            <span className="order-items__qty">x{item.qty}</span>
            <span className="order-items__price">{peso(item.price * item.qty)}</span>
          </li>
        ))}
      </ul>

      {order.return && <p className="order-card__note"><strong>{order.return.type}:</strong> {order.return.reason}</p>}
      {order.cancel && <p className="order-card__note"><strong>Cancellation by {order.cancel.by.toLowerCase()}:</strong> {order.cancel.reason}</p>}
      {order.failed && <p className="order-card__note"><strong>Failed delivery after {plural(order.failed.attempts, 'attempt')}:</strong> {order.failed.reason}</p>}
      {order.pickup && ['unpaid', 'to_ship', 'ready'].includes(order.status) && (
        <p className="order-card__note"><strong>Pickup:</strong> <Link className="link" href="/seller/orders/pickups">{PICKUP_STATUS[order.pickup.status].label}</Link>{order.pickup.courier && `, ${order.pickup.courier}`}{order.pickup.status === 'rejected' && ` Onetap said: ${order.pickup.reason}`}</p>
      )}
      {order.status === 'shipping' && <p className="order-card__note"><strong>Latest update:</strong> {order.events.at(-1).label}, {formatDate(order.events.at(-1).at)}</p>}

      <footer className="order-card__foot">
        <div className="order-card__meta">
          <span>{order.payment} · {paymentLabel(order)}</span>
          {order.payment === 'Cash on Delivery' && !order.paid && order.status !== 'cancelled' && <span>Expected COD collection {peso(order.total)}</span>}
          {order.tracking && <span>{order.courier} · {order.tracking}</span>}
          {order.shipBy && ['to_ship', 'ready'].includes(order.status) && <span className="order-card__due">Ship by {formatDate(order.shipBy)}</span>}
        </div>
        <div className="order-card__total"><small>Order total</small><strong>{peso(order.total)}</strong></div>
        <div className="order-card__actions">
          <OrderActions order={order} />
          <Link className="btn-mini" href={`/seller/orders/${order.id}`}>View Details<span className="sr-only"> for {order.id}</span></Link>
        </div>
      </footer>
    </article>
  );
}

function matches(order, text) {
  const haystack = [order.id, order.buyer.name, order.buyer.username, order.tracking, ...order.items.map((i) => i.name)];
  return haystack.join(' ').toLowerCase().includes(text);
}

function OrderList({ orders, tabs, tab, onTab, showStatus, empty, selection }) {
  const [query, setQuery] = useState('');
  const current = tabs.find((t) => t.id === tab) || tabs[0];
  const text = query.trim().toLowerCase();
  const shown = orders.filter(current.match).filter((o) => matches(o, text));
  const tabBar = useRef(null);

  // On a phone the active tab can start off screen, including from a ?tab= link.
  useEffect(() => {
    tabBar.current.querySelector('[aria-pressed="true"]').scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [current.id]);

  return (
    <>
      <div className="order-tools">
        <div className="order-tabs" role="group" aria-label="Filter orders" ref={tabBar}>
          {tabs.map((t) => (
            <button
              type="button"
              key={t.id}
              aria-pressed={t.id === current.id}
              onClick={() => onTab(t.id)}
            >
              {t.label} <span>{orders.filter(t.match).length}</span>
            </button>
          ))}
        </div>
        <label className="order-search">
          <Icon name="search" />
          <span className="sr-only">Search orders</span>
          <input type="search" placeholder="Order, buyer, product or tracking no." value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {selection?.render(current, shown)}

      <p className="sr-only" role="status">{plural(shown.length, 'order')} shown</p>
      {shown.length ? (
        <div className="order-list">
          {shown.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              showStatus={showStatus}
              selectable={selection?.canSelect(current, order)}
              selected={selection?.selected.includes(order.id)}
              onSelect={(on) => selection.toggle(order.id, on)}
            />
          ))}
        </div>
      ) : (
        <div className="panel order-empty"><Icon name="box" /><h2>{text ? 'No orders match your search' : empty}</h2></div>
      )}
    </>
  );
}

function PageHead({ title, text, count }) {
  return (
    <div className="order-head">
      <div>
        <h1 tabIndex={-1}>{title}</h1>
        <p className="muted">{text}</p>
      </div>
      {count > 0 && <span className="order-head__count">{plural(count, 'action')} needed</span>}
    </div>
  );
}

const orderStatus = (order) => <Badge status={sellerStatus(order)} />;

const groupTab = (id, label) => ({ id, label, match: (o) => sellerGroup(o) === id });

const MY_ORDER_TABS = [
  { id: 'all', label: 'All', match: () => true },
  groupTab('new', 'New Orders'),
  groupTab('to_ship', 'To Ship'),
  groupTab('unpaid', 'Unpaid / Awaiting Payment'),
  groupTab('shipping', 'Shipping Update'),
  groupTab('completed', 'Completed'),
  groupTab('requests', 'Return / Refunds / Cancel'),
];

export function MyOrders({ tab: initial }) {
  const state = useOrders();
  const [tab, setTab] = useState(initial || 'all');
  return (
    <div className="order-page">
      <PageHead title="My Orders" text="Approve new orders, set pickup schedules and follow every order to delivery." count={state.orders.filter(needsApproval).length} />
      <OrdersGate state={state}>
        <OrderList orders={state.orders} tabs={MY_ORDER_TABS} tab={tab} onTab={setTab} showStatus={orderStatus} empty="No orders here" />
      </OrdersGate>
    </div>
  );
}

const SHIP_TABS = [
  { id: 'arrange', label: 'To Schedule', match: needsArranging },
  { id: 'payment', label: 'Awaiting Payment', match: awaitingPayment },
  { id: 'requested', label: 'Finding a Courier', match: (o) => o.status === 'to_ship' && awaitingPickup(o) },
  { id: 'ready', label: 'Ready to Hand Over', match: (o) => o.status === 'ready' },
];

export function ToShip({ tab: initial }) {
  const state = useOrders();
  const { orders } = state;
  const [tab, setTab] = useState(initial || 'arrange');
  const [selected, setSelected] = useState([]);
  const open = orders.filter(needsArranging);
  const chosen = open.filter((o) => selected.includes(o.id));

  const selection = {
    selected,
    canSelect: (current, order) => current.id === 'arrange' && needsArranging(order),
    toggle(id, on) {
      setSelected(on ? [...selected, id] : selected.filter((other) => other !== id));
    },
    render(current, shown) {
      const selectable = shown.filter(needsArranging);
      if (current.id !== 'arrange' || !selectable.length) return null;
      const all = selectable.every((o) => selected.includes(o.id));
      return (
        <div className="mass-ship">
          <label>
            <input type="checkbox" checked={all} onChange={(e) => setSelected(e.target.checked ? selectable.map((o) => o.id) : [])} />
            Select all
          </label>
          <span className="muted">{plural(chosen.length, 'order')} selected</span>
          <button
            className="btn-mini btn-mini--primary"
            type="button"
            disabled={!chosen.length}
            onClick={() => openPickupRequest(chosen)}
          >
            Mass Set Schedule
          </button>
        </div>
      );
    },
  };

  return (
    <div className="order-page">
      <PageHead title="To Ship" text="Set pickup schedules, print waybills and hand over parcels." count={orders.filter(needsArranging).length} />
      <OrdersGate state={state}>
        <OrderList orders={orders} tabs={SHIP_TABS} tab={tab} onTab={setTab} showStatus={orderStatus} empty="Nothing to ship right now" selection={selection} />
      </OrdersGate>
    </div>
  );
}

const REQUEST_TABS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'returns', label: 'Return / Refund', match: (o) => Boolean(o.return) },
  { id: 'cancellations', label: 'Cancellation', match: (o) => Boolean(o.cancel) },
  { id: 'failed', label: 'Failed Delivery', match: (o) => Boolean(o.failed) },
];

export function Returns({ tab: initial }) {
  const state = useOrders();
  const orders = state.orders.filter((o) => o.return || o.cancel || o.failed);
  const [tab, setTab] = useState(initial || 'all');
  // Requests waiting on the seller come first.
  const sorted = [...orders.filter(hasOpenAction), ...orders.filter((o) => !hasOpenAction(o))];
  return (
    <div className="order-page">
      <PageHead title="Return / Refunds / Cancel" text="Review buyer requests, failed deliveries and refunds." count={orders.filter(hasOpenAction).length} />
      <OrdersGate state={state}>
        <OrderList orders={sorted} tabs={REQUEST_TABS} tab={tab} onTab={setTab} showStatus={(order) => <Badge status={requestStatus(order)} />} empty="Nothing here right now" />
      </OrdersGate>
    </div>
  );
}

const PROGRESS = ['Order placed', 'Seller approved', 'Courier booked', 'Picked up', 'In transit', 'Out for delivery', 'Delivered'];
const PROGRESS_REACHED = { booking_confirmed: 3, ready_for_pickup: 3, picked_up: 4, in_transit: 5, at_sorting_facility: 5, sorting_completed: 5, departed_sorting_facility: 5, arrived_delivery_hub: 5, ready_for_delivery: 5, return_to_sender: 5, out_for_delivery: 6, failed_delivery: 6, delivered: 7 };

export function Progress({ order }) {
  if (order.status === 'cancelled') return null;
  const reached = order.status === 'completed' ? PROGRESS.length : PROGRESS_REACHED[order.shipmentStatus] || (order.approvedAt ? 2 : 1);
  return (
    <ol className="order-steps">
      {PROGRESS.map((step, i) => <li className={i < reached ? 'is-done' : ''} key={step}>{step}</li>)}
    </ol>
  );
}

const photoTime = (ms) => new Date(ms).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });

// Every delivery photo, with when it was taken. Older proofs have one photo and no time.
export function ProofPhotos({ proof }) {
  const photos = proof?.photos?.length ? proof.photos : proof?.photo ? [{ url: proof.photo }] : [];
  if (!photos.length) return null;
  return (
    <ul className="proof-photos__list">
      {photos.map((photo, i) => (
        <li key={photo.url}>
          <a href={photo.url} target="_blank" rel="noopener noreferrer"><img src={photo.url} alt={`Delivered parcel, photo ${i + 1}`} /></a>
          {photo.at && <small className="muted">{photoTime(photo.at)}</small>}
        </li>
      ))}
    </ul>
  );
}

export function ProofOfDelivery({ proof }) {
  if (!proof) return null;
  return (
    <div className="delivery-proof">
      <strong>Proof of delivery</strong>
      {proof.receivedBy && <span>Received by {proof.receivedBy.name} (rider)</span>}
      {proof.receiver && <span>Recipient: {proof.receiver}{proof.relationship && ` (${proof.relationship})`}</span>}
      {!proof.receivedBy && !proof.receiver && <span>Received by: not recorded</span>}
      {proof.deliveredBy && <span>Confirmed by {proof.deliveredBy}</span>}
      <ProofPhotos proof={proof} />
    </div>
  );
}

const trackingTime = (ms) => new Date(ms).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });

// The tracking milestones, reached or still to come, then any setbacks. Shared by sellers and buyers.
export function TrackingHistory({ tracking }) {
  if (!tracking) return null;
  return (
    <section className="tracking" aria-labelledby="tracking-title">
      <h3 id="tracking-title">Shipping tracking history</h3>
      <ol className="timeline order-timeline tracking__steps">
        {tracking.milestones.map((step) => (
          <li className={step.done ? 'is-done' : 'is-pending'} key={step.key}>
            {step.label}
            <small>
              {step.done ? [trackingTime(step.at), step.location, step.note].filter(Boolean).join(' · ') : 'Not yet'}
            </small>
          </li>
        ))}
      </ol>
      {tracking.exceptions.length > 0 && (
        <ul className="tracking__exceptions">
          {tracking.exceptions.map((item) => <li key={`${item.label}-${item.at}`}><strong>{item.label}</strong> {[trackingTime(item.at), item.location, item.note].filter(Boolean).join(' · ')}</li>)}
        </ul>
      )}
    </section>
  );
}

function RequestPanel({ title, status, rows, response }) {
  return (
    <section className="panel">
      <div className="panel__head"><h2>{title}</h2><span className="order-card__status"><Badge status={status} /></span></div>
      <dl className="order-facts">
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        {response && <div><dt>Your response</dt><dd>{response}</dd></div>}
      </dl>
    </section>
  );
}

export function OrderDetail({ id }) {
  const state = useOrders();
  const order = state.orders.find((o) => o.id === id);

  if (state.loading || (state.error && !state.orders.length)) {
    return <div className="order-page"><h1 className="sr-only" tabIndex={-1}>Order {id}</h1><OrdersGate state={state} /></div>;
  }

  if (!order) {
    return (
      <div className="order-page">
        <div className="panel order-empty">
          <Icon name="box" />
          <h1 tabIndex={-1}>Order not found</h1>
          <p className="muted">We couldn&apos;t find order {id}.</p>
          <Link className="btn-mini" href="/seller/orders">Back to My Orders</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="order-page">
      <Link className="order-back" href="/seller/orders"><Icon name="arrow-left" className="icon icon--sm" /> My Orders</Link>
      <div className="order-head">
        <div>
          <h1 tabIndex={-1}>Order {order.id}</h1>
          <p className="muted">Placed {formatDate(order.placedAt)}</p>
        </div>
        <Badge status={sellerStatus(order)} />
      </div>

      <div className="order-detail">
        <div className="order-detail__main">
          <section className="panel">
            <div className="panel__head"><h2>Tracking</h2></div>
            <Progress order={order} />
            {order.tracking ? (
              <dl className="order-facts order-facts--row">
                <div><dt>Courier</dt><dd>{order.courier}</dd></div>
                <div><dt>Handover</dt><dd>{order.method}</dd></div>
                <div><dt>Tracking number</dt><dd>{order.tracking}</dd></div>
                {order.bookingRef && <div><dt>Booking reference</dt><dd>{order.bookingRef}</dd></div>}
                {order.pickedUpAt && <div><dt>Picked up</dt><dd>{formatDate(order.pickedUpAt)}</dd></div>}
                {order.outForDeliveryAt && <div><dt>Out for delivery</dt><dd>{formatDate(order.outForDeliveryAt)}</dd></div>}
                {order.deliveredAt && <div><dt>Delivered</dt><dd>{formatDate(order.deliveredAt)}</dd></div>}
                {['pickup', 'delivery'].filter((kind) => order.riders?.[kind]).map((kind) => (
                  <div key={kind}><dt>{kind === 'pickup' ? 'Pickup rider' : 'Delivery rider'}</dt><dd>{order.riders[kind].name}, <a className="link" href={`tel:${order.riders[kind].phone}`}>{order.riders[kind].phone}</a> ({TASK_STATUS[order.riders[kind].status].label})</dd></div>
                ))}
              </dl>
            ) : (
              <p className="muted">A tracking number appears once you set a schedule, any payment clears and the courier confirms the booking.</p>
            )}
            <ProofOfDelivery proof={order.proof} />
            <TrackingHistory tracking={order.trackingHistory} />
            <h3>Order activity</h3>
            <ol className="timeline order-timeline">
              {[...order.events].reverse().map((event) => (
                <li className="is-done" key={`${event.label}-${event.at}`}>
                  {event.label}
                  <small>{formatDate(event.at)}</small>
                </li>
              ))}
            </ol>
          </section>

          {order.cancel && (
            <RequestPanel
              title="Cancellation"
              status={CANCEL_STATUS[order.cancel.status]}
              response={order.cancel.response}
              rows={[['Requested by', order.cancel.by], ['Reason', order.cancel.reason], ['Date', formatDate(order.cancel.at)]]}
            />
          )}

          {order.return && (
            <RequestPanel
              title={order.return.type}
              status={RETURN_STATUS[order.return.status]}
              response={order.return.response}
              rows={[['Reason', order.return.reason], ['Buyer says', order.return.detail], ['Requested', formatDate(order.return.at)], ['Refund amount', peso(order.total)]]}
            />
          )}

          {order.failed && (
            <RequestPanel
              title="Failed Delivery"
              status={FAILED_STATUS[order.failed.status]}
              rows={[['Reason', order.failed.reason], ['Delivery attempts', order.failed.attempts], ['Reported', formatDate(order.failed.at)], ['Courier', order.courier], ['Amount', peso(order.total)]]}
            />
          )}
          <section className="panel">
            <div className="panel__head"><h2>Items</h2></div>
            <ul className="order-items">
              {order.items.map((item) => (
                <li key={`${item.product}-${item.variation}`}>
                  <img className="deal__image" src={item.image} alt="" />
                  <span className="order-items__text">
                    <strong>{item.name}</strong>
                    <small>{item.variation ? `${item.variation} · ` : ''}{peso(item.price)} each</small>
                  </span>
                  <span className="order-items__qty">x{item.qty}</span>
                  <span className="order-items__price">{peso(item.price * item.qty)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="order-detail__side" aria-label="Order summary">
          <section className="panel order-next">
            <div className="panel__head"><h2>Actions</h2></div>
            <div className="order-card__actions">
              <OrderActions order={order} />
              <Link className="btn-mini" href="/seller/chat/inbox">Open Inbox</Link>
            </div>
          </section>

          <section className="panel">
            <div className="panel__head"><h2>Buyer</h2></div>
            <dl className="order-facts">
              <div><dt>Name</dt><dd>{order.buyer.name}</dd></div>
              <div><dt>Username</dt><dd>{order.buyer.username}</dd></div>
              <div><dt>Phone</dt><dd>{order.buyer.phone}</dd></div>
              <div><dt>Ship to</dt><dd>{order.buyer.address}</dd></div>
              {order.note && <div><dt>Buyer note</dt><dd>{order.note}</dd></div>}
            </dl>
          </section>

          <section className="panel">
            <div className="panel__head"><h2>Payment</h2></div>
            <dl className="order-sum">
              <div><dt>Method</dt><dd>{order.payment}</dd></div>
              <div><dt>Status</dt><dd>{paymentLabel(order)}</dd></div>
              {order.payment === 'Cash on Delivery' && !order.paid && <div><dt>Expected collection</dt><dd>{peso(order.total)}</dd></div>}
              <div><dt>Subtotal</dt><dd>{peso(order.subtotal)}</dd></div>
              <div><dt>Shipping</dt><dd>{peso(order.shippingFee)}</dd></div>
              {order.voucher > 0 && <div><dt>Voucher</dt><dd>-{peso(order.voucher)}</dd></div>}
              <div className="order-sum__total"><dt>Total</dt><dd>{peso(order.total)}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
