'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openCustomerLogin } from './Auth';
import Icon from './Icon';
import { Chat, ChatApi, chatState, serverThreads, Threads } from '@/lib/chat';
import { useStored } from '@/lib/store';
import { peso, toast } from '@/lib/ui';

const update = (patch) => chatState.set((state) => ({ ...state, ...patch }));
const LIST_REFRESH_MS = 6000;
export const THREAD_REFRESH_MS = 3000;

function Header({ title, back }) {
  return (
    <header className="chat__head">
      {back && (
        <button className="icon-btn" type="button" aria-label="Back to conversations" onClick={() => update({ activeId: null, server: false })}>
          <Icon name="arrow-left" />
        </button>
      )}
      <h2>{title}</h2>
      <button className="icon-btn" type="button" aria-label="Close chat" onClick={closeChat}><Icon name="close" /></button>
    </header>
  );
}

function closeChat() {
  update({ open: false });
  document.getElementById('chat-launcher')?.focus();
}

function Row({ name, preview, unread, onClick }) {
  return (
    <button type="button" className="chat__row" onClick={onClick}>
      <span className="chat__avatar">{name[0].toUpperCase()}</span>
      <span className="chat__row-text"><strong>{name}</strong><small>{preview}</small></span>
      {unread > 0 && <span className="count">{unread}</span>}
    </button>
  );
}

// One message, for both the chat box and the seller inbox. All content renders as text.
export function Bubble({ message, role, onFaq }) {
  const { sender, text, meta, at } = message;
  const side = sender === role ? 'me' : 'them';
  return (
    <div className={`bubble bubble--${side} ${sender === 'bot' ? 'bubble--bot' : ''}`}>
      {sender === 'bot' && <small className="bubble__label">Auto-reply</small>}
      {text}
      {meta?.image && <img className="bubble__image" src={meta.image} alt="Sent by the shop" />}
      {meta?.product && (
        <span className="bubble__product">
          <img src={meta.product.image} alt="" />
          <span><strong>{meta.product.name}</strong>{meta.product.price && <small>{peso(meta.product.price)}</small>}</span>
        </span>
      )}
      {meta?.faq && (
        <span className="bubble__faq">
          {meta.faq.map((question, i) => (
            onFaq
              ? <button className="chip" type="button" key={question} onClick={() => onFaq(i)}>{question}</button>
              : <span className="chip" key={question}>{question}</span>
          ))}
        </span>
      )}
      <time>{new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
    </div>
  );
}

function ThreadList({ role, rows, counts, seller, fresh, needsLogin }) {
  return (
    <>
      <Header title="Chat" />
      <div className="chat__tabs" role="tablist" aria-label="Chat as">
        {[['customer', 'Customer'], ['seller', 'Seller']].map(([value, label]) => (
          <button className="chat__tab" type="button" role="tab" key={value} aria-selected={role === value} onClick={() => update({ role: value, needsLogin: false })}>
            {label}{counts[value] > 0 && <span className="count">{counts[value]}</span>}
          </button>
        ))}
      </div>
      <div className="chat__body">
        {needsLogin && (
          <div className="empty">
            <p>Log in to message this shop.</p>
            <button className="btn btn--primary" type="button" onClick={openCustomerLogin}>Log In</button>
          </div>
        )}
        {role === 'seller' && !seller ? (
          <div className="empty">
            <p>Log in to Seller Centre to read and answer your customers.</p>
            <Link className="btn btn--primary" href="/seller/login">Go to Seller Centre</Link>
          </div>
        ) : (
          <>
            {rows.map((row) => <Row key={row.id} {...row} />)}
            {role === 'seller' && !rows.length && <p className="chat__hint">No customer messages yet.</p>}
            {role === 'seller' && <Link className="chat__manage" href="/seller/chat/inbox">Open Chat Management</Link>}
            {role === 'customer' && fresh.length > 0 && (
              <>
                <h3 className="chat__section">Message a shop</h3>
                {fresh.map((shop) => (
                  <Row key={shop.id} name={shop.name} preview="Start a conversation" unread={0} onClick={() => Chat.openShop(shop.id)} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Conversation({ title, role, messages, draft, focusRequest, onSend, onFaq, disabled }) {
  const log = useRef(null);
  const input = useRef(null);
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    log.current.scrollTop = log.current.scrollHeight;
  }, [lastId]);

  useEffect(() => {
    if (focusRequest) input.current?.focus();
  }, [focusRequest]);

  function submit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    update({ draft: '' });
    onSend(text);
  }

  return (
    <>
      <Header title={title} back />
      <div className="chat__messages" role="log" aria-live="polite" tabIndex={0} ref={log}>
        {messages.map((m) => <Bubble message={m} role={role} onFaq={onFaq} key={m.id} />)}
        {!messages.length && <p className="chat__hint">Say hello to start the conversation.</p>}
      </div>
      {disabled ? <p className="chat__notice">{disabled}</p> : (
        <form className="composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="chat-input">Message {title}</label>
          <input
            id="chat-input"
            ref={input}
            autoComplete="off"
            maxLength={500}
            placeholder="Write a message"
            value={draft}
            onChange={(e) => update({ draft: e.target.value })}
          />
          <button className="btn btn--primary" type="submit" aria-label="Send message"><Icon name="send" /></button>
        </form>
      )}
    </>
  );
}

function SampleThread({ thread, draft, focusRequest }) {
  useEffect(() => {
    Threads.markRead(thread.id);
  }, [thread]);

  const messages = thread.messages.map((m) => ({ id: `${m.ts}-${m.from}`, sender: m.from === 'customer' ? 'customer' : 'seller', text: m.text, at: m.ts }));
  return <Conversation title={thread.shopName} role="customer" messages={messages} draft={draft} focusRequest={focusRequest} onSend={(text) => Chat.sendToSample(text)} />;
}

function ServerThread({ id, role, draft, focusRequest }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    setData(await ChatApi.get(role, id));
    Chat.refreshThreads();
  }, [id, role]);

  useEffect(() => {
    load().catch((err) => toast(err.message, 'error'));
    const timer = setInterval(() => load().catch(() => {}), THREAD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function post(message) {
    try {
      setData(await ChatApi.post(role, id, message));
      Chat.refreshThreads();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const { thread, messages = [] } = data || {};
  return (
    <Conversation
      title={thread ? (role === 'customer' ? thread.shopName : thread.customerName) : 'Chat'}
      role={role}
      messages={messages}
      draft={draft}
      focusRequest={focusRequest}
      onSend={(text) => post({ text })}
      onFaq={role === 'customer' ? (faq) => post({ faq }) : undefined}
      disabled={role === 'customer' && thread?.blocked ? 'This shop is not accepting messages from your account.' : ''}
    />
  );
}

export default function ChatBox() {
  const pathname = usePathname();
  const { open, role, activeId, server, needsLogin, draft, focusRequest } = chatState.use();
  const threads = useStored('chats', []);
  const customer = useStored('session.customer');
  const seller = useStored('session.seller');
  const guestId = useStored('guestId');
  const remote = serverThreads.use();

  const customerId = customer ? `customer:${customer.username}` : guestId;
  const mineSample = threads.filter((t) => t.customerId === customerId);
  const customerRemote = customer ? remote.customer : [];
  const sellerRemote = seller ? remote.seller : [];

  const counts = {
    customer: mineSample.reduce((sum, t) => sum + t.unread.customer, 0) + customerRemote.reduce((sum, t) => sum + t.unread, 0),
    seller: sellerRemote.reduce((sum, t) => sum + t.unread, 0),
  };
  const total = counts.customer + counts.seller;

  useEffect(() => {
    Chat.guestId();
    function onSession() {
      Chat.adoptGuestThreads();
      update({ activeId: null, server: false, needsLogin: false });
      Chat.refreshThreads();
    }
    document.addEventListener('onetap:session', onSession);
    return () => document.removeEventListener('onetap:session', onSession);
  }, []);

  const signedIn = Boolean(customer || seller);
  useEffect(() => {
    if (!signedIn) return undefined;
    Chat.refreshThreads();
    const timer = setInterval(() => Chat.refreshThreads(), LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [signedIn]);

  const sample = !server && activeId ? threads.find((t) => t.id === activeId) : null;
  const started = new Set(mineSample.map((t) => t.shopId));
  const fresh = Chat.shops().filter((s) => !started.has(s.id));

  const rows = role === 'customer'
    ? [
      ...customerRemote.map((t) => ({ id: t.id, name: t.shopName, preview: t.preview || 'No messages yet', unread: t.unread, onClick: () => Chat.openThread(t.id, 'customer') })),
      ...mineSample
        .slice()
        .sort((a, b) => (b.messages.at(-1)?.ts || 0) - (a.messages.at(-1)?.ts || 0))
        .map((t) => ({ id: t.id, name: t.shopName, preview: t.messages.at(-1)?.text || 'No messages yet', unread: t.unread.customer, onClick: () => update({ activeId: t.id, server: false }) })),
    ]
    : sellerRemote.map((t) => ({ id: t.id, name: t.customerName, preview: t.preview, unread: t.unread, onClick: () => Chat.openThread(t.id, 'seller') }));

  if (['/admin', '/courier', '/rider'].some((path) => pathname.startsWith(path))) return null;

  let content = <ThreadList role={role} rows={rows} counts={counts} seller={seller} fresh={fresh} needsLogin={needsLogin} />;
  if (server && activeId) content = <ServerThread key={activeId} id={activeId} role={role} draft={draft} focusRequest={focusRequest} />;
  else if (sample) content = <SampleThread key={sample.id} thread={sample} draft={draft} focusRequest={focusRequest} />;

  return (
    <aside className="chat" aria-label="Customer and seller chat">
      <section
        className="chat__panel"
        id="chat-panel"
        hidden={!open}
        onKeyDown={(e) => {
          if (e.key === 'Escape') closeChat();
        }}
      >
        {open && content}
      </section>
      <button
        className="chat__launcher"
        id="chat-launcher"
        type="button"
        aria-expanded={open}
        aria-controls="chat-panel"
        onClick={() => (open ? closeChat() : Chat.open())}
      >
        <Icon name="chat" />
        <span>Chat</span>
        <span className="count" hidden={!total} aria-label={`${total} unread`}>{total}</span>
      </button>
    </aside>
  );
}
