'use client';

// Seller product pages: My Products, Onetap Standard Product and Product AI Optimiser.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { STANDARD_PRODUCTS } from '@/lib/data';
import { priceRange, PRODUCT_STATUS, qualityReport, totalStock } from '@/lib/products';
import { Products, useSellerProducts } from '@/lib/productsApi';
import { Modal, peso, toast } from '@/lib/ui';

export function confirmModal({ title, body, label, run, danger }) {
  function Confirm() {
    const [busy, setBusy] = useState(false);
    return (
      <>
        <p className="muted order-modal__text">{body}</p>
        <button
          className={`btn btn--block ${danger ? 'btn--danger' : 'btn--primary'}`}
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await run();
              Modal.close();
            } catch (err) {
              toast(err.message, 'error');
              setBusy(false);
            }
          }}
        >
          {busy ? 'Working…' : label}
        </button>
      </>
    );
  }
  Modal.open({ title, content: <Confirm /> });
}

function Badge({ status }) {
  return <span className={`order-badge order-badge--${status.tone}`}>{status.label}</span>;
}

function priceText(product) {
  const range = priceRange(product);
  if (!range) return 'No price yet';
  return range[0] === range[1] ? peso(range[0]) : `${peso(range[0])} to ${peso(range[1])}`;
}

function ListState({ loading, error, onRetry, emptyTitle, emptyText, empty }) {
  if (loading) {
    return (
      <div className="order-list" aria-label="Loading products" role="status">
        {[0, 1, 2].map((i) => <div className="skeleton" key={i} />)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="panel order-empty" role="alert">
        <Icon name="box" />
        <h2>We couldn&apos;t load your products</h2>
        <p className="muted">{error}</p>
        <button className="btn-mini" type="button" onClick={onRetry}>Try Again</button>
      </div>
    );
  }
  if (!empty) return null;
  return (
    <div className="panel order-empty">
      <Icon name="box" />
      <h2>{emptyTitle}</h2>
      {emptyText && <p className="muted">{emptyText}</p>}
      <Link className="btn-mini btn-mini--primary" href="/seller/products/new">Add New Product</Link>
    </div>
  );
}

const PRODUCT_TABS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'live', label: 'Live', match: (p) => p.status === 'live' },
  { id: 'violation', label: 'Violation', match: (p) => ['violation', 'suspended'].includes(p.status) },
  { id: 'unpublished', label: 'Unpublished', match: (p) => p.status === 'unpublished' },
];

function ProductRow({ product: p, reload }) {
  const router = useRouter();

  function publish() {
    confirmModal({
      title: `Publish ${p.name}`,
      body: 'It goes on the marketplace straight away.',
      label: 'Publish Product',
      run: async () => {
        try {
          await Products.setStatus(p.id, 'publish');
          toast('Your product is live.', 'success');
          await reload();
        } catch (err) {
          if (!err.fields) throw err;
          Modal.close();
          toast('Finish the required details before publishing.', 'error');
          router.push(`/seller/products/${p.id}/edit`);
        }
      },
    });
  }

  function unpublish() {
    confirmModal({
      title: `Unpublish ${p.name}`,
      body: 'Buyers will no longer see this product. You can publish it again later.',
      label: 'Unpublish Product',
      run: async () => {
        await Products.setStatus(p.id, 'unpublish');
        toast('The product was unpublished.', 'success');
        await reload();
      },
    });
  }

  function remove() {
    confirmModal({
      title: `Delete ${p.name}`,
      body: "This permanently removes the product. It can't be undone.",
      label: 'Delete Product',
      danger: true,
      run: async () => {
        await Products.remove(p.id);
        toast('The product was deleted.', 'success');
        await reload();
      },
    });
  }

  return (
    <article className="product-row">
      <img className="product-row__image" src={p.images[0]} alt="" width="84" height="84" />
      <div className="product-row__main">
        <div className="product-row__head">
          <h2><Link href={`/seller/products/${p.id}/edit`}>{p.name}</Link></h2>
          <Badge status={PRODUCT_STATUS[p.status]} />
        </div>
        <dl className="product-row__facts">
          <div><dt>Code</dt><dd>{p.code}</dd></div>
          <div><dt>Price</dt><dd>{priceText(p)}</dd></div>
          <div><dt>Stock</dt><dd>{totalStock(p)}</dd></div>
          {p.category && <div><dt>Category</dt><dd>{p.subcategory || p.category}</dd></div>}
        </dl>
        {p.violation && <p className="order-card__note"><strong>{p.status === 'suspended' ? 'Suspended' : 'Disapproved'}:</strong> {p.violation} {p.status === 'suspended' ? 'Contact support to get it back on sale.' : 'Edit the listing and publish it again.'}</p>}
      </div>
      <div className="order-card__actions product-row__actions">
        <Link className="btn-mini" href={`/seller/products/${p.id}/edit`}>Edit<span className="sr-only"> {p.name}</span></Link>
        {['unpublished', 'violation'].includes(p.status) && <button className="btn-mini btn-mini--primary" type="button" onClick={publish}>Publish<span className="sr-only"> {p.name}</span></button>}
        {p.status === 'live' && <button className="btn-mini" type="button" onClick={unpublish}>Unpublish<span className="sr-only"> {p.name}</span></button>}
        <button className="btn-mini btn-mini--danger" type="button" onClick={remove}>Delete<span className="sr-only"> {p.name}</span></button>
      </div>
    </article>
  );
}

export function MyProducts({ tab: initial }) {
  const { products, loading, error, reload } = useSellerProducts();
  const [tab, setTab] = useState(initial || 'all');
  const [query, setQuery] = useState('');
  const tabBar = useRef(null);
  const current = PRODUCT_TABS.find((t) => t.id === tab) || PRODUCT_TABS[0];
  const text = query.trim().toLowerCase();
  const shown = products.filter(current.match).filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(text));

  useEffect(() => {
    tabBar.current.querySelector('[aria-pressed="true"]').scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [current.id]);

  return (
    <div className="order-page">
      <div className="order-head">
        <div>
          <h1 tabIndex={-1}>My Products</h1>
          <p className="muted">Add, edit and publish your listings.</p>
        </div>
        <Link className="btn-mini btn-mini--primary" href="/seller/products/new">Add New Product</Link>
      </div>

      <div className="order-tools">
        <div className="order-tabs" role="group" aria-label="Filter products" ref={tabBar}>
          {PRODUCT_TABS.map((t) => (
            <button type="button" key={t.id} aria-pressed={t.id === current.id} onClick={() => setTab(t.id)}>
              {t.label} <span>{products.filter(t.match).length}</span>
            </button>
          ))}
        </div>
        <label className="order-search">
          <Icon name="search" />
          <span className="sr-only">Search products</span>
          <input type="search" placeholder="Product name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <ListState
        loading={loading}
        error={error}
        onRetry={reload}
        empty={!shown.length}
        emptyTitle={text ? 'No products match your search' : 'No products here yet'}
        emptyText={text ? '' : 'Add a product to start selling on Onetap.'}
      />
      {!loading && !error && shown.length > 0 && (
        <div className="order-list">
          {shown.map((p) => <ProductRow key={p.id} product={p} reload={reload} />)}
        </div>
      )}
    </div>
  );
}

export function StandardProducts() {
  const [query, setQuery] = useState('');
  const text = query.trim().toLowerCase();
  const shown = STANDARD_PRODUCTS.filter((p) => `${p.name} ${p.category}`.toLowerCase().includes(text));

  return (
    <div className="order-page">
      <div className="order-head">
        <div>
          <h1 tabIndex={-1}>Onetap Standard Product</h1>
          <p className="muted">Start from a ready-made template, then add your own images, price and stock.</p>
        </div>
      </div>
      <label className="order-search">
        <Icon name="search" />
        <span className="sr-only">Search templates</span>
        <input type="search" placeholder="Search templates" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {shown.length ? (
        <ul className="template-grid">
          {shown.map((p) => (
            <li className="panel template" key={p.id}>
              <span className="deal__image" style={{ '--tint': p.tint }} aria-hidden="true">{p.emoji}</span>
              <h2>{p.name}</h2>
              <p className="muted">{p.category} · {p.subcategory}</p>
              <Link className="btn-mini btn-mini--primary" href={`/seller/products/new?template=${p.id}`}>Use Template<span className="sr-only">: {p.name}</span></Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel order-empty"><Icon name="search" /><h2>No templates match your search</h2></div>
      )}
    </div>
  );
}

export function ProductOptimiser() {
  const { products, loading, error, reload } = useSellerProducts();
  const reports = products.map((p) => ({ product: p, ...qualityReport(p) })).sort((a, b) => a.score - b.score);
  const average = reports.length ? Math.round(reports.reduce((sum, r) => sum + r.score, 0) / reports.length) : 0;

  return (
    <div className="order-page">
      <div className="order-head">
        <div>
          <h1 tabIndex={-1}>Product AI Optimiser</h1>
          <p className="muted">Automatic listing checks, with your lowest scores first.</p>
        </div>
        {reports.length > 0 && <span className="order-head__count">Average score {average}%</span>}
      </div>
      <ListState
        loading={loading}
        error={error}
        onRetry={reload}
        empty={!reports.length}
        emptyTitle="Nothing to check yet"
        emptyText="Add a product to see how it can improve."
      />
      {!loading && !error && reports.length > 0 && (
        <div className="order-list">
          {reports.map(({ product: p, score, checks }) => (
            <article className="panel quality" key={p.id}>
              <div className="quality__head">
                <img className="product-row__image" src={p.images[0]} alt="" width="84" height="84" />
                <div className="quality__title">
                  <h2>{p.name}</h2>
                  <div className="quality__bar" role="img" aria-label={`Score ${score}%`}><span style={{ width: `${score}%` }} /></div>
                  <strong>{score}%</strong>
                </div>
                <Link className="btn-mini" href={`/seller/products/${p.id}/edit`}>Improve<span className="sr-only"> {p.name}</span></Link>
              </div>
              <ul className="quality__checks">
                {checks.map((check) => (
                  <li className={check.ok ? 'is-ok' : ''} key={check.label}>
                    <Icon name={check.ok ? 'check' : 'help'} className="icon icon--sm" />
                    <span><strong>{check.label}</strong>{!check.ok && <small>{check.tip}</small>}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
