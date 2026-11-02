import { adminRoute } from '@/lib/server/admin';
import { revealAccount, reviewAccount } from '@/lib/server/payoutAccounts';

// The full account number, for checking it with the bank or wallet. Each look is audited.
export const GET = adminRoute('cod', async (request, admin, { params }) => {
  const { id } = await params;
  return Response.json({ account: revealAccount(admin, id) });
});

export const POST = adminRoute('cod', async (request, admin, { params }) => {
  const { id } = await params;
  reviewAccount(admin, id, await request.json());
  return Response.json({ account: revealAccount(admin, id) });
});
