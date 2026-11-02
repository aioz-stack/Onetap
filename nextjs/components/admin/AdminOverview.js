'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch, dateTime, PageHead, RateBars, SandboxBanner, StatCards, TrendChart } from './AdminUI';
import { peso } from '@/lib/ui';

const REFRESH_MS = 15000;

function Alerts({ alerts }) {
  return (
    <section className="panel">
      <div className="panel__head"><h2>Alerts</h2></div>
      {alerts.length ? (
        <ul className="admin-alerts">
          {alerts.map((alert) => (
            <li className={`admin-alert admin-alert--${alert.level}`} key={alert.text}>
              <strong>{alert.level === 'critical' ? 'Critical' : 'Warning'}</strong> <Link href={alert.href}>{alert.text}</Link>
            </li>
          ))}
        </ul>
      ) : <p className="muted">Nothing needs attention right now.</p>}
    </section>
  );
}

const STATUS_ROWS = [
  ['booking_confirmed', 'Booking Confirmed'], ['ready_for_pickup', 'Ready for Pickup'], ['picked_up', 'Picked Up'], ['in_transit', 'In Transit'], ['out_for_delivery', 'Out for Delivery'], ['delivered', 'Delivered'], ['failed_delivery', 'Failed Delivery'], ['return_to_sender', 'Return to Sender'],
];

function Logistics({ data }) {
  return (
    <section className="panel">
      <div className="panel__head"><h2>Logistics Overview</h2></div>
      <StatCards items={[
        { label: 'Logistics Partners', value: data.partners, href: '/admin/logistics' },
        { label: 'Active API Integrations', value: data.activeIntegrations, href: '/admin/api' },
        { label: 'Pending Pickup Requests', value: data.pendingPickups, href: '/admin/pickups' },
        { label: 'Active Shipments', value: data.activeShipments, href: '/admin/shipments' },
        { label: 'Delivered Orders', value: data.delivered, href: '/admin/shipments?status=delivered' },
        { label: 'Failed Deliveries', value: data.failedDeliveries, href: '/admin/shipments?status=failed_delivery' },
      ]} />
      <div className="admin-charts">
        <TrendChart title="Shipments, last 14 days" series={[{ label: 'Booked', tone: 'one', values: data.bookedPerDay }, { label: 'Delivered', tone: 'two', values: data.deliveredPerDay }]} />
        <RateBars title="Courier delivery success" rows={data.courierPerformance.map((c) => ({ label: c.name, rate: c.successRate, note: `${c.delivered} delivered, ${c.failed} failed` }))} />
      </div>
      <div className="admin-table" role="region" aria-label="Shipments by status" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Shipment status</th><th scope="col">Count</th></tr></thead>
          <tbody>{STATUS_ROWS.map(([key, label]) => <tr key={key}><td>{label}</td><td>{data.shipmentStatus[key] || 0}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function Finance({ data }) {
  return (
    <section className="panel">
      <div className="panel__head"><h2>Financial Overview</h2></div>
      <StatCards items={[
        { label: 'Total COD Collections', value: peso(data.totalCollected), href: '/admin/cod' },
        { label: 'Pending COD Remittances', value: peso(data.pendingRemittance), href: '/admin/cod?status=collected' },
        { label: 'Completed COD Remittances', value: peso(data.completedRemittance), href: '/admin/cod?status=remitted' },
        { label: 'Outstanding COD Balances', value: peso(data.outstanding), href: '/admin/cod' },
      ]} />
      <TrendChart title="COD, last 14 days" money series={[{ label: 'Collected', tone: 'one', values: data.collectedPerDay }, { label: 'Remitted', tone: 'two', values: data.remittedPerDay }]} />
    </section>
  );
}

function Moderation({ data }) {
  return (
    <section className="panel">
      <div className="panel__head"><h2>Product Listings Overview</h2></div>
      <StatCards items={[
        { label: 'Live Listings', value: data.live, href: '/admin/products?tab=live' },
        { label: 'Suspended Listings', value: data.suspended, href: '/admin/products?tab=suspended' },
      ]} />
    </section>
  );
}

export function AdminOverview() {
  const [state, setState] = useState({ loading: true });

  const load = useCallback(() => adminFetch('/overview').then((data) => setState({ data }), (err) => setState((current) => ({ ...current, loading: false, error: err.message }))), []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const { data, loading, error } = state;
  return (
    <div className="order-page admin-page">
      <PageHead title="Overview" text="Updates every 15 seconds." />
      <SandboxBanner />
      {loading && <div className="skeleton" role="status" aria-label="Loading overview" />}
      {error && !data && <p className="form-error" role="alert">{error}</p>}
      {data && (
        <>
          <Alerts alerts={data.alerts} />
          {data.logistics && <Logistics data={data.logistics} />}
          {data.finance && <Finance data={data.finance} />}
          {data.moderation && <Moderation data={data.moderation} />}
          {data.activity.length > 0 && (
            <section className="panel">
              <div className="panel__head"><h2>Recent Admin Activity</h2></div>
              <ul className="admin-activity">
                {data.activity.map((item) => <li key={`${item.at}-${item.action}-${item.target_id}`}><strong>{item.admin}</strong> {item.action} <span className="muted">{item.target_id} · {dateTime(item.at)}</span></li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
