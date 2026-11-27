// Shared domain types for the titoForce platform (used by server and web).

export const FIELD_TYPES = [
  'text',
  'longtext',
  'email',
  'phone',
  'url',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'checkbox',
  'picklist',
  'multipicklist',
  'lookup',
  'user',
  'formula',
  'rollup',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const PALETTE = ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink', 'teal', 'indigo'] as const;
export type PaletteColor = (typeof PALETTE)[number];

export interface PicklistOption {
  value: string;
  color?: PaletteColor;
}

export type FormulaResultType = 'number' | 'currency' | 'percent' | 'text' | 'date' | 'checkbox';
export type RollupFunction = 'count' | 'sum' | 'min' | 'max' | 'avg';

export interface RollupDef {
  childObject: string;
  relationshipField: string;
  fn: RollupFunction;
  field?: string;
  filter?: FilterGroup | null;
}

export interface FieldDef {
  apiName: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: PicklistOption[];
  /** Target object for lookups. '*' means polymorphic (any object). */
  referenceTo?: string | null;
  /** Master-detail behaviour: deleting the parent deletes this child. */
  cascadeDelete?: boolean;
  formula?: string;
  formulaType?: FormulaResultType;
  rollup?: RollupDef;
  defaultValue?: unknown;
  helpText?: string;
  /** Hidden from roles without the viewSensitive permission, unless a role's field permissions say otherwise. */
  sensitive?: boolean;
  precision?: number;
  section?: string;
  sortOrder?: number;
  isCustom?: boolean;
}

export interface ObjectDef {
  apiName: string;
  label: string;
  pluralLabel: string;
  description?: string;
  icon: string;
  color: string;
  keyPrefix: string;
  /** Field holding the record name; ignored when nameTemplate is set. */
  nameField: string;
  /** e.g. "{first_name} {last_name}" */
  nameTemplate?: string;
  /** Picklist driving the path bar and default kanban grouping. */
  statusField?: string;
  /** Default date field for calendar views. */
  dateField?: string;
  /** Start/end date fields for timeline (gantt) views. */
  timeline?: { start: string; end: string } | null;
  highlightFields?: string[];
  listFields?: string[];
  /** Error-condition formulas evaluated on save (true = reject with message), as in Salesforce validation rules. */
  validationRules?: ValidationRule[];
  /** Fields checked for case-insensitive duplicates on save (e.g. email). */
  duplicateFields?: string[];
  isCustom: boolean;
  fields: FieldDef[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ValidationRule {
  name: string;
  /** Formula that returns true when the record is INVALID. */
  condition: string;
  message: string;
  active?: boolean;
}

export const SYSTEM_FIELDS = ['id', 'name', 'owner_id', 'created_at', 'updated_at', 'created_by', 'updated_by'] as const;
export type SystemField = (typeof SYSTEM_FIELDS)[number];

export type RecordData = Record<string, unknown>;

export interface CrmRecord {
  id: string;
  object: string;
  name: string;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  fields: RecordData;
  /** What the signed-in user may do with this record, including access granted by sharing rules. */
  access?: RecordAccess;
}

export interface RecordAccess {
  edit: boolean;
  delete: boolean;
}

/** Display names for referenced records and users, keyed by id. */
export type RefMap = Record<string, { name: string; object: string }>;

export interface RecordResponse {
  record: CrmRecord;
  refs: RefMap;
}

export interface QueryResponse {
  records: CrmRecord[];
  total: number;
  page: number;
  pageSize: number;
  refs: RefMap;
}

export const FILTER_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'is_empty',
  'is_not_empty',
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface FilterRule {
  field: string;
  op: FilterOperator;
  value?: unknown;
}

export interface FilterGroup {
  match: 'all' | 'any';
  rules: FilterRule[];
}

export interface SortSpec {
  field: string;
  dir: 'asc' | 'desc';
}

export interface RecordQuery {
  filters?: FilterGroup | null;
  /** Additional groups ANDed with `filters`. */
  andFilters?: (FilterGroup | null)[];
  /** API only: the list view whose filters (and default sort) apply. */
  viewId?: string | null;
  sort?: SortSpec | null;
  page?: number;
  pageSize?: number;
  q?: string;
}

export type ViewType = 'table' | 'kanban' | 'calendar' | 'timeline';

export interface ListViewDef {
  id: string;
  object: string;
  name: string;
  ownerId: string | null;
  shared: boolean;
  filters: FilterGroup | null;
  sort: SortSpec | null;
  columns: string[] | null;
  viewType: ViewType;
  groupBy?: string | null;
}

// ---------- Users & security ----------

export type AccessLevel = 'all' | 'own' | 'none';

export interface ObjectPermission {
  read: AccessLevel;
  create: boolean;
  edit: AccessLevel;
  delete: AccessLevel;
}

/** Field-level security: `edit` (read and write), `read` (read only) or `none` (hidden). */
export type FieldAccess = 'edit' | 'read' | 'none';

export interface RolePermissions {
  setup: boolean;
  viewSensitive: boolean;
  manageAutomations: boolean;
  manageAgents: boolean;
  /** Users with this role must use a second factor when they sign in with a password. */
  requireMfa?: boolean;
  /** Keyed by object api name; '*' is the default for unlisted objects. */
  objects: Record<string, ObjectPermission>;
  /**
   * Field permissions keyed by object, then field api name. Unlisted fields are editable, except sensitive fields,
   * which are hidden from roles without viewSensitive. Ignored for roles with setup access.
   */
  fields?: Record<string, Record<string, FieldAccess>>;
}

export interface RoleDef {
  id: string;
  name: string;
  description: string;
  permissions: RolePermissions;
}

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  title: string | null;
  roleId: string;
  roleName: string;
  active: boolean;
  isAgent: boolean;
  avatarColor: string;
  /** Phone used to bridge click-to-call and forward inbound calls. */
  phone?: string | null;
  createdAt: string;
  /** Only included for administrators. */
  mfaEnabled?: boolean;
}

export interface SessionInfo {
  user: UserDTO;
  permissions: RolePermissions;
}

/** Response of POST /api/auth/login: a session, or a second step. */
export type LoginResponse =
  | (SessionInfo & { token?: string })
  | { mfaRequired: true; challenge: string }
  | { mfaSetupRequired: true; challenge: string };

export interface MfaStatus {
  enabled: boolean;
  /** The user's role requires a second factor. */
  required: boolean;
  recoveryCodesLeft: number;
  enabledAt: string | null;
  /** Users without a password sign in with single sign-on, where the identity provider handles MFA. */
  hasPassword: boolean;
}

/** A new authenticator secret, shown once while the user sets up MFA. */
export interface MfaEnrollment {
  secret: string;
  /** otpauth:// URI for QR codes. */
  uri: string;
}

// ---------- Sharing rules ----------

export type SharingRuleType = 'owner' | 'criteria';

/** Opens records to roles whose object access is limited to their own records. */
export interface SharingRule {
  id: string;
  object: string;
  name: string;
  description: string;
  type: SharingRuleType;
  /** Owner rules: records owned by users with these roles. */
  ownerRoles: string[];
  /** Criteria rules: records matching these conditions. */
  criteria: FilterGroup | null;
  /** Roles that get access. */
  shareWith: string[];
  /** Edit access also needs the role's own edit permission on the object. Sharing never grants delete. */
  access: 'read' | 'edit';
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------- Single sign-on ----------

export type SsoProviderType = 'oidc' | 'saml';

export interface OidcSettings {
  issuer: string;
  clientId: string;
  /** Space-separated; must include openid. */
  scopes: string;
  tokenAuthMethod: 'client_secret_basic' | 'client_secret_post';
}

export interface SamlSettings {
  /** Identity provider single sign-on URL (HTTP-Redirect binding). */
  entryPoint: string;
  /** Expected issuer of responses; not checked when empty. */
  idpIssuer: string | null;
  /** Identity provider signing certificate(s), PEM or base64. */
  idpCert: string;
  /** Service provider entity ID; defaults to the metadata URL. */
  spEntityId: string | null;
  /** Attribute holding the email address when the NameID is not one. */
  emailAttribute: string | null;
  nameAttribute: string | null;
}

export interface SsoProvider {
  id: string;
  type: SsoProviderType;
  name: string;
  enabled: boolean;
  config: OidcSettings | SamlSettings;
  /** Whether an OIDC client secret is stored. It is never returned. */
  hasSecret: boolean;
  /** Create a user on first sign-in when no account matches. */
  jit: boolean;
  /** Role for users created on first sign-in. */
  defaultRole: string | null;
  /** Only accept these email domains; empty accepts any. */
  allowedDomains: string[];
  /** Values to register with the identity provider. */
  urls: { redirect?: string; acs?: string; entityId?: string; metadata?: string };
  createdAt: string;
  updatedAt: string;
}

export interface SsoProviderList {
  providers: SsoProvider[];
  /** Public address of titoForce that provider URLs start with. */
  baseUrl: string;
}

/** Enabled providers, as listed on the sign-in page. */
export interface PublicSsoProvider {
  id: string;
  name: string;
  type: SsoProviderType;
}

/** Why a single sign-on attempt failed; sent back to the sign-in page as `?sso_error=`. */
export type SsoErrorReason =
  | 'expired'
  | 'denied'
  | 'failed'
  | 'disabled'
  | 'no_email'
  | 'unverified_email'
  | 'domain_not_allowed'
  | 'not_provisioned'
  | 'inactive'
  | 'rate_limited';

// ---------- Apps ----------

export type AppPage = 'home' | 'forecast' | 'org-chart' | 'reports';

export type AppNavItem =
  | { type: 'object'; object: string; label?: string; view?: ViewType }
  | { type: 'page'; page: AppPage; label: string; icon: string };

export interface AppDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  nav: AppNavItem[];
  dashboardId: string | null;
  sortOrder: number;
}

// ---------- Automation ----------

export type TriggerType = 'created' | 'updated' | 'saved' | 'deleted';

export type AutomationAction =
  | { type: 'update_record'; fields: Record<string, unknown> }
  | { type: 'update_related'; lookupField: string; fields: Record<string, unknown> }
  | { type: 'create_record'; object: string; fields: Record<string, unknown> }
  | { type: 'notify'; to: string; title: string; body?: string }
  | { type: 'run_agent'; agentId: string; prompt: string }
  | { type: 'webhook'; url: string; method?: 'POST' | 'PUT' }
  | { type: 'submit_approval'; processId?: string; comment?: string };

export type AutomationActionType = AutomationAction['type'];

export interface AutomationDef {
  id: string;
  name: string;
  description: string;
  object: string;
  trigger: { type: TriggerType; watchFields?: string[] };
  conditions: FilterGroup | null;
  actions: AutomationAction[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  stats?: { runs: number; failures: number; lastRunAt: string | null };
}

export interface AutomationRun {
  id: string;
  automationId: string;
  automationName: string;
  recordId: string | null;
  status: 'success' | 'failed' | 'skipped';
  detail: unknown;
  error: string | null;
  createdAt: string;
}

// ---------- Approvals ----------

export type ApproverSpec = { type: 'user'; userId: string } | { type: 'field'; path: string; fallbackUserId?: string };

export interface ApprovalProcessDef {
  id: string;
  name: string;
  description: string;
  object: string;
  entryConditions: FilterGroup | null;
  approver: ApproverSpec;
  onSubmit: AutomationAction[];
  onApprove: AutomationAction[];
  onReject: AutomationAction[];
  active: boolean;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'recalled';

export interface ApprovalRequest {
  id: string;
  processId: string;
  processName: string;
  recordId: string;
  object: string;
  recordName: string;
  submittedBy: string;
  submittedByName: string;
  approverId: string;
  approverName: string;
  status: ApprovalStatus;
  comment: string | null;
  decisionComment: string | null;
  createdAt: string;
  decidedAt: string | null;
}

// ---------- AI agents ----------

export type AgentAutonomy = 'read_only' | 'approval_required' | 'autonomous';

export interface AgentDef {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  autonomy: AgentAutonomy;
  icon: string;
  color: string;
  active: boolean;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  kind: 'read' | 'write';
  parameters: Record<string, unknown>;
}

export type AgentStepStatus = 'ok' | 'error' | 'pending_approval' | 'rejected';

export interface AgentStep {
  type: 'tool_call' | 'message' | 'error';
  at: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
  status?: AgentStepStatus;
  text?: string;
  durationMs?: number;
  actionId?: string;
}

export type AgentTrigger = 'chat' | 'automation' | 'record_action' | 'api';

export interface AgentRun {
  id: string;
  agentId: string;
  agentName: string;
  trigger: AgentTrigger;
  status: 'running' | 'completed' | 'failed';
  input: string;
  output: string | null;
  provider: string;
  model: string | null;
  steps: AgentStep[];
  userId: string | null;
  recordId: string | null;
  conversationId: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export type AgentActionStatus = 'pending' | 'executed' | 'rejected' | 'failed';

export interface AgentAction {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  status: AgentActionStatus;
  result: unknown;
  /** User who may approve (besides agent managers). */
  approverId: string | null;
  recordId: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface AiStatus {
  provider: 'openai' | 'anthropic' | 'offline';
  model: string | null;
  /** True when an LLM provider is configured; false means the offline rules engine is used. */
  configured: boolean;
  note: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
  runId?: string;
}

export interface Conversation {
  id: string;
  agentId: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Analytics ----------

export type ChartType = 'bar' | 'column' | 'line' | 'pie' | 'donut' | 'kpi' | 'table' | 'funnel';
export type DateInterval = 'day' | 'month' | 'quarter' | 'year';
export type MetricFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface ReportDef {
  id: string;
  name: string;
  description: string;
  object: string;
  filters: FilterGroup | null;
  groupBy: { field: string; interval?: DateInterval } | null;
  metric: { fn: MetricFn; field?: string };
  chart: ChartType;
  sort: 'natural' | 'label' | 'value_desc' | 'value_asc';
  limit: number | null;
  app: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportRow {
  key: string | null;
  label: string;
  value: number;
  color?: PaletteColor;
}

export interface ReportResult {
  rows: ReportRow[];
  total: number;
  metricLabel: string;
  format: 'number' | 'currency' | 'percent';
}

export interface DashboardWidget {
  reportId: string;
  title?: string;
  size?: 1 | 2 | 3;
}

export interface DashboardDef {
  id: string;
  name: string;
  description: string;
  app: string | null;
  widgets: DashboardWidget[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Misc ----------

export interface NotificationDTO {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface TimelineItem {
  id: string;
  kind: 'activity' | 'history' | 'agent';
  at: string;
  title: string;
  body?: string | null;
  actorName?: string | null;
  actorType?: 'user' | 'agent' | 'automation' | 'system' | 'approval';
  recordId?: string;
  activityType?: string;
  status?: string;
  dueDate?: string | null;
  changes?: { field: string; label: string; from: unknown; to: unknown }[];
  /** Activities logged from email, calls and meetings carry their details. */
  email?: EmailDetails;
  call?: CallDetails;
  meeting?: MeetingDetails;
  attachments?: AttachmentRef[];
}

// ---------- Integrations ----------

export type IntegrationProvider = 'google' | 'microsoft' | 'imap' | 'ics';

/** What to do with synced mail from senders that match no record. */
export type UnmatchedMailAction = 'ignore' | 'lead' | 'case';

export interface ConnectedAccountSettings {
  syncEmail: boolean;
  syncCalendar: boolean;
  unmatched: UnmatchedMailAction;
  /** IMAP/SMTP server settings (the password is stored encrypted, never returned). */
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  username?: string;
  /** Host of a subscribed calendar URL (the full URL is a secret and stored encrypted). */
  feedHost?: string;
}

export interface ConnectedAccountDTO {
  id: string;
  provider: IntegrationProvider;
  label: string;
  address: string | null;
  /** What this account can do: send and sync mail, sync calendars. */
  capabilities: { sendEmail: boolean; syncEmail: boolean; calendar: boolean; exportEvents: boolean };
  settings: ConnectedAccountSettings;
  status: 'active' | 'error';
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface MailSyncStats {
  logged: number;
  duplicates: number;
  skipped: number;
}

export interface CalendarSyncStats {
  imported: number;
  updated: number;
  skipped: number;
}

/** What one sync of a connected account did (null: that part was not synced). */
export interface SyncResult {
  mail: MailSyncStats | null;
  calendar: CalendarSyncStats | null;
  error: string | null;
}

export interface SyncResponse {
  account: ConnectedAccountDTO;
  result: SyncResult;
}

export interface IntegrationStatus {
  /** How mail sent by the current user is delivered: their own connected account, the organization relay, or only logged. */
  email: { mode: 'account' | 'relay' | 'log'; accountId: string | null; from: string | null };
  oauth: { google: boolean; microsoft: boolean };
  /** Click-to-call needs Twilio on the server and the user's own phone number. */
  telephony: { twilio: boolean; phone: string | null; ready: boolean; number: string | null };
  calendarFeed: { enabled: boolean };
  syncIntervalMinutes: number;
  attachmentMaxBytes: number;
  allowPrivateNetwork: boolean;
}

export interface AdminIntegrationStatus {
  publicUrl: string;
  secretKey: boolean;
  smtpRelay: { configured: boolean; from: string | null };
  google: boolean;
  microsoft: boolean;
  twilio: { configured: boolean; number: string | null; inboundWebhook: string; statusWebhook: string };
  oauthRedirects: { google: string; microsoft: string };
  syncIntervalMinutes: number;
  attachmentMaxBytes: number;
  accounts: { provider: IntegrationProvider; total: number; failing: number }[];
}

export interface AttachmentRef {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface AttachmentDTO extends AttachmentRef {
  recordId: string;
  source: 'upload' | 'email';
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  /** Set when the file belongs to an activity of the record (e.g. an email attachment) rather than to the record itself. */
  activity: { id: string; name: string } | null;
}

export interface EmailDetails {
  direction: 'inbound' | 'outbound';
  /** sent: delivered to the mail server; received: synced from a mailbox; logged: recorded only, not delivered. */
  status: 'sent' | 'received' | 'logged';
  from: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string;
  sentAt: string;
  messageId: string | null;
  provider: string;
}

export type CallStatus = 'queued' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'no-answer' | 'failed' | 'canceled' | 'logged';

export interface CallDetails {
  id: string;
  direction: 'inbound' | 'outbound';
  status: CallStatus;
  provider: 'twilio' | 'manual';
  from: string | null;
  to: string | null;
  durationSeconds: number | null;
  outcome: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface MeetingDetails {
  start: string | null;
  end: string | null;
  location: string | null;
  attendees: string[];
  /** Calendar the meeting is synced with, if any. */
  calendar: { provider: IntegrationProvider; direction: 'import' | 'export' } | null;
}

export const CALL_OUTCOMES = ['Connected', 'Left voicemail', 'No answer', 'Busy', 'Wrong number'] as const;

export interface UploadFile {
  fileName: string;
  contentType?: string | null;
  /** Base64 (a data: URL is accepted). */
  data: string;
}

export interface SendEmailRequest {
  /** The record the email is logged against. */
  recordId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** Mailbox to send from (default: the user's first mailbox that can send, then the organization relay). */
  accountId?: string | null;
  /** Activity id of the email being answered (sets the threading headers). */
  inReplyTo?: string | null;
  files?: UploadFile[];
  /** Files already attached to records the user can read. */
  attachmentIds?: string[];
  /** Record the email without sending it. */
  logOnly?: boolean;
}

export interface SendEmailResult {
  activityId: string;
  status: 'sent' | 'logged';
  via: 'account' | 'relay' | 'log';
  from: string;
}

export interface ImapAccountRequest {
  label?: string | null;
  address: string;
  /** Defaults to the address. */
  username?: string | null;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  /** Without SMTP settings the mailbox is only synced, not used for sending. */
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  syncEmail?: boolean;
  unmatched?: UnmatchedMailAction;
}

export interface MeetingRequest {
  recordId: string;
  subject: string;
  start: string;
  end: string;
  location?: string | null;
  description?: string | null;
  attendees?: string[];
  /** Calendar account to add the meeting to (none: only logged in the CRM). */
  accountId?: string | null;
  /** Email invitations to the attendees. */
  sendInvites?: boolean;
}

export interface MeetingResult {
  activityId: string;
  /** The calendar the meeting was added to. */
  calendar: { accountId: string; provider: IntegrationProvider } | null;
  /** Set when the meeting was logged but the calendar did not accept it. */
  calendarError: string | null;
}

export interface CalendarFeedResult {
  /** Subscription link; only shown once (a new link replaces the old one). */
  url: string;
}

export interface StartCallRequest {
  recordId: string;
  /** The number to call (international format, or national with the server's default calling code). */
  phone: string;
}

/** A call and the activity it is logged on (outbound calls are logged once the user answers their phone). */
export interface CallState {
  call: CallDetails;
  activityId: string | null;
}

export interface CallLogRequest {
  recordId: string;
  direction: 'inbound' | 'outbound';
  subject?: string | null;
  outcome?: (typeof CALL_OUTCOMES)[number] | null;
  durationSeconds?: number | null;
  notes?: string | null;
  phone?: string | null;
  /** When the call took place (default: now). */
  at?: string | null;
}

export interface SearchResultGroup {
  object: string;
  label: string;
  records: { id: string; name: string; subtitle?: string }[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
