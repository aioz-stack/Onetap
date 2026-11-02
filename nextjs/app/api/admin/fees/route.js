import { adminRoute } from '@/lib/server/admin';
import { feeOverview, setFees } from '@/lib/server/fees';

// Fee Management: only administrators with the `fees` permission can see or change fees.
export const GET = adminRoute('fees', async () => Response.json(feeOverview()));

export const POST = adminRoute('fees', async (request, admin) => {
  setFees(admin, await request.json());
  return Response.json(feeOverview());
});
