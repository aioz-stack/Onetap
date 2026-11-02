import { proofResponse } from '@/lib/server/proofs';
import { route } from '@/lib/server/route';

export const GET = route(async (request, { params }) => {
  const { id } = await params;
  return proofResponse(id);
});
