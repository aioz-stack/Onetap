import { checkOrigin } from '@/lib/server/admin';
import { currentAccount } from '@/lib/server/auth';
import { currentCourier } from '@/lib/server/courierPanel';
import { route } from '@/lib/server/route';
import { requestStreet } from '@/lib/server/streets';

// Anyone filling in an address can report a missing street, including during sign-up. The form
// says which panel it is in, and the request is credited to that panel's signed-in account, if any.
async function requester(panel) {
  if (panel === 'courier') {
    const courier = await currentCourier();
    return courier ? { role: 'courier', username: courier.partnerId } : { role: 'guest' };
  }
  const role = panel === 'seller' ? 'seller' : 'customer';
  const account = await currentAccount(role);
  return account ? { role, username: account.username } : { role: 'guest' };
}

export const POST = route(async (request) => {
  checkOrigin(request);
  const input = await request.json();
  return Response.json({ street: requestStreet(request, await requester(input?.panel), input) }, { status: 201 });
});
