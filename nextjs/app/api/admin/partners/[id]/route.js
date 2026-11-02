import { adminRoute } from '@/lib/server/admin';
import { ApiError } from '@/lib/server/errors';
import { activatePartner, deactivatePartner, setDefaultPartner, updatePartner } from '@/lib/server/logistics';

export const PUT = adminRoute('logistics', async (request, admin, { params }) => {
  const { id } = await params;
  return Response.json({ partner: updatePartner(admin, id, await request.json()) });
});

export const POST = adminRoute('logistics', async (request, admin, { params }) => {
  const { id } = await params;
  const { action } = await request.json();
  if (action === 'active') return Response.json(await activatePartner(admin, id));
  if (action === 'inactive') return Response.json(deactivatePartner(admin, id));
  if (action === 'default') return Response.json({ partner: setDefaultPartner(admin, id) });
  throw new ApiError(422, 'Choose a valid status.');
});
