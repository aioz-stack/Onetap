import { adminRoute } from '@/lib/server/admin';
import { ApiError } from '@/lib/server/errors';
import { disconnectIntegration, saveIntegration, setEnvironment, testIntegration } from '@/lib/server/logistics';

export const PUT = adminRoute('api', async (request, admin, { params }) => {
  const { id } = await params;
  const { environment, ...input } = await request.json();
  saveIntegration(admin, id, environment, input);
  return new Response(null, { status: 204 });
});

export const POST = adminRoute('api', async (request, admin, { params }) => {
  const { id } = await params;
  const { action, environment } = await request.json();
  if (action === 'test') return Response.json(await testIntegration(admin, id, environment));
  if (action === 'disconnect') disconnectIntegration(admin, id, environment);
  else if (action === 'environment') setEnvironment(admin, id, environment);
  else throw new ApiError(400, 'Unknown action.');
  return new Response(null, { status: 204 });
});
