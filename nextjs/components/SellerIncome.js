'use client';

// Seller Centre > Finance > My Income: Income Overview, Income Statement, Income Details, and
// My Balance (withdrawals). Every figure comes from the seller's income ledger on the server,
// which is built from their delivered and refunded orders.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, DateFilter, dateTime, FilterBar, PageHead, SelectFilter, StatCards, Tabs, TextField, TrendChart, useAdminList, useRefresh } from './admin/AdminUI';
import Icon from './Icon';
import { Badge } from './SellerOrders';
import { confirmModal } from './SellerProducts';
import { INCOME_PAYOUT_STATUS, INCOME_STATUS, PAYOUT_STATUS } from '@/lib/adminLabels';
import { send } from '@/lib/productsApi';
import { useStored } from '@/lib/store';
import { Modal, peso, toast } from '@/lib/ui';

const CLIENT = { fetch: (url) => send(`/api/seller${url}`), base: '/api/seller' };
const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

const VIEWS = [
  ['overview', 'Income Overview', '/seller/income'],
  ['statement', 'Income Statement', '/seller/income/statement'],
  ['details', 'Income Details', '/seller/income/details'],
  ['payouts', 'My Balance', '/seller/income/payouts'],
];

const TEXT = {
  overview: 'Your earnings, balance and payouts, from your delivered orders.',
  statement: 'A statement of your income for any range of dates.',
  details: 'Every delivered order and what you earned from it.',
  payouts: 'Withdraw your available balance and follow your payouts.',
};

// Philippine dates for the statement's default range and quick picks.
const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const day = (ms) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
const dateOnly = (ms) => (ms ? new Date(ms).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }) : '—');

function useLoad(url) {
  const [state, setState] = useState({ loading: true });
  const load = useCallback(() => send(url).then((data) => setState({ data }), (err) => setState((current) => ({ ...current, loading: false, error: err.message }))), [url]);
  useRefresh(load);
  return { ...state, reload: load };
}

function Explainer() {
  return (
    <details className="panel income-explainer">
      <summary>How your income is calculated</summary>
      <ul>
        <li><strong>Gross sales</strong> is what buyers paid for your delivered orders: product prices plus shipping.</li>
        <li><strong>Shipping fees</strong> go to the courier, so they never count as your income.</li>
        <li><strong>Net income</strong> = product revenue − platform fees − Onetap&apos;s commission − refunds − other deductions. Onetap charges no separate platform fee today, and the commission rate is fixed on each order when it&apos;s delivered.</li>
        <li>A refund takes back that order&apos;s product revenue and returns its commission.</li>
        <li>Income becomes <strong>available</strong> once Onetap holds the money (a prepaid payment is on record, or the courier remitted the COD cash) and the buyer&apos;s 7-day return window has closed.</li>
        <li>Your <strong>available balance</strong> is your available income minus every payout you requested that wasn&apos;t rejected or cancelled.</li>
      </ul>
    </details>
  );
}

function Overview() {
  const { data, loading, error } = useLoad('/api/seller/income');
  const [metric, setMetric] = useState('net');
  const [range, setRange] = useState(30);
  if (!data) return loading ? <div className="skeleton" role="status" aria-label="Loading your income" /> : <p className="form-error" role="alert">{error}</p>;
  const { totals, balance } = data;
  const days = data.trend.slice(-range).map((d) => ({ day: d.date, value: d[metric] }));
  return (
    <>
      <section className="panel" aria-labelledby="income-earnings">
        <div className="panel__head"><h2 id="income-earnings">Earnings</h2><span className="muted">{totals.orders} delivered {totals.orders === 1 ? 'order' : 'orders'}</span></div>
        <StatCards items={[
          { label: 'Total Earnings (net)', value: peso(totals.totalEarnings) },
          { label: 'Total Sales Revenue (gross)', value: peso(totals.totalSales) },
          { label: 'Today', value: peso(totals.today) },
          { label: 'This Week', value: peso(totals.week) },
          { label: 'This Month', value: peso(totals.month) },
        ]} />
      </section>
      <div className="income-pair">
        <section className="panel" aria-labelledby="income-balance">
          <div className="panel__head"><h2 id="income-balance">Balance</h2><Link className="link" href="/seller/income/payouts">Withdraw</Link></div>
          <StatCards items={[
            { label: 'Available Balance', value: peso(balance.available) },
            { label: 'Awaiting Settlement', value: peso(balance.pendingSettlement) },
            { label: 'In Return Window', value: peso(balance.onHold) },
            { label: 'Total Withdrawn', value: peso(balance.withdrawn) },
          ]} />
        </section>
        <section className="panel" aria-labelledby="income-payouts">
          <div className="panel__head"><h2 id="income-payouts">Payouts</h2></div>
          <StatCards items={[
            { label: `Pending (${balance.payouts.pending.count})`, value: peso(balance.payouts.pending.amount) },
            { label: `Processing (${balance.payouts.processing.count})`, value: peso(balance.payouts.processing.amount) },
            { label: `Completed (${balance.payouts.completed.count})`, value: peso(balance.payouts.completed.amount) },
          ]} />
        </section>
      </div>
      <section className="panel" aria-labelledby="income-trend">
        <div className="panel__head">
          <h2 id="income-trend">Sales and Income Trend</h2>
          <div className="income-toggles">
            <div className="order-tabs" role="group" aria-label="Measure">
              {[['net', 'Net income'], ['gross', 'Gross sales']].map(([key, label]) => <button type="button" key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>{label}</button>)}
            </div>
            <div className="order-tabs" role="group" aria-label="Range">
              {[7, 30, 90].map((n) => <button type="button" key={n} aria-pressed={range === n} onClick={() => setRange(n)}>{n} days</button>)}
            </div>
          </div>
        </div>
        <TrendChart title={`${metric === 'net' ? 'Net income' : 'Gross sales'}, last ${range} days`} money labelEvery={range === 7 ? 1 : range === 30 ? 5 : 15} series={[{ label: metric === 'net' ? 'Net income' : 'Gross sales', tone: 'one', values: days }]} />
        <details className="income-table-toggle">
          <summary>Show as table</summary>
          <div className="income-scroll">
            <table className="income-table">
              <thead><tr><th scope="col">Day</th><th scope="col">Orders</th><th scope="col">Gross sales</th><th scope="col">Net income</th></tr></thead>
              <tbody>{data.trend.slice(-range).reverse().map((d) => <tr key={d.date}><th scope="row">{d.date}</th><td>{d.orders}</td><td>{peso(d.gross)}</td><td>{peso(d.net)}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      </section>
      <section className="panel" aria-labelledby="income-recent">
        <div className="panel__head"><h2 id="income-recent">Recent Payouts</h2><Link className="link" href="/seller/income/payouts">All payouts</Link></div>
        <PayoutList payouts={data.payouts.slice(0, 5)} />
      </section>
      <Explainer />
    </>
  );
}

const STATEMENT_LINES = [
  ['grossSales', 'Gross sales', ''],
  ['shippingFees', 'Less: shipping fees passed to couriers', '−'],
  ['productRevenue', 'Product revenue', '=', true],
  ['platformFees', 'Less: platform fees', '−'],
  ['commissions', 'Less: Onetap commission (net of reversals)', '−'],
  ['refunds', 'Less: refunds', '−'],
  ['deductions', 'Less: other deductions', '−'],
  ['netIncome', 'Net income', '=', true],
];
const PERIOD_LABELS = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' };

function Statement() {
  const shop = useStored('session.seller')?.shopName;
  const now = today();
  const [filters, setFilters] = useState({ from: `${now.slice(0, 7)}-01`, to: now, period: 'day' });
  const query = new URLSearchParams(filters).toString();
  const { data, loading, error } = useLoad(`/api/seller/income/statement?${query}`);
  const set = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const monthStart = (offset) => {
    const date = new Date(`${now.slice(0, 7)}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0, 10);
  };
  const quick = [
    ['This month', { from: monthStart(0), to: now }],
    ['Last month', { from: monthStart(-1), to: day(Date.parse(`${monthStart(0)}T00:00:00+08:00`) - 3600 * 1000) }],
    ['This year', { from: `${now.slice(0, 4)}-01-01`, to: now }],
  ];

  return (
    <>
      <section className="panel income-controls" aria-label="Statement options">
        <div className="income-controls__row">
          <label className="admin-date"><span>From</span><input type="date" value={filters.from} max={filters.to} onChange={(e) => set({ from: e.target.value })} /></label>
          <label className="admin-date"><span>To</span><input type="date" value={filters.to} min={filters.from} max={now} onChange={(e) => set({ to: e.target.value })} /></label>
          <label className="admin-select"><span className="sr-only">Summarise by</span>
            <select value={filters.period} onChange={(e) => set({ period: e.target.value })}>
              {Object.entries(PERIOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label} summary</option>)}
            </select>
          </label>
        </div>
        <div className="income-controls__row">
          {quick.map(([label, range]) => <button className="btn-mini" type="button" key={label} onClick={() => set(range)}>{label}</button>)}
          <span className="income-controls__spacer" />
          <a className="btn-mini" href={`/api/seller/income/statement?${query}&format=csv`} download><Icon name="box" /> Download CSV</a>
          <button className="btn-mini btn-mini--primary" type="button" onClick={() => window.print()}>Print or Save PDF</button>
        </div>
      </section>
      {!data && (loading ? <div className="skeleton" role="status" aria-label="Loading the statement" /> : <p className="form-error" role="alert">{error}</p>)}
      {data && (
        <article className="panel income-statement" aria-labelledby="statement-title">
          <header className="income-statement__head">
            <div>
              <h2 id="statement-title">Income Statement</h2>
              <p className="muted">{shop ? `${shop} · ` : ''}{dateOnly(Date.parse(`${data.range.from}T00:00:00+08:00`))} to {dateOnly(Date.parse(`${data.range.to}T00:00:00+08:00`))}</p>
            </div>
            <small className="muted">Generated {dateTime(data.generatedAt)}</small>
          </header>
          {error && <p className="form-error" role="alert">{error}</p>}
          <dl className="income-lines">
            {STATEMENT_LINES.map(([key, label, sign, total]) => (
              <div className={total ? 'is-total' : ''} key={key}>
                <dt>{label}</dt>
                <dd>{sign === '−' && data.summary[key] ? `(${peso(Math.abs(data.summary[key]))})` : peso(data.summary[key])}</dd>
              </div>
            ))}
          </dl>
          <p className="muted income-statement__note">{data.summary.orders} delivered {data.summary.orders === 1 ? 'order' : 'orders'} and {data.summary.refundedOrders} {data.summary.refundedOrders === 1 ? 'refund' : 'refunds'} in this range. Amounts in brackets are taken away.</p>
          <h3>{PERIOD_LABELS[data.period]} summary</h3>
          {data.rows.length ? (
            <div className="income-scroll">
              <table className="income-table">
                <thead>
                  <tr><th scope="col">Period</th><th scope="col">Orders</th><th scope="col">Gross sales</th><th scope="col">Shipping</th><th scope="col">Product revenue</th><th scope="col">Platform fees</th><th scope="col">Commissions</th><th scope="col">Refunds</th><th scope="col">Deductions</th><th scope="col">Net income</th></tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.period}>
                      <th scope="row">{row.period}</th><td>{row.orders}</td><td>{peso(row.grossSales)}</td><td>{peso(row.shippingFees)}</td><td>{peso(row.productRevenue)}</td><td>{peso(row.platformFees)}</td>
                      <td>{peso(row.commissions)}</td><td>{peso(row.refunds)}</td><td>{peso(row.deductions)}</td><td><strong>{peso(row.netIncome)}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><th scope="row">Total</th><td>{data.summary.orders}</td><td>{peso(data.summary.grossSales)}</td><td>{peso(data.summary.shippingFees)}</td><td>{peso(data.summary.productRevenue)}</td><td>{peso(data.summary.platformFees)}</td><td>{peso(data.summary.commissions)}</td><td>{peso(data.summary.refunds)}</td><td>{peso(data.summary.deductions)}</td><td><strong>{peso(data.summary.netIncome)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
          ) : <p className="muted">No delivered orders or refunds in this range.</p>}
        </article>
      )}
    </>
  );
}

function RecordDetail({ orderId }) {
  const { data, error } = useLoad(`/api/seller/income/details/${encodeURIComponent(orderId)}`);
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!data) return <div className="skeleton" role="status" aria-label="Loading the transaction" />;
  const r = data.record;
  const lines = [
    ['Gross amount (buyer paid)', r.gross], ['Shipping fee, passed to the courier', -r.shippingFee], ['Product revenue', r.productRevenue], ['Platform fees', -r.platformFee],
    [`Onetap commission (${r.commissionRate}%${r.refund ? ', reversed by the refund' : ''})`, -r.commission], ['Refund to the buyer', -r.refund], ['Other deductions', -r.deduction],
  ];
  const timeline = [
    ['Order placed', r.orderDate], ['Delivered, income recorded', r.deliveredAt], ['Money settled with Onetap', r.settledAt], ['Return window closed', r.windowEnds <= Date.now() ? r.windowEnds : null],
    ['Refunded to the buyer', r.refundedAt], ['Available to withdraw', r.availableAt],
  ].filter(([, at]) => at);
  return (
    <div className="assistant-form">
      <div className="approval-head">
        <Badge status={INCOME_STATUS[r.status]} />
        <Badge status={INCOME_PAYOUT_STATUS[r.payoutStatus]} />
        <span className="muted">{r.reason}</span>
      </div>
      <section>
        <h3>Breakdown</h3>
        <dl className="income-lines">
          {lines.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value < 0 ? `(${peso(-value)})` : peso(value || 0)}</dd></div>)}
          <div className="is-total"><dt>Net earnings</dt><dd>{peso(r.net)}</dd></div>
        </dl>
      </section>
      <section>
        <h3>Items</h3>
        <ul className="income-items">
          {r.items.map((item) => <li key={`${item.name}-${item.variation}`}><span>{item.qty} × {item.name}{item.variation && ` (${item.variation})`}</span><span>{peso(item.price * item.qty)}</span></li>)}
        </ul>
        <dl className="order-facts order-facts--row">
          <div><dt>Buyer</dt><dd>{r.customer}</dd></div>
          <div><dt>Payment</dt><dd>{r.paymentMethod}</dd></div>
          {r.paymentReference && <div><dt>Payment reference</dt><dd>{r.paymentReference}</dd></div>}
        </dl>
      </section>
      <section>
        <h3>Trail</h3>
        <ol className="timeline order-timeline">
          {timeline.map(([label, at]) => <li className="is-done" key={label}>{label}<small>{dateTime(at)}</small></li>)}
        </ol>
        <p className="muted">Ledger entries: {r.entries.map((e) => `#${e.id} ${e.kind} ${peso(e.net)}`).join(' · ')}</p>
      </section>
      <Link className="btn btn--ghost btn--block" href={`/seller/orders/${encodeURIComponent(r.orderId)}`} onClick={() => Modal.close()}>Open the order</Link>
    </div>
  );
}

const openRecord = (orderId) => Modal.open({ title: `Income for ${orderId}`, variant: 'wide', content: <RecordDetail orderId={orderId} /> });

function Details({ initial }) {
  const list = useAdminList('/income/details', initial, CLIENT);
  useRefresh(list.reload);
  const counts = list.data?.counts || {};
  return (
    <>
      <Tabs list={list} name="status" label="Filter by income status" tabs={[['', 'All'], ...Object.entries(INCOME_STATUS).map(([key, s]) => [key, s.label, counts[key]])]} />
      <FilterBar list={list} placeholder="Order number, product or buyer">
        <SelectFilter list={list} name="payout" label="Payout" options={Object.entries(INCOME_PAYOUT_STATUS).map(([key, s]) => [key, s.label])} />
        <DateFilter list={list} name="from" label="Delivered from" />
        <DateFilter list={list} name="to" label="To" />
      </FilterBar>
      {list.data && <p className="muted income-totals">{list.data.total} {list.data.total === 1 ? 'order' : 'orders'} · gross {peso(list.data.totals.gross)} · net {peso(list.data.totals.net)}</p>}
      <DataTable
        list={list}
        label="Income by order"
        empty="No income yet. Each delivered order appears here."
        rowKey={(row) => row.orderId}
        columns={[
          { label: 'Order', render: (row) => <button className="link" type="button" onClick={() => openRecord(row.orderId)}>{row.orderId}</button> },
          { label: 'Product', render: (row) => <>{row.product}{row.moreItems > 0 && <small className="muted"> +{row.moreItems} more</small>}</> },
          { label: 'Qty', render: (row) => row.quantity },
          { label: 'Order date', sort: 'date', render: (row) => dateOnly(row.orderDate) },
          { label: 'Gross', sort: 'gross', render: (row) => peso(row.gross) },
          { label: 'Platform fees', render: (row) => peso(row.platformFee) },
          { label: 'Commission', render: (row) => peso(row.commission) },
          { label: 'Deductions', render: (row) => peso(row.refund + row.deduction) },
          { label: 'Net', sort: 'net', render: (row) => <strong>{peso(row.net)}</strong> },
          { label: 'Status', render: (row) => <Badge status={INCOME_STATUS[row.status]} /> },
          { label: 'Payout', render: (row) => <Badge status={INCOME_PAYOUT_STATUS[row.payoutStatus]} /> },
        ]}
      />
    </>
  );
}

function PayoutList({ payouts, onCancel }) {
  if (!payouts.length) return <p className="muted">No payouts yet.</p>;
  return (
    <ul className="rider-list">
      {payouts.map((p) => (
        <li key={p.id}>
          <span>
            <span><strong>{p.reference}</strong> · {peso(p.amount)}</span>
            <small className="muted">
              {p.method}{p.method === 'Bank transfer' && ` (${p.provider})`} · {p.accountName} {p.accountNumber} · requested {dateTime(p.requestedAt)}
              {p.completedAt && ` · sent ${dateTime(p.completedAt)}, reference ${p.payoutReference}`}
              {p.note && ` · ${p.note}`}
            </small>
          </span>
          <span>
            <Badge status={PAYOUT_STATUS[p.status]} />
            {onCancel && p.status === 'pending' && <button className="link" type="button" onClick={() => onCancel(p)}>Cancel</button>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function WithdrawForm({ available, min, methods, onDone }) {
  const [values, setValues] = useState({ amount: String(available), method: methods[0], provider: '', accountName: '', accountNumber: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = (name) => ({ value: values[name], error: errors[name], onChange: (e) => setValues({ ...values, [name]: e.target.value }) });
  const bank = values.method === 'Bank transfer';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { reference } = await send('/api/seller/income/payouts', json('POST', values));
      Modal.close();
      toast(`Payout ${reference} requested. Onetap will process it.`, 'success');
      onDone();
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit} noValidate>
      <p className="muted">Available to withdraw: <strong>{peso(available)}</strong>. The minimum is {peso(min)}.</p>
      <TextField id="payout-amount" label="Amount (₱)" inputMode="decimal" required {...field('amount')} />
      <div className="field">
        <label htmlFor="payout-method">Send to</label>
        <select id="payout-method" value={values.method} onChange={(e) => setValues({ ...values, method: e.target.value })}>
          {methods.map((m) => <option key={m}>{m}</option>)}
        </select>
      </div>
      {bank && <TextField id="payout-provider" label="Bank name" required {...field('provider')} />}
      <TextField id="payout-name" label="Account name" autoComplete="name" required {...field('accountName')} />
      <TextField id="payout-number" label={bank ? 'Account number' : `${values.method} mobile number`} inputMode="numeric" required hint={bank ? '6 to 20 digits.' : 'Like 09171234567.'} {...field('accountNumber')} />
      {error && !Object.keys(errors).length && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Requesting…' : 'Request Payout'}</button>
    </form>
  );
}

function Payouts() {
  const { data, loading, error, reload } = useLoad('/api/seller/income');
  const [all, setAll] = useState(null);
  const loadAll = useCallback(() => send('/api/seller/income/payouts').then((body) => setAll(body.payouts)).catch(() => {}), []);
  useEffect(() => {
    loadAll();
  }, [loadAll, data]);
  if (!data) return loading ? <div className="skeleton" role="status" aria-label="Loading your balance" /> : <p className="form-error" role="alert">{error}</p>;
  const { balance } = data;
  const open = (all || data.payouts).some((p) => ['pending', 'processing'].includes(p.status));
  const canWithdraw = balance.available >= data.minPayout && !open;
  const done = () => {
    reload();
    loadAll();
  };
  const cancel = (p) => confirmModal({
    title: `Cancel ${p.reference}?`,
    body: `${peso(p.amount)} goes back to your available balance.`,
    label: 'Cancel Payout',
    danger: true,
    run: async () => {
      await send(`/api/seller/income/payouts/${p.id}`, { method: 'DELETE' });
      toast('Payout cancelled.', 'success');
      done();
    },
  });

  return (
    <>
      <section className="panel income-balance" aria-labelledby="balance-title">
        <div className="panel__head"><h2 id="balance-title">Available Balance</h2></div>
        <p className="income-balance__amount">{peso(balance.available)}</p>
        <button
          className="btn btn--primary"
          type="button"
          disabled={!canWithdraw}
          onClick={() => Modal.open({ title: 'Withdraw your balance', content: <WithdrawForm available={balance.available} min={data.minPayout} methods={data.methods} onDone={done} /> })}
        >
          Withdraw
        </button>
        <p className="muted">
          {open ? 'You have a payout in progress. You can request another once it is done.' : balance.available < data.minPayout ? `You can withdraw once your available balance reaches ${peso(data.minPayout)}.` : 'Onetap processes payouts and tells you when the money is sent.'}
        </p>
        <StatCards items={[
          { label: 'Awaiting Settlement', value: peso(balance.pendingSettlement) },
          { label: 'In Return Window', value: peso(balance.onHold) },
          { label: 'Payouts in Progress', value: peso(balance.payouts.pending.amount + balance.payouts.processing.amount) },
          { label: 'Total Withdrawn', value: peso(balance.withdrawn) },
        ]} />
      </section>
      <section className="panel" aria-labelledby="payouts-title">
        <div className="panel__head"><h2 id="payouts-title">Payout History</h2></div>
        <PayoutList payouts={all || data.payouts} onCancel={cancel} />
      </section>
      <Explainer />
    </>
  );
}

export function SellerIncome({ view, initial = {} }) {
  const current = VIEWS.find(([key]) => key === view);
  return (
    <div className="order-page income-page">
      <PageHead title={current[1]} text={TEXT[view]} />
      <nav className="order-tabs income-nav" aria-label="My Income">
        {VIEWS.map(([key, label, href]) => <Link key={key} href={href} aria-current={key === view ? 'page' : undefined}>{label}</Link>)}
      </nav>
      {view === 'overview' && <Overview />}
      {view === 'statement' && <Statement />}
      {view === 'details' && <Details initial={initial} />}
      {view === 'payouts' && <Payouts />}
    </div>
  );
}
