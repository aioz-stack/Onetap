'use client';

// The Logistics Partner Panel: a courier's own view of its pickups, shipments, COD and reports.
// The server limits every response to the signed-in user's partner.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../Icon';
import { ThemeToggle } from '../Header';
import { courierFetch, COURIER_CLIENT, dateOnly, dateTime, DataTable, DateFilter, FilterBar, NavCount, PageHead, percent, postCourier, useNavCounts, RateBars, StatCards, Tabs, TextField, TrendChart, useAdminList, useRefresh, Badge } from '../admin/AdminUI';
import { openWaybill, ProofPhotos } from '../SellerOrders';
import { RiderSection } from './CourierRiders';
import { COD_STATUS, COURIER_PICKUP_STATUS, HANDOVER_STATUS, options, SHIPMENT_STATUS, TASK_STATUS } from '@/lib/adminLabels';
import { Modal, peso, toast } from '@/lib/ui';

// Finance has its own heading. Remittances is a dropdown with a page for each kind.
const FINANCE = [
  { label: 'COD Collections', href: '/courier/cod', icon: 'wallet' },
  {
    label: 'Remittances', icon: 'wallet', id: 'courier-remittances', base: '/courier/finance/remittances',
    items: [{ label: 'Logistics Remittance', href: '/courier/finance/remittances/logistics' }, { label: 'Rider Remittance', href: '/courier/finance/remittances/riders' }],
  },
];

function FinanceNav({ pathname, counts }) {
  const dropdown = FINANCE[1];
  const inside = pathname.startsWith(dropdown.base);
  const [open, setOpen] = useState(inside);
  useEffect(() => {
    if (inside) setOpen(true);
  }, [inside]);
  return (
    <div className="nav-section" role="group" aria-labelledby="courier-finance">
      <span className="seller-nav__heading nav-section__heading" id="courier-finance">Finance</span>
      <Link className="seller-nav__home" href={FINANCE[0].href} aria-current={pathname === FINANCE[0].href ? 'page' : undefined}><Icon name={FINANCE[0].icon} /> {FINANCE[0].label}<NavCount count={counts[FINANCE[0].href]} /></Link>
      <button className={`seller-nav__home nav-dropdown${inside ? ' is-inside' : ''}`} type="button" aria-expanded={open} aria-controls={dropdown.id} onClick={() => setOpen(!open)}>
        <Icon name={dropdown.icon} /> {dropdown.label}
        {/* Closed, the dropdown shows what its pages have waiting. */}
        {!open && <NavCount count={dropdown.items.reduce((sum, item) => sum + (counts[item.href] || 0), 0)} />}
        <Icon name="chevron" className="icon icon--sm seller-nav__chevron nav-dropdown__chevron" />
      </button>
      <ul className="nav-dropdown__list" id={dropdown.id} hidden={!open}>
        {dropdown.items.map((item) => (
          <li key={item.href}><Link href={item.href} aria-current={pathname === item.href ? 'page' : undefined}>{item.label}<NavCount count={counts[item.href]} /></Link></li>
        ))}
      </ul>
    </div>
  );
}

const NAV = [
  { label: 'Dashboard', href: '/courier', icon: 'chart' },
  { label: 'Assigned Pickups', href: '/courier/pickups', icon: 'store' },
  { label: 'Shipments', href: '/courier/shipments', icon: 'box' },
  { label: 'Rider Management', href: '/courier/riders', icon: 'user' },
  { label: 'Assignment History', href: '/courier/riders/assignments', icon: 'clock' },
  { label: 'Rider Performance', href: '/courier/riders/performance', icon: 'star' },
  { label: 'Delivery Performance', href: '/courier/reports', icon: 'truck' },
];

function CourierNotifications() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const unread = items.filter((item) => !item.read).length;

  const load = useCallback(() => courierFetch('/notifications').then((body) => setItems(body.notifications)).catch(() => {}), []);
  useRefresh(load);

  function toggle() {
    setOpen(!open);
    if (!open && unread) {
      courierFetch('/notifications', { method: 'POST' }).catch(() => {});
      setItems(items.map((item) => ({ ...item, read: true })));
    }
  }

  return (
    <div className="popover-wrap">
      <button className="seller-bar__icon" type="button" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={toggle}>
        <Icon name="bell" />
        {unread > 0 && <span className="count seller-bar__count">{unread}</span>}
      </button>
      {open && (
        <div className="popover popover--wide seller-notices">
          <div className="popover__head"><strong>Notifications</strong></div>
          {items.map((item) => (
            <Link className="notif" href={item.link} key={item.id} onClick={() => setOpen(false)}>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
              <small>{dateTime(item.at)}</small>
            </Link>
          ))}
          {!items.length && <p className="muted notif">Nothing new yet.</p>}
        </div>
      )}
    </div>
  );
}

function PasswordForm() {
  const [values, setValues] = useState({ current: '', next: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await postCourier('/auth/password', values);
      Modal.close();
      toast('Password changed.', 'success');
    } catch (err) {
      setErrors(err.fields || {});
      toast(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit}>
      <TextField id="courier-current" label="Current password" type="password" autoComplete="current-password" required value={values.current} error={errors.current} onChange={(e) => setValues({ ...values, current: e.target.value })} />
      <TextField id="courier-next" label="New password" type="password" autoComplete="new-password" required minLength={12} hint="At least 12 characters." value={values.next} error={errors.next} onChange={(e) => setValues({ ...values, next: e.target.value })} />
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Change Password'}</button>
    </form>
  );
}

export function CourierShell({ account, children }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const counts = useNavCounts(courierFetch);
  const waiting = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const [partner, setPartner] = useState(null);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // A closed panel answers 401, which sends the user to the login page.
  const check = useCallback(() => courierFetch('/partner').then((body) => setPartner(body.partner)).catch(() => {}), []);
  useRefresh(check);

  async function logout() {
    await courierFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.assign('/courier/login');
  }

  return (
    <div className="seller admin">
      <header className="seller-bar">
        <button className="seller-bar__menu" type="button" aria-label={navOpen ? 'Close menu' : 'Open menu'} aria-expanded={navOpen} aria-controls="courier-nav" onClick={() => setNavOpen(!navOpen)}><Icon name="menu" /><NavCount count={waiting} className="nav-count--menu" /></button>
        <Link className="seller-bar__brand" href="/courier" aria-label="Partner dashboard">
          <img src="/logo.svg" alt="" width="34" height="34" />
          <span>Onetap</span>
        </Link>
        <span className="seller-bar__title">Logistics Partner Panel</span>
        <div className="seller-bar__actions">
          <ThemeToggle />
          <CourierNotifications />
          <button className="seller-bar__logout" type="button" onClick={() => Modal.open({ title: 'Change password', content: <PasswordForm /> })}>{account.name}<span className="admin-role"> · {partner?.name || account.partnerName}</span></button>
          <button className="seller-bar__logout" type="button" onClick={logout}>Log Out</button>
        </div>
      </header>
      <div className="seller-shell">
        <nav className={`seller-nav ${navOpen ? 'is-open' : ''}`} id="courier-nav" aria-label="Logistics Partner Panel">
          {NAV.map((item) => (
            <Link className="seller-nav__home" href={item.href} key={item.href} aria-current={pathname === item.href ? 'page' : undefined}><Icon name={item.icon} /> {item.label}<NavCount count={counts[item.href]} /></Link>
          ))}
          <FinanceNav pathname={pathname} counts={counts} />
        </nav>
        <div className="courier-main">
          {partner?.status === 'inactive' && <p className="admin-banner" role="status"><strong>{partner.name} has been deactivated.</strong> You won&apos;t get new pickups. Finish your {partner.openParcels === 1 ? 'open parcel' : `${partner.openParcels} open parcels`}, and this panel will close when you do.</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export function CourierLogin() {
  const [values, setValues] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await postCourier('/auth/login', values);
      window.location.assign('/courier');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <section className="admin-login">
      <form className="panel" onSubmit={submit}>
        <h1 tabIndex={-1}>Logistics Partner Panel</h1>
        <p className="muted">Sign in with the account Onetap created for your company.</p>
        <TextField id="courier-identifier" label="Username or email" autoComplete="username" required value={values.identifier} onChange={(e) => setValues({ ...values, identifier: e.target.value })} />
        <TextField id="courier-password" label="Password" type="password" autoComplete="current-password" required value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Log In'}</button>
      </form>
    </section>
  );
}

function ModeBanner({ environment, name }) {
  return environment === 'sandbox' ? (
    <p className="admin-banner" role="note"><strong>Sandbox mode.</strong> {name} is simulated here, so no real parcel moves. Updates you send go through the same signed check as a courier webhook.</p>
  ) : (
    <p className="admin-banner" role="note"><strong>Live partner.</strong> Picked up and delivered statuses come from your API. Use Sync with Courier to fetch the latest.</p>
  );
}

function ServiceDetails({ partner }) {
  const list = (items) => items.join(', ') || 'None';
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Your Service Details</h2>
        <Badge status={partner.status === 'active' ? { label: 'Active', tone: 'ok' } : { label: 'Inactive', tone: 'neutral' }} />
      </div>
      <dl className="order-sum">
        <div><dt>Company</dt><dd>{partner.name}</dd></div>
        <div><dt>Contact</dt><dd>{partner.contact || '—'}</dd></div>
        <div><dt>Delivery options</dt><dd>{list(partner.services)}</dd></div>
        <div><dt>Service coverage</dt><dd>{list(partner.zones)}</dd></div>
        <div><dt>Pickup locations</dt><dd>{list(partner.pickupLocations)}</dd></div>
        <div><dt>Delivery locations</dt><dd>{list(partner.deliveryLocations)}</dd></div>
        {Object.entries(partner.base).map(([area, rate]) => <div key={area}><dt>{area} rate</dt><dd>{peso(Number(rate))}</dd></div>)}
        <div><dt>Each extra ½ kg</dt><dd>{peso(Number(partner.perHalfKg))}</dd></div>
        <div><dt>COD remittance</dt><dd>{partner.remittanceDays} days</dd></div>
      </dl>
      <p className="muted">Onetap manages these details. Contact Onetap to change them.</p>
    </section>
  );
}

export function CourierHome() {
  const [state, setState] = useState({ loading: true });

  const load = useCallback(() => courierFetch('/overview').then((data) => setState({ data }), (err) => setState((current) => ({ ...current, loading: false, error: err.message }))), []);

  useRefresh(load);

  const { data, loading, error } = state;
  const metrics = data?.metrics;
  return (
    <div className="order-page admin-page">
      <PageHead title="Dashboard" text="Updates every 15 seconds." />
      {loading && <div className="skeleton" role="status" aria-label="Loading dashboard" />}
      {error && !data && <p className="form-error" role="alert">{error}</p>}
      {data && (
        <>
          <ModeBanner environment={data.partner.environment} name={data.partner.name} />
          <section className="panel">
            <div className="panel__head"><h2>Pickups</h2></div>
            <StatCards items={[
              { label: 'Assigned Pickup Requests', value: metrics.assigned, href: '/courier/pickups' },
              { label: 'Pending Pickups', value: metrics.pending, href: '/courier/pickups?status=scheduled' },
              { label: 'Scheduled Pickups', value: metrics.scheduled, href: '/courier/pickups?status=confirmed' },
              { label: 'Successfully Picked Up', value: metrics.pickedUp, href: '/courier/pickups?status=picked_up' },
              { label: 'Failed Pickups', value: metrics.failedPickups, href: '/courier/pickups?status=failed' },
            ]} />
          </section>
          <section className="panel">
            <div className="panel__head"><h2>Deliveries</h2></div>
            <StatCards items={[
              { label: 'Active Shipments', value: metrics.active, href: '/courier/shipments?group=active' },
              { label: 'Out for Delivery', value: metrics.outForDelivery, href: '/courier/shipments?status=out_for_delivery' },
              { label: 'Successfully Delivered', value: metrics.delivered, href: '/courier/shipments?status=delivered' },
              { label: 'Failed Deliveries', value: metrics.failed, href: '/courier/shipments?status=failed_delivery' },
              { label: 'Return to Sender', value: metrics.returned, href: '/courier/shipments?status=return_to_sender' },
            ]} />
          </section>
          <section className="panel">
            <div className="panel__head"><h2>COD Collections</h2></div>
            <StatCards items={[
              { label: 'Collected', value: peso(metrics.codCollected), href: '/courier/cod' },
              { label: 'Parcels Collected', value: metrics.codCount, href: '/courier/cod' },
              { label: 'Waiting for Remittance', value: peso(metrics.codPending), href: '/courier/cod?status=collected' },
            ]} />
          </section>
          <ServiceDetails partner={data.partner} />
        </>
      )}
    </div>
  );
}

// Listed in the order the buttons appear, with the next normal step first. `location` is the
// label for where it happened, and `required` makes it a facility the tracking history names.
export const REPORT_FORMS = {
  pickup_confirmed: { title: 'Approve pickup', label: 'Approve Pickup' },
  pickup_rejected: { title: 'Reject pickup', label: 'Reject Pickup', reason: 'Why are you rejecting this pickup?' },
  pickup_failed: { title: 'Report failed pickup', label: 'Report Failed Pickup', reason: 'Why did the pickup fail?' },
  picked_up: { title: 'Confirm collected', label: 'Confirm Collected', location: 'Location' },
  in_transit: { title: 'Update to in transit', label: 'Mark In Transit', location: 'Location' },
  at_sorting_facility: { title: 'Arrived at sorting facility', label: 'Arrived at Sorting Facility', location: 'Sorting facility', required: true },
  sorting_completed: { title: 'Sorting completed', label: 'Sorting Completed', location: 'Sorting facility', required: true },
  departed_sorting_facility: { title: 'Departed sorting facility', label: 'Departed Sorting Facility', location: 'Sorting facility', required: true },
  arrived_delivery_hub: { title: 'Arrived at delivery hub', label: 'Arrived at Delivery Hub', location: 'Delivery hub', required: true },
  out_for_delivery: { title: 'Out for delivery', label: 'Out for Delivery', location: 'Location' },
  delivered: { title: 'Order delivered', label: 'Order Delivered', location: 'Location', proof: true },
  failed_delivery: { title: 'Report failed delivery', label: 'Report Failed Delivery', reason: 'Why did delivery fail?', location: 'Location' },
  return_to_sender: { title: 'Return to sender', label: 'Return to Sender', reason: 'Why is it going back?', location: 'Location' },
};

// Opens a map search for an address. Addresses aren't geocoded, so this is the closest match.
export const mapLink = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

const MAX_PHOTOS = 3;

// The proof part of a delivery: up to three photos, from the camera or the gallery, and the
// rider who received the parcel at handover, chosen from the partner's riders in the database.
function DeliveryProof({ values, setValues, errors, setErrors, requirePhoto, uploadFile, loadRiders, uploading, setUploading }) {
  const [riders, setRiders] = useState(null);
  const [photos, setPhotos] = useState([]);

  useEffect(() => {
    loadRiders().then((body) => setRiders(body.riders), () => setRiders([]));
  }, [loadRiders]);

  async function upload(file) {
    if (!file) return;
    if (photos.length >= MAX_PHOTOS) {
      setErrors((current) => ({ ...current, photo: `Send up to ${MAX_PHOTOS} photos.` }));
      return;
    }
    const data = new FormData();
    data.append('file', file);
    setUploading(true);
    setErrors((current) => ({ ...current, photo: undefined }));
    try {
      const { url } = await uploadFile(data);
      const next = [...photos, { url, preview: URL.createObjectURL(file) }];
      setPhotos(next);
      setValues((current) => ({ ...current, photos: next.map((photo) => photo.url) }));
    } catch (err) {
      setErrors((current) => ({ ...current, photo: err.message }));
    }
    setUploading(false);
  }

  function remove(url) {
    const next = photos.filter((photo) => photo.url !== url);
    setPhotos(next);
    setValues((current) => ({ ...current, photos: next.map((photo) => photo.url) }));
  }

  const pick = (e) => {
    upload(e.target.files[0]);
    e.target.value = '';
  };
  const full = uploading || photos.length >= MAX_PHOTOS;

  return (
    <>
      <fieldset className="field proof-photos">
        <legend>Delivery photo{requirePhoto ? '' : ' (optional)'}</legend>
        <div className="order-card__actions">
          <label className={`btn-mini btn-mini--primary proof-photos__button${full ? ' is-disabled' : ''}`}>
            <input className="sr-only" type="file" accept="image/*" capture="environment" disabled={full} onChange={pick} />
            Capture Photo
          </label>
          <label className={`btn-mini proof-photos__button${full ? ' is-disabled' : ''}`}>
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={full} onChange={pick} />
            Upload from Gallery
          </label>
        </div>
        <small className="field__hint">{uploading ? 'Uploading…' : `Show the parcel and its condition at the door. Up to ${MAX_PHOTOS} photos. Only the buyer, seller, your courier and Onetap can see them.`}</small>
        {errors.photo && <small className="field__error">{errors.photo}</small>}
        {photos.length > 0 && (
          <ul className="proof-photos__list">
            {photos.map((photo, i) => (
              <li key={photo.url}>
                <img src={photo.preview} alt={`Delivery photo ${i + 1}`} />
                <button className="btn-mini" type="button" onClick={() => remove(photo.url)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <div className="field">
        <label htmlFor="report-received-by">Received By{requirePhoto ? '' : ' (optional)'}</label>
        <select id="report-received-by" required={requirePhoto} aria-invalid={Boolean(errors.receivedBy)} value={values.receivedBy} disabled={!riders} onChange={(e) => setValues({ ...values, receivedBy: e.target.value })}>
          <option value="">{!riders ? 'Loading riders…' : requirePhoto ? 'Choose a rider' : 'No rider: our staff delivered it'}</option>
          {riders?.map((rider) => <option key={rider.id} value={rider.id}>{rider.name} ({rider.phone})</option>)}
        </select>
        <small className="field__hint">The rider who handed the parcel over, from your courier&apos;s registered riders.</small>
        {errors.receivedBy && <small className="field__error">{errors.receivedBy}</small>}
      </div>
      <TextField id="report-receiver" label="Recipient name (optional)" maxLength={100} placeholder="Who took the parcel at the door" value={values.receiver} error={errors.receiver} onChange={(e) => setValues({ ...values, receiver: e.target.value })} />
      <TextField id="report-relationship" label="Relationship to buyer (optional)" maxLength={100} placeholder="Self, family, guard" value={values.relationship} onChange={(e) => setValues({ ...values, relationship: e.target.value })} />
    </>
  );
}

const courierRiders = () => courierFetch('/riders/choices');

// Partner staff send reports through the panel API. The Rider Panel passes its own send, upload
// and rider list, requires photos, Received By and a location, and shows the details the rider
// confirms against.
export function ReportForm({ shipment, status, onDone, details, label, requirePhoto = false, locationRequired = false, defaultLocation = '', defaultReceivedBy = '', loadRiders = courierRiders, send = (values) => postCourier(`/shipments/${shipment.id}`, { action: 'report', status, ...values }), uploadFile = (data) => courierFetch('/uploads', { method: 'POST', body: data }) }) {
  const form = REPORT_FORMS[status];
  const [values, setValues] = useState({ reason: '', location: defaultLocation, receiver: '', relationship: '', photos: [], receivedBy: defaultReceivedBy, codCollected: shipment.cod ? String(shipment.total) : '' });
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (name) => (e) => setValues({ ...values, [name]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    const missing = {};
    if (form.proof && requirePhoto && !values.photos.length) missing.photo = 'Take or upload a photo of the delivered parcel.';
    if (form.proof && requirePhoto && !values.receivedBy) missing.receivedBy = 'Choose who received the parcel.';
    if (Object.keys(missing).length) {
      setErrors(missing);
      setError('Check the highlighted fields.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await send(values);
      Modal.close();
      toast(`Saved for ${shipment.orderId}.`, 'success');
      onDone(status);
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit}>
      {details}
      {form.reason && <TextField id="report-reason" label={form.reason} required maxLength={200} value={values.reason} error={errors.reason} onChange={set('reason')} />}
      {form.location && <TextField id="report-location" label={form.required || locationRequired ? form.location : `${form.location} (optional)`} required={form.required || locationRequired} maxLength={100} value={values.location} error={errors.location} onChange={set('location')} />}
      {form.proof && (
        <>
          <DeliveryProof values={values} setValues={setValues} errors={errors} setErrors={setErrors} requirePhoto={requirePhoto} uploadFile={uploadFile} loadRiders={loadRiders} uploading={uploading} setUploading={setUploading} />
          {shipment.cod && <TextField id="report-cod" label="Amount collected (₱)" required inputMode="decimal" value={values.codCollected} error={errors.codCollected} onChange={set('codCollected')} />}
        </>
      )}
      {shipment.sandbox && <p className="muted">Sandbox: this is a simulated courier update.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" type="submit" disabled={saving || uploading}>{saving ? 'Saving…' : label || form.label}</button>
    </form>
  );
}

function ShipmentDetail({ id, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => courierFetch(`/shipments/${id}`).then(({ shipment }) => setData(shipment), (err) => setError(err.message)), [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!data) return <div className="skeleton" role="status" aria-label="Loading shipment" />;

  const { pickup } = data;
  // A rejected pickup leaves this courier, so there's no shipment left to show.
  const finished = (status) => {
    onChanged();
    if (status === 'pickup_rejected') return;
    Modal.open({ title: `Shipment for ${data.orderId}`, variant: 'wide', content: <ShipmentDetail id={id} onChanged={onChanged} /> });
  };

  async function sync() {
    setBusy(true);
    try {
      const { applied } = await postCourier(`/shipments/${id}`, { action: 'sync' });
      toast(applied ? `${applied} updates applied.` : 'Already up to date.', 'success');
      await load();
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  }

  const waybill = () => openWaybill({
    id: data.orderId, tracking: data.tracking, bookingRef: data.bookingRef, sandbox: data.sandbox, courier: data.courier, method: data.method, payment: data.cod ? 'Cash on Delivery' : 'Prepaid', paid: !data.cod, total: data.total,
    buyer: { name: data.customer, phone: data.phone, address: data.address }, items: data.items,
  });

  return (
    <div className="assistant-form">
      {data.sandbox && <p className="admin-banner" role="note"><strong>Sandbox shipment.</strong> No real parcel exists.</p>}
      <dl className="order-facts order-facts--row">
        <div><dt>Status</dt><dd><Badge status={SHIPMENT_STATUS[data.status]} /></dd></div>
        <div><dt>Tracking</dt><dd>{data.tracking}</dd></div>
        <div><dt>Booking reference</dt><dd>{data.bookingRef || '—'}</dd></div>
        <div><dt>Estimated delivery</dt><dd>{dateOnly(data.eta)}{data.delayed && ' (delayed)'}</dd></div>
        {data.pickedUpAt && <div><dt>Picked up</dt><dd>{dateTime(data.pickedUpAt)}</dd></div>}
        {data.outForDeliveryAt && <div><dt>Out for delivery</dt><dd>{dateTime(data.outForDeliveryAt)}</dd></div>}
        {data.deliveredAt && <div><dt>Delivered</dt><dd>{dateTime(data.deliveredAt)}</dd></div>}
        <div><dt>Collect from</dt><dd>{data.seller}{pickup?.address && <>, {pickup.address} <a className="link" href={mapLink(pickup.address)} target="_blank" rel="noopener noreferrer">Map</a></>}</dd></div>
        {pickup?.contactPhone && <div><dt>Seller contact</dt><dd>{pickup.contactName}, {pickup.contactPhone}</dd></div>}
        {pickup && <div><dt>Pickup schedule</dt><dd>{dateOnly(pickup.scheduledFor)}{pickup.slot && `, ${pickup.slot}`} ({pickup.method})</dd></div>}
        {pickup?.parcel.weight && <div><dt>Parcel</dt><dd>{pickup.parcel.parcels} parcel{pickup.parcel.parcels === 1 ? '' : 's'}, {pickup.parcel.weight} kg{pickup.parcel.note && `. ${pickup.parcel.note}`}</dd></div>}
        <div><dt>Deliver to</dt><dd>{data.customer}, {data.address} <a className="link" href={mapLink(data.address)} target="_blank" rel="noopener noreferrer">Map</a></dd></div>
        <div><dt>Customer contact</dt><dd>{data.phone}</dd></div>
        <div><dt>Payment</dt><dd>{data.cod ? `Collect ${peso(data.total)}` : 'Prepaid, collect nothing'}</dd></div>
        {data.proof?.receivedBy && <div><dt>Received by</dt><dd>{data.proof.receivedBy.name} (rider, {data.proof.receivedBy.phone})</dd></div>}
        {data.proof?.receiver && <div><dt>Recipient</dt><dd>{data.proof.receiver}{data.proof.relationship && ` (${data.proof.relationship})`}</dd></div>}
        {data.proof?.deliveredBy && <div><dt>Confirmed by</dt><dd>{data.proof.deliveredBy}</dd></div>}
      </dl>
      <ProofPhotos proof={data.proof} />
      <div className="order-card__actions">
        {Object.keys(REPORT_FORMS).filter((status) => data.actions.includes(status)).map((status) => (
          <button className={`btn-mini ${['pickup_confirmed', 'picked_up', 'delivered'].includes(status) ? 'btn-mini--primary' : ''}`} type="button" key={status} onClick={() => Modal.open({ title: `${REPORT_FORMS[status].title}: ${data.orderId}`, content: <ReportForm shipment={data} status={status} onDone={finished} /> })}>
            {REPORT_FORMS[status].label}
          </button>
        ))}
        <button className="btn-mini" type="button" onClick={waybill}>Print Waybill</button>
        <button className="btn-mini" type="button" disabled={busy} onClick={sync}>Sync with Courier</button>
      </div>
      <RiderSection shipment={data} onChanged={() => {
        load();
        onChanged();
      }} />
      <section>
        <h3>Shipment history</h3>
        <ol className="timeline order-timeline">
          {data.events.map((event) => (
            <li className="is-done" key={`${event.at}-${event.status}-${event.note}`}>
              {SHIPMENT_STATUS[event.status]?.label || event.status}{event.note && `: ${event.note}`}
              <small>{dateTime(event.at)}{event.location && ` · ${event.location}`} · {event.source}</small>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

const openShipment = (id, orderId, onChanged) => Modal.open({ title: `Shipment for ${orderId}`, variant: 'wide', content: <ShipmentDetail id={id} onChanged={onChanged} /> });

export function CourierPickups({ initial }) {
  const list = useAdminList('/pickups', initial, COURIER_CLIENT);
  useRefresh(list.reload);
  const counts = list.data?.counts || {};

  return (
    <div className="order-page admin-page">
      <PageHead title="Assigned Pickups" text="Open a new request to approve or reject it, and assign a rider to collect it. Only booked pickups appear here." />
      <Tabs list={list} name="status" label="Filter by status" tabs={[['', 'All Assigned'], ...options(COURIER_PICKUP_STATUS).map(([value, label]) => [value, label, counts[value] || 0])]} />
      <FilterBar list={list} placeholder="Order, seller or booking reference">
        <DateFilter list={list} name="from" label="From" />
        <DateFilter list={list} name="to" label="To" />
      </FilterBar>
      <DataTable
        list={list}
        label="Assigned pickups"
        empty="No pickups here yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Order', render: (row) => <button className="link" type="button" onClick={() => openShipment(row.shipmentId, row.orderId, list.reload)}>{row.orderId}</button> },
          { label: 'Seller', sort: 'seller', render: (row) => row.seller },
          { label: 'Pickup address', render: (row) => row.address },
          { label: 'Contact', render: (row) => row.contactPhone || '—' },
          { label: 'Schedule', sort: 'scheduled', render: (row) => <>{dateOnly(row.scheduledFor)}{row.slot && <small className="admin-cell-note">{row.slot}</small>}</> },
          { label: 'Handover', render: (row) => row.method },
          { label: 'Rider', render: (row) => (row.rider ? <>{row.rider.rider}<small className="admin-cell-note">{TASK_STATUS[row.rider.status].label}</small></> : row.method === 'Pickup' && ['scheduled', 'confirmed'].includes(row.status) ? <button className="link" type="button" onClick={() => openShipment(row.shipmentId, row.orderId, list.reload)}>Assign</button> : '—') },
          { label: 'Status', sort: 'status', render: (row) => <Badge status={COURIER_PICKUP_STATUS[row.status]} /> },
        ]}
      />
    </div>
  );
}

const SHIPMENT_TABS = ['picked_up', 'in_transit', 'at_sorting_facility', 'arrived_delivery_hub', 'out_for_delivery', 'delivered', 'failed_delivery', 'return_to_sender'];

export function CourierShipments({ initial }) {
  const list = useAdminList('/shipments', initial, COURIER_CLIENT);
  useRefresh(list.reload);

  return (
    <div className="order-page admin-page">
      <PageHead title="Shipments" text="Parcels booked with your company, from collection to delivery." />
      <Tabs list={list} name="status" label="Filter by status" tabs={[['', 'All'], ...SHIPMENT_TABS.map((status) => [status, SHIPMENT_STATUS[status].label])]} />
      <FilterBar list={list} placeholder="Tracking, order, seller or customer">
        <DateFilter list={list} name="from" label="From" />
        <DateFilter list={list} name="to" label="To" />
        <label className="switch"><input type="checkbox" checked={list.filters.group === 'active'} onChange={(e) => list.setFilter('group', e.target.checked ? 'active' : '')} /><span>Active only</span></label>
      </FilterBar>
      <DataTable
        list={list}
        label="Shipments"
        empty="No shipments here yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Tracking', render: (row) => <button className="link" type="button" onClick={() => openShipment(row.id, row.orderId, list.reload)}>{row.tracking}</button> },
          { label: 'Order', render: (row) => row.orderId },
          { label: 'Status', sort: 'status', render: (row) => <><Badge status={SHIPMENT_STATUS[row.status]} />{row.delayed && <> <Badge status={{ label: 'Delayed', tone: 'danger' }} /></>}</> },
          { label: 'Customer', render: (row) => row.customer },
          { label: 'Rider', render: (row) => row.rider || '—' },
          { label: 'Deliver to', render: (row) => row.address },
          { label: 'Picked up', render: (row) => dateTime(row.pickedUpAt) },
          { label: 'Estimated', sort: 'eta', render: (row) => dateOnly(row.eta) },
          { label: 'COD', render: (row) => (row.cod ? peso(row.total) : '—') },
        ]}
      />
    </div>
  );
}

export function CourierCod({ initial }) {
  const list = useAdminList('/cod', initial, COURIER_CLIENT);

  return (
    <div className="order-page admin-page">
      <PageHead title="COD Collections" text="Cash collected on delivery, and what is still to be remitted to Onetap." />
      <Tabs list={list} name="status" label="Filter by status" tabs={[['', 'All'], ...options(COD_STATUS).filter(([value]) => value !== 'void')]} />
      <FilterBar list={list} placeholder="Order, seller or remittance">
        <DateFilter list={list} name="from" label="From" />
        <DateFilter list={list} name="to" label="To" />
      </FilterBar>
      <DataTable
        list={list}
        label="COD collections"
        empty="No COD parcels here yet"
        rowKey={(row) => row.orderId}
        columns={[
          { label: 'Order', render: (row) => row.orderId },
          { label: 'Seller', render: (row) => row.seller },
          { label: 'Rider', render: (row) => (row.rider ? <>{row.rider}<small className="admin-cell-note">{HANDOVER_STATUS[row.riderHandover].label}</small></> : '—') },
          { label: 'Expected', sort: 'amount', render: (row) => peso(row.expected) },
          { label: 'Collected', render: (row) => peso(row.collected) },
          { label: 'Status', render: (row) => <Badge status={COD_STATUS[row.status]} /> },
          { label: 'Collected on', sort: 'collected', render: (row) => dateTime(row.collectedAt) },
          { label: 'Remit by', sort: 'due', render: (row) => dateOnly(row.dueAt) },
        ]}
      />
    </div>
  );
}

const MATCH = {
  matched: { label: 'Matched', tone: 'ok' },
  short: { label: 'Short', tone: 'danger' },
  over: { label: 'Over', tone: 'warn' },
};
const PARCEL_PAYMENT = {
  prepaid: { label: 'Prepaid to Onetap', tone: 'info' },
  awaiting: { label: 'Awaiting Remittance', tone: 'warn' },
  remitted: { label: 'Remitted', tone: 'ok' },
};

export function CourierLogisticsRemittance({ initial }) {
  const list = useAdminList('/finance/remittances', { view: 'remittances', ...initial }, COURIER_CLIENT);
  useRefresh(list.reload);
  const view = list.filters.view === 'deliveries' ? 'deliveries' : 'remittances';
  const summary = list.data?.summary;
  // Switching tabs keeps the old rows until the new ones arrive, and each tab's columns only fit its own rows.
  const ready = list.data?.view === view;
  const signed = (value) => (value === 0 ? peso(0) : `${value > 0 ? '+' : '−'}${peso(Math.abs(value))}`);

  return (
    <div className="order-page admin-page">
      <p className="income-eyebrow">Finance · Remittances</p>
      <PageHead title="Logistics Remittance" text="COD cash you remit to Onetap, and the delivery fee on every parcel you delivered: Onetap's logistics fee and your share." />
      {summary && (
        <section className="panel">
          <StatCards items={[
            { label: `Awaiting Remittance (${summary.awaitingParcels})`, value: peso(summary.awaiting), href: '/courier/cod?status=collected' },
            { label: 'Overdue', value: peso(summary.overdue) },
            { label: `Remitted to Onetap (${summary.remittances})`, value: peso(summary.remitted) },
            { label: 'Delivery Fees', value: peso(summary.deliveryFees) },
            { label: 'Onetap Logistics Fees', value: peso(summary.logisticsFees) },
            { label: 'Your Share', value: peso(summary.courierShare) },
          ]} />
          {summary.discrepancies > 0 && <p className="admin-banner" role="note"><strong>{summary.discrepancies} {summary.discrepancies === 1 ? 'remittance doesn\'t' : 'remittances don\'t'} match.</strong> Onetap recorded a different amount than expected. Check the Remittances to Onetap tab.</p>}
        </section>
      )}
      <div className="order-tabs" role="group" aria-label="Show">
        {[['remittances', 'Remittances to Onetap'], ['deliveries', 'Delivery Fees by Parcel']].map(([key, label]) => (
          <button type="button" key={key} aria-pressed={view === key} onClick={() => list.setFilter('view', key)}>{label}</button>
        ))}
      </div>
      <FilterBar list={list} placeholder={view === 'remittances' ? 'Reference or note' : 'Order, seller or customer'}>
        <DateFilter list={list} name="from" label="From" />
        <DateFilter list={list} name="to" label="To" />
      </FilterBar>
      {!ready ? <div className="skeleton" role="status" aria-label="Loading" /> : view === 'remittances' ? (
        <DataTable
          list={list}
          label="COD remittances to Onetap"
          empty="No remittances yet. Onetap records each one when it receives your COD cash."
          rowKey={(row) => row.id}
          columns={[
            { label: 'Reference', render: (row) => <strong>{row.reference}</strong> },
            { label: 'Parcels', render: (row) => row.parcels },
            { label: 'Expected', render: (row) => peso(row.expected) },
            { label: 'Received by Onetap', sort: 'received', render: (row) => peso(row.received) },
            { label: 'Difference', render: (row) => signed(row.difference) },
            { label: 'Status', render: (row) => <Badge status={MATCH[row.status]} /> },
            { label: 'Recorded', sort: 'at', render: (row) => <>{dateTime(row.at)}{row.note && <small className="admin-cell-note">{row.note}</small>}</> },
          ]}
        />
      ) : (
        <DataTable
          list={list}
          label="Delivery fees by parcel"
          empty="No delivered parcels yet"
          rowKey={(row) => row.orderId}
          columns={[
            { label: 'Order', render: (row) => row.orderId },
            { label: 'Seller', render: (row) => row.seller },
            { label: 'Payment', render: (row) => row.paymentMethod },
            { label: 'Delivery Fee', sort: 'fee', render: (row) => peso(row.deliveryFee) },
            { label: 'Logistics Fee', render: (row) => peso(row.logisticsFee) },
            { label: 'Your Share', render: (row) => <strong>{peso(row.courierShare)}</strong> },
            { label: 'Status', render: (row) => <><Badge status={PARCEL_PAYMENT[row.paymentStatus]} />{row.remittanceReference && <small className="admin-cell-note">{row.remittanceReference}</small>}</> },
            { label: 'Delivered', sort: 'delivered', render: (row) => dateTime(row.deliveredAt) },
          ]}
        />
      )}
    </div>
  );
}

const PERIODS = [7, 30, 90];

export function CourierReports() {
  const [days, setDays] = useState(30);
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    courierFetch(`/reports?days=${days}`).then((data) => setState({ data }), (err) => setState({ error: err.message }));
  }, [days]);

  const { data, loading, error } = state;
  return (
    <div className="order-page admin-page">
      <PageHead title="Delivery Performance" text="Based on shipments booked in the selected period.">
        <label className="admin-select">
          <span className="sr-only">Period</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((period) => <option key={period} value={period}>Last {period} days</option>)}
          </select>
        </label>
      </PageHead>
      {loading && <div className="skeleton" role="status" aria-label="Loading report" />}
      {error && <p className="form-error" role="alert">{error}</p>}
      {data && (
        <section className="panel">
          <StatCards items={[
            { label: 'Shipments', value: data.shipments },
            { label: 'Delivered', value: data.delivered },
            { label: 'Failed Deliveries', value: data.failed },
            { label: 'Return to Sender', value: data.returned },
            { label: 'Average Delivery Time', value: data.averageHours === null ? '—' : `${data.averageHours.toFixed(1)} hours` },
          ]} />
          <div className="admin-charts">
            <TrendChart title="Parcels, last 14 days" series={[{ label: 'Collected', tone: 'one', values: data.collectedPerDay }, { label: 'Delivered', tone: 'two', values: data.deliveredPerDay }]} />
            <RateBars
              title="Service rates"
              rows={[
                { label: 'Delivery success', rate: data.successRate, note: `${percent(data.successRate)} of finished deliveries` },
                { label: 'On-time delivery', rate: data.onTimeRate, note: 'Delivered by the estimated date' },
                { label: 'Pickup success', rate: data.pickupRate, note: 'Collected without a failed pickup' },
              ]}
            />
          </div>
        </section>
      )}
    </div>
  );
}
