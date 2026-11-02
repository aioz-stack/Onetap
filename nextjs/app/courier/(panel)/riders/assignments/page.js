import { CourierAssignments } from '@/components/courier/CourierRiders';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Assignment History' };

export default async function CourierAssignmentsPage({ searchParams }) {
  await pageCourier();
  return <CourierAssignments initial={await searchParams} />;
}
