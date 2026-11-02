import { ChatInbox } from '@/components/SellerChat';

export const metadata = { title: 'Chat Inbox' };

export default async function ChatInboxPage({ searchParams }) {
  const { thread } = await searchParams;
  return <ChatInbox key={thread} thread={thread} />;
}
