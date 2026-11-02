'use client';

// The buyer's order pages.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { Badge, FormModal, ProofOfDelivery, Progress, TrackingHistory } from './SellerOrders';
import { confirmModal } from './SellerProducts';
import { SHIPMENT_STATUS } from '@/lib/adminLabels';
import { Chat } from '@/lib/chat';
import { currentStatus, formatDate, orderGroup, paymentLabel } from '@/lib/orders';
import { Purchases, usePurchases } from '@/lib/purchases';
import { BUYER_CANCEL_SCHEMA, RETURN_REQUEST_SCHEMA } from '@/lib/schemas';
import { Modal, peso, toast } from '@/lib/ui';

const RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function openCancel(order, reload) {
  Modal.open({
    title: `Cancel ${order.id}`,
    content: (
      <FormModal
        id="buyer-cancel"
        schema={BUYER_CANCEL_SCHEMA}
        submitLabel="Request Cancellation"
        onSubmit={async ({ reason }) => {
          await Purchases.act([order.id], 'requestCancel', { reason });
          Modal.close();
          toast(order.status === 'unpaid' ? 'Your order was cancelled.' : 'Your request was sent to the seller.', 'success');
          await reload();
        }}
      >
        <p className="muted order-modal__text">{order.status === 'unpaid' ? 'This order hasn\'t been paid, so it cancels straight away.' : 'The seller reviews your request. Any payment is refunded if they approve it.'}</p>
      </FormModal>
    ),
  });
}

function openReturn(order, reload) {
  Modal.open({
    title: `Return or refund ${order.id}`,
    content: (
      <FormModal
        id="buyer-return"
        schema={RETURN_REQUEST_SCHEMA}
        submitLabel="Send Request"
        onSubmit={async (data) => {
          await Purchases.act([order.id], 'requestReturn', data);
          Modal.close();
          toast('Your request was sent to the seller.', 'success');
          await reload();
        }}
      />
    ),
  });
}

function openPay(order, reload) {
  confirmModal({
    title: `Pay for ${order.id}`,
    body: `This is a simulated ${order.payment} payment, so no money moves.`,
    label: `Pay ${peso(order.total)}`,
    run: async () => {
      await Purchases.act([order.id], 'pay');
      toast('Payment confirmed.', 'success');
      await reload();
    },
  });
}

function PurchaseActions({ order, reload }) {
  const canCancel = ['unpaid', 'to_ship', 'ready'].includes(order.status) && !order.cancel;
  const delivered = order.deliveredAt ? Date.parse(order.deliveredAt) : 0;
  const canReturn = order.status === 'completed' && !order.return && new Date().getTime() - delivered <= RETURN_WINDOW_MS;
  return (
    <>
      {order.status === 'unpaid' && <button className="btn-mini btn-mini--primary" type="button" onClick={() => openPay(order, reload)}>Pay Now<span className="sr-only"> for {order.id}</span></button>}
      {canCancel && <button className="btn-mini" type="button" onClick={() => openCancel(order, reload)}>Cancel Order<span className="sr-only"> {order.id}</span></button>}
      {canReturn && <button className="btn-mini" type="button" onClick={() => openReturn(order, reload)}>Return / Refund<span className="sr-only"> for {order.id}</span></button>}
      <button className="btn-mini" type="button" onClick={() => Chat.openShop(`seller:${order.seller}`, `Hi! I have a question about order ${order.id}.`)}>Message Seller<span className="sr-only"> about {order.id}</span></button>
    </>
  );
}

function Items({ order }) {
  return (
    <ul className="order-items">
      {order.items.map((item) => (
        <li key={`${item.product}-${item.variation}`}>
          <img className="deal__image" src={item.image} alt="" />
          <span className="order-items__text">
            <strong>{item.name}</strong>
            {item.variation && <small>{item.variation}</small>}
          </span>
          <span className="order-items__qty">x{item.qty}</span>
          <span className="order-items__price">{peso(item.price * item.qty)}</span>
        </li>
      ))}
    </ul>
  );
}

function Notes({ order }) {
  return (
    <>
      {order.return && <p className="order-card__note"><strong>{order.return.type}:</strong> {order.return.reason}{order.return.response && ` Seller's reply: ${order.return.response}`}</p>}
      {order.cancel && <p className="order-card__note"><strong>Cancellation by {order.cancel.by.toLowerCase()}:</strong> {order.cancel.reason}{order.cancel.response && ` Seller's reply: ${order.cancel.response}`}</p>}
      {order.failed && <p className="order-card__note"><strong>Delivery problem:</strong> {order.failed.reason}</p>}
    </>
  );
}

const groupTab = (id, label) => ({ id, label, match: (o) => orderGroup(o) === id });

const TABS = [
  { id: 'all', label: 'All', match: () => true },
  groupTab('unpaid', 'To Pay'),
  groupTab('to_ship', 'To Ship'),
  groupTab('shipping', 'Shipping'),
  groupTab('completed', 'Completed'),
  groupTab('requests', 'Return / Refunds / Cancel'),
];

export function MyPurchases({ tab: initial }) {
  const { orders, loading, error, reload } = usePurchases();
  const [tab, setTab] = useState(initial || 'all');
  const tabBar = useRef(null);
  const current = TABS.find((t) => t.id === tab) || TABS[0];
  const shown = orders.filter(current.match);

  useEffect(() => {
    tabBar.current.querySelector('[aria-pressed="true"]').scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [current.id]);

  return (
    <section className="container purchases">
      <div className="order-head"><div><h1 tabIndex={-1}>My Purchases</h1><p className="muted">Track, pay for and manage your orders.</p></div></div>
      <div className="order-tabs" role="group" aria-label="Filter purchases" ref={tabBar}>
        {TABS.map((t) => (
          <button type="button" key={t.id} aria-pressed={t.id === current.id} onClick={() => setTab(t.id)}>{t.label} <span>{orders.filter(t.match).length}</span></button>
        ))}
      </div>
      {loading && <div className="order-list" role="status" aria-label="Loading purchases"><div className="skeleton" /><div className="skeleton" /></div>}
      {!loading && error && !orders.length && (
        <div className="panel order-empty" role="alert">
          <Icon name="box" />
          <h2>We couldn&apos;t load your purchases</h2>
          <p className="muted">{error}</p>
          <button className="btn-mini" type="button" onClick={reload}>Try Again</button>
        </div>
      )}
      {!loading && !error && !shown.length && (
        <div className="panel order-empty">
          <Icon name="box" />
          <h2>No orders here yet</h2>
          <Link className="btn-mini btn-mini--primary" href="/#products">Browse Deals</Link>
        </div>
      )}
      {!loading && shown.length > 0 && (
        <div className="order-list">
          {shown.map((order) => (
            <article className="order-card" key={order.id}>
              <header className="order-card__head">
                <strong>{order.shopName}</strong>
                <Link className="link" href={`/orders/${order.id}`}>{order.id}</Link>
                <span className="muted">{formatDate(order.placedAt)}</span>
                <span className="order-card__status"><Badge status={currentStatus(order)} /></span>
              </header>
              <Items order={order} />
              <Notes order={order} />
              <footer className="order-card__foot">
                <div className="order-card__meta">
                  <span>{order.payment} · {paymentLabel(order)}</span>
                  {order.tracking && <span>{order.courier} · {order.tracking}</span>}
                </div>
                <div className="order-card__total"><small>Order total</small><strong>{peso(order.total)}</strong></div>
                <div className="order-card__actions">
                  <PurchaseActions order={order} reload={reload} />
                  <Link className="btn-mini" href={`/orders/${order.id}`}>View Details<span className="sr-only"> for {order.id}</span></Link>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function PurchaseDetail({ id }) {
  const { orders, loading, error, reload } = usePurchases();
  const order = orders.find((o) => o.id === id);

  if (loading) return <section className="container purchases"><h1 className="sr-only" tabIndex={-1}>Order {id}</h1><div className="skeleton" role="status" aria-label="Loading order" /></section>;
  if (!order) {
    return (
      <section className="container purchases">
        <div className="panel order-empty" role={error ? 'alert' : undefined}>
          <Icon name="box" />
          <h1 tabIndex={-1}>{error ? 'We couldn\'t load this order' : 'Order not found'}</h1>
          <p className="muted">{error || `We couldn't find order ${id} in your account.`}</p>
          <Link className="btn-mini" href="/orders">Back to My Purchases</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="container purchases">
      <Link className="order-back" href="/orders"><Icon name="arrow-left" className="icon icon--sm" /> My Purchases</Link>
      <div className="order-head">
        <div>
          <h1 tabIndex={-1}>Order {order.id}</h1>
          <p className="muted">{order.shopName} · Placed {formatDate(order.placedAt)}</p>
        </div>
        <Badge status={currentStatus(order)} />
      </div>
      <div className="order-detail">
        <div className="order-detail__main">
          <section className="panel">
            <div className="panel__head"><h2>Tracking</h2></div>
            <Progress order={order} />
            {order.tracking ? (
              <dl className="order-facts order-facts--row">
                <div><dt>Courier</dt><dd>{order.courier}</dd></div>
                <div><dt>Tracking number</dt><dd>{order.tracking}</dd></div>
                {order.shipmentStatus && <div><dt>Shipment status</dt><dd>{SHIPMENT_STATUS[order.shipmentStatus].label}</dd></div>}
                {order.eta && !order.deliveredAt && <div><dt>Estimated delivery</dt><dd>{formatDate(new Date(order.eta).toISOString())}</dd></div>}
                {order.pickedUpAt && <div><dt>Picked up</dt><dd>{formatDate(order.pickedUpAt)}</dd></div>}
                {order.outForDeliveryAt && <div><dt>Out for delivery</dt><dd>{formatDate(order.outForDeliveryAt)}</dd></div>}
                {order.deliveredAt && <div><dt>Delivered</dt><dd>{formatDate(order.deliveredAt)}</dd></div>}
                {order.riders?.delivery && <div><dt>Delivery rider</dt><dd>{order.riders.delivery.name}, <a className="link" href={`tel:${order.riders.delivery.phone}`}>{order.riders.delivery.phone}</a></dd></div>}
              </dl>
            ) : <p className="muted">A tracking number appears once a courier is booked for your order.</p>}
            {order.sandbox && <p className="muted">This is a Sandbox test shipment, so no real parcel is moving.</p>}
            {order.trackingUrl && <a className="btn-mini" href={order.trackingUrl} target="_blank" rel="noopener noreferrer">Track with {order.courier}</a>}
            <ProofOfDelivery proof={order.proof} />
            <TrackingHistory tracking={order.trackingHistory} />
            <h3>Order activity</h3>
            <ol className="timeline order-timeline">
              {[...order.events].reverse().map((event) => (
                <li className="is-done" key={`${event.label}-${event.at}`}>{event.label}<small>{formatDate(event.at)}</small></li>
              ))}
            </ol>
          </section>
          <Notes order={order} />
          <section className="panel"><div className="panel__head"><h2>Items</h2></div><Items order={order} /></section>
        </div>
        <aside className="order-detail__side" aria-label="Order summary">
          <section className="panel order-next">
            <div className="panel__head"><h2>Actions</h2></div>
            <div className="order-card__actions"><PurchaseActions order={order} reload={reload} /></div>
          </section>
          <section className="panel">
            <div className="panel__head"><h2>Deliver to</h2></div>
            <dl className="order-facts">
              <div><dt>Name</dt><dd>{order.buyer.name}</dd></div>
              <div><dt>Phone</dt><dd>{order.buyer.phone}</dd></div>
              <div><dt>Address</dt><dd>{order.buyer.address}</dd></div>
            </dl>
          </section>
          <section className="panel">
            <div className="panel__head"><h2>Payment</h2></div>
            <dl className="order-sum">
              <div><dt>Method</dt><dd>{order.payment}</dd></div>
              <div><dt>Status</dt><dd>{paymentLabel(order)}</dd></div>
              <div><dt>Subtotal</dt><dd>{peso(order.subtotal)}</dd></div>
              <div><dt>Shipping</dt><dd>{peso(order.shippingFee)}</dd></div>
              <div className="order-sum__total"><dt>Total</dt><dd>{peso(order.total)}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </section>
  );
}
