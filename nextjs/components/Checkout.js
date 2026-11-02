'use client';

// Checkout. The summary here is an estimate for the buyer: the server recalculates prices,
// stock and shipping when the order is placed.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Form, Sections } from './Forms';
import { confirmModal } from './SellerProducts';
import { Cart, findCartItem, liveProducts, loadLiveProducts } from './Storefront';
import { SHIPPING_ZONES } from '@/lib/data';
import { checkoutShippingFee, findSaleRow } from '@/lib/products';
import { logisticsOptions } from '@/lib/productsApi';
import { Purchases } from '@/lib/purchases';
import { checkoutSchema, PAYMENT_METHODS, serviceAddressErrors } from '@/lib/schemas';
import { FieldError, useStored } from '@/lib/store';
import { peso, toast } from '@/lib/ui';

function groupByShop(rows) {
  const shops = new Map();
  rows.forEach((row) => {
    const { seller, shopName } = row.product.listing;
    const shop = shops.get(seller) || { seller, shopName, rows: [] };
    shops.set(seller, { ...shop, rows: [...shop.rows, row] });
  });
  return [...shops.values()];
}

export default function Checkout({ customer }) {
  const router = useRouter();
  const cart = useStored('cart', {});
  const live = liveProducts.use();
  const [loaded, setLoaded] = useState(false);
  const [partners, setPartners] = useState([]);
  const [zone, setZone] = useState(SHIPPING_ZONES[0]);
  const [payment, setPayment] = useState(PAYMENT_METHODS[0]);
  const checkoutKey = useRef('');

  useEffect(() => {
    Promise.all([loadLiveProducts(), logisticsOptions().then(setPartners).catch(() => {})]).finally(() => setLoaded(true));
  }, []);

  const rows = useMemo(() => Object.entries(cart).map(([key, qty]) => ({ key, qty, product: findCartItem(key, live) })), [cart, live]);
  const unavailable = rows.filter((row) => !row.product?.listing);
  const shops = groupByShop(rows.filter((row) => row.product?.listing));
  const priced = shops.map((shop) => ({
    ...shop,
    fee: checkoutShippingFee(shop.rows.map((row) => ({ product: row.product.listing, qty: row.qty })), zone, partners),
    subtotal: shop.rows.reduce((sum, row) => sum + row.product.price * row.qty, 0),
  }));
  const total = priced.reduce((sum, shop) => sum + shop.subtotal + shop.fee, 0);
  const overStock = priced.flatMap((shop) => shop.rows).filter((row) => Number(findSaleRow(row.product.listing, row.product.variation)?.stock) < row.qty);

  async function place(address) {
    const [outside] = Object.entries(serviceAddressErrors(address));
    if (outside) throw new FieldError(...outside);
    const lines = priced.flatMap((shop) => shop.rows.map((row) => ({ productId: row.product.listing.id, variation: row.product.variation, qty: row.qty })));
    // Kept across a repeated click or a retry, so one checkout can't create two sets of orders.
    checkoutKey.current ||= `${new Date().getTime()}-${Math.random().toString(36).slice(2)}`;
    let orders;
    try {
      orders = await Purchases.place({ lines, address, zone, payment, checkoutKey: checkoutKey.current });
    } catch (err) {
      loadLiveProducts();
      throw err;
    }
    priced.flatMap((shop) => shop.rows).forEach((row) => Cart.change(row.key, -row.qty));
    if (payment === 'Cash on Delivery') {
      toast('Your order was placed.', 'success');
      router.push('/orders');
      return;
    }
    confirmModal({
      title: 'Confirm payment',
      body: `This is a simulated ${payment} payment, so no money moves. If you close this, your order stays unpaid in My Purchases.`,
      label: `Pay ${peso(orders.reduce((sum, order) => sum + order.total, 0))}`,
      run: async () => {
        await Purchases.act(orders.map((order) => order.id), 'pay');
        toast('Payment confirmed.', 'success');
        router.push('/orders');
      },
    });
  }

  if (!loaded) {
    return <section className="container checkout"><h1 tabIndex={-1}>Checkout</h1><div className="skeleton" role="status" aria-label="Loading your cart" /></section>;
  }

  if (!priced.length) {
    return (
      <section className="container checkout">
        <h1 tabIndex={-1}>Checkout</h1>
        <div className="panel order-empty">
          <h2>{unavailable.length ? 'Nothing in your cart can be ordered' : 'Your cart is empty'}</h2>
          {unavailable.length > 0 && <p className="muted">Demo products can't be bought. Add a product sold by an Onetap seller.</p>}
          <div className="checkout__links">
            <Link className="btn-mini btn-mini--primary" href="/#products">Browse Deals</Link>
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

          {priced.map((shop) => (
            <section className="panel" key={shop.seller}>
              <div className="panel__head"><h2>{shop.shopName}</h2></div>
              <ul className="order-items">
                {shop.rows.map((row) => (
                  <li key={row.key}>
                    <img className="deal__image" src={row.product.image} alt="" />
                    <span className="order-items__text">
                      <strong>{row.product.listing.name}</strong>
                      {row.product.variation && <small>{row.product.variation}</small>}
                    </span>
                    <span className="order-items__qty">x{row.qty}</span>
                    <span className="order-items__price">{peso(row.product.price * row.qty)}</span>
                  </li>
                ))}
              </ul>
              <p className="sales-total">Standard shipping: <strong>{peso(shop.fee)}</strong></p>
            </section>
          ))}

          {unavailable.length > 0 && <p className="order-card__note">{unavailable.length === 1 ? '1 demo item stays' : `${unavailable.length} demo items stay`} in your cart, because demo products can't be bought.</p>}
        </div>

        <aside className="panel checkout__summary" aria-label="Order summary">
          <fieldset className="choice choice--stack">
            <legend>Payment Method</legend>
            {PAYMENT_METHODS.map((method) => (
              <label key={method}>
                <input type="radio" name="payment-choice" checked={payment === method} onChange={() => setPayment(method)} /> {method}
              </label>
            ))}
          </fieldset>
          {payment !== 'Cash on Delivery' && <p className="muted checkout__note">Online payment is simulated. You won't be asked for card details.</p>}
          <dl className="order-sum">
            <div><dt>Subtotal</dt><dd>{peso(priced.reduce((sum, shop) => sum + shop.subtotal, 0))}</dd></div>
            <div><dt>Shipping</dt><dd>{peso(priced.reduce((sum, shop) => sum + shop.fee, 0))}</dd></div>
            <div className="order-sum__total"><dt>Total</dt><dd>{peso(total)}</dd></div>
          </dl>
          {overStock.length > 0 && <p className="form-error">Only {findSaleRow(overStock[0].product.listing, overStock[0].product.variation)?.stock} left of {overStock[0].product.listing.name}. Update your cart.</p>}
          <p className="form-error" role="alert" />
          <button className="btn btn--primary btn--block" type="submit" disabled={overStock.length > 0}>Place Order</button>
        </aside>
      </Form>
    </section>
  );
}
