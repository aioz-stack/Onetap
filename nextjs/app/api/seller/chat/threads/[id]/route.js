import { sellerFrom } from '@/lib/server/auth';
import { getThread, sendAsSeller, updateThread } from '@/lib/server/chat';
import { route } from '@/lib/server/route';

export const GET = route(async (request, { params }) => {
  const { id } = await params;
  const markRead = request.nextUrl.searchParams.has('read');
  return Response.json(getThread('seller', sellerFrom(request), id, markRead));
});

export const POST = route(async (request, { params }) => {
  const { id } = await params;
  const seller = sellerFrom(request);
  return Response.json(sendAsSeller(seller, id, await request.json()));
});

export const PATCH = route(async (request, { params }) => {
  const { id } = await params;
  const seller = sellerFrom(request);
  return Response.json({ thread: updateThread(seller, id, await request.json()) });
});
