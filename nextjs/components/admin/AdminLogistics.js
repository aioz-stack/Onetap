'use client';

// Logistics Partners and API Configuration.

import { useCallback, useEffect, useState } from 'react';
import { confirmModal } from '../SellerProducts';
import { adminFetch, Badge, CheckGroup, dateTime, DataTable, FilterBar, PageHead, percent, postAdmin, SandboxBanner, SelectFilter, TextField, useAdminList, useRefresh } from './AdminUI';
import { API_STATUS, options } from '@/lib/adminLabels';
import { SHIPPING_ZONES } from '@/lib/data';
import { Modal, peso, toast } from '@/lib/ui';

const BLANK = {
  name: '', contact: '', trackingUrl: '', services: ['Standard', 'Cash on Delivery'], zones: SHIPPING_ZONES, pickupLocations: SHIPPING_ZONES, deliveryLocations: SHIPPING_ZONES,
  base: Object.fromEntries(SHIPPING_ZONES.map((zone) => [zone, 80])), perHalfKg: 15, remittanceDays: 3, forSellers: true, forCustomers: true,
};

const PASSWORD_HINT = 'At least 12 characters. Passwords are stored as hashes, so nobody can look them up later.';

function PasswordFields({ value, errors, onChange, label = 'Password' }) {
  const field = (name, text, hint) => <TextField id={`login-${name}`} label={text} type="password" required autoComplete="new-password" minLength={12} maxLength={128} hint={hint} value={value[name]} error={errors[name]} onChange={(e) => onChange({ [name]: e.target.value })} />;
  return (
    <>
      {field('password', label, PASSWORD_HINT)}
      {field('confirmPassword', `Confirm ${label.toLowerCase()}`)}
    </>
  );
}

const USER_FORMS = {
  add: { title: 'Add a user', button: 'Add User', done: 'User added. Share the password with them securely.', blank: { name: '', username: '', email: '', password: '', confirmPassword: '', active: true } },
  edit: { title: 'Edit account details', button: 'Save Details', done: 'Account details saved.' },
  password: { title: 'Reset password', button: 'Reset Password', done: 'Password reset and user signed out. Share the new password with them securely.', blank: { password: '', confirmPassword: '' } },
};

function UserForm({ url, mode, user, onDone, onCancel }) {
  const copy = USER_FORMS[mode];
  const [form, setForm] = useState(copy.blank || { name: user.name, username: user.username, email: user.email });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm({ ...form, ...patch });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage('');
    try {
      const body = await (mode === 'add' ? postAdmin(url, form) : postAdmin(`${url}/${encodeURIComponent(user.username)}`, form, 'PATCH'));
      onDone(body.users, copy.done);
    } catch (err) {
      setErrors(err.fields || {});
      setMessage(err.message);
      setSaving(false);
    }
  }

  const detail = (name, label, props = {}) => <TextField id={`panel-${name}`} label={label} required value={form[name]} error={errors[name]} onChange={(e) => set({ [name]: e.target.value })} autoComplete="off" {...props} />;

  return (
    <form className="assistant-form" onSubmit={submit} autoComplete="off">
      <h3>{mode === 'add' ? copy.title : `${copy.title}: ${user.username}`}</h3>
      <div className="form-grid">
        {mode !== 'password' && (
          <>
            {detail('name', 'Full name')}
            {detail('username', 'Username', { hint: '4 to 30 letters, numbers, dots or underscores.' })}
            {detail('email', 'Email (optional)', { type: 'email', required: false })}
          </>
        )}
        {mode !== 'edit' && <PasswordFields value={form} errors={errors} onChange={set} label={mode === 'add' ? 'Password' : 'New password'} />}
      </div>
      {mode === 'add' && <label className="switch"><input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /><span>Activate this account now</span></label>}
      {message && <p className="form-error" role="alert">{message}</p>}
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : copy.button}</button>
      {onCancel && <button className="btn btn--block" type="button" onClick={onCancel}>Cancel</button>}
    </form>
  );
}

function PanelUsers({ partner, onChanged }) {
  const [users, setUsers] = useState(null);
  const [view, setView] = useState({ mode: 'add' });
  const [message, setMessage] = useState('');
  const url = `/partners/${partner.id}/users`;

  useEffect(() => {
    adminFetch(url).then((body) => setUsers(body.users), (err) => setMessage(err.message));
  }, [url]);

  const saved = (list, done) => {
    setUsers(list);
    setView({ mode: 'add' });
    toast(done, 'success');
    onChanged();
  };

  async function setActive(user, active) {
    try {
      const body = await postAdmin(`${url}/${encodeURIComponent(user.username)}`, { disabled: !active }, 'PATCH');
      saved(body.users, active ? `${user.username} can sign in again.` : `${user.username} was deactivated and signed out.`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="assistant-form">
      <p className="muted">These accounts sign in at /courier/login and only see {partner.name}&apos;s pickups, shipments and delivery records.</p>
      {!partner.access.open && <p className="admin-banner" role="note">{partner.name} is inactive, so its Courier Panel is closed. These accounts can sign in once it&apos;s activated.</p>}
      {!users && !message && <div className="skeleton" role="status" aria-label="Loading users" />}
      {message && <p className="form-error" role="alert">{message}</p>}
      {users?.length === 0 && <p className="muted">No accounts yet, so nobody can sign in for {partner.name}. Add one below.</p>}
      {users?.length > 0 && (
        <ul className="admin-activity admin-accounts">
          {users.map((user) => (
            <li key={user.username}>
              <div>
                <strong>{user.name}</strong> <Badge status={user.disabled ? { label: 'Deactivated', tone: 'neutral' } : { label: 'Active', tone: 'ok' }} />
                <p className="muted">{user.username} · {user.email || 'No email'}</p>
              </div>
              <div className="order-card__actions">
                <button className="btn-mini" type="button" onClick={() => setView({ mode: 'edit', user })}>Edit<span className="sr-only"> {user.username}</span></button>
                <button className="btn-mini" type="button" onClick={() => setView({ mode: 'password', user })}>Reset Password<span className="sr-only"> for {user.username}</span></button>
                {user.disabled
                  ? <button className="btn-mini btn-mini--primary" type="button" onClick={() => setActive(user, true)}>Activate<span className="sr-only"> {user.username}</span></button>
                  : <button className="btn-mini btn-mini--danger" type="button" onClick={() => setActive(user, false)}>Deactivate<span className="sr-only"> {user.username}</span></button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <UserForm key={`${view.mode}-${view.user?.username}`} url={url} mode={view.mode} user={view.user} onDone={saved} onCancel={view.user ? () => setView({ mode: 'add' }) : null} />
    </div>
  );
}

function PartnerForm({ partner, onSaved }) {
  const [form, setForm] = useState(partner || BLANK);
  const [account, setAccount] = useState({ username: '', password: '', confirmPassword: '', active: true });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm({ ...form, ...patch });
  const setLogin = (patch) => setAccount({ ...account, ...patch });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await (partner ? postAdmin(`/partners/${partner.id}`, form, 'PUT') : postAdmin('/partners', { ...form, account }));
      Modal.close();
      toast(partner ? 'Partner updated.' : `Partner added with login ${account.username}. Activate it to put it to work.`, 'success');
      onSaved();
    } catch (err) {
      setErrors(err.fields || {});
      toast(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit}>
      <div className="form-grid">
        <TextField id="partner-name" label="Name" required value={form.name} error={errors.name} onChange={(e) => set({ name: e.target.value })} />
        <TextField id="partner-contact" label="Contact" value={form.contact} onChange={(e) => set({ contact: e.target.value })} />
        <TextField id="partner-tracking" label="Tracking link" placeholder="https://courier.example/track/{tracking}" value={form.trackingUrl} error={errors.trackingUrl} onChange={(e) => set({ trackingUrl: e.target.value })} />
        <TextField id="partner-services" label="Delivery options" hint="Separate with commas." value={form.services.join(', ')} onChange={(e) => set({ services: e.target.value.split(',').map((s) => s.trimStart()) })} />
      </div>
      <CheckGroup legend="Service coverage" options={SHIPPING_ZONES} value={form.zones} onChange={(zones) => set({ zones })} />
      <CheckGroup legend="Pickup locations" options={SHIPPING_ZONES} value={form.pickupLocations} onChange={(pickupLocations) => set({ pickupLocations })} />
      <CheckGroup legend="Delivery locations" options={SHIPPING_ZONES} value={form.deliveryLocations} onChange={(deliveryLocations) => set({ deliveryLocations })} />
      <div className="form-grid form-grid--four">
        {SHIPPING_ZONES.map((zone) => (
          <TextField key={zone} id={`rate-${zone}`} label={`${zone} (₱)`} inputMode="decimal" value={form.base[zone]} error={errors.base && zone === SHIPPING_ZONES[0] ? errors.base : ''} onChange={(e) => set({ base: { ...form.base, [zone]: e.target.value } })} />
        ))}
        <TextField id="rate-step" label="Each extra ½ kg (₱)" inputMode="decimal" value={form.perHalfKg} error={errors.perHalfKg} onChange={(e) => set({ perHalfKg: e.target.value })} />
        <TextField id="remittance-days" label="COD remittance days" inputMode="numeric" value={form.remittanceDays} error={errors.remittanceDays} onChange={(e) => set({ remittanceDays: e.target.value })} />
      </div>
      <label className="switch"><input type="checkbox" checked={form.forSellers} onChange={(e) => set({ forSellers: e.target.checked })} /><span>Sellers can choose this courier</span></label>
      <label className="switch"><input type="checkbox" checked={form.forCustomers} onChange={(e) => set({ forCustomers: e.target.checked })} /><span>Use for customer shipping rates</span></label>
      {!partner && (
        <>
          <h3>Courier Panel login</h3>
          <p className="muted">The partner signs in with this at /courier/login once you&apos;ve activated it. Their account only sees this courier&apos;s records.</p>
          <div className="form-grid">
            <TextField id="login-username" label="Username" required autoComplete="off" hint="4 to 30 letters, numbers, dots or underscores." value={account.username} error={errors.username} onChange={(e) => setLogin({ username: e.target.value })} />
            <PasswordFields value={account} errors={errors} onChange={setLogin} />
          </div>
          <label className="switch"><input type="checkbox" checked={account.active} onChange={(e) => setLogin({ active: e.target.checked })} /><span>Activate this account now</span></label>
        </>
      )}
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Partner'}</button>
    </form>
  );
}

function ActivationReport({ partner, report }) {
  const sandbox = report.environment === 'sandbox';
  const list = (items) => items.join(', ');
  return (
    <dl className="order-facts">
      <div><dt>Connection</dt><dd>{sandbox ? 'Sandbox' : 'Production'} test passed</dd></div>
      <div><dt>Sellers</dt><dd>{report.sellers ? 'Can choose this courier now' : 'Not offered, as set on this partner'}</dd></div>
      <div><dt>Customers</dt><dd>{report.customers ? 'Included in shipping rates' : 'Not included, as set on this partner'}</dd></div>
      <div><dt>Courier Panel</dt><dd>{report.panelOpen ? 'Open' : 'Closed'}. {report.logins === 1 ? '1 login' : `${report.logins} logins`} can sign in at /courier/login</dd></div>
      <div><dt>Service coverage</dt><dd>{list(report.zones)}</dd></div>
      <div><dt>Pickup locations</dt><dd>{list(report.pickupLocations)}</dd></div>
      <div><dt>Delivery locations</dt><dd>{list(report.deliveryLocations)}</dd></div>
      <div><dt>Bookings</dt><dd>{sandbox ? `Booking, tracking and status updates work, but they're simulated. No real parcel moves until ${partner.name} has an official API connection.` : 'Booking, tracking and status updates run through the courier API.'}</dd></div>
    </dl>
  );
}

function panelState({ status, access }) {
  if (status === 'active') return 'Open';
  if (!access.open) return 'Closed';
  return `Open until ${access.openParcels === 1 ? '1 parcel finishes' : `${access.openParcels} parcels finish`}`;
}

export function AdminLogistics() {
  const [state, setState] = useState({ loading: true, partners: [] });
  const [activating, setActivating] = useState('');

  const load = useCallback(() => adminFetch('/partners').then(({ partners }) => setState({ partners }), (err) => setState({ partners: [], error: err.message })), []);

  useRefresh(load);

  const activate = async (partner) => {
    setActivating(partner.id);
    try {
      const { activation } = await postAdmin(`/partners/${partner.id}`, { action: 'active' });
      Modal.open({ title: `${partner.name} is active`, content: <ActivationReport partner={partner} report={activation} /> });
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
    setActivating('');
  };

  const act = async (partner, action, message) => {
    try {
      await postAdmin(`/partners/${partner.id}`, { action });
      toast(message, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const openForm = (partner) => Modal.open({ title: partner ? `Edit ${partner.name}` : 'Add logistics partner', variant: 'wide', content: <PartnerForm partner={partner} onSaved={load} /> });

  return (
    <div className="order-page admin-page">
      <PageHead title="Logistics Partners" text="Couriers, coverage and who can use them.">
        <button className="btn-mini btn-mini--primary" type="button" onClick={() => openForm(null)}>Add Partner</button>
      </PageHead>
      <SandboxBanner />
      {state.loading && <div className="skeleton" role="status" aria-label="Loading partners" />}
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <div className="admin-cards">
        {state.partners.map((partner) => (
          <article className="panel" key={partner.id}>
            <div className="panel__head">
              <h2>{partner.name}</h2>
              <Badge status={partner.status === 'active' ? { label: 'Active', tone: 'ok' } : { label: 'Inactive', tone: 'neutral' }} />
              {partner.isDefault && <Badge status={{ label: 'Default', tone: 'info' }} />}
              <Badge status={{ label: partner.environment === 'sandbox' ? 'Sandbox' : 'Production', tone: 'warn' }} />
            </div>
            <dl className="order-sum">
              <div><dt>Integration</dt><dd>{API_STATUS[partner.integration?.status || 'not_configured'].label}</dd></div>
              <div><dt>Coverage</dt><dd>{partner.zones.join(', ') || 'None'}</dd></div>
              <div><dt>Delivery options</dt><dd>{partner.services.join(', ')}</dd></div>
              <div><dt>Pickup locations</dt><dd>{partner.pickupLocations.join(', ') || 'None'}</dd></div>
              <div><dt>Delivery locations</dt><dd>{partner.deliveryLocations.join(', ') || 'None'}</dd></div>
              <div><dt>Available to</dt><dd>{[partner.forSellers && 'Sellers', partner.forCustomers && 'Customers'].filter(Boolean).join(', ') || 'Nobody'}</dd></div>
              <div><dt>{SHIPPING_ZONES[0]} rate</dt><dd>{peso(Number(partner.base[SHIPPING_ZONES[0]]))}</dd></div>
              <div><dt>Delivery success</dt><dd>{percent(partner.stats.successRate)}</dd></div>
              <div><dt>Delivered / failed</dt><dd>{partner.stats.delivered} / {partner.stats.failed}</dd></div>
              <div><dt>Courier Panel</dt><dd>{panelState(partner)}</dd></div>
              <div><dt>Panel accounts</dt><dd>{partner.accounts.total ? `${partner.accounts.active} active of ${partner.accounts.total}` : 'None yet'}</dd></div>
            </dl>
            <div className="order-card__actions">
              <button className="btn-mini" type="button" onClick={() => openForm(partner)}>Edit<span className="sr-only"> {partner.name}</span></button>
              <button className="btn-mini" type="button" onClick={() => Modal.open({ title: `${partner.name} panel users`, variant: 'wide', content: <PanelUsers partner={partner} onChanged={load} /> })}>Panel Users<span className="sr-only"> for {partner.name}</span></button>
              {!partner.isDefault && partner.status === 'active' && <button className="btn-mini" type="button" onClick={() => act(partner, 'default', `${partner.name} is now the default.`)}>Set Default<span className="sr-only"> {partner.name}</span></button>}
              {partner.status === 'active'
                ? <button className="btn-mini btn-mini--danger" type="button" onClick={() => confirmModal({ title: `Deactivate ${partner.name}`, body: 'Sellers and customers stop seeing this courier and it gets no new pickups. Its staff keep the Courier Panel until their open parcels are finished, then it closes. All records are kept.', label: 'Deactivate', danger: true, run: () => act(partner, 'inactive', `${partner.name} was deactivated.`) })}>Deactivate<span className="sr-only"> {partner.name}</span></button>
                : <button className="btn-mini btn-mini--primary" type="button" disabled={Boolean(activating)} onClick={() => activate(partner)}>{activating === partner.id ? 'Activating…' : 'Activate'}<span className="sr-only"> {partner.name}</span></button>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

const SECRETS = [['apiKey', 'API Key'], ['clientId', 'Client ID'], ['clientSecret', 'Client Secret'], ['accessToken', 'Access Token'], ['webhookSecret', 'Webhook Secret']];
const FAULTS = [['none', 'No fault'], ['timeout_once', 'Time out once'], ['error_once', 'Server error once'], ['lost_response_once', 'Lose the response once'], ['always_fail', 'Always fail']];

function IntegrationForm({ partner, integration, onSaved }) {
  const [secrets, setSecrets] = useState({});
  const [baseUrl, setBaseUrl] = useState(integration.baseUrl);
  const [fault, setFault] = useState(integration.fault);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await postAdmin(`/integrations/${partner.id}`, { environment: integration.environment, secrets, baseUrl, fault }, 'PUT');
      Modal.close();
      toast('Saved. Test the connection next.', 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit} autoComplete="off">
      <p className="muted">Saved values are encrypted and never shown again. Leave a field blank to keep what&apos;s stored.</p>
      {SECRETS.map(([field, label]) => (
        <TextField key={field} id={`secret-${field}`} label={label} type="password" autoComplete="new-password" placeholder={integration.configured[field] ? 'Saved' : 'Not set'} value={secrets[field] || ''} onChange={(e) => setSecrets({ ...secrets, [field]: e.target.value })} />
      ))}
      <TextField id="integration-url" label="API address" placeholder="https://" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      {integration.environment === 'sandbox' && (
        <div className="field">
          <label htmlFor="integration-fault">Sandbox test fault</label>
          <select id="integration-fault" value={fault} onChange={(e) => setFault(e.target.value)}>
            {FAULTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <small className="field__hint">Makes the simulator fail on purpose, to test retries and error handling.</small>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    </form>
  );
}

function IntegrationRow({ partner, integration, reload }) {
  const [testing, setTesting] = useState(false);

  async function test() {
    setTesting(true);
    try {
      const { ok, message } = await postAdmin(`/integrations/${partner.id}`, { action: 'test', environment: integration.environment });
      toast(message, ok ? 'success' : 'error');
    } catch (err) {
      toast(err.message, 'error');
    }
    setTesting(false);
    reload();
  }

  const post = async (action, message) => {
    await postAdmin(`/integrations/${partner.id}`, { action, environment: integration.environment });
    toast(message, 'success');
    reload();
  };

  const name = integration.environment === 'sandbox' ? 'Sandbox' : 'Production';
  return (
    <div className="admin-integration">
      <div className="admin-integration__head">
        <strong>{name}</strong>
        <Badge status={API_STATUS[integration.status] || API_STATUS.not_configured} />
        {integration.active && <Badge status={{ label: 'In Use', tone: 'info' }} />}
      </div>
      <p className="muted">
        {integration.environment === 'sandbox' ? 'Built-in simulator. No live courier is contacted.' : `No production adapter is installed for ${partner.name} yet. Credentials can be stored, but bookings stay on Sandbox.`}
      </p>
      <p className="muted">Credentials set: {SECRETS.filter(([field]) => integration.configured[field]).map(([, label]) => label).join(', ') || 'None'}. Last test: {dateTime(integration.lastTestedAt)}.</p>
      {integration.lastError && <p className="form-error">{integration.lastError}</p>}
      <div className="order-card__actions">
        <button className="btn-mini" type="button" onClick={() => Modal.open({ title: `${partner.name} ${name}`, content: <IntegrationForm partner={partner} integration={integration} onSaved={reload} /> })}>Edit<span className="sr-only"> {partner.name} {name}</span></button>
        <button className="btn-mini" type="button" disabled={testing || integration.status === 'not_configured'} onClick={test}>{testing ? 'Testing…' : 'Test Connection'}<span className="sr-only"> {partner.name} {name}</span></button>
        {!integration.active && integration.status === 'connected' && <button className="btn-mini" type="button" onClick={() => post('environment', `${partner.name} now uses ${name}.`).catch((err) => toast(err.message, 'error'))}>Use {name}</button>}
        {integration.status !== 'not_configured' && (
          <button
            className="btn-mini btn-mini--danger"
            type="button"
            onClick={() => confirmModal({
              title: `Disconnect ${partner.name} ${name}`,
              body: 'This permanently deletes the stored credentials.',
              label: 'Disconnect',
              danger: true,
              run: () => post('disconnect', 'Disconnected.'),
            })}
          >
            Disconnect<span className="sr-only"> {partner.name} {name}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function ApiLogs({ partners }) {
  const list = useAdminList('/logs');
  return (
    <section className="panel">
      <div className="panel__head"><h2>API Request Log</h2></div>
      <FilterBar list={list} placeholder="Operation, reference or error">
        <SelectFilter list={list} name="partner" label="Partner" options={partners.map((p) => [p.id, p.name])} />
        <SelectFilter list={list} name="outcome" label="Outcome" options={[['success', 'Success'], ['retry', 'Retried'], ['failed', 'Failed']]} />
        <button className="btn-mini" type="button" onClick={list.reload}>Refresh</button>
      </FilterBar>
      <DataTable
        list={list}
        label="API request log"
        empty="No API requests yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'When', sort: 'at', render: (row) => dateTime(row.at) },
          { label: 'Partner', render: (row) => row.partner_id },
          { label: 'Mode', render: (row) => row.environment },
          { label: 'Operation', render: (row) => row.operation },
          { label: 'Reference', render: (row) => row.reference },
          { label: 'Attempt', render: (row) => row.attempt },
          { label: 'Outcome', render: (row) => <Badge status={{ success: { label: 'Success', tone: 'ok' }, retry: { label: 'Retried', tone: 'warn' }, failed: { label: 'Failed', tone: 'danger' } }[row.outcome]} /> },
          { label: 'Time', sort: 'duration', render: (row) => `${row.duration_ms} ms` },
          { label: 'Error', render: (row) => row.error },
        ]}
      />
      {list.data?.webhooks.length > 0 && (
        <>
          <h3>Recent webhooks</h3>
          <div className="admin-table" role="region" aria-label="Recent webhooks" tabIndex={0}>
            <table>
              <thead><tr><th scope="col">When</th><th scope="col">Partner</th><th scope="col">Outcome</th><th scope="col">Tracking</th><th scope="col">Status</th><th scope="col">Error</th></tr></thead>
              <tbody>{list.data.webhooks.map((hook) => <tr key={`${hook.at}-${hook.tracking}-${hook.status}-${hook.outcome}`}><td>{dateTime(hook.at)}</td><td>{hook.partner_id}</td><td>{hook.outcome}</td><td>{hook.tracking}</td><td>{hook.status}</td><td>{hook.error}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function AdminApi() {
  const [partners, setPartners] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => adminFetch('/integrations').then((body) => setPartners(body.partners), (err) => setError(err.message)), []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="order-page admin-page">
      <PageHead title="API Configuration" text="Credentials are encrypted on the server and never sent back to this page." />
      <SandboxBanner />
      {error && <p className="form-error" role="alert">{error}</p>}
      {!partners && !error && <div className="skeleton" role="status" aria-label="Loading integrations" />}
      {partners?.map((partner) => (
        <section className="panel" key={partner.id}>
          <div className="panel__head">
            <h2>{partner.name}</h2>
            <p className="panel__note">Last 24 hours: {partner.health.requests} requests, {partner.health.failed} failed, {partner.health.retries} retried{partner.health.averageMs !== null && `, ${partner.health.averageMs} ms average`}</p>
          </div>
          <div className="admin-integrations">
            {partner.integrations.map((integration) => <IntegrationRow key={integration.environment} partner={partner} integration={integration} reload={load} />)}
          </div>
          <p className="muted admin-webhook">Webhook address: <code>/api/webhooks/couriers/{partner.id}</code></p>
        </section>
      ))}
      {partners && <ApiLogs partners={partners} />}
    </div>
  );
}

export { options };
