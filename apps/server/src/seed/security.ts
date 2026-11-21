import type { ObjectPermission, RoleDef, RolePermissions } from '@titoforce/shared';

const FULL: ObjectPermission = { read: 'all', create: true, edit: 'all', delete: 'all' };
/** Read everything, change what you own (typical "public read only" sharing). */
const TEAM: ObjectPermission = { read: 'all', create: true, edit: 'own', delete: 'own' };
/** Read and edit everything, but only delete your own records. */
const SHARED: ObjectPermission = { read: 'all', create: true, edit: 'all', delete: 'own' };
const OWN: ObjectPermission = { read: 'own', create: true, edit: 'own', delete: 'own' };
const READ: ObjectPermission = { read: 'all', create: false, edit: 'none', delete: 'none' };
const NONE: ObjectPermission = { read: 'none', create: false, edit: 'none', delete: 'none' };

const SALES = ['account', 'contact', 'lead', 'opportunity', 'quote', 'quote_line_item', 'product'];
const SERVICE = ['case', 'knowledge_article'];
const MARKETING = ['campaign', 'web_form'];
const WORK = ['project', 'work_item'];
const PEOPLE = ['department', 'employee', 'time_off_request', 'performance_review', 'job_requisition', 'candidate'];

function perms(base: Partial<Omit<RolePermissions, 'objects'>>, defaults: ObjectPermission, objects: Record<string, ObjectPermission>): RolePermissions {
  const all = [...SALES, ...SERVICE, ...MARKETING, ...WORK, ...PEOPLE, 'activity'];
  const out: Record<string, ObjectPermission> = { '*': defaults };
  for (const o of all) out[o] = objects[o] ?? defaults;
  return { setup: false, viewSensitive: false, manageAutomations: false, manageAgents: false, ...base, objects: out };
}

const each = (names: string[], p: ObjectPermission) => Object.fromEntries(names.map((n) => [n, p]));

/** Directory-style HR access for everyone: see colleagues and departments, request your own time off. */
const SELF_SERVICE = {
  department: READ,
  employee: READ,
  time_off_request: OWN,
  performance_review: OWN,
  job_requisition: NONE,
  candidate: NONE,
};

export function standardRoles(): RoleDef[] {
  return [
    {
      id: 'admin',
      name: 'System Administrator',
      description: 'Full access, including setup, security, automations and AI agents.',
      permissions: perms({ setup: true, viewSensitive: true, manageAutomations: true, manageAgents: true }, FULL, {}),
    },
    {
      id: 'sales_manager',
      name: 'Sales Manager',
      description: 'Manages the sales team: full access to sales data, read access to service.',
      permissions: perms({ manageAutomations: true }, READ, {
        ...each(SALES, FULL),
        product: READ,
        ...each(MARKETING, READ),
        ...each(WORK, TEAM),
        ...SELF_SERVICE,
        time_off_request: TEAM,
        performance_review: TEAM,
        // Hiring managers open requisitions and submit them for HR approval.
        job_requisition: TEAM,
        activity: SHARED,
      }),
    },
    {
      id: 'sales_rep',
      name: 'Sales Representative',
      description: 'Works leads and opportunities. Sees all sales data, edits own records.',
      permissions: perms({}, READ, {
        ...each(SALES, TEAM),
        product: READ,
        campaign: READ,
        web_form: NONE,
        ...each(WORK, TEAM),
        ...SELF_SERVICE,
        activity: TEAM,
      }),
    },
    {
      id: 'support_agent',
      name: 'Support Agent',
      description: 'Works the case queue and maintains the knowledge base.',
      permissions: perms({}, READ, {
        case: SHARED,
        knowledge_article: SHARED,
        contact: TEAM,
        ...each(['lead', 'opportunity', 'quote', 'quote_line_item'], READ),
        web_form: NONE,
        ...each(WORK, TEAM),
        ...SELF_SERVICE,
        activity: TEAM,
      }),
    },
    {
      id: 'marketing',
      name: 'Marketing',
      description: 'Runs campaigns, forms and lead generation.',
      permissions: perms({}, READ, {
        ...each(MARKETING, FULL),
        lead: FULL,
        contact: TEAM,
        ...each(WORK, TEAM),
        ...SELF_SERVICE,
        job_requisition: TEAM,
        activity: TEAM,
      }),
    },
    {
      id: 'hr_manager',
      name: 'HR Manager',
      description: 'Manages workers, time off, reviews and recruiting, including compensation.',
      permissions: perms({ viewSensitive: true }, READ, {
        ...each(PEOPLE, FULL),
        ...each(WORK, TEAM),
        web_form: NONE,
        activity: TEAM,
      }),
    },
    {
      id: 'employee',
      name: 'Employee',
      description: 'Self-service: directory, time off, projects and knowledge.',
      permissions: perms({}, NONE, {
        ...SELF_SERVICE,
        ...each(WORK, TEAM),
        knowledge_article: READ,
        product: READ,
        activity: OWN,
      }),
    },
    {
      id: 'ai_agent',
      name: 'AI Agent',
      description: 'Used by agents launched from automations. Cannot sign in, delete data or see sensitive fields.',
      permissions: perms({}, READ, {
        ...each([...SALES, ...SERVICE, ...MARKETING, ...WORK], { read: 'all', create: true, edit: 'all', delete: 'none' }),
        employee: READ,
        department: READ,
        time_off_request: NONE,
        performance_review: NONE,
        job_requisition: READ,
        candidate: NONE,
        activity: { read: 'all', create: true, edit: 'all', delete: 'none' },
      }),
    },
  ];
}
