import { adminRoute } from '@/lib/server/admin';
import { customerApprovalDetail, decideCustomer } from '@/lib/server/customerApprovals';

export const GET = adminRoute('customers', async (request, admin, { params }) => {
  const { username } = await params;
  return Response.json({ customer: customerApprovalDetail(username) });
});

export const POST = adminRoute('customers', async (request, admin, { params }) => {
  const { username } = await params;
  const { action, reason } = await request.json();
  return Response.json({ customer: decideCustomer(admin, username, action, reason) });
});
