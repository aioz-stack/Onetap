import { logoutAccount } from '@/lib/server/auth';
import { currentRider, setRiderDuty } from '@/lib/server/riders';
import { route } from '@/lib/server/route';

// Logging out also signs the rider out for work, so they stop getting new tasks.
export const POST = route(async () => {
  const rider = await currentRider();
  if (rider) {
    try { setRiderDuty(rider, false, 'logout'); } catch { /* an inactive rider is already offline */ }
  }
  await logoutAccount('rider');
  return new Response(null, { status: 204 });
});
