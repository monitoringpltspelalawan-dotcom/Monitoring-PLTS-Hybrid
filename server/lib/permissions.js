/** Permission catalogue and default role matrix (RBAC). */

export const PERMISSIONS = [
  'site:view', 'site:manage', 'site:delete',
  'device:view', 'device:manage',
  'gateway:view', 'gateway:manage',
  'modbus:view', 'modbus:manage', 'modbus:test',
  'alarm:view', 'alarm:ack', 'alarm:resolve', 'alarm:rules',
  'analytics:view', 'report:view', 'report:generate', 'report:schedule',
  'user:view', 'user:manage', 'audit:view', 'settings:manage',
];

const VIEW = ['site:view', 'device:view', 'gateway:view', 'modbus:view', 'alarm:view', 'analytics:view', 'report:view'];

export const DEFAULT_ROLES = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Full platform control including users, settings and destructive operations.',
    permissions: [...PERMISSIONS],
  },
  {
    code: 'CORPORATE_ADMIN',
    name: 'Corporate Administrator',
    description: 'Portfolio-wide administration of sites, devices, gateways, reports and users.',
    permissions: PERMISSIONS.filter((p) => p !== 'site:delete'),
  },
  {
    code: 'REGIONAL_MANAGER',
    name: 'Regional Manager',
    description: 'Read and manage operations within the assigned region.',
    permissions: [
      ...VIEW, 'site:manage', 'device:manage', 'gateway:manage', 'modbus:test',
      'alarm:ack', 'alarm:resolve', 'alarm:rules', 'report:generate', 'report:schedule', 'user:view',
    ],
  },
  {
    code: 'SITE_ADMIN',
    name: 'Site Administrator',
    description: 'Administration of authorized sites, devices, gateways and Modbus mappings.',
    permissions: [
      ...VIEW, 'site:manage', 'device:manage', 'gateway:manage', 'modbus:manage', 'modbus:test',
      'alarm:ack', 'alarm:resolve', 'alarm:rules', 'report:generate', 'report:schedule',
    ],
  },
  {
    code: 'OPERATOR',
    name: 'Operator',
    description: 'Day-to-day operations: acknowledge alarms, run reports, test connectivity.',
    permissions: [...VIEW, 'modbus:test', 'alarm:ack', 'alarm:resolve', 'report:generate'],
  },
  {
    code: 'VIEWER',
    name: 'Viewer',
    description: 'Read-only access to authorized sites and reports.',
    permissions: [...VIEW],
  },
];

export const rolePermissions = (roleCode, permissionsJson) => {
  if (roleCode === 'SUPER_ADMIN') return [...PERMISSIONS];
  const parsed = typeof permissionsJson === 'string' ? JSON.parse(permissionsJson || '[]') : permissionsJson || [];
  return parsed.filter((p) => PERMISSIONS.includes(p));
};
