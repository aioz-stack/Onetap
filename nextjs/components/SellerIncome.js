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
  ['accounts', 'Bank Accounts', '/seller/income/accounts'],
];

const TEXT = {
  overview: 'Your net income, released weekly every Tuesday at 8:00 AM.',
  statement: 'A statement of your income for any range of dates.',
  details: 'Every delivered order and what you earned from it.',
  payouts: 'Withdraw your released income and follow your payouts.',
  accounts: 'The bank accounts and e-wallets your payouts can go to.',
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
        <li>An order&apos;s income becomes <strong>eligible</strong> once Onetap holds the money (a prepaid payment is on record, or the courier remitted the COD cash) and the buyer&apos;s 7-day return window has closed with no return open.</li>
        <li>Eligible income is paid weekly. Everything that becomes eligible from Monday 12:00 AM to Sunday 11:59 PM is <strong>Pending</strong>, and is <strong>Released</strong> the following Tuesday at 8:00 AM.</li>
        <li><strong>Total Income</strong> = Released + Pending + income not yet eligible.</li>
        <li>Your <strong>available balance</strong> is your released income minus every payout you requested that wasn&apos;t rejected or cancelled.</li>
      </ul>
    </details>
  );
}

const when = (ms) => new Date(ms).toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });

function IncomeCard({ id, label, value, icon, tone = '', children }) {
  return (
    <article className={`panel income-card${tone ? ` income-card--${tone}` : ''}`} aria-labelledby={`income-card-${id}`}>
      <h2 id={`income-card-${id}`}><Icon name={icon} /> {label}</h2>
      <p className="income-card__value">{peso(value)}</p>
      <p className="income-card__note">{children}</p>
    </article>
  );
}

function Overview() {
  const { data, loading, error } = useLoad('/api/seller/income');
  const [metric, setMetric] = useState('net');
  const [range, setRange] = useState(30);
  if (!data) return loading ? <div className="skeleton" role="status" aria-label="Loading your income" /> : <p className="form-error" role="alert">{error}</p>;
  const { totals, balance, income } = data;
  const days = data.trend.slice(-range).map((d) => ({ day: d.date, value: d[metric] }));
  const monthName = new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
  return (
    <>
      <section className="income-cards" aria-label="Income summary">
        <IncomeCard id="pending" label="Pending Income" value={income.pending} icon="clock" tone="pending">
          {income.releases.length ? income.releases.map((r) => <span className="income-card__line" key={r.at}>{peso(r.amount)} releases {when(r.at)}</span>) : <span className="income-card__line">Nothing pending. The next release is {when(income.cycle.nextRelease)}.</span>}
          <span className="income-card__line">This cycle: {when(income.cycle.from)} to {when(income.cycle.to)}.</span>
        </IncomeCard>
        <IncomeCard id="released" label="Released Income" value={income.released} icon="check" tone="released">
          Released every Tuesday at 8:00 AM. {peso(balance.available)} available to withdraw.
        </IncomeCard>
        <IncomeCard id="month" label="This Month" value={income.month} icon="chart">
          Net income from {monthName}&apos;s transactions.
        </IncomeCard>
        <IncomeCard id="total" label="Total Income" value={income.total} icon="wallet">
          From {totals.orders} completed {totals.orders === 1 ? 'order' : 'orders'}. {income.notYetEligible > 0 && <>{peso(income.notYetEligible)} isn&apos;t eligible yet.</>}
        </IncomeCard>
      </section>
      <div className="income-pair">
        <section className="panel" aria-labelledby="income-balance">
          <div className="panel__head"><h2 id="income-balance">Balance</h2><Link className="link" href="/seller/income/payouts">Withdraw</Link></div>
          <StatCards items={[
            { label: 'Available to Withdraw', value: peso(balance.available) },
            { label: 'Total Withdrawn', value: peso(balance.withdrawn) },
            { label: 'Awaiting Settlement', value: peso(balance.pendingSettlement) },
            { label: 'In Return Window', value: peso(balance.onHold) },
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
    ['Eligible for release', r.eligibleAt], ['Refunded to the buyer', r.refundedAt], [r.releasedAt ? 'Released' : 'Scheduled release', r.releasedAt || r.releaseAt],
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
              {p.provider} {p.accountNumber} · {p.accountName} · requested {dateTime(p.requestedAt)}
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

// Withdrawals go to one of the seller's verified saved accounts, the default one first.
function WithdrawForm({ available, min, accounts, onDone }) {
  const verified = accounts.filter((a) => a.status === 'verified');
  const [values, setValues] = useState({ amount: String(available), accountId: (verified.find((a) => a.isDefault) || verified[0])?.id || '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  if (!verified.length) {
    return (
      <div className="assistant-form">
        <p>You need a verified bank or e-wallet account to withdraw.</p>
        <p className="muted">{accounts.length ? 'Your saved accounts are still waiting for verification by Onetap.' : 'Add one in Bank Accounts. Onetap verifies it before money can go to it.'}</p>
        <Link className="btn btn--primary btn--block" href="/seller/income/accounts" onClick={() => Modal.close()}>Go to Bank Accounts</Link>
      </div>
    );
  }

  return (
    <form className="assistant-form" onSubmit={submit} noValidate>
      <p className="muted">Available to withdraw: <strong>{peso(available)}</strong>. The minimum is {peso(min)}.</p>
      <TextField id="payout-amount" label="Amount (₱)" inputMode="decimal" required value={values.amount} error={errors.amount} onChange={(e) => setValues({ ...values, amount: e.target.value })} />
      <fieldset className="choice payout-accounts">
        <legend>Send to</legend>
        {verified.map((a) => (
          <label key={a.id} className="payout-choice">
            <input type="radio" name="accountId" value={a.id} checked={values.accountId === a.id} onChange={() => setValues({ ...values, accountId: a.id })} />
            <span><strong>{a.provider}</strong> {a.number}{a.isDefault && <span className="order-badge order-badge--info">Default</span>}<small className="muted">{a.holderName}{a.accountType && ` · ${a.accountType}`}</small></span>
          </label>
        ))}
        {errors.accountId && <small className="field__error">{errors.accountId}</small>}
      </fieldset>
      {accounts.length > verified.length && <p className="muted">Accounts still waiting for verification aren&apos;t shown.</p>}
      {error && !Object.keys(errors).length && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Requesting…' : 'Request Payout'}</button>
    </form>
  );
}

const ACCOUNT_STATUS = {
  pending: { label: 'Waiting for Verification', tone: 'warn' },
  verified: { label: 'Verified', tone: 'ok' },
  rejected: { label: 'Not Verified', tone: 'danger' },
};

// Add or edit a saved account. The provider list follows the account type. Editing never shows
// the saved number: a new one replaces it, and a blank field keeps it.
function AccountForm({ setup, account, onSaved }) {
  const [values, setValues] = useState({
    kind: account?.kind || 'bank', providerId: account?.providerId || '', holderName: account?.holderName || '', accountType: account?.accountType || setup.bankAccountTypes[0], number: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const providers = setup.providers.filter((p) => p.kind === values.kind);
  const chosen = providers.find((p) => p.id === values.providerId);
  const bank = values.kind === 'bank';
  const set = (patch) => setValues((current) => ({ ...current, ...patch }));
  const digits = chosen ? (chosen.minDigits === chosen.maxDigits ? `${chosen.minDigits} digits` : `${chosen.minDigits} to ${chosen.maxDigits} digits`) : '';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const result = account
        ? await send(`/api/seller/payout-accounts/${account.id}`, json('PATCH', values))
        : await send('/api/seller/payout-accounts', json('POST', values));
      Modal.close();
      toast(account ? (result.reverify ? 'Account updated. Onetap will verify it again.' : 'Account updated.') : 'Account saved. Onetap will verify it before you can withdraw to it.', 'success');
      onSaved();
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="account-kind">Account Type</label>
        <select id="account-kind" value={values.kind} disabled={Boolean(account)} onChange={(e) => set({ kind: e.target.value, providerId: '', number: '' })} aria-invalid={Boolean(errors.kind)}>
          {Object.entries(setup.kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        {errors.kind && <small className="field__error">{errors.kind}</small>}
      </div>
      <div className="field">
        <label htmlFor="account-provider">{bank ? 'Bank Name' : 'E-Wallet Provider'}</label>
        <select id="account-provider" value={values.providerId} onChange={(e) => set({ providerId: e.target.value })} aria-invalid={Boolean(errors.providerId)} required>
          <option value="">{bank ? 'Choose a bank' : 'Choose an e-wallet'}</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {errors.providerId && <small className="field__error">{errors.providerId}</small>}
      </div>
      <TextField id="account-holder" label="Account Holder Name" autoComplete="name" required value={values.holderName} error={errors.holderName} hint="Exactly as the bank or wallet shows it." onChange={(e) => set({ holderName: e.target.value })} />
      {bank && (
        <div className="field">
          <label htmlFor="account-type">Bank Account Type</label>
          <select id="account-type" value={values.accountType} onChange={(e) => set({ accountType: e.target.value })} aria-invalid={Boolean(errors.accountType)}>
            {setup.bankAccountTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
          {errors.accountType && <small className="field__error">{errors.accountType}</small>}
        </div>
      )}
      <TextField
        id="account-number"
        label={bank ? 'Account Number' : 'Registered Mobile Number'}
        inputMode={bank ? 'numeric' : 'tel'}
        autoComplete="off"
        required={!account}
        placeholder={account ? `Leave blank to keep ${account.number}` : bank ? '' : '0917 123 4567'}
        hint={bank ? (digits ? `${chosen.name} account numbers have ${digits}.` : 'Choose your bank first.') : 'The mobile number registered to the wallet.'}
        value={values.number}
        error={errors.number}
        onChange={(e) => set({ number: e.target.value })}
      />
      {account && <p className="muted">Changing the provider, number or holder name means Onetap verifies the account again.</p>}
      {error && !Object.keys(errors).length && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Saving…' : account ? 'Save Changes' : 'Save Account'}</button>
    </form>
  );
}

function BankAccounts() {
  const { data, loading, error, reload } = useLoad('/api/seller/payout-accounts');
  if (!data) return loading ? <div className="skeleton" role="status" aria-label="Loading your accounts" /> : <p className="form-error" role="alert">{error}</p>;
  const open = (account) => Modal.open({ title: account ? `Edit ${account.provider} ${account.number}` : 'Add a bank or e-wallet account', content: <AccountForm setup={data} account={account} onSaved={reload} /> });
  const makeDefault = async (a) => {
    try {
      await send(`/api/seller/payout-accounts/${a.id}`, json('POST', { action: 'default' }));
      toast(`${a.provider} ${a.number} is now your default withdrawal account.`, 'success');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const remove = (a) => confirmModal({
    title: `Delete ${a.provider} ${a.number}?`,
    body: 'You can no longer withdraw to it. Past payouts to it stay in your history.',
    label: 'Delete Account',
    danger: true,
    run: async () => {
      await send(`/api/seller/payout-accounts/${a.id}`, { method: 'DELETE' });
      toast('Account deleted.', 'success');
      reload();
    },
  });

  return (
    <>
      <section className="panel" aria-labelledby="accounts-title">
        <div className="panel__head">
          <h2 id="accounts-title">Saved Accounts</h2>
          <span className="muted">{data.accounts.length} of {data.max}</span>
          <button className="btn btn--primary income-head-action" type="button" disabled={data.accounts.length >= data.max} onClick={() => open(null)}>Add Bank Account</button>
        </div>
        {data.accounts.length ? (
          <ul className="payout-account-list">
            {data.accounts.map((a) => (
              <li key={a.id} className="payout-account">
                <span className="payout-account__icon" aria-hidden="true"><Icon name={a.kind === 'bank' ? 'store' : 'wallet'} /></span>
                <div className="payout-account__main">
                  <strong>{a.provider}</strong>
                  <span className="payout-account__number">{a.number}</span>
                  <small className="muted">{a.holderName} · {a.kindLabel}{a.accountType && ` · ${a.accountType}`}</small>
                  {a.reviewNote && <small className="field__error">{a.reviewNote}</small>}
                </div>
                <div className="payout-account__side">
                  <span className="payout-account__badges">
                    {a.isDefault && <span className="order-badge order-badge--info">Default</span>}
                    <Badge status={ACCOUNT_STATUS[a.status]} />
                  </span>
                  <span className="payout-account__actions">
                    {!a.isDefault && <button className="link" type="button" onClick={() => makeDefault(a)}>Set as Default</button>}
                    <button className="link" type="button" onClick={() => open(a)}>Edit</button>
                    <button className="link link--danger" type="button" onClick={() => remove(a)}>Delete</button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No accounts yet. Add a bank account or e-wallet to withdraw your released income.</p>}
      </section>
      <section className="panel income-explainer">
        <h2 className="sr-only">About saved accounts</h2>
        <ul>
          <li>Onetap verifies each account before money can go to it. You&apos;ll get a notification when it&apos;s done.</li>
          <li>Your default account is chosen first when you withdraw. Only verified accounts can receive payouts.</li>
          <li>Account numbers are stored encrypted, and only the last four digits are ever shown.</li>
          <li>An account can only be registered once on Onetap.</li>
        </ul>
      </section>
    </>
  );
}

function Payouts() {
  const { data, loading, error, reload } = useLoad('/api/seller/income');
  const accounts = useLoad('/api/seller/payout-accounts');
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
          onClick={() => Modal.open({ title: 'Withdraw your balance', content: <WithdrawForm available={balance.available} min={data.minPayout} accounts={accounts.data?.accounts || []} onDone={done} /> })}
        >
          Withdraw
        </button>
        <p className="muted">
          {open ? 'You have a payout in progress. You can request another once it is done.' : balance.available < data.minPayout ? `You can withdraw once your released income reaches ${peso(data.minPayout)}. ${peso(balance.pendingRelease)} is pending release on ${when(data.income.cycle.nextRelease)}.` : 'Withdraw your released income. Onetap processes payouts and tells you when the money is sent.'}
        </p>
        <StatCards items={[
          { label: 'Pending Release', value: peso(balance.pendingRelease) },
          { label: 'Not Yet Eligible', value: peso(balance.notYetEligible) },
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
      {view === 'accounts' && <BankAccounts />}
    </div>
  );
}
