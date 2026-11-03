'use client';

// Storefront state, product grid, cart and the home carousel.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { openCustomerLogin } from './Auth';
import Icon from './Icon';
import { RichText } from './RichText';
import { Cart, isSampleItem, useCart } from '@/lib/cart';
import { CATEGORIES, PRODUCT_CATEGORIES, PRODUCTS, SHOPS } from '@/lib/data';
import { Chat } from '@/lib/chat';
import { findSaleRow, salePrice, saleRows, totalStock } from '@/lib/products';
import { Auth, Store } from '@/lib/store';
import { createState, Modal, peso, toast } from '@/lib/ui';

const StorefrontContext = createContext(null);
export const useStorefront = () => useContext(StorefrontContext);

function scrollToDeals() {
  document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
}

export function StorefrontProvider({ children }) {
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const pathname = usePathname();
  const router = useRouter();

  const goToDeals = useCallback(() => {
    if (pathname === '/') scrollToDeals();
    else router.push('/#products');
  }, [pathname, router]);

  const search = useCallback((text) => {
    setQuery(text.trim());
    setCategory('All');
    goToDeals();
  }, [goToDeals]);

  const value = useMemo(
    () => ({ category, setCategory, query, setQuery, search, goToDeals }),
    [category, query, search, goToDeals],
  );
  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
}

function matches(product, category, query) {
  const inCategory = category === 'All' || product.category === category;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${product.name} ${product.category}`.toLowerCase();
  return inCategory && words.every((w) => text.includes(w));
}

// Products sellers have published, in the shape the sample products use.
export const liveProducts = createState([]);

function toStoreProduct(listing) {
  const rows = saleRows(listing).filter((row) => Number(row.stock) > 0);
  const cheapest = (rows.length ? rows : saleRows(listing)).reduce((best, row) => (salePrice(row) < salePrice(best) ? row : best));
  return {
    id: listing.id,
    name: listing.name,
    category: PRODUCT_CATEGORIES.find((c) => c.name === listing.category)?.store,
    price: salePrice(cheapest),
    variation: listing.variations.enabled ? cheapest.key : '',
    was: Number(cheapest.price),
    image: listing.images[0],
    shop: `seller:${listing.seller}`,
    listing,
  };
}

export function loadLiveProducts() {
  return fetch('/api/products')
    .then((response) => (response.ok ? response.json() : { products: [] }))
    .then(({ products }) => liveProducts.set(products.map(toStoreProduct)))
    .catch(() => {});
}

// Cart keys are product ids, plus the variation for seller listings that have them.
export function findCartItem(key, live) {
  const sample = PRODUCTS.find((item) => item.id === key);
  if (sample) return sample;
  const [id, variation] = key.split('::');
  const product = live.find((item) => item.id === id);
  if (!product) return null;
  if (!variation) return product;
  const row = saleRows(product.listing).find((other) => other.key === variation);
  return row && { ...product, id: key, variation, name: `${product.name} (${variation})`, price: salePrice(row) };
}

function addToCart(key, name) {
  Cart.change(key, 1);
  toast(`Added ${name} to your cart.`, 'success');
}

function QuickView({ product }) {
  const { listing } = product;
  const rows = saleRows(listing);
  const hasVariations = listing.variations.enabled;
  const [selected, setSelected] = useState(rows.find((row) => Number(row.stock) > 0) || rows[0]);
  const stock = Number(selected.stock) || 0;

  return (
    <div className="quick-view">
      <div className="quick-view__images">
        {listing.images.map((url, i) => <img src={url} alt={`${listing.name}, image ${i + 1}`} key={url} />)}
      </div>
      {listing.video && <video src={listing.video.url} controls preload="metadata" aria-label={`${listing.name} video`} />}
      <p className="product__price">{peso(salePrice(selected))} {Number(selected.promo) > 0 && <s>{peso(Number(selected.price))}</s>}</p>
      <p className="muted">{listing.shopName} · {listing.condition} · {stock} in stock{listing.preOrder ? ` · Pre-order, ships in ${listing.preOrderDays} days` : ''}</p>
      {hasVariations && (
        <div className="chips" role="group" aria-label="Choose a variation">
          {rows.map((row) => (
            <button className="chip" type="button" key={row.key} aria-pressed={row.key === selected.key} disabled={!Number(row.stock)} onClick={() => setSelected(row)}>{row.key}</button>
          ))}
        </div>
      )}
      <button
        className="btn btn--primary btn--block"
        type="button"
        disabled={!stock}
        onClick={() => {
          addToCart(hasVariations ? `${product.id}::${selected.key}` : product.id, listing.name);
          Modal.close();
        }}
      >
        {stock ? 'Add to Cart' : 'Sold Out'}
      </button>
      <RichText blocks={listing.description} />
      {listing.specs.some((spec) => spec.value.trim()) && (
        <dl className="shop-info">
          {listing.specs.filter((spec) => spec.value.trim()).map((spec) => <div className="shop-info__row" key={spec.name}><dt>{spec.name}</dt><dd>{spec.value}</dd></div>)}
        </dl>
      )}
    </div>
  );
}

function openQuickView(product) {
  Modal.open({ title: product.name, variant: 'wide', content: <QuickView product={product} /> });
}

function ProductCard({ product: p }) {
  const off = Math.round((1 - p.price / p.was) * 100);
  const soldOut = p.listing && !totalStock(p.listing);
  return (
    <article className="product">
      <div className="product__image" style={{ '--tint': p.tint }}>
        {p.image ? <img src={p.image} alt="" /> : <span aria-hidden="true">{p.emoji}</span>}
        {off > 0 && <span className="product__off">-{off}%</span>}
      </div>
      <div className="product__body">
        {p.listing ? <h3><button className="product__name" type="button" onClick={() => openQuickView(p)}>{p.name}</button></h3> : <h3>{p.name}</h3>}
        <p className="product__price">{peso(p.price)} {off > 0 && <s>{peso(p.was)}</s>}</p>
        {p.listing
          ? <p className="product__meta">{p.listing.shopName}</p>
          : <p className="product__meta"><Icon name="star" className="icon icon--sm" /> {p.rating} · {p.sold} sold</p>}
        <div className="product__actions">
          <button
            className="btn btn--primary btn--sm"
            type="button"
            disabled={soldOut}
            onClick={() => {
              if (p.listing?.variations.enabled) openQuickView(p);
              else addToCart(p.id, p.name);
            }}
          >
            {soldOut ? 'Sold Out' : 'Add to Cart'}
          </button>
          <button
            className="icon-btn icon-btn--bordered"
            type="button"
            aria-label={`Chat with seller about ${p.name}`}
            onClick={() => Chat.openShop(p.shop, `Hi! Is "${p.name}" available?`)}
          >
            <Icon name="chat" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function Deals() {
  const { category, setCategory, query } = useStorefront();
  const live = liveProducts.use();
  const list = [...live, ...PRODUCTS].filter((p) => matches(p, category, query));

  useEffect(() => {
    loadLiveProducts();
  }, []);

  let status = '';
  if (query) status = `${list.length} ${list.length === 1 ? 'result' : 'results'} for "${query}"`;
  else if (!list.length) status = 'No products in this category.';

  return (
    <section className="container deals" id="products" aria-labelledby="deals-title">
      <div className="deals__head">
        <h2 id="deals-title">Today&apos;s Deals</h2>
        <div className="chips" role="group" aria-label="Filter by category">
          {CATEGORIES.map((c) => (
            <button className="chip" type="button" key={c} aria-pressed={c === category} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
      </div>
      <p className="deals__status" role="status">{status}</p>
      <div className="product-grid">
        {list.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}

// Scrolls smoothly on the home page; without scripts it is still a normal link.
export function DealsLink({ children, ...props }) {
  const { goToDeals } = useStorefront();
  return (
    <Link
      href="/#products"
      {...props}
      onClick={(e) => {
        e.preventDefault();
        goToDeals();
      }}
    >
      {children}
    </Link>
  );
}

// The cart by store, oldest first: stores in the order their first item was added, and each store's
// items in the order they were added. Only items on sale from an Onetap seller can be ticked.
export function groupCart(items, live) {
  const stores = new Map();
  [...items].sort((a, b) => a.addedAt - b.addedAt).forEach((item) => {
    const product = findCartItem(item.key, live);
    const listing = product?.listing;
    const sample = isSampleItem(item.key);
    const id = listing ? listing.seller : sample ? product.shop : 'unavailable';
    const name = listing ? listing.shopName : sample ? SHOPS.find((shop) => shop.id === product.shop)?.name || 'Demo shop' : 'No longer available';
    const stock = listing ? Number(findSaleRow(listing, product.variation)?.stock) || 0 : 0;
    const store = stores.get(id) || { id, name, items: [] };
    store.items.push({ ...item, product, buyable: Boolean(listing) && stock > 0, stock, sample });
    stores.set(id, store);
  });
  return [...stores.values()];
}

// A checkbox that can also show "some ticked".
export function Tick({ checked, indeterminate = false, disabled = false, onChange, label, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="tick">
      <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      {children}
    </label>
  );
}

export function QtyStepper({ item, name }) {
  return (
    <div className="stepper">
      <button type="button" aria-label={`Remove one ${name}`} onClick={() => Cart.change(item.key, -1)}>−</button>
      <span aria-label="Quantity">{item.qty}</span>
      <button type="button" aria-label={`Add one ${name}`} disabled={item.buyable && item.qty >= item.stock} onClick={() => Cart.change(item.key, 1)}>+</button>
    </div>
  );
}

export function cartItemNote(item) {
  if (item.sample) return "Demo item, can't be bought";
  if (!item.product?.listing) return 'No longer available';
  if (!item.buyable) return 'Sold out';
  if (item.qty > item.stock) return `Only ${item.stock} left. Lower the quantity to check out.`;
  return '';
}

function CartView() {
  const { goToDeals } = useStorefront();
  const router = useRouter();
  const items = useCart();
  const live = liveProducts.use();

  useEffect(() => {
    loadLiveProducts();
    Cart.sync();
  }, []);

  if (!items.length) {
    return (
      <div className="empty">
        <p>Your cart is empty.</p>
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => {
            Modal.close();
            goToDeals();
          }}
        >
          Browse Deals
        </button>
      </div>
    );
  }

  const stores = groupCart(items, live);
  const buyable = stores.flatMap((store) => store.items).filter((item) => item.buyable);
  const chosen = buyable.filter((item) => item.selected);
  const total = chosen.reduce((sum, item) => sum + item.product.price * item.qty, 0);
  const overStock = chosen.find((item) => item.qty > item.stock);
  const keys = (list) => list.map((item) => item.key);

  function checkout() {
    const customer = Auth.session('customer');
    if (!chosen.length) toast('Select at least one item to check out.');
    else if (overStock) toast(`Only ${overStock.stock} left of ${overStock.product.name}. Lower the quantity first.`);
    else if (customer && customer.approvalStatus !== 'approved') {
      toast(customer.approvalStatus === 'rejected' ? 'Your account is Unverified. Resubmit your valid ID in My Profile.' : "You can check out once your account is Verified. We'll notify you.");
    } else if (customer) {
      Modal.close();
      router.push('/checkout');
    } else {
      toast('Log in to check out.');
      openCustomerLogin();
    }
  }

  return (
    <>
      <div className="cart-bar">
        <Tick checked={buyable.length > 0 && chosen.length === buyable.length} indeterminate={chosen.length > 0 && chosen.length < buyable.length} disabled={!buyable.length} onChange={(on) => Cart.select(null, on)} label="Select all items">
          <span>Select all ({buyable.length})</span>
        </Tick>
      </div>
      {stores.map((store) => {
        const own = store.items.filter((item) => item.buyable);
        const ticked = own.filter((item) => item.selected);
        return (
          <section className="cart-store" key={store.id} aria-label={store.name}>
            <div className="cart-store__head">
              <Tick checked={own.length > 0 && ticked.length === own.length} indeterminate={ticked.length > 0 && ticked.length < own.length} disabled={!own.length} onChange={(on) => Cart.select(keys(own), on)} label={`Select all items from ${store.name}`}>
                <Icon name="store" />
                <strong>{store.name}</strong>
              </Tick>
            </div>
            <ul className="cart-list">
              {store.items.map((item) => {
                const p = item.product;
                const name = p?.name || 'Unavailable item';
                const note = cartItemNote(item);
                return (
                  <li className="cart-row" key={item.key}>
                    <Tick checked={item.buyable && item.selected} disabled={!item.buyable} onChange={(on) => Cart.select([item.key], on)} label={`Select ${name}`} />
                    <span className="cart-row__image" style={{ '--tint': p?.tint }} aria-hidden="true">{p?.image ? <img src={p.image} alt="" /> : p?.emoji}</span>
                    <div className="cart-row__text">
                      <strong>{name}</strong>
                      {p && <span>{peso(p.price * item.qty)}</span>}
                      {note && <small className={item.buyable ? 'form-error' : 'muted'}>{note}</small>}
                      <QtyStepper item={item} name={name} />
                    </div>
                    <button className="icon-btn" type="button" aria-label={`Delete ${name} from cart`} onClick={() => Cart.remove(item.key)}>
                      <Icon name="trash" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <div className="cart-total">
        <span>Subtotal ({chosen.length} selected)</span>
        <strong>{peso(total)}</strong>
      </div>
      <p className="muted cart-hint">{chosen.length ? 'Shipping is added at checkout. Unticked items stay in your cart.' : 'Tick the items you want to check out.'}</p>
      <button className="btn btn--primary btn--block" type="button" aria-disabled={!chosen.length || Boolean(overStock)} onClick={checkout}>
        Checkout{chosen.length ? ` (${chosen.length})` : ''}
      </button>
    </>
  );
}

export function openCart() {
  Modal.open({ title: 'Your Cart', variant: 'drawer', content: <CartView /> });
}

function claimVouchers() {
  if (!Auth.session('customer')) {
    toast('Log in or sign up to claim your vouchers.');
    openCustomerLogin();
    return;
  }
  if (Auth.session('customer').approvalStatus !== 'approved') {
    toast('You can claim vouchers once your account is Verified.');
    return;
  }
  if (Store.get('vouchersClaimed')) {
    toast('You already claimed today\'s vouchers.');
    return;
  }
  Store.set('vouchersClaimed', true);
  toast('Vouchers claimed! They will apply at checkout.', 'success');
}

const SLIDE_COUNT = 3;

export function Carousel() {
  const { goToDeals } = useStorefront();
  const [index, setIndex] = useState(0);
  const timer = useRef(null);

  const stop = useCallback(() => clearInterval(timer.current), []);
  const start = useCallback(() => {
    clearInterval(timer.current);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer.current = setInterval(() => setIndex((i) => (i + 1) % SLIDE_COUNT), 6000);
  }, []);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  return (
    <div className="carousel" aria-roledescription="carousel" aria-label="Featured offers" onMouseEnter={stop} onMouseLeave={start} onFocus={stop}>
      <article className="slide slide--vip" hidden={index !== 0}>
        <span className="pill"><Icon name="star" /> Onetap VIP Member Club</span>
        <h1 className="slide__title">Unlock Exclusive<br />Savings &amp; Free Shipping!</h1>
        <p className="slide__text">Get up to 20% OFF vouchers daily + ₱0 minimum spend delivery nationwide.</p>
        <div className="slide__actions">
          <button className="btn btn--white" type="button" onClick={claimVouchers}>Claim Vouchers Now</button>
          <span className="slide__note">Limited Daily Slots</span>
        </div>
      </article>
      <article className="slide slide--flash" hidden={index !== 1}>
        <span className="pill"><Icon name="star" /> Payday Flash Sale</span>
        <h2 className="slide__title">Big Brands,<br />Bigger Payday Deals</h2>
        <p className="slide__text">Fresh markdowns on gadgets, fashion and home essentials every day.</p>
        <div className="slide__actions">
          <button className="btn btn--white" type="button" onClick={goToDeals}>Shop Today&apos;s Deals</button>
          <span className="slide__note">While Stocks Last</span>
        </div>
      </article>
      <article className="slide slide--seller" hidden={index !== 2}>
        <span className="pill"><Icon name="star" /> Onetap Sellers</span>
        <h2 className="slide__title">Open Your Shop<br />in One Tap</h2>
        <p className="slide__text">Register your store and start reaching shoppers nationwide.</p>
        <div className="slide__actions">
          <Link className="btn btn--white" href="/seller/register">Start Selling</Link>
          <span className="slide__note">Free to Join</span>
        </div>
      </article>
      <div className="carousel__dots" role="group" aria-label="Choose slide">
        {Array.from({ length: SLIDE_COUNT }, (_, i) => (
          <button type="button" key={i} aria-label={`Show slide ${i + 1}`} aria-current={i === index} onClick={() => setIndex(i)} />
        ))}
      </div>
    </div>
  );
}
