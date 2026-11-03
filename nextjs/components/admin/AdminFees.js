'use client';

// Fee Management: Onetap's admin fee (charged to sellers) and logistics fee (Onetap's share of the
// delivery fee), each a fixed amount or a percentage. Default Rates sets them for everyone; Admin
// Fee · Sellers and Logistic Fee · Partners give one seller or partner its own rate, or switch the
// fee off for them. Changes apply to orders delivered from then on: every delivered order keeps the
// fees it was recorded with. The server works every fee out (fees.js).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch, Badge, dateTime, DataTable, FilterBar, PageHead, postAdmin, SelectFilter, StatCards, useAdminList, useRefresh } from './AdminUI';
import { confirmModal } from '../SellerProducts';
import { APPLICATION_STATUS, options } from '@/lib/adminLabels';
import { Modal, peso, toast } from '@/lib/ui';

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const apply = (fee, base) => (!fee.value || base <= 0 ? 0 : money(fee.type === 'fixed' ? Math.min(fee.value, base) : (base * fee.value) / 100));
const describe = (fee) => (fee.type === 'fixed' ? `${peso(fee.value)} per order` : `${Number(fee.value)}%`);

const FEES = [
  ['admin', 'Admin Fee', 'Charged to the seller on every delivered order.', 'of the order’s product total (item prices × quantities, without the delivery fee)', 'per order, never more than the product total'],
  ['logistics', 'Logistics Fee', 'Onetap’s share of the delivery fee the buyer paid. The courier gets the rest. Sellers are never charged it.', 'of the order’s delivery fee', 'per order, never more than the delivery fee'],
];

function FeeEditor({ name, title, text, percentBase, fixedNote, fee, limits, error, onChange }) {
  const id = `fee-${name}`;
  return (
    <fieldset className="panel fee-editor">
      <legend className="fee-editor__title">{title}</legend>
      <p className="muted">{text}</p>
      <div className="fee-editor__types" role="radiogroup" aria-label={`${title} type`}>
        {[['percent', 'Percentage (%)'], ['fixed', 'Fixed amount (₱)']].map(([type, label]) => (
          <label key={type} className={`fee-type${fee.type === type ? ' is-on' : ''}`}>
            <input type="radio" name={`${id}-type`} value={type} checked={fee.type === type} onChange={() => onChange({ ...fee, type, value: '' })} />
            {label}
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor={`${id}-value`}>{fee.type === 'percent' ? 'Percentage' : 'Amount'}</label>
        <div className="fee-editor__value">
          {fee.type === 'fixed' && <span aria-hidden="true">₱</span>}
          <input id={`${id}-value`} inputMode="decimal" value={fee.value} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint`} onChange={(e) => onChange({ ...fee, value: e.target.value })} />
          {fee.type === 'percent' && <span aria-hidden="true">%</span>}
        </div>
        <small className="field__hint" id={`${id}-hint`}>{fee.type === 'percent' ? `0 to ${limits.percent}% ${percentBase}.` : `₱0 to ₱${limits.fixed.toLocaleString('en-PH')} ${fixedNote}.`}</small>
        {error && <small className="field__error">{error}</small>}
      </div>
    </fieldset>
  );
}

function Example({ fees }) {
  const [products, setProducts] = useState('1000');
  const [delivery, setDelivery] = useState('80');
  const productTotal = money(products);
  const deliveryFee = money(delivery);
  const adminFee = apply({ ...fees.admin, value: Number(fees.admin.value) || 0 }, productTotal);
  const logisticsFee = apply({ ...fees.logistics, value: Number(fees.logistics.value) || 0 }, deliveryFee);
  return (
    <section className="panel" aria-labelledby="fee-example">
      <div className="panel__head"><h2 id="fee-example">Example order</h2><span className="muted">With the fees above</span></div>
      <div className="fee-example__inputs">
        <label className="admin-date"><span>Product total (₱)</span><input inputMode="decimal" value={products} onChange={(e) => setProducts(e.target.value)} /></label>
        <label className="admin-date"><span>Delivery fee (₱)</span><input inputMode="decimal" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></label>
      </div>
      <div className="fee-example">
        <dl className="income-lines">
          <div><dt>Buyer pays</dt><dd>{peso(productTotal + deliveryFee)}</dd></div>
          <div><dt>Admin fee (from the seller)</dt><dd>{peso(adminFee)}</dd></div>
          <div className="is-total"><dt>Seller earns</dt><dd>{peso(productTotal - adminFee)}</dd></div>
        </dl>
        <dl className="income-lines">
          <div><dt>Logistics fee (from the delivery fee)</dt><dd>{peso(logisticsFee)}</dd></div>
          <div><dt>Courier gets</dt><dd>{peso(deliveryFee - logisticsFee)}</dd></div>
          <div className="is-total"><dt>Onetap earns</dt><dd>{peso(adminFee + logisticsFee)}</dd></div>
        </dl>
      </div>
    </section>
  );
}

export function AdminFees() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(() => adminFetch('/fees').then((body) => {
    setData(body);
    setDraft({ admin: { ...body.fees.admin, value: String(body.fees.admin.value) }, logistics: { ...body.fees.logistics, value: String(body.fees.logistics.value) } });
  }, (err) => setError(err.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  if (!data || !draft) return <div className="order-page admin-page">{error ? <p className="form-error" role="alert">{error}</p> : <div className="skeleton" role="status" aria-label="Loading fees" />}</div>;

  const changed = ['admin', 'logistics'].some((key) => draft[key].type !== data.fees[key].type || Number(draft[key].value) !== data.fees[key].value);
  const save = () => confirmModal({
    title: 'Save the new fees?',
    body: `Admin fee: ${describe({ ...draft.admin, value: Number(draft.admin.value) })}. Logistics fee: ${describe({ ...draft.logistics, value: Number(draft.logistics.value) })}. They apply to orders delivered from now on. Orders already delivered keep their fees.`,
    label: 'Save Fees',
    run: async () => {
      try {
        setErrors({});
        await postAdmin('/fees', draft);
        toast('Fees saved. They apply to orders delivered from now on.', 'success');
        load();
      } catch (err) {
        setErrors(err.fields || {});
        throw err;
      }
    },
  });

  return (
    <div className="order-page admin-page">
      <PageHead title="Fee Management" text="Set Onetap’s default fees. Sellers and logistics partners pay these unless they have their own rate. Each delivered order records the fees in force when it’s delivered, so changes never rewrite past orders. Sellers never see these fees." />
      <FeeTabs />
      <section className="panel">
        <StatCards items={[
          { label: 'Admin fee now', value: describe(data.fees.admin) },
          { label: 'Logistics fee now', value: describe(data.fees.logistics) },
          { label: 'Admin fees earned', value: peso(data.earned.adminFees) },
          { label: 'Logistics fees earned', value: peso(data.earned.logisticsFees) },
        ]} />
        <p className="muted">Earned across {data.earned.orders} delivered {data.earned.orders === 1 ? 'order' : 'orders'}. See each order in Financial Collections.</p>
        <p className="muted">
          <Link className="link" href="/admin/fees/sellers?fee=custom">{data.accounts.seller.custom} {data.accounts.seller.custom === 1 ? 'seller has' : 'sellers have'} their own admin fee</Link>
          {data.accounts.seller.off > 0 && <>, <Link className="link" href="/admin/fees/sellers?fee=off">{data.accounts.seller.off} switched off</Link></>}.
          {' '}<Link className="link" href="/admin/fees/partners?fee=custom">{data.accounts.partner.custom} {data.accounts.partner.custom === 1 ? 'partner has' : 'partners have'} their own logistics fee</Link>
          {data.accounts.partner.off > 0 && <>, <Link className="link" href="/admin/fees/partners?fee=off">{data.accounts.partner.off} switched off</Link></>}.
        </p>
      </section>
      <div className="fee-editors">
        {FEES.map(([name, title, text, percentBase, fixedNote]) => (
          <FeeEditor key={name} name={name} title={title} text={text} percentBase={percentBase} fixedNote={fixedNote} fee={draft[name]} limits={data.limits}
            error={errors[`${name}Value`] || errors[`${name}Type`]} onChange={(fee) => setDraft({ ...draft, [name]: fee })} />
        ))}
      </div>
      <div className="fee-actions">
        <button className="btn btn--primary" type="button" disabled={!changed} onClick={save}>Save Fees</button>
        {changed && <button className="btn btn--ghost" type="button" onClick={load}>Discard Changes</button>}
      </div>
      <Example fees={draft} />
      <section className="panel" aria-labelledby="fee-history">
        <div className="panel__head"><h2 id="fee-history">Change History</h2></div>
        {data.history.length || data.older.length ? (
          <ol className="timeline order-timeline">
            {data.history.map((item) => (
              <li className="is-done" key={`c${item.id}`}>
                {item.kind === 'default' ? 'Default rates' : item.kind === 'seller' ? `Admin fee for ${item.accountName}` : `Logistics fee for ${item.accountName}`}: {changeLabel(item.before)} → {changeLabel(item.after)}
                <small>{dateTime(item.at)} by {item.admin}</small>
              </li>
            ))}
            {data.older.map((item) => (
              <li className="is-done" key={`a${item.at}`}>
                {item.detail.adminFee ? <>Admin fee {item.detail.adminFee.from} → {item.detail.adminFee.to}; logistics fee {item.detail.logisticsFee.from} → {item.detail.logisticsFee.to}</> : <>Commission {item.detail.from}% → {item.detail.to}%</>}
                <small>{dateTime(item.at)} by {item.admin}</small>
              </li>
            ))}
          </ol>
        ) : <p className="muted">No changes yet.</p>}
      </section>
    </div>
  );
}

// The three Fee Management pages.
export function FeeTabs() {
  const pathname = usePathname();
  return (
    <nav className="order-tabs fee-tabs" aria-label="Fee Management">
      {[['/admin/fees', 'Default Rates'], ['/admin/fees/sellers', 'Admin Fee · Sellers'], ['/admin/fees/partners', 'Logistic Fee · Partners']].map(([href, label]) => (
        <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}

const SOURCE = { default: 'default rate', account: 'own rate', off: 'switched off' };
// How an account's fee reads in lists: "5% (default)", "₱20.00 per order", "Switched off".
export const settingLabel = (setting) => (!setting.enabled ? 'Switched off' : `${describe(setting)}${setting.mode === 'default' ? ' (default)' : ''}`);
const changeLabel = (side) => (side.admin ? `admin ${describe(side.admin)}, logistics ${describe(side.logistics)}` : settingLabel(side));

const KIND_TEXT = {
  seller: { fee: 'Admin fee', title: 'Admin Fee', base: 'gross product income (the order’s product total)', unit: 'per completed order', gross: 'Gross product income', net: 'Net income (seller)', orders: 'Orders' },
  partner: { fee: 'Logistics fee', title: 'Logistics Fee', base: 'gross delivery income (the order’s delivery fee)', unit: 'per completed delivery', gross: 'Gross delivery income', net: 'Net income (partner)', orders: 'Deliveries' },
};

function AccountFee({ kind, account, onSaved }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const text = KIND_TEXT[kind];

  const load = useCallback(() => adminFetch(`/fees/accounts/${kind}/${encodeURIComponent(account)}`).then((body) => {
    setData(body);
    setDraft({ enabled: body.setting.enabled, mode: body.setting.mode, type: body.setting.type, value: String(body.setting.value) });
  }, (err) => setError(err.message)), [kind, account]);
  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) return <p className="form-error" role="alert">{error}</p>;
  if (!data || !draft) return <div className="skeleton" role="status" aria-label="Loading the fee" />;

  const fallback = data.defaults[kind === 'seller' ? 'admin' : 'logistics'];
  const rate = draft.mode === 'custom' ? { type: draft.type, value: Number(draft.value) || 0 } : fallback;
  const sample = kind === 'seller' ? 1000 : 80;
  const sampleFee = draft.enabled ? apply(rate, sample) : 0;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError('');
    try {
      const body = await postAdmin(`/fees/accounts/${kind}/${encodeURIComponent(account)}`, draft);
      setData(body);
      setDraft({ enabled: body.setting.enabled, mode: body.setting.mode, type: body.setting.type, value: String(body.setting.value) });
      toast(`${text.fee} saved. It applies to ${kind === 'seller' ? 'orders' : 'deliveries'} completed from now on.`, 'success');
      onSaved();
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.fields ? '' : err.message);
    }
    setBusy(false);
  }

  return (
    <div className="assistant-form account-fee">
      <p className="muted">{kind === 'seller' ? `${data.shopName} · ${data.name || data.account}` : data.name}. Now: <strong>{settingLabel(data.setting)}</strong>{data.setting.updatedBy && <> · changed {dateTime(data.setting.updatedAt)} by {data.setting.updatedBy}</>}</p>
      <form className="account-fee__form" onSubmit={save}>
        <label className="switch">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
          <span>Charge the {text.fee.toLowerCase()}</span>
        </label>
        <fieldset className="choice choice--stack" disabled={!draft.enabled}>
          <legend>Rate</legend>
          <label><input type="radio" name="fee-mode" checked={draft.mode === 'default'} onChange={() => setDraft({ ...draft, mode: 'default' })} /> Default rate ({describe(fallback)})</label>
          <label><input type="radio" name="fee-mode" checked={draft.mode === 'custom'} onChange={() => setDraft({ ...draft, mode: 'custom', value: draft.mode === 'custom' ? draft.value : '' })} /> Own rate</label>
        </fieldset>
        {draft.enabled && draft.mode === 'custom' && (
          <div className="account-fee__rate">
            <div className="fee-editor__types" role="radiogroup" aria-label="Fee type">
              {[['percent', 'Percentage (%)'], ['fixed', 'Fixed amount (₱)']].map(([type, label]) => (
                <label key={type} className={`fee-type${draft.type === type ? ' is-on' : ''}`}>
                  <input type="radio" name="fee-type" value={type} checked={draft.type === type} onChange={() => setDraft({ ...draft, type, value: '' })} />
                  {label}
                </label>
              ))}
            </div>
            <div className="field">
              <label htmlFor="account-fee-value">{draft.type === 'percent' ? 'Percentage' : 'Amount'}</label>
              <div className="fee-editor__value">
                {draft.type === 'fixed' && <span aria-hidden="true">₱</span>}
                <input id="account-fee-value" inputMode="decimal" required value={draft.value} aria-invalid={Boolean(errors.feeValue)} aria-describedby="account-fee-hint" onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
                {draft.type === 'percent' && <span aria-hidden="true">%</span>}
              </div>
              <small className="field__hint" id="account-fee-hint">{draft.type === 'percent' ? `0 to ${data.limits.percent}% of the ${text.base}.` : `₱0 to ₱${data.limits.fixed.toLocaleString('en-PH')} ${text.unit}, never more than the ${kind === 'seller' ? 'product total' : 'delivery fee'}.`}</small>
              {(errors.feeValue || errors.feeType) && <small className="field__error">{errors.feeValue || errors.feeType}</small>}
            </div>
          </div>
        )}
        <p className="muted account-fee__example">On a {peso(sample)} {kind === 'seller' ? 'order' : 'delivery fee'}: fee {peso(sampleFee)}, {kind === 'seller' ? 'seller keeps' : 'partner keeps'} {peso(sample - sampleFee)}.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn--primary" type="submit" disabled={busy}>Save {text.title}</button>
        <p className="muted account-fee__note">Applies to {kind === 'seller' ? 'orders' : 'deliveries'} completed from now on. Completed ones keep the fee they were charged.</p>
      </form>
      <section>
        <h3>Totals</h3>
        <dl className="income-lines">
          <div><dt>{text.orders} completed</dt><dd>{data.totals.orders}</dd></div>
          <div><dt>{text.gross}</dt><dd>{peso(data.totals.gross)}</dd></div>
          <div><dt>{text.fee} deducted</dt><dd>−{peso(data.totals.fee)}</dd></div>
          <div className="is-total"><dt>{text.net}</dt><dd>{peso(data.totals.net)}</dd></div>
        </dl>
      </section>
      <section>
        <h3>Latest fee calculations</h3>
        {data.orders.length ? (
          <div className="admin-table" role="region" aria-label="Latest fee calculations" tabIndex={0}>
            <table>
              <thead><tr><th scope="col">Order</th><th scope="col">Completed</th><th scope="col">Gross</th><th scope="col">Fee</th><th scope="col">Net</th></tr></thead>
              <tbody>
                {data.orders.map((row) => (
                  <tr key={row.orderId}>
                    <td>{row.orderId}</td>
                    <td>{dateTime(row.at)}</td>
                    <td>{peso(row.gross)}</td>
                    <td>{peso(row.fee)}<small className="admin-cell-note">{row.source === 'off' ? 'switched off' : `${describe({ type: row.type, value: row.value })}, ${SOURCE[row.source] || 'default rate'}`}</small></td>
                    <td>{peso(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No completed {kind === 'seller' ? 'orders' : 'deliveries'} yet.</p>}
      </section>
      <section>
        <h3>Change history</h3>
        {data.history.length ? (
          <ol className="timeline order-timeline">
            {data.history.map((item) => <li className="is-done" key={item.id}>{settingLabel(item.before)} → {settingLabel(item.after)}<small>{dateTime(item.at)} by {item.admin}</small></li>)}
          </ol>
        ) : <p className="muted">Never changed. It uses the default rate.</p>}
      </section>
    </div>
  );
}

const openAccountFee = (kind, row, onSaved) => Modal.open({
  title: `${KIND_TEXT[kind].fee}: ${kind === 'seller' ? row.shopName : row.name}`,
  variant: 'wide',
  content: <AccountFee kind={kind} account={row.account} onSaved={onSaved} />,
});

const FEE_OPTIONS = [['default', 'Default rate'], ['custom', 'Own rate'], ['off', 'Switched off']];

function feeCell(row) {
  return (
    <>
      <strong className={row.setting.enabled ? '' : 'muted'}>{settingLabel(row.setting)}</strong>
      {row.setting.updatedBy && <small className="admin-cell-note">{dateTime(row.setting.updatedAt)} · {row.setting.updatedBy}</small>}
    </>
  );
}

export function AdminSellerFees({ initial }) {
  const list = useAdminList('/fees/sellers', { dir: 'asc', ...initial });
  useRefresh(list.reload);
  const defaults = list.data?.defaults;
  return (
    <div className="order-page admin-page">
      <PageHead title="Fee Management" text="Each seller's admin fee: the default rate, their own percentage or fixed amount, or none. It's taken from completed orders only, once per order." />
      <FeeTabs />
      {defaults && <p className="muted">Default admin fee: <strong>{describe(defaults.admin)}</strong>. <Link className="link" href="/admin/fees">Change the default</Link></p>}
      <FilterBar list={list} placeholder="Seller, store, username or email">
        <SelectFilter list={list} name="status" label="Account status" options={options(APPLICATION_STATUS)} />
        <SelectFilter list={list} name="fee" label="Admin fee" options={FEE_OPTIONS} />
      </FilterBar>
      <DataTable
        list={list}
        label="Seller admin fees"
        empty="No sellers here"
        rowKey={(row) => row.account}
        columns={[
          { label: 'Seller Name', sort: 'seller', render: (row) => <>{row.name}<small className="admin-cell-note">{row.account}</small></> },
          { label: 'Store Name', render: (row) => row.shopName },
          { label: 'Account Status', render: (row) => <Badge status={APPLICATION_STATUS[row.status]} /> },
          { label: 'Admin Fee', sort: 'updated', render: feeCell },
          { label: 'Orders', render: (row) => row.orders },
          { label: 'Gross Income', sort: 'gross', render: (row) => peso(row.gross) },
          { label: 'Admin Fees', sort: 'fees', render: (row) => peso(row.fee) },
          { label: 'Net Income', render: (row) => peso(row.net) },
          { label: 'Actions', render: (row) => <button className="btn-mini" type="button" aria-label={`Edit admin fee for ${row.shopName}`} onClick={() => openAccountFee('seller', row, list.reload)}>Edit</button> },
        ]}
      />
    </div>
  );
}

export function AdminPartnerFees({ initial }) {
  const list = useAdminList('/fees/partners', { dir: 'asc', ...initial });
  useRefresh(list.reload);
  const defaults = list.data?.defaults;
  return (
    <div className="order-page admin-page">
      <PageHead title="Fee Management" text="Each logistics partner's logistics fee, Onetap's share of the delivery fee: the default rate, their own percentage or fixed amount, or none. It's taken from completed deliveries only, once per delivery." />
      <FeeTabs />
      {defaults && <p className="muted">Default logistics fee: <strong>{describe(defaults.logistics)}</strong>. <Link className="link" href="/admin/fees">Change the default</Link></p>}
      <FilterBar list={list} placeholder="Partner name">
        <SelectFilter list={list} name="status" label="Account status" options={[['active', 'Active'], ['inactive', 'Inactive']]} />
        <SelectFilter list={list} name="fee" label="Logistics fee" options={FEE_OPTIONS} />
      </FilterBar>
      <DataTable
        list={list}
        label="Logistics partner fees"
        empty="No logistics partners here"
        rowKey={(row) => row.account}
        columns={[
          { label: 'Logistics Partner', sort: 'partner', render: (row) => row.name },
          { label: 'Account Status', render: (row) => <Badge status={row.status === 'active' ? { label: 'Active', tone: 'ok' } : { label: 'Inactive', tone: 'neutral' }} /> },
          { label: 'Logistics Fee', sort: 'updated', render: feeCell },
          { label: 'Deliveries', render: (row) => row.orders },
          { label: 'Gross Delivery Income', sort: 'gross', render: (row) => peso(row.gross) },
          { label: 'Logistics Fees', sort: 'fees', render: (row) => peso(row.fee) },
          { label: 'Net Income', render: (row) => peso(row.net) },
          { label: 'Actions', render: (row) => <button className="btn-mini" type="button" aria-label={`Edit logistics fee for ${row.name}`} onClick={() => openAccountFee('partner', row, list.reload)}>Edit</button> },
        ]}
      />
    </div>
  );
}
