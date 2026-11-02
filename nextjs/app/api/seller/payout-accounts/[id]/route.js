import { checkOrigin } from '@/lib/server/admin';
import { sellerFrom } from '@/lib/server/auth';
import { deleteAccount, setDefaultAccount, updateAccount } from '@/lib/server/payoutAccounts';
import { route } from '@/lib/server/route';

export const PATCH = route(async (request, { params }) => {
  checkOrigin(request);
  const { id } = await params;
  return Response.json(updateAccount(sellerFrom(request), id, await request.json()));
});

// `{ action: 'default' }` makes this the default withdrawal account.
export const POST = route(async (request, { params }) => {
  checkOrigin(request);
  const { id } = await params;
  const { action } = await request.json();
  if (action !== 'default') return Response.json({ error: 'Unknown action.' }, { status: 400 });
  setDefaultAccount(sellerFrom(request), id);
  return new Response(null, { status: 204 });
});

export const DELETE = route(async (request, { params }) => {
  checkOrigin(request);
  const { id } = await params;
  deleteAccount(sellerFrom(request), id);
  return new Response(null, { status: 204 });
});
