'use client';

// Financial Collections: every delivered order's money, split into seller proceeds, Onetap's admin
// fee, and the delivery fee (Onetap's logistics fee and the courier's share), and where the cash
// is now. The fees themselves are set in Fee Management.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { adminFetch, Badge, dateTime, DataTable, DateFilter, FilterBar, PageHead, SelectFilter, StatCards, Tabs, useAdminList, useRefresh } from './AdminUI';
import { COLLECTION_STATUS, options } from '@/lib/adminLabels';
import { peso } from '@/lib/ui';

// How an order's admin fee was worked out when it was delivered.
const feeBasis = (type, value) => (type === 'fixed' ? `fixed ${peso(value)}` : `${value}%`);

const REPORT_COLUMNS = [['Orders', 'orders'], ['Product Total', 'productTotal'], ['Delivery Fees', 'riderFee'], ['Logistics Fees', 'logisticsFee'], ['Courier Shares', 'courierShare'], ['Admin Fees', 'adminFee'], ['Seller Proceeds', 'sellerProceeds'], ['Total Transactions', 'total'], ['COD Collected', 'codCollected'], ['Prepaid Collected', 'prepaidCollected'], ['COD With Riders', 'withRiders'], ['Remitted to Onetap', 'remitted']];

function Reports() {
  const [period, setPeriod] = useState('daily');
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let current = true;
    adminFetch(`/collections?period=${period}`).then((body) => current && setRows(body.rows), () => current && setRows([]));
    return () => {
      current = false;
    };
  }, [period]);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Collection Reports</h2>
        <a className="btn-mini admin-right" href={`/api/admin/collections?period=${period}&format=csv`} download>Download Report</a>
      </div>
      <div className="order-tabs" role="group" aria-label="Report period">
        {['daily', 'weekly', 'monthly'].map((value) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>
      {rows?.length ? (
        <div className="admin-table" role="region" aria-label="Collection report" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Period</th>{REPORT_COLUMNS.map(([label]) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{rows.map((row) => <tr key={row.period}><td>{row.period}</td>{REPORT_COLUMNS.map(([label, key]) => <td key={label}>{key === 'orders' ? row[key] : peso(row[key])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : <p className="muted">{rows ? 'No delivered orders yet.' : 'Loading…'}</p>}
    </section>
  );
}

export function AdminCollections({ initial }) {
  const list = useAdminList('/collections', initial);
  useRefresh(list.reload);
  const totals = list.data?.totals;

  return (
    <div className="order-page admin-page">
      <PageHead title="Financial Collections" text="Recorded automatically when a delivery is confirmed, with the fees in force at that moment. Onetap earns the admin fee (from the seller) and the logistics fee (from the delivery fee).">
        <Link className="btn-mini" href="/admin/fees">Fee Management</Link>
      </PageHead>
      {totals && (
        <section className="panel">
          <StatCards items={[
            { label: 'Total Transactions', value: peso(totals.total) },
            { label: 'Seller Proceeds', value: peso(totals.sellerProceeds) },
            { label: 'Admin Fees', value: peso(totals.adminFee) },
            { label: 'Logistics Fees', value: peso(totals.logisticsFee) },
            { label: 'Onetap Fees', value: peso(totals.onetapFees) },
            { label: 'Delivery Fees', value: peso(totals.riderFee) },
            { label: 'Courier Shares', value: peso(totals.courierShare) },
            { label: 'COD Collected', value: peso(totals.codCollected) },
            { label: 'COD With Riders', value: peso(totals.withRiders), href: '/admin/collections?status=with_rider' },
            { label: 'Prepaid Collected', value: peso(totals.prepaidCollected) },
          ]} />
          <p className="muted">Totals cover the filters below. Prepaid payments are simulated until a payment provider is connected.</p>
        </section>
      )}
      <Tabs list={list} name="status" label="Filter by collection status" tabs={[['', 'All'], ...options(COLLECTION_STATUS)]} />
      <FilterBar list={list} placeholder="Order, seller, customer or courier">
        <SelectFilter list={list} name="payment" label="Payment" options={[['cod', 'Cash on Delivery'], ['prepaid', 'Prepaid']]} />
        <DateFilter list={list} name="from" label="From" />
        <DateFilter list={list} name="to" label="To" />
      </FilterBar>
      <DataTable
        list={list}
        label="Financial collections"
        empty="No delivered orders here yet"
        rowKey={(row) => row.orderId}
        columns={[
          { label: 'Order', render: (row) => row.orderId },
          { label: 'Seller', sort: 'seller', render: (row) => row.seller },
          { label: 'Customer', render: (row) => row.customer },
          { label: 'Product Total', render: (row) => peso(row.productTotal) },
          { label: 'Admin Fee', render: (row) => <>{peso(row.adminFee)}<small className="admin-cell-note">{row.adminFeeSource === 'off' ? 'Switched off for this seller' : feeBasis(row.adminFeeType, row.adminFeeValue)}{row.adminFeeSource === 'account' && ' · seller rate'}</small></> },
          { label: 'Delivery Fee', render: (row) => <>{peso(row.riderFee)}<small className="admin-cell-note">Logistics {peso(row.logisticsFee)}{row.logisticsFeeSource === 'account' ? ' (partner rate)' : row.logisticsFeeSource === 'off' ? ' (switched off)' : ''} · courier {peso(row.courierShare)}</small></> },
          { label: 'Total', sort: 'total', render: (row) => <>{peso(row.total)}{row.difference !== 0 && <small className="admin-cell-note">Collected {peso(row.collected)}</small>}</> },
          { label: 'Payment', render: (row) => <>{row.paymentMethod}{row.paymentReference && <small className="admin-cell-note">{row.paymentReference}</small>}</> },
          { label: 'Collected On', sort: 'collected', render: (row) => dateTime(row.collectedAt) },
          { label: 'Status', render: (row) => <><Badge status={COLLECTION_STATUS[row.status]} />{row.rider && <small className="admin-cell-note">{row.rider}</small>}</> },
        ]}
      />
      <Reports />
    </div>
  );
}
