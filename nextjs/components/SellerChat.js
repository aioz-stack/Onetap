'use client';

// Seller Chat Management: performance, chat assistant tools, education and the inbox.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bubble, THREAD_REFRESH_MS } from './ChatBox';
import Icon from './Icon';
import { Badge } from './SellerOrders';
import { confirmModal } from './SellerProducts';
import { Chat, ChatApi } from '@/lib/chat';
import { CHAT_EDUCATION } from '@/lib/data';
import { formatDate, ORDER_STATUS } from '@/lib/orders';
import { uploadImage, useSellerProducts } from '@/lib/productsApi';
import { Modal, peso, toast } from '@/lib/ui';

const LIST_REFRESH_MS = 5000;
const MAX_TEXT = 500;

const shortDate = (ms) => {
  const options = { timeZone: 'Asia/Manila' };
  const date = new Date(ms).toLocaleDateString('en-US', { ...options, month: '2-digit', day: '2-digit', year: 'numeric' });
  const day = new Date(ms).toLocaleDateString('en-US', { ...options, weekday: 'short' });
  return `${date} (${day})`;
};

function duration(ms) {
  const seconds = Math.round((ms || 0) / 1000);
  const part = (value) => String(value).padStart(2, '0');
  return `${part(Math.floor(seconds / 3600))}:${part(Math.floor(seconds / 60) % 60)}:${part(seconds % 60)}`;
}

const percent = (rate) => (rate === null ? '-' : `${(rate * 100).toFixed(1)}%`);

function Change({ current, previous, lowerIsBetter }) {
  if (!previous || current === null) return <span className="perf__change">-</span>;
  const change = (current - previous) / previous;
  if (!change) return <span className="perf__change">0.00%</span>;
  const up = change > 0;
  const good = up !== Boolean(lowerIsBetter);
  return <span className={`perf__change perf__change--${good ? 'good' : 'bad'}`}>{up ? '▲' : '▼'} {Math.abs(change * 100).toFixed(2)}%</span>;
}

function Hint({ text }) {
  return <span className="insights__hint" title={text}><Icon name="help" className="icon icon--sm" /><span className="sr-only">: {text}</span></span>;
}

function openPerformanceDetail({ days }) {
  Modal.open({
    title: 'Last 7 days',
    variant: 'wide',
    content: (
      <div className="sales-table">
        <table>
          <thead><tr><th scope="col">Day</th><th scope="col">Chat Enquiry</th><th scope="col">Chat Response Rate</th><th scope="col">Response Time</th></tr></thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.end}>
                <th scope="row">{shortDate(day.end - 1)}</th>
                <td>{day.enquiries}</td>
                <td>{percent(day.responseRate)}</td>
                <td>{duration(day.responseMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  });
}

function Performance() {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    ChatApi.performance().then((data) => setState({ data }), (err) => setState({ error: err.message }));
  }, []);

  const { data, loading, error } = state;
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Chat Performance</h2>
        {data && <p className="panel__note">Data from {shortDate(data.from)} to {shortDate(data.to)} GMT+08</p>}
        <button className="panel__more" type="button" disabled={!data} onClick={() => openPerformanceDetail(data)}>More<span className="sr-only"> chat performance</span> <Icon name="chevron" className="icon icon--sm icon--right" /></button>
      </div>
      {loading && <div className="skeleton skeleton--short" role="status" aria-label="Loading performance" />}
      {error && <p className="form-error" role="alert">{error}</p>}
      {data && (
        <dl className="perf">
          <div>
            <dt>Chat Enquiry <Hint text="Conversations where a buyer asked something in the last 30 days." /></dt>
            <dd>{data.current.enquiries}</dd>
            <dd className="perf__compare">vs Previous 30 Days <Change current={data.current.enquiries} previous={data.previous.enquiries} /></dd>
          </div>
          <div>
            <dt>Chat Response Rate <Hint text="Share of those conversations you replied to. Automatic messages don't count." /></dt>
            <dd>{percent(data.current.responseRate)}</dd>
            <dd className="perf__compare">vs Previous 30 Days <Change current={data.current.responseRate} previous={data.previous.responseRate} /></dd>
          </div>
          <div>
            <dt>Response Time <Hint text="Average time from a buyer's message to your reply." /></dt>
            <dd>{duration(data.current.responseMs)}</dd>
            <dd className="perf__compare">vs Previous 30 Days <Change current={data.current.responseMs} previous={data.previous.responseMs} lowerIsBetter /></dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function useSaver(settings, onSaved) {
  const [saving, setSaving] = useState(false);
  const save = async (patch, message) => {
    setSaving(true);
    try {
      onSaved(await ChatApi.saveSettings({ ...settings, ...patch }));
      Modal.close();
      toast(message, 'success');
    } catch (err) {
      toast(err.message, 'error');
      setSaving(false);
    }
  };
  return [saving, save];
}

function GreetingEditor({ settings, onSaved }) {
  const [greeting, setGreeting] = useState(settings.greeting);
  const [saving, save] = useSaver(settings, onSaved);
  return (
    <div className="assistant-form">
      <label className="switch">
        <input type="checkbox" checked={greeting.enabled} onChange={(e) => setGreeting({ ...greeting, enabled: e.target.checked })} />
        <span>Send a greeting when a buyer starts a chat</span>
      </label>
      <div className="field">
        <label htmlFor="greeting-text">Greeting message</label>
        <textarea id="greeting-text" rows={4} maxLength={MAX_TEXT} value={greeting.text} onChange={(e) => setGreeting({ ...greeting, text: e.target.value })} />
        <small className="field__hint">{greeting.text.length} / {MAX_TEXT}</small>
      </div>
      <button className="btn btn--primary btn--block" type="button" disabled={saving} onClick={() => save({ greeting }, 'Greeting saved.')}>{saving ? 'Saving…' : 'Save Greeting'}</button>
    </div>
  );
}

function ShortcutEditor({ settings, onSaved }) {
  const [items, setItems] = useState(settings.shortcuts);
  const [saving, save] = useSaver(settings, onSaved);
  const change = (i, patch) => setItems(items.map((item, j) => (i === j ? { ...item, ...patch } : item)));
  return (
    <div className="assistant-form">
      <p className="muted">Save replies you use often, then pick them while chatting.</p>
      {items.map((item, i) => (
        <fieldset className="assistant-row" key={i}>
          <legend className="sr-only">Shortcut {i + 1}</legend>
          <div className="field">
            <label htmlFor={`shortcut-title-${i}`}>Name</label>
            <input id={`shortcut-title-${i}`} maxLength={40} value={item.title} onChange={(e) => change(i, { title: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`shortcut-text-${i}`}>Message</label>
            <textarea id={`shortcut-text-${i}`} rows={2} maxLength={MAX_TEXT} value={item.text} onChange={(e) => change(i, { text: e.target.value })} />
          </div>
          <button className="btn-mini btn-mini--danger" type="button" onClick={() => setItems(items.filter((_, j) => j !== i))}>Delete<span className="sr-only"> shortcut {i + 1}</span></button>
        </fieldset>
      ))}
      {!items.length && <p className="muted">No shortcuts yet.</p>}
      {items.length < 30 && <button className="btn-mini product-add" type="button" onClick={() => setItems([...items, { title: '', text: '' }])}>Add Shortcut</button>}
      <button className="btn btn--primary btn--block" type="button" disabled={saving} onClick={() => save({ shortcuts: items }, 'Shortcuts saved.')}>{saving ? 'Saving…' : 'Save Shortcuts'}</button>
    </div>
  );
}

function FaqEditor({ settings, onSaved }) {
  const [faq, setFaq] = useState(settings.faq);
  const [saving, save] = useSaver(settings, onSaved);
  const change = (i, patch) => setFaq({ ...faq, items: faq.items.map((item, j) => (i === j ? { ...item, ...patch } : item)) });
  return (
    <div className="assistant-form">
      <label className="switch">
        <input type="checkbox" checked={faq.enabled} onChange={(e) => setFaq({ ...faq, enabled: e.target.checked })} />
        <span>Send these questions when a buyer starts a chat</span>
      </label>
      {faq.items.map((item, i) => (
        <fieldset className="assistant-row" key={i}>
          <legend className="sr-only">Question {i + 1}</legend>
          <div className="field">
            <label htmlFor={`faq-q-${i}`}>Question</label>
            <input id={`faq-q-${i}`} maxLength={100} value={item.q} onChange={(e) => change(i, { q: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`faq-a-${i}`}>Answer</label>
            <textarea id={`faq-a-${i}`} rows={2} maxLength={MAX_TEXT} value={item.a} onChange={(e) => change(i, { a: e.target.value })} />
          </div>
          <button className="btn-mini btn-mini--danger" type="button" onClick={() => setFaq({ ...faq, items: faq.items.filter((_, j) => j !== i) })}>Delete<span className="sr-only"> question {i + 1}</span></button>
        </fieldset>
      ))}
      {faq.items.length < 5 && <button className="btn-mini product-add" type="button" onClick={() => setFaq({ ...faq, items: [...faq.items, { q: '', a: '' }] })}>Add Question</button>}
      <button className="btn btn--primary btn--block" type="button" disabled={saving} onClick={() => save({ faq }, 'FAQ saved.')}>{saving ? 'Saving…' : 'Save FAQ'}</button>
    </div>
  );
}

function AssistantCard({ icon, title, hint, text, status, action, onClick }) {
  return (
    <article className="assistant">
      <span className="assistant__icon" aria-hidden="true"><Icon name={icon} /></span>
      <div className="assistant__text">
        <h3>{title} <Hint text={hint} /></h3>
        <p className="muted">{text}</p>
        <p className="assistant__status">{status}</p>
      </div>
      <button className="btn-mini" type="button" onClick={onClick}>{action}<span className="sr-only"> {title}</span></button>
    </article>
  );
}

function Assistant() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    ChatApi.settings().then(setSettings, (err) => setError(err.message));
  }, []);

  const open = (title, Editor) => Modal.open({ title, variant: 'wide', content: <Editor settings={settings} onSaved={setSettings} /> });

  return (
    <section className="panel">
      <div className="panel__head"><h2>Chat Assistant</h2></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!settings && !error && <div className="skeleton skeleton--short" role="status" aria-label="Loading chat assistant" />}
      {settings && (
        <div className="assistant-grid">
          <AssistantCard
            icon="chat"
            title="Agent Greetings"
            hint="Sent once, when a buyer first opens a chat with your shop."
            text="Automatically send a greeting when a buyer starts a conversation."
            status={settings.greeting.enabled ? 'On' : 'Off'}
            action="Edit"
            onClick={() => open('Agent Greetings', GreetingEditor)}
          />
          <AssistantCard
            icon="send"
            title="Shortcut"
            hint="Saved replies you can drop into a chat from the inbox."
            text="Respond faster with preset messages while you chat."
            status={`${settings.shortcuts.length} saved`}
            action="Start"
            onClick={() => open('Shortcut', ShortcutEditor)}
          />
          <AssistantCard
            icon="help"
            title="FAQ"
            hint="Buyers tap a question and get your answer straight away."
            text="Send frequently asked questions when a buyer starts a chat."
            status={settings.faq.enabled ? `On, ${settings.faq.items.length} questions` : 'Off'}
            action="Edit"
            onClick={() => open('FAQ', FaqEditor)}
          />
        </div>
      )}
    </section>
  );
}

function openArticle({ q, a }) {
  Modal.open({ title: q, content: <p className="muted">{a}</p> });
}

function openAllArticles() {
  Modal.open({
    title: 'Chat Education',
    variant: 'wide',
    content: CHAT_EDUCATION.map(({ q, a }) => (
      <details className="faq" key={q}>
        <summary>{q}<Icon name="chevron" className="icon faq__chevron" /></summary>
        <p>{a}</p>
      </details>
    )),
  });
}

function Education() {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Chat Education</h2>
        <button className="panel__more" type="button" onClick={openAllArticles}>More<span className="sr-only"> chat education</span> <Icon name="chevron" className="icon icon--sm icon--right" /></button>
      </div>
      <ul className="education">
        {CHAT_EDUCATION.slice(0, 6).map((article) => (
          <li key={article.q}><button type="button" onClick={() => openArticle(article)}>{article.q}</button></li>
        ))}
      </ul>
    </section>
  );
}

export function ChatManagement() {
  const [threads, setThreads] = useState([]);

  useEffect(() => {
    ChatApi.list('seller').then(setThreads, () => {});
  }, []);

  const unread = threads.reduce((sum, thread) => sum + thread.unread, 0);
  return (
    <div className="order-page">
      <div className="order-head">
        <div>
          <h1 tabIndex={-1}>Chat Management</h1>
          <p className="muted">See how you're responding, and set up tools that help.</p>
        </div>
        <Link className="btn-mini btn-mini--primary" href="/seller/chat/inbox">Open Inbox{unread > 0 && ` (${unread})`}</Link>
      </div>
      <Performance />
      <Assistant />
      <Education />
    </div>
  );
}

const INBOX_TABS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'unread', label: 'Unread', match: (t) => t.unread > 0 },
  { id: 'unreplied', label: 'Unreplied', match: (t) => t.lastSender === 'customer' && t.status === 'open' },
  { id: 'pinned', label: 'Pinned', match: (t) => t.pinned },
  { id: 'resolved', label: 'Resolved', match: (t) => t.status === 'resolved' },
];

function Composer({ threadId, disabledNote, onPost }) {
  const [text, setText] = useState('');
  const [settings, setSettings] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef(null);
  const { products } = useSellerProducts();
  const live = products.filter((p) => p.status === 'live');

  useEffect(() => {
    ChatApi.settings().then(setSettings, () => {});
  }, []);

  useEffect(() => {
    setText('');
  }, [threadId]);

  async function submit(e) {
    e?.preventDefault();
    if (!text.trim()) return;
    const sent = await onPost({ text });
    if (sent) setText('');
  }

  async function sendImage(file) {
    setUploading(true);
    try {
      await onPost({ image: await uploadImage(file, { square: false }) });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  function pickProduct() {
    Modal.open({
      title: 'Send a product',
      content: live.length ? (
        <ul className="pick-list">
          {live.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={async () => {
                  Modal.close();
                  await onPost({ productId: p.id });
                }}
              >
                <img src={p.images[0]} alt="" />
                <span>{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="muted">You have no live products yet.</p>,
    });
  }

  return (
    <form className="inbox__composer" onSubmit={submit}>
      {disabledNote && <p className="order-card__note">{disabledNote}</p>}
      {showShortcuts && (
        <ul className="pick-list pick-list--shortcuts">
          {settings?.shortcuts.map((item) => (
            <li key={item.title}>
              <button
                type="button"
                onClick={() => {
                  setText(item.text);
                  setShowShortcuts(false);
                  input.current.focus();
                }}
              >
                <strong>{item.title}</strong><small>{item.text}</small>
              </button>
            </li>
          ))}
          {!settings?.shortcuts.length && <li className="muted">No shortcuts yet. Add them in Chat Management.</li>}
        </ul>
      )}
      <div className="inbox__tools">
        <button className="btn-mini" type="button" aria-expanded={showShortcuts} onClick={() => setShowShortcuts(!showShortcuts)}>Shortcuts</button>
        <button className="btn-mini" type="button" onClick={pickProduct}>Send Product</button>
        <label className="btn-mini">
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => {
              const [file] = e.target.files;
              e.target.value = '';
              if (file) sendImage(file);
            }}
          />
          {uploading ? 'Uploading…' : 'Send Image'}
        </label>
      </div>
      <div className="composer">
        <label className="sr-only" htmlFor="inbox-input">Reply</label>
        <textarea
          id="inbox-input"
          ref={input}
          rows={2}
          maxLength={MAX_TEXT}
          placeholder="Write a reply. Enter sends, Shift+Enter adds a line."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="btn btn--primary" type="submit" aria-label="Send reply"><Icon name="send" /></button>
      </div>
    </form>
  );
}

function CustomerPanel({ thread, customer, onChange }) {
  const [note, setNote] = useState(thread.note);

  useEffect(() => {
    setNote(thread.note);
  }, [thread.id, thread.note]);

  return (
    <aside className="inbox__details" aria-label="Customer details">
      <section>
        <h3>Customer</h3>
        <dl className="order-sum">
          <div><dt>Name</dt><dd>{thread.customerName}</dd></div>
          <div><dt>Username</dt><dd>{customer.username}</dd></div>
          {customer.memberSince && <div><dt>Member since</dt><dd>{shortDate(customer.memberSince)}</dd></div>}
          <div><dt>Orders with you</dt><dd>{customer.orderCount}</dd></div>
          <div><dt>Total spent</dt><dd>{peso(customer.totalSpent)}</dd></div>
        </dl>
      </section>
      <section>
        <h3>Recent Orders</h3>
        {customer.orders.length ? (
          <ul className="inbox__orders">
            {customer.orders.map((order) => (
              <li key={order.id}>
                <Link className="link" href={`/seller/orders/${order.id}`}>{order.id}</Link>
                <Badge status={ORDER_STATUS[order.status]} />
                <small className="muted">{order.firstItem}{order.itemCount > 1 && ` and ${order.itemCount - 1} more`}</small>
                <small className="muted">{peso(order.total)} · {formatDate(order.placedAt)}</small>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No orders with your shop yet.</p>}
      </section>
      <section>
        <div className="field">
          <label htmlFor="inbox-note">Private Note</label>
          <textarea id="inbox-note" rows={3} maxLength={MAX_TEXT} value={note} onChange={(e) => setNote(e.target.value)} />
          <small className="field__hint">Only you can see this.</small>
        </div>
        <button className="btn-mini" type="button" disabled={note === thread.note} onClick={() => onChange({ note }, 'Note saved.')}>Save Note</button>
      </section>
    </aside>
  );
}

function Conversation({ id, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const log = useRef(null);
  const paused = useRef(false);
  const lastId = data?.messages.at(-1)?.id;

  const load = useCallback(async () => {
    if (paused.current) return;
    try {
      setData(await ChatApi.get('seller', id));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    paused.current = false;
    setData(null);
    load().then(onChanged);
    const timer = setInterval(load, THREAD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, onChanged]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lastId]);

  async function post(message) {
    try {
      setData(await ChatApi.post('seller', id, message));
      onChanged();
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    }
  }

  async function change(changes, message) {
    try {
      const thread = await ChatApi.update(id, changes);
      setData((current) => ({ ...current, thread }));
      onChanged();
      toast(message, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (error && !data) return <div className="inbox__empty" role="alert">{error}</div>;
  if (!data) return <div className="inbox__empty"><div className="skeleton" role="status" aria-label="Loading conversation" /></div>;

  const { thread, messages, customer } = data;
  return (
    <>
      <section className="inbox__thread" aria-label={`Conversation with ${thread.customerName}`}>
        <header className="inbox__head">
          <button className="icon-btn inbox__back" type="button" aria-label="Back to conversations" onClick={onBack}><Icon name="arrow-left" /></button>
          <div className="inbox__who">
            <strong>{thread.customerName}</strong>
            <Badge status={thread.status === 'open' ? { label: 'Open', tone: 'info' } : { label: 'Resolved', tone: 'ok' }} />
            {thread.blocked && <Badge status={{ label: 'Blocked', tone: 'danger' }} />}
          </div>
          <div className="inbox__actions">
            <button className="btn-mini" type="button" onClick={() => change({ status: thread.status === 'open' ? 'resolved' : 'open' }, thread.status === 'open' ? 'Marked as resolved.' : 'Reopened.')}>{thread.status === 'open' ? 'Resolve' : 'Reopen'}</button>
            <button className="btn-mini" type="button" aria-pressed={thread.pinned} onClick={() => change({ pinned: !thread.pinned }, thread.pinned ? 'Unpinned.' : 'Pinned.')}>{thread.pinned ? 'Unpin' : 'Pin'}</button>
            <button
              className="btn-mini"
              type="button"
              onClick={async () => {
                paused.current = true;
                await change({ unread: true }, 'Marked as unread.');
                onBack();
              }}
            >
              Mark Unread
            </button>
            <button
              className="btn-mini btn-mini--danger"
              type="button"
              onClick={() => (thread.blocked
                ? change({ blocked: false }, 'Unblocked.')
                : confirmModal({
                  title: `Block ${thread.customerName}`,
                  body: "They won't be able to message your shop until you unblock them.",
                  label: 'Block Customer',
                  danger: true,
                  run: () => change({ blocked: true }, 'Blocked.'),
                }))}
            >
              {thread.blocked ? 'Unblock' : 'Block'}
            </button>
          </div>
        </header>
        <div className="inbox__messages" role="log" aria-live="polite" tabIndex={0} ref={log}>
          {messages.map((message) => <Bubble message={message} role="seller" key={message.id} />)}
        </div>
        <Composer threadId={id} disabledNote={thread.blocked ? "You've blocked this customer, so they can't reply." : ''} onPost={post} />
      </section>
      <CustomerPanel thread={thread} customer={customer} onChange={change} />
    </>
  );
}

export function ChatInbox({ thread: initial }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(initial || null);

  const load = useCallback(async () => {
    try {
      setThreads(await ChatApi.list('seller'));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    Chat.refreshThreads();
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const current = INBOX_TABS.find((t) => t.id === tab);
  const text = query.trim().toLowerCase();
  const shown = threads.filter(current.match).filter((t) => `${t.customerName} ${t.customer} ${t.preview}`.toLowerCase().includes(text));

  return (
    <div className="order-page inbox-page">
      <Link className="order-back" href="/seller/chat"><Icon name="arrow-left" className="icon icon--sm" /> Chat Management</Link>
      <h1 tabIndex={-1}>Chat Inbox</h1>
      <div className={`inbox ${selected ? 'inbox--open' : ''}`}>
        <section className="inbox__list" aria-label="Conversations">
          <div className="order-tabs" role="group" aria-label="Filter conversations">
            {INBOX_TABS.map((t) => (
              <button type="button" key={t.id} aria-pressed={t.id === tab} onClick={() => setTab(t.id)}>{t.label} <span>{threads.filter(t.match).length}</span></button>
            ))}
          </div>
          <label className="order-search">
            <Icon name="search" />
            <span className="sr-only">Search conversations</span>
            <input type="search" placeholder="Customer or message" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {loading && <div className="skeleton skeleton--short" role="status" aria-label="Loading conversations" />}
          {!loading && error && !threads.length && <p className="form-error" role="alert">{error}</p>}
          {!loading && !error && !shown.length && <p className="muted inbox__none">{text ? 'No conversations match your search.' : 'No conversations here yet.'}</p>}
          <ul className="inbox__rows">
            {shown.map((t) => (
              <li key={t.id}>
                <button className="chat__row" type="button" aria-current={t.id === selected ? 'true' : undefined} onClick={() => setSelected(t.id)}>
                  <span className="chat__avatar">{t.customerName[0].toUpperCase()}</span>
                  <span className="chat__row-text">
                    <strong>{t.pinned && <span aria-label="Pinned">★ </span>}{t.customerName}</strong>
                    <small>{t.preview}</small>
                  </span>
                  {t.unread > 0 && <span className="count">{t.unread}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
        {selected
          ? <Conversation key={selected} id={selected} onBack={() => setSelected(null)} onChanged={load} />
          : <div className="inbox__empty"><Icon name="chat" /><p className="muted">Choose a conversation to read and reply.</p></div>}
      </div>
    </div>
  );
}
