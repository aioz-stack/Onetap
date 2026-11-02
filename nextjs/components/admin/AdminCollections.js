'use client';

// Financial Collections: every delivered order's money, split into seller proceeds, the rider
// (delivery) fee and Onetap's admin fee, and where the cash is now.

import { useEffect, useState } from 'react';
import { adminFetch, Badge, dateTime, DataTable, DateFilter, FilterBar, PageHead, postAdmin, SelectFilter, StatCards, Tabs, TextField, useAdminList, useRefresh } from './AdminUI';
import { COLLECTION_STATUS, options } from '@/lib/adminLabels';
import { Modal, peso, toast } from '@/lib/ui';

function CommissionForm({ rate, onDone }) {
  const [value, setValue] = useState(String(rate));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = await postAdmin('/collections', { commissionRate: value });
      Modal.close();
      toast(`Commission set to ${body.commissionRate}%. It applies to orders delivered from now on.`, 'success');
      onDone();
    } catch (err) {
      setError(err.fields?.commissionRate || err.message);
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit}>
      <p className="muted">Onetap&apos;s admin fee is this percentage of each order&apos;s product total, taken from the seller&apos;s proceeds. Delivery fees are never included. Orders already delivered keep the rate they were recorded with.</p>
      <TextField id="commission-rate" label="Commission rate (%)" required inputMode="decimal" value={value} error={error} onChange={(e) => setValue(e.target.value)} />
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Rate'}</button>
    </form>
  );
}

const REPORT_COLUMNS = [['Orders', 'orders'], ['Product Total', 'productTotal'], ['Rider Fees', 'riderFee'], ['Admin Fees', 'adminFee'], ['Seller Proceeds', 'sellerProceeds'], ['Total Transactions', 'total'], ['COD Collected', 'codCollected'], ['Prepaid Collected', 'prepaidCollected'], ['COD With Riders', 'withRiders'], ['Remitted to Onetap', 'remitted']];

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
  const rate = list.data?.commissionRate;

  return (
    <div className="order-page admin-page">
      <PageHead title="Financial Collections" text="Recorded automatically when a delivery is confirmed. Seller proceeds, rider fees and admin fees are kept apart: only admin fees are Onetap's.">
        {rate !== undefined && <button className="btn-mini" type="button" onClick={() => Modal.open({ title: 'Marketplace commission', content: <CommissionForm rate={rate} onDone={list.reload} /> })}>Commission: {rate}%</button>}
      </PageHead>
      {rate === 0 && <p className="admin-banner" role="note"><strong>Commission is 0%.</strong> No admin fee is being recorded. Set Onetap&apos;s rate to start recording it on new deliveries.</p>}
      {totals && (
        <section className="panel">
          <StatCards items={[
            { label: 'Total Transactions', value: peso(totals.total) },
            { label: 'Seller Proceeds', value: peso(totals.sellerProceeds) },
            { label: 'Rider Fees', value: peso(totals.riderFee) },
            { label: 'Admin Fees', value: peso(totals.adminFee) },
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
          { label: 'Rider Fee', render: (row) => peso(row.riderFee) },
          { label: 'Admin Fee', render: (row) => <>{peso(row.adminFee)}<small className="admin-cell-note">{row.commissionRate}%</small></> },
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
