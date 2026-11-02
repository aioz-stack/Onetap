import { customerFrom } from '@/lib/server/auth';
import { getThread, sendAsCustomer } from '@/lib/server/chat';
import { route } from '@/lib/server/route';

export const GET = route(async (request, { params }) => {
  const { id } = await params;
  const markRead = request.nextUrl.searchParams.has('read');
  return Response.json(getThread('customer', customerFrom(request).username, id, markRead));
});

export const POST = route(async (request, { params }) => {
  const { id } = await params;
  const { username } = customerFrom(request);
  return Response.json(sendAsCustomer(username, id, await request.json()));
});
