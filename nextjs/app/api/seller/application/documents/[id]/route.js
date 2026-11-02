import { documentResponse } from '@/lib/server/applications';
import { applicantFrom } from '@/lib/server/auth';
import { route } from '@/lib/server/route';

export const GET = route(async (request, { params }) => {
  const { id } = await params;
  return documentResponse(applicantFrom(request), id);
});
