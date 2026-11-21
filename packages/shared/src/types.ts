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
  /** Restricted to roles with the viewSensitive permission (field-level security). */
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

export interface RolePermissions {
  setup: boolean;
  viewSensitive: boolean;
  manageAutomations: boolean;
  manageAgents: boolean;
  /** Keyed by object api name; '*' is the default for unlisted objects. */
  objects: Record<string, ObjectPermission>;
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
  createdAt: string;
}

export interface SessionInfo {
  user: UserDTO;
  permissions: RolePermissions;
}

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
}

export interface SearchResultGroup {
  object: string;
  label: string;
  records: { id: string; name: string; subtitle?: string }[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
