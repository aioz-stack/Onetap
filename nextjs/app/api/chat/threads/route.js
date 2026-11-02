import { customerFrom } from '@/lib/server/auth';
import { listThreads, openThread } from '@/lib/server/chat';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json({ threads: listThreads('customer', customerFrom(request).username) }));

export const POST = route(async (request) => {
  const customer = customerFrom(request);
  const { seller } = await request.json();
  return Response.json({ thread: openThread(customer, seller) });
});
