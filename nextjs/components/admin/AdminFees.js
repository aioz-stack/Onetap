'use client';

// Fee Management: Onetap's admin fee (charged to sellers) and logistics fee (Onetap's share of the
// delivery fee), each a fixed amount or a percentage. Changes apply to orders delivered from then
// on: every delivered order keeps the fees it was recorded with.

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, dateTime, PageHead, postAdmin, StatCards } from './AdminUI';
import { confirmModal } from '../SellerProducts';
import { peso, toast } from '@/lib/ui';

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
      <PageHead title="Fee Management" text="Set Onetap’s fees. Each delivered order records the fees in force when it’s delivered, so changes never rewrite past orders. Sellers never see these fees." />
      <section className="panel">
        <StatCards items={[
          { label: 'Admin fee now', value: describe(data.fees.admin) },
          { label: 'Logistics fee now', value: describe(data.fees.logistics) },
          { label: 'Admin fees earned', value: peso(data.earned.adminFees) },
          { label: 'Logistics fees earned', value: peso(data.earned.logisticsFees) },
        ]} />
        <p className="muted">Earned across {data.earned.orders} delivered {data.earned.orders === 1 ? 'order' : 'orders'}. See each order in Financial Collections.</p>
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
        {data.history.length ? (
          <ol className="timeline order-timeline">
            {data.history.map((item) => (
              <li className="is-done" key={item.at}>
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
