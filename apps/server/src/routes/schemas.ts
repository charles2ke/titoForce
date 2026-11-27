import { CALL_OUTCOMES, FIELD_TYPES, FILTER_OPERATORS, PALETTE } from '@titoforce/shared';
import { z } from 'zod';

// Request-shape validation. Services perform the semantic validation (known fields, permissions, …).

const id = z.string().min(1).max(64);
const apiName = z.string().min(1).max(64);
const shortText = z.string().max(255);

export const filterRule = z.object({ field: apiName, op: z.enum(FILTER_OPERATORS), value: z.unknown().optional() });
export const filterGroup = z.object({ match: z.enum(['all', 'any']), rules: z.array(filterRule).max(50) });
export const sortSpec = z.object({ field: apiName, dir: z.enum(['asc', 'desc']) });

export const recordQuery = z.object({
  filters: filterGroup.nullish(),
  andFilters: z.array(filterGroup.nullable()).max(5).optional(),
  viewId: id.nullish(),
  sort: sortSpec.nullish(),
  page: z.number().int().min(1).max(1_000_000).optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
  q: z.string().max(200).optional(),
});

export const recordWrite = z.object({
  fields: z.record(z.string(), z.unknown()),
  allowDuplicates: z.boolean().optional(),
});

export const login = z.object({ email: z.string().min(1).max(254), password: z.string().min(1).max(200), issueToken: z.boolean().optional() });
export const changePassword = z.object({ current: z.string().min(1).max(200), next: z.string().min(8).max(200) });

export const listView = z.object({
  object: apiName,
  name: z.string().min(1).max(80),
  shared: z.boolean().default(false),
  filters: filterGroup.nullable().default(null),
  sort: sortSpec.nullable().default(null),
  columns: z.array(apiName).max(30).nullable().default(null),
  viewType: z.enum(['table', 'kanban', 'calendar', 'timeline']).default('table'),
  groupBy: apiName.nullish(),
});

const navItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('object'), object: apiName, label: shortText.optional(), view: z.enum(['table', 'kanban', 'calendar', 'timeline']).optional() }),
  z.object({ type: z.literal('page'), page: z.enum(['home', 'forecast', 'org-chart', 'reports']), label: shortText, icon: z.string().max(40) }),
]);
export const app = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/).optional(),
  name: z.string().min(1).max(60),
  description: z.string().max(500).default(''),
  icon: z.string().max(40).default('layout-grid'),
  color: z.enum(PALETTE).default('indigo'),
  nav: z.array(navItem).max(30),
  dashboardId: id.nullable().default(null),
  sortOrder: z.number().int().min(0).max(1000).default(100),
});

export const createUser = z.object({
  email: z.string().min(3).max(254),
  name: z.string().min(1).max(120),
  title: z.string().max(120).nullish(),
  roleId: apiName,
  password: z.string().min(8).max(200),
});
export const updateUser = z.object({
  name: z.string().min(1).max(120).optional(),
  title: z.string().max(120).nullish(),
  roleId: apiName.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});

const access = z.enum(['all', 'own', 'none']);
export const role = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  permissions: z.object({
    setup: z.boolean(),
    viewSensitive: z.boolean(),
    manageAutomations: z.boolean(),
    manageAgents: z.boolean(),
    requireMfa: z.boolean().default(false),
    objects: z.record(z.string(), z.object({ read: access, create: z.boolean(), edit: access, delete: access })),
    fields: z.record(z.string(), z.record(z.string(), z.enum(['edit', 'read', 'none']))).default({}),
  }),
});

// ---------- security ----------

export const sharingRule = z.object({
  object: apiName,
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  type: z.enum(['owner', 'criteria']),
  ownerRoles: z.array(apiName).max(50).default([]),
  criteria: filterGroup.nullable().default(null),
  shareWith: z.array(apiName).min(1).max(50),
  access: z.enum(['read', 'edit']),
  active: z.boolean().default(true),
});

const mfaCode = z.string().min(1).max(40);
export const mfaChallenge = z.object({ challenge: z.string().min(1).max(200) });
export const mfaVerify = z.object({ challenge: z.string().min(1).max(200), code: mfaCode, issueToken: z.boolean().optional() });
/** Enabling, disabling and new recovery codes need the password and a current code. */
export const mfaConfirm = z.object({ code: mfaCode, password: z.string().min(1).max(200) });

const httpsUrl = z.string().min(1).max(2000);
export const ssoProvider = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'Ids use lowercase letters, numbers and dashes'),
  type: z.enum(['oidc', 'saml']),
  name: z.string().min(1).max(80),
  enabled: z.boolean().default(true),
  oidc: z
    .object({
      issuer: httpsUrl,
      clientId: z.string().min(1).max(500),
      scopes: z.string().max(500).default('openid email profile'),
      tokenAuthMethod: z.enum(['client_secret_basic', 'client_secret_post']).default('client_secret_basic'),
    })
    .nullish(),
  saml: z
    .object({
      entryPoint: httpsUrl,
      idpIssuer: z.string().max(2000).nullish(),
      idpCert: z.string().min(1).max(50_000),
      spEntityId: z.string().max(2000).nullish(),
      emailAttribute: z.string().max(500).nullish(),
      nameAttribute: z.string().max(500).nullish(),
    })
    .nullish(),
  /** OIDC client secret; omitted keeps the stored one, '' removes it. */
  clientSecret: z.string().max(2000).optional(),
  jit: z.boolean().default(false),
  defaultRole: apiName.nullish(),
  allowedDomains: z.array(z.string().min(1).max(253)).max(50).default([]),
});

export const createObject = z.object({
  label: z.string().min(1).max(60),
  pluralLabel: z.string().max(60).optional(),
  apiName: apiName.optional(),
  description: z.string().max(500).optional(),
  icon: z.string().max(40).optional(),
  color: z.enum(PALETTE).optional(),
});
export const updateObject = z.object({
  label: z.string().min(1).max(60).optional(),
  pluralLabel: z.string().min(1).max(60).optional(),
  description: z.string().max(500).optional(),
  icon: z.string().max(40).optional(),
  color: z.enum(PALETTE).optional(),
  nameField: apiName.optional(),
  nameTemplate: z.string().max(200).nullish(),
  statusField: apiName.nullish(),
  dateField: apiName.nullish(),
  timeline: z.object({ start: apiName, end: apiName }).nullish(),
  highlightFields: z.array(apiName).max(8).optional(),
  listFields: z.array(apiName).max(15).optional(),
  duplicateFields: z.array(apiName).max(5).optional(),
  validationRules: z
    .array(z.object({ name: z.string().min(1).max(80), condition: z.string().min(1).max(2000), message: z.string().min(1).max(255), active: z.boolean().optional() }))
    .max(30)
    .optional(),
});

const option = z.object({ value: z.string().min(1).max(100), color: z.enum(PALETTE).optional() });
const fieldBase = {
  label: z.string().min(1).max(80),
  required: z.boolean().optional(),
  options: z.array(option).max(200).optional(),
  referenceTo: apiName.nullish(),
  cascadeDelete: z.boolean().optional(),
  formula: z.string().max(4000).optional(),
  formulaType: z.enum(['number', 'currency', 'percent', 'text', 'date', 'checkbox']).optional(),
  rollup: z
    .object({
      childObject: apiName,
      relationshipField: apiName,
      fn: z.enum(['count', 'sum', 'min', 'max', 'avg']),
      field: apiName.optional(),
      filter: filterGroup.nullish(),
    })
    .optional(),
  defaultValue: z.unknown().optional(),
  helpText: z.string().max(500).optional(),
  sensitive: z.boolean().optional(),
  precision: z.number().int().min(0).max(8).optional(),
  section: z.string().max(60).optional(),
};
export const createField = z.object({ ...fieldBase, apiName: apiName.optional(), type: z.enum(FIELD_TYPES) });
export const updateField = z.object(fieldBase).partial();

const action = z.looseObject({ type: z.enum(['update_record', 'update_related', 'create_record', 'notify', 'run_agent', 'webhook', 'submit_approval']) });
export const automation = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  object: apiName,
  trigger: z.object({ type: z.enum(['created', 'updated', 'saved', 'deleted']), watchFields: z.array(apiName).max(20).optional() }),
  conditions: filterGroup.nullable().default(null),
  actions: z.array(action).min(1).max(20),
  active: z.boolean().default(true),
});

export const approvalProcess = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  object: apiName,
  entryConditions: filterGroup.nullable().default(null),
  approver: z.discriminatedUnion('type', [
    z.object({ type: z.literal('user'), userId: id }),
    z.object({ type: z.literal('field'), path: z.string().min(1).max(200), fallbackUserId: id.optional() }),
  ]),
  onSubmit: z.array(action).max(20).default([]),
  onApprove: z.array(action).max(20).default([]),
  onReject: z.array(action).max(20).default([]),
  active: z.boolean().default(true),
});

export const submitApproval = z.object({ recordId: id, processId: id.optional(), comment: z.string().max(2000).optional() });
export const decision = z.object({ comment: z.string().max(2000).optional() });

export const agent = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(1000).default(''),
  instructions: z.string().max(8000).default(''),
  tools: z.array(z.string().max(60)).min(1).max(50),
  autonomy: z.enum(['read_only', 'approval_required', 'autonomous']),
  icon: z.string().max(40).default('bot'),
  color: z.enum(PALETTE).default('indigo'),
  active: z.boolean().default(true),
});

export const chat = z.object({ message: z.string().min(1).max(4000), conversationId: id.nullish(), recordId: id.nullish() });

const reportSpec = {
  object: apiName,
  filters: filterGroup.nullable().default(null),
  groupBy: z.object({ field: apiName, interval: z.enum(['day', 'month', 'quarter', 'year']).optional() }).nullable().default(null),
  metric: z.object({ fn: z.enum(['count', 'sum', 'avg', 'min', 'max']), field: apiName.optional() }),
  sort: z.enum(['natural', 'label', 'value_desc', 'value_asc']).default('natural'),
  limit: z.number().int().min(1).max(100).nullable().default(null),
};
export const reportPreview = z.object(reportSpec);
export const report = z.object({
  ...reportSpec,
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  chart: z.enum(['bar', 'column', 'line', 'pie', 'donut', 'kpi', 'table', 'funnel']),
  app: z.string().max(40).nullable().default(null),
});

export const dashboard = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  app: z.string().max(40).nullable().default(null),
  widgets: z.array(z.object({ reportId: id, title: z.string().max(120).optional(), size: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() })).max(24),
});

export const convertLead = z.object({ createOpportunity: z.boolean().optional(), opportunityName: z.string().max(255).optional(), accountId: id.optional() });
export const importCsv = z.object({ csv: z.string().min(1).max(5_000_000) });
export const markRead = z.object({ ids: z.array(id).max(500).optional() });

// ---------- integrations ----------

const emailAddress = z.string().min(3).max(254);
const unmatched = z.enum(['ignore', 'lead', 'case']);
const port = z.number().int().min(1).max(65535);
const dateTime = z.string().min(1).max(40);

/** File sizes are checked by the attachment service (and bounded by the route's body limit). */
export const uploadFile = z.object({ fileName: z.string().min(1).max(255), contentType: z.string().max(255).nullish(), data: z.string().min(1) });

export const sendEmail = z.object({
  recordId: id,
  to: z.array(emailAddress).max(50),
  cc: z.array(emailAddress).max(50).optional(),
  subject: shortText,
  body: z.string().max(100_000),
  accountId: id.nullish(),
  inReplyTo: id.nullish(),
  files: z.array(uploadFile).max(10).optional(),
  attachmentIds: z.array(id).max(10).optional(),
  logOnly: z.boolean().optional(),
});

/** An empty password keeps the stored one when updating a mailbox. */
export const imapAccount = z.object({
  label: z.string().max(80).nullish(),
  address: emailAddress,
  username: z.string().max(254).nullish(),
  password: z.string().max(1000),
  imapHost: z.string().min(1).max(255),
  imapPort: port,
  imapSecure: z.boolean(),
  smtpHost: z.string().max(255).nullish(),
  smtpPort: port.nullish(),
  smtpSecure: z.boolean().nullish(),
  syncEmail: z.boolean().optional(),
  unmatched: unmatched.optional(),
});

export const icsAccount = z.object({ url: z.string().min(1).max(2000), label: z.string().max(80).nullish() });

export const updateAccount = z.object({
  label: z.string().min(1).max(80).optional(),
  syncEmail: z.boolean().optional(),
  syncCalendar: z.boolean().optional(),
  unmatched: unmatched.optional(),
});

export const phone = z.object({ phone: z.string().max(40).nullable() });

export const meeting = z.object({
  recordId: id,
  subject: z.string().min(1).max(255),
  start: dateTime,
  end: dateTime,
  location: z.string().max(255).nullish(),
  description: z.string().max(32_000).nullish(),
  attendees: z.array(emailAddress).max(50).optional(),
  accountId: id.nullish(),
  sendInvites: z.boolean().optional(),
});

export const startCall = z.object({ recordId: id, phone: z.string().min(1).max(40) });

export const logCall = z.object({
  recordId: id,
  direction: z.enum(['inbound', 'outbound']),
  subject: shortText.nullish(),
  outcome: z.enum(CALL_OUTCOMES).nullish(),
  durationSeconds: z.number().int().min(0).max(86_400).nullish(),
  notes: z.string().max(32_000).nullish(),
  phone: z.string().max(40).nullish(),
  at: dateTime.nullish(),
});
