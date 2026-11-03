'use client';

// Checkout: the items ticked in the cart, one order per store, paid by Cash on Delivery. Each
// store's shipping fee comes from the rates of the partner that delivers it (`checkoutQuote`), and
// everything is worked out again whenever the ticked items, quantities or delivery area change. The
// server recalculates prices, stock and shipping when the order is placed, from the same cart.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Form, Sections } from './Forms';
import { cartItemNote, findCartItem, groupCart, liveProducts, loadLiveProducts, openCart, QtyStepper } from './Storefront';
import { Cart, useCart } from '@/lib/cart';
import { SHIPPING_ZONES } from '@/lib/data';
import { checkoutQuote } from '@/lib/products';
import { logisticsOptions } from '@/lib/productsApi';
import { Purchases } from '@/lib/purchases';
import { checkoutSchema, PAYMENT_METHODS, serviceAddressErrors } from '@/lib/schemas';
import { FieldError } from '@/lib/store';
import { peso, toast } from '@/lib/ui';

const COD = PAYMENT_METHODS[0];

export default function Checkout({ customer }) {
  const router = useRouter();
  const items = useCart();
  const live = liveProducts.use();
  const [loaded, setLoaded] = useState(false);
  const [partners, setPartners] = useState([]);
  const [zone, setZone] = useState(SHIPPING_ZONES[0]);
  const checkoutKey = useRef('');

  useEffect(() => {
    Promise.all([loadLiveProducts(), Cart.sync(), logisticsOptions().then(setPartners).catch(() => {})]).finally(() => setLoaded(true));
  }, []);

  // A changed cart is a new checkout, so a retry after a change can't return the earlier result.
  const chosenKeys = items.filter((item) => item.selected).map((item) => `${item.key}×${item.qty}`).join('|');
  useEffect(() => {
    checkoutKey.current = '';
  }, [chosenKeys, zone]);

  const stores = groupCart(items, live)
    .map((store) => ({ ...store, items: store.items.filter((item) => item.buyable && item.selected) }))
    .filter((store) => store.items.length)
    .map((store) => {
      const quote = checkoutQuote(store.items.map((item) => ({ product: item.product.listing, qty: item.qty })), zone, partners);
      const subtotal = store.items.reduce((sum, item) => sum + item.product.price * item.qty, 0);
      return { ...store, quote, subtotal, total: subtotal + quote.fee };
    });
  const lines = stores.flatMap((store) => store.items);
  const left = items.filter((item) => !lines.some((line) => line.key === item.key));
  const subtotal = stores.reduce((sum, store) => sum + store.subtotal, 0);
  const shipping = stores.reduce((sum, store) => sum + store.quote.fee, 0);
  const overStock = lines.find((item) => item.qty > item.stock);
  const noCourier = stores.find((store) => !store.quote.partner);

  async function place(address) {
    const [outside] = Object.entries(serviceAddressErrors(address));
    if (outside) throw new FieldError(...outside);
    if (!lines.length) throw new Error('Select at least one item to check out.');
    // Kept across a repeated click or a retry, so one checkout can't create two sets of orders.
    checkoutKey.current ||= `${new Date().getTime()}-${Math.random().toString(36).slice(2)}`;
    try {
      await Purchases.place({ address, zone, payment: COD, checkoutKey: checkoutKey.current, expect: lines.map((item) => ({ key: item.key, qty: item.qty })) });
    } catch (err) {
      loadLiveProducts();
      Cart.sync();
      throw err;
    }
    await Cart.sync();
    toast(stores.length > 1 ? `${stores.length} orders were placed, one for each store.` : 'Your order was placed.', 'success');
    router.push('/orders');
  }

  if (!loaded) {
    return <section className="container checkout"><h1 tabIndex={-1}>Checkout</h1><div className="skeleton" role="status" aria-label="Loading your cart" /></section>;
  }

  if (!stores.length) {
    const anyBuyable = items.some((item) => findCartItem(item.key, live)?.listing);
    return (
      <section className="container checkout">
        <h1 tabIndex={-1}>Checkout</h1>
        <div className="panel order-empty">
          <h2>{!items.length ? 'Your cart is empty' : anyBuyable ? 'No items selected' : 'Nothing in your cart can be ordered'}</h2>
          {items.length > 0 && <p className="muted">{anyBuyable ? 'Tick the items you want in your cart, then check out.' : "Demo products can't be bought. Add a product sold by an Onetap seller."}</p>}
          <div className="checkout__links">
            {items.length > 0 ? <button className="btn-mini btn-mini--primary" type="button" onClick={openCart}>Open Cart</button> : <Link className="btn-mini btn-mini--primary" href="/#products">Browse Deals</Link>}
            <Link className="btn-mini" href="/orders">View My Purchases</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="container checkout">
      <h1 tabIndex={-1}>Checkout</h1>
      <Form className="checkout__grid" id="checkout-form" onSubmit={place}>
        <div className="checkout__main">
          <section className="panel">
            <Sections schema={checkoutSchema(customer)} prefix="checkout" />
            <div className="field">
              <label htmlFor="checkout-zone">Delivery Area</label>
              <select id="checkout-zone" name="zone-choice" value={zone} onChange={(e) => setZone(e.target.value)}>
                {SHIPPING_ZONES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </section>

          {stores.map((store, i) => (
            <section className="panel checkout-store" key={store.id} aria-label={`Order ${i + 1}: ${store.name}`}>
              <div className="panel__head">
                <h2>{store.name}</h2>
                {stores.length > 1 && <span className="muted">Order {i + 1} of {stores.length}</span>}
              </div>
              <ul className="order-items">
                {store.items.map((item) => {
                  const note = cartItemNote(item);
                  return (
                    <li key={item.key}>
                      <img className="deal__image" src={item.product.image} alt="" />
                      <span className="order-items__text">
                        <strong>{item.product.listing.name}</strong>
                        {item.product.variation && <small>{item.product.variation}</small>}
                        <small>{peso(item.product.price)} each</small>
                        {note && <small className="form-error">{note}</small>}
                      </span>
                      <QtyStepper item={item} name={item.product.listing.name} />
                      <span className="order-items__price">{peso(item.product.price * item.qty)}</span>
                    </li>
                  );
                })}
              </ul>
              <dl className="order-sum checkout-store__sum">
                <div><dt>Subtotal</dt><dd>{peso(store.subtotal)}</dd></div>
                <div>
                  <dt>Shipping fee{store.quote.partner && <small> via {store.quote.partner.name}</small>}</dt>
                  <dd>{store.quote.partner ? peso(store.quote.fee) : 'No courier'}</dd>
                </div>
                <div className="order-sum__total"><dt>Store total</dt><dd>{peso(store.total)}</dd></div>
              </dl>
            </section>
          ))}

          {left.length > 0 && <p className="order-card__note">{left.length === 1 ? '1 item stays' : `${left.length} items stay`} in your cart, because {left.length === 1 ? "it isn't" : "they aren't"} ticked or can&apos;t be bought. <button className="link" type="button" onClick={openCart}>Edit your cart</button></p>}
        </div>

        <aside className="panel checkout__summary" aria-label="Order summary">
          <h2 className="checkout__title">Order Summary</h2>
          <dl className="order-sum">
            <div><dt>Payment Method</dt><dd>{COD}</dd></div>
          </dl>
          <p className="muted checkout__note">Pay the rider in cash when your order arrives.</p>
          <dl className="order-sum">
            <div><dt>Subtotal ({lines.length} {lines.length === 1 ? 'item' : 'items'})</dt><dd>{peso(subtotal)}</dd></div>
            <div><dt>Shipping Fee</dt><dd>{peso(shipping)}</dd></div>
            {stores.length > 1 && stores.map((store) => (
              <div className="order-sum__sub" key={store.id}><dt>{store.name}{store.quote.partner && `, ${store.quote.partner.name}`}</dt><dd>{peso(store.quote.fee)}</dd></div>
            ))}
            <div className="order-sum__total"><dt>Total Amount</dt><dd>{peso(subtotal + shipping)}</dd></div>
          </dl>
          {stores.length > 1 && <p className="muted checkout__note">You&apos;ll get {stores.length} orders, one for each store, each delivered and paid for separately.</p>}
          {overStock && <p className="form-error">Only {overStock.stock} left of {overStock.product.listing.name}. Lower the quantity.</p>}
          {noCourier && <p className="form-error">No courier delivers {noCourier.name}&apos;s items to {zone} with Cash on Delivery right now.</p>}
          <p className="form-error" role="alert" />
          <button className="btn btn--primary btn--block" type="submit" disabled={Boolean(overStock || noCourier)}>Place Order · {peso(subtotal + shipping)}</button>
        </aside>
      </Form>
    </section>
  );
}
