'use client';

import { useCallback, useEffect, useState } from 'react';
import { RichText } from '../RichText';
import { adminFetch, Badge, dateTime, DataTable, FilterBar, PageHead, postAdmin, Tabs, useAdminList } from './AdminUI';
import { LISTING_STATUS } from '@/lib/adminLabels';
import { saleRows, totalStock } from '@/lib/products';
import { Modal, peso, toast } from '@/lib/ui';

const ACTION_LABELS = { published: 'Published', submitted: 'Submitted', approve: 'Approved', disapprove: 'Disapproved', suspend: 'Suspended', reinstate: 'Reinstated' };

function ReasonForm({ title, label, onSubmit }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="assistant-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(reason);
        } catch (err) {
          setError(err.fields?.reason || err.message);
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="moderation-reason">{title}</label>
        <textarea id="moderation-reason" rows={4} maxLength={500} required aria-invalid={Boolean(error)} value={reason} onChange={(e) => setReason(e.target.value)} />
        <small className="field__hint">The seller sees this. 10 to 500 characters.</small>
        {error && <small className="field__error">{error}</small>}
      </div>
      <button className="btn btn--danger btn--block" type="submit" disabled={busy}>{busy ? 'Saving…' : label}</button>
    </form>
  );
}

function ListingDetail({ id, onChanged }) {
  const [listing, setListing] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => adminFetch(`/products/${id}`).then((body) => setListing(body.listing), (err) => setError(err.message)), [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!listing) return <div className="skeleton" role="status" aria-label="Loading listing" />;

  const decide = async (action, reason, message) => {
    await postAdmin(`/products/${id}`, { action, reason });
    Modal.close();
    toast(message, 'success');
    onChanged();
  };

  const askReason = (action, title, label, message) => Modal.open({ title: listing.name, content: <ReasonForm title={title} label={label} onSubmit={(reason) => decide(action, reason, message)} /> });

  return (
    <div className="assistant-form">
      <Badge status={LISTING_STATUS[listing.status] || { label: 'Unpublished', tone: 'neutral' }} />
      {listing.flag && <p className="admin-banner" role="note"><strong>Automatic check:</strong> {listing.flag}</p>}
      {listing.reason && <p className="order-card__note"><strong>Reason:</strong> {listing.reason}</p>}
      <div className="quick-view__images">{listing.images.map((url, i) => <img src={url} alt={`${listing.name}, image ${i + 1}`} key={url} />)}</div>
      {listing.video && <video src={listing.video.url} controls preload="metadata" aria-label="Product video" />}
      <dl className="order-facts order-facts--row">
        <div><dt>Seller</dt><dd>{listing.shopName} ({listing.seller})</dd></div>
        <div><dt>Code</dt><dd>{listing.code}</dd></div>
        <div><dt>Category</dt><dd>{listing.category} / {listing.subcategory}</dd></div>
        <div><dt>Condition</dt><dd>{listing.condition}</dd></div>
        <div><dt>Total stock</dt><dd>{totalStock(listing)}</dd></div>
        <div><dt>Submitted</dt><dd>{dateTime(listing.updatedAt)}</dd></div>
      </dl>
      <section>
        <h3>Prices and variations</h3>
        <div className="admin-table" role="region" aria-label="Prices" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Variation</th><th scope="col">Price</th><th scope="col">Promo</th><th scope="col">Stock</th></tr></thead>
            <tbody>{saleRows(listing).map((row) => <tr key={row.key || 'single'}><td>{row.key || 'Standard'}</td><td>{peso(Number(row.price))}</td><td>{row.promo ? peso(Number(row.promo)) : '—'}</td><td>{row.stock}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section><h3>Description</h3><RichText blocks={listing.description} /></section>
      <div className="order-card__actions">
        {listing.status === 'suspended' && <button className="btn-mini btn-mini--primary" type="button" onClick={() => decide('reinstate', '', 'Listing reinstated. The seller was notified.').catch((err) => toast(err.message, 'error'))}>Reinstate</button>}
        {listing.status === 'live' && <button className="btn-mini btn-mini--danger" type="button" onClick={() => askReason('suspend', 'Why is this listing suspended?', 'Suspend Listing', 'Listing suspended. The seller was notified.')}>Suspend</button>}
      </div>
      <section>
        <h3>Listing history</h3>
        <ol className="timeline order-timeline">
          {listing.history.map((item) => (
            <li className="is-done" key={`${item.at}-${item.action}`}>
              {ACTION_LABELS[item.action]} by {item.actor}{item.reason && `: ${item.reason}`}
              <small>{dateTime(item.at)}</small>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function AdminProducts({ initial }) {
  const list = useAdminList('/products', initial);
  const counts = list.data?.counts || {};
  const open = (row) => Modal.open({ title: row.name, variant: 'wide', content: <ListingDetail id={row.id} onChanged={list.reload} /> });

  return (
    <div className="order-page admin-page">
      <PageHead title="Product Listings" text="Products go live as soon as sellers publish them. Suspend a listing to take it down." />
      <Tabs
        list={list}
        label="Filter listings"
        tabs={[['', 'All Products'], ['live', 'Live', counts.live], ['suspended', 'Suspended', counts.suspended]]}
      />
      <FilterBar list={list} placeholder="Product, code or seller" />
      <DataTable
        list={list}
        label="Product listings"
        empty="No listings here yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Product', render: (row) => <span className="admin-product"><img src={row.images[0]} alt="" width="40" height="40" /><button className="link" type="button" onClick={() => open(row)}>{row.name}</button></span> },
          { label: 'Seller', sort: 'seller', render: (row) => row.shopName },
          { label: 'Category', render: (row) => row.subcategory },
          { label: 'Status', sort: 'status', render: (row) => <><Badge status={LISTING_STATUS[row.status]} />{row.flag && <> <Badge status={{ label: 'Flagged', tone: 'warn' }} /></>}</> },
          { label: 'Updated', sort: 'updated', render: (row) => dateTime(row.updatedAt) },
        ]}
      />
    </div>
  );
}
