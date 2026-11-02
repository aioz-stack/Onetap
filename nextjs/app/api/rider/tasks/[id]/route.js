import { riderRoute, riderTaskAction } from '@/lib/server/riders';

export const POST = riderRoute(async (request, account, { params }) => {
  const { id } = await params;
  return Response.json(riderTaskAction(account, id, await request.json()));
});
