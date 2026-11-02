'use client';

import { useEffect, useState } from 'react';
import { adminFetch, Badge, dateOnly, dateTime, DataTable, DateFilter, FilterBar, PageHead, postAdmin, SelectFilter, StatCards, Tabs, TextField, useAdminList } from './AdminUI';
import { COD_STATUS, HANDOVER_STATUS, options } from '@/lib/adminLabels';
import { Modal, peso, toast } from '@/lib/ui';

function RemittanceForm({ selected, onDone }) {
  const expected = selected.reduce((sum, row) => sum + row.collected, 0);
  const [form, setForm] = useState({ reference: '', received: String(expected), note: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const difference = Number(form.received) - expected;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await postAdmin('/cod/remittances', { partnerId: selected[0].partnerId, orderIds: selected.map((row) => row.orderId), ...form });
      Modal.close();
      toast(difference ? 'Remittance recorded with a discrepancy.' : 'Remittance recorded.', difference ? 'info' : 'success');
      onDone();
    } catch (err) {
      setErrors(err.fields || {});
      toast(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit}>
      <p className="muted">{selected.length} {selected.length === 1 ? 'order' : 'orders'} from {selected[0].courier}. Expected {peso(expected)}.</p>
      <TextField id="remit-reference" label="Transaction reference" required value={form.reference} error={errors.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
      <TextField id="remit-received" label="Amount received (₱)" inputMode="decimal" required value={form.received} error={errors.received} onChange={(e) => setForm({ ...form, received: e.target.value })} />
      {Boolean(difference) && Number.isFinite(difference) && <p className="form-error">This is {peso(Math.abs(difference))} {difference < 0 ? 'short' : 'over'}. It will be recorded as a discrepancy.</p>}
      <TextField id="remit-note" label="Note (optional)" maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record Remittance'}</button>
    </form>
  );
}

function Reports() {
  const [period, setPeriod] = useState('daily');
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let current = true;
    adminFetch(`/cod/reports?period=${period}`).then((body) => current && setRows(body.rows), () => current && setRows([]));
    return () => {
      current = false;
    };
  }, [period]);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>COD Reports</h2>
        <a className="btn-mini admin-right" href={`/api/admin/cod/reports?period=${period}&format=csv`} download>Download Report</a>
      </div>
      <div className="order-tabs" role="group" aria-label="Report period">
        {['daily', 'weekly', 'monthly'].map((value) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>
      {rows?.length ? (
        <div className="admin-table" role="region" aria-label="COD report" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Period</th><th scope="col">Courier</th><th scope="col">Orders</th><th scope="col">Expected</th><th scope="col">Collected</th><th scope="col">Remitted</th><th scope="col">Pending</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={`${r.period}-${r.courier}`}><td>{r.period}</td><td>{r.courier}</td><td>{r.orders}</td><td>{peso(r.expected)}</td><td>{peso(r.collected)}</td><td>{peso(r.remitted)}</td><td>{peso(r.pending)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="muted">{rows ? 'No collections yet.' : 'Loading…'}</p>}
    </section>
  );
}

function Remittances({ refresh }) {
  const list = useAdminList('/cod/remittances');
  useEffect(() => {
    if (refresh) list.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);
  return (
    <section className="panel">
      <div className="panel__head"><h2>Remittance History</h2></div>
      <DataTable
        list={list}
        label="Remittance history"
        empty="No remittances recorded yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Date', sort: 'at', render: (row) => dateTime(row.at) },
          { label: 'Courier', render: (row) => row.courier },
          { label: 'Reference', render: (row) => row.reference },
          { label: 'Expected', render: (row) => peso(row.expected) },
          { label: 'Received', sort: 'received', render: (row) => peso(row.received) },
          { label: 'Difference', render: (row) => (row.difference ? <Badge status={{ label: peso(row.difference), tone: 'danger' }} /> : 'None') },
          { label: 'Recorded by', render: (row) => row.admin },
        ]}
      />
    </section>
  );
}

export function AdminCod({ initial }) {
  const list = useAdminList('/cod', initial);
  const [partners, setPartners] = useState([]);
  const [selected, setSelected] = useState([]);
  const [saved, setSaved] = useState(0);
  const { summary } = list.data || {};

  useEffect(() => {
    fetch('/api/logistics/options').then((r) => r.json()).then((body) => setPartners(body.partners.map((p) => [p.id, p.name]))).catch(() => {});
  }, []);

  const toggle = (row, on) => {
    if (on && selected.length && selected[0].partnerId !== row.partnerId) {
      toast('Choose collections from one courier at a time.', 'error');
      return;
    }
    setSelected(on ? [...selected, row] : selected.filter((item) => item.orderId !== row.orderId));
  };

  const done = () => {
    setSelected([]);
    setSaved(saved + 1);
    list.reload();
  };

  return (
    <div className="order-page admin-page">
      <PageHead title="COD Monitoring" text="Cash on Delivery from collection to remittance.">
        <button className="btn-mini btn-mini--primary" type="button" disabled={!selected.length} onClick={() => Modal.open({ title: 'Record courier remittance', content: <RemittanceForm selected={selected} onDone={done} /> })}>Record Remittance{selected.length > 0 && ` (${selected.length})`}</button>
      </PageHead>
      <p className="admin-banner" role="note"><strong>Records only.</strong> Remittances are entered by hand from the courier&apos;s statement. No money moves through this page.</p>
      {summary && (
        <StatCards items={[
          { label: 'Total COD Collections', value: peso(summary.totalCollected) },
          { label: 'Pending Remittances', value: peso(summary.pendingRemittance) },
          { label: 'Completed Remittances', value: peso(summary.completedRemittance) },
          { label: 'Outstanding Balance', value: peso(summary.outstanding) },
          { label: 'Awaiting Delivery', value: peso(summary.awaitingDelivery) },
          { label: 'Overdue', value: summary.overdue },
          { label: 'Discrepancies', value: summary.discrepancies },
        ]} />
      )}
      <Tabs list={list} name="status" label="Filter by status" tabs={[['', 'All'], ...options(COD_STATUS)]} />
      <FilterBar list={list} placeholder="Order, seller, customer or courier">
        <SelectFilter list={list} name="partner" label="Courier" options={partners} />
        <DateFilter list={list} name="from" label="From" />
        <DateFilter list={list} name="to" label="To" />
      </FilterBar>
      <DataTable
        list={list}
        label="COD transactions"
        empty="No COD transactions here yet"
        rowKey={(row) => row.orderId}
        columns={[
          {
            label: 'Select',
            render: (row) => row.status === 'collected' && (
              <label>
                <span className="sr-only">Select {row.orderId}</span>
                <input type="checkbox" checked={selected.some((item) => item.orderId === row.orderId)} onChange={(e) => toggle(row, e.target.checked)} />
              </label>
            ),
          },
          { label: 'Order', render: (row) => row.orderId },
          { label: 'Seller', sort: 'seller', render: (row) => row.seller },
          { label: 'Courier', render: (row) => row.courier || '—' },
          { label: 'Rider', render: (row) => (row.rider ? <>{row.rider}<small className="admin-cell-note">{HANDOVER_STATUS[row.riderHandover].label}</small></> : '—') },
          { label: 'Expected', sort: 'amount', render: (row) => peso(row.expected) },
          { label: 'Collected', render: (row) => peso(row.collected) },
          { label: 'Status', render: (row) => <><Badge status={COD_STATUS[row.status]} />{Boolean(row.discrepancy) && <> <Badge status={{ label: `${peso(row.discrepancy)} off`, tone: 'danger' }} /></>}</> },
          { label: 'Collected on', sort: 'collected', render: (row) => dateOnly(row.collectedAt) },
          { label: 'Remittance due', sort: 'due', render: (row) => dateOnly(row.dueAt) },
          { label: 'Remitted on', render: (row) => dateOnly(row.remittedAt) },
        ]}
      />
      <Reports key={saved} />
      <Remittances refresh={saved} />
    </div>
  );
}
