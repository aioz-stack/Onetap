import { AdminTeam } from '@/components/admin/AdminTeam';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Team' };

export default async function AdminTeamPage() {
  const admin = await pageAdmin('team');
  return <AdminTeam self={admin.username} />;
}
