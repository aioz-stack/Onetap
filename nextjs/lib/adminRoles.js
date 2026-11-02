// Administrator roles, shared by the server checks and the admin navigation.

export const ADMIN_ROLES = {
  super_admin: { label: 'Super Admin', permissions: ['logistics', 'api', 'pickups', 'shipments', 'cod', 'products', 'sellers', 'audit', 'team'] },
  logistics: { label: 'Logistics Manager', permissions: ['logistics', 'api', 'pickups', 'shipments'] },
  finance: { label: 'Finance', permissions: ['shipments', 'cod'] },
  moderator: { label: 'Moderator', permissions: ['products', 'sellers'] },
};

export function can(admin, permission) {
  return Boolean(ADMIN_ROLES[admin?.adminRole]?.permissions.includes(permission));
}
