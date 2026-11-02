import { courierRoute } from '@/lib/server/courierPanel';
import { ApiError } from '@/lib/server/errors';
import { riderDetail, setRiderActive, setRiderLogin, updateRider } from '@/lib/server/riders';

export const GET = courierRoute(async (request, account, { params }) => {
  const { id } = await params;
  return Response.json({ rider: riderDetail(account.partnerId, id) });
});

// Edits come as a form, because they can carry a new license file.
export const PUT = courierRoute(async (request, account, { params }) => {
  const { id } = await params;
  return Response.json({ rider: await updateRider(account, id, await request.formData()) });
});

export const POST = courierRoute(async (request, account, { params }) => {
  const { id } = await params;
  const { action, ...input } = await request.json();
  if (action === 'activate' || action === 'deactivate') setRiderActive(account, id, action === 'activate');
  else if (action === 'login') await setRiderLogin(account, id, input);
  else throw new ApiError(400, 'Unknown action.');
  return Response.json({ rider: riderDetail(account.partnerId, id) });
});
