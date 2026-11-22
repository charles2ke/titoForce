import type { AppNavItem, AutomationAction, FilterGroup, FilterRule, ListViewDef, ReportDef } from '@titoforce/shared';
import type { AgentInput } from '../ai/runtime.ts';
import type { ReportInput } from '../analytics/reports.ts';
import type { AutomationInput } from '../automation/engine.ts';
import type { Principal } from '../platform/principal.ts';
import type { ListViewInput } from '../platform/views.ts';
import type { Services } from '../services.ts';

export const AGENT_IDS = {
  copilot: 'agt_copilot',
  leadQualifier: 'agt_lead_qualifier',
  serviceTriage: 'agt_service_triage',
  dealCoach: 'agt_deal_coach',
  hrAssistant: 'agt_hr_assistant',
  projectManager: 'agt_project_manager',
} as const;

const READ_TOOLS = [
  'list_objects',
  'describe_object',
  'search_records',
  'query_records',
  'get_record',
  'get_related_records',
  'get_timeline',
  'aggregate_records',
  'search_knowledge',
  'list_users',
];
const WRITE_TOOLS = ['create_record', 'update_record', 'log_activity', 'convert_lead', 'submit_for_approval', 'send_notification'];

const all = (...rules: FilterRule[]): FilterGroup => ({ match: 'all', rules });
const OPEN_DEAL: FilterRule = { field: 'stage', op: 'not_in', value: ['Closed Won', 'Closed Lost'] };
const MINE: FilterRule = { field: 'owner_id', op: 'eq', value: 'CURRENT_USER' };

function agents(): (AgentInput & { id: string })[] {
  return [
    {
      id: AGENT_IDS.copilot,
      name: 'titoForce Copilot',
      description: 'General assistant for every app: find, summarize, create and update records, log activities and convert leads.',
      instructions: [
        'You are titoForce Copilot, the assistant built into the titoForce CRM.',
        '- Answer with data from tools; link every record you mention.',
        '- When asked to change data, make the change and then state exactly what changed.',
        '- Ask a short clarifying question when a request is ambiguous (for example two records with the same name).',
        '- Prefer short bullet lists over long paragraphs.',
      ].join('\n'),
      tools: [...READ_TOOLS, 'score_lead', ...WRITE_TOOLS],
      autonomy: 'autonomous',
      icon: 'sparkles',
      color: 'indigo',
      active: true,
    },
    {
      id: AGENT_IDS.leadQualifier,
      name: 'Lead Qualifier',
      description: 'Scores new leads, saves the score and rating, and creates a follow-up task for hot leads. Runs automatically when a lead is created.',
      instructions: [
        'You qualify inbound sales leads.',
        '1. Call score_lead to get the score, rating and scoring factors.',
        '2. Save lead_score and rating on the lead with update_record. Do not change other fields.',
        '3. If the rating is Hot, log an open Task on the lead due tomorrow: "Call hot lead <name> within 24h".',
        '4. Reply with the score, rating and the top three reasons.',
      ].join('\n'),
      tools: ['search_records', 'query_records', 'get_record', 'score_lead', 'update_record', 'log_activity'],
      autonomy: 'autonomous',
      icon: 'target',
      color: 'green',
      active: true,
    },
    {
      id: AGENT_IDS.serviceTriage,
      name: 'Service Triage',
      description: 'Sets case priority and category from the description and suggests knowledge articles. Runs automatically when a case is created.',
      instructions: [
        'You triage customer support cases.',
        '1. Read the case with get_record.',
        '2. Choose a priority (Low, Medium, High, Urgent) and a category (Technical, Billing, Access, Feature Request, General). Outages, data loss and security issues are Urgent.',
        '3. Save priority and category with update_record only when they differ from the current values.',
        '4. Search the knowledge base and list up to three relevant articles.',
        'Never close or escalate a case yourself.',
      ].join('\n'),
      tools: ['search_records', 'query_records', 'get_record', 'get_related_records', 'search_knowledge', 'update_record'],
      autonomy: 'autonomous',
      icon: 'life-buoy',
      color: 'teal',
      active: true,
    },
    {
      id: AGENT_IDS.dealCoach,
      name: 'Deal Coach',
      description: 'Reviews opportunities, flags risks and recommends next steps. Any change it proposes waits for your approval.',
      instructions: [
        'You are an experienced sales coach.',
        '- Summarize stage, amount, close date and recent activity (get_record, get_timeline, get_related_records).',
        '- Flag risks: close date in the past, no activity for 14+ days, no next step, no primary contact, large discounts.',
        '- Recommend two or three concrete next steps.',
        '- Only when asked, update next_step or log a follow-up task. These changes wait for human approval.',
      ].join('\n'),
      tools: [...READ_TOOLS, 'update_record', 'log_activity'],
      autonomy: 'approval_required',
      icon: 'trophy',
      color: 'orange',
      active: true,
    },
    {
      id: AGENT_IDS.hrAssistant,
      name: 'HR Assistant',
      description: 'Answers people questions: PTO balance, managers, departments, open roles and HR policies. Read-only.',
      instructions: [
        'You help employees with HR questions.',
        '- Look up PTO balances, managers, departments, open job requisitions and HR knowledge articles.',
        '- Never guess compensation or review details; if a tool does not return them, say you cannot see them.',
        '- Time off is requested from the Time Off tab and approved by the employee’s manager.',
      ].join('\n'),
      tools: ['describe_object', 'search_records', 'query_records', 'get_record', 'get_related_records', 'aggregate_records', 'search_knowledge', 'list_users'],
      autonomy: 'read_only',
      icon: 'heart-handshake',
      color: 'pink',
      active: true,
    },
    {
      id: AGENT_IDS.projectManager,
      name: 'Project Manager',
      description: 'Tracks projects and work items: progress, overdue work and workload; creates and assigns work items.',
      instructions: [
        'You help teams run projects.',
        '- Report project progress, overdue work items and open work per assignee.',
        '- When asked, create or update work items (status, assignee, dates) and notify the people affected.',
        '- List every change you made.',
      ].join('\n'),
      tools: ['search_records', 'query_records', 'get_record', 'get_related_records', 'aggregate_records', 'list_users', 'create_record', 'update_record', 'log_activity', 'send_notification'],
      autonomy: 'autonomous',
      icon: 'kanban',
      color: 'purple',
      active: true,
    },
  ];
}

export interface Approvers {
  sales: string;
  hr: string;
}

export interface SeededProcesses {
  quoteDiscount: string;
  timeOff: string;
  requisition: string;
}

async function approvalProcesses(s: Services, approvers: Approvers): Promise<SeededProcesses> {
  const quote = await s.approvals.createProcess({
    name: 'Quote discount approval',
    description: 'Quotes with a discount above 20% need sales manager approval before they are sent.',
    object: 'quote',
    entryConditions: all({ field: 'discount', op: 'gt', value: 20 }, { field: 'status', op: 'in', value: ['Draft', 'Rejected'] }),
    approver: { type: 'user', userId: approvers.sales },
    onSubmit: [{ type: 'update_record', fields: { status: 'In Review' } }],
    onApprove: [{ type: 'update_record', fields: { status: 'Approved' } }],
    onReject: [{ type: 'update_record', fields: { status: 'Rejected' } }],
    active: true,
  });
  const timeOff = await s.approvals.createProcess({
    name: 'Time off approval',
    description: 'Routes requests to the employee’s manager. Approved vacation and personal days are deducted from the PTO balance.',
    object: 'time_off_request',
    entryConditions: all({ field: 'status', op: 'in', value: ['Draft', 'Rejected'] }),
    approver: { type: 'field', path: 'employee.manager.user', fallbackUserId: approvers.hr },
    onSubmit: [{ type: 'update_record', fields: { status: 'Submitted' } }],
    onApprove: [
      { type: 'update_record', fields: { status: 'Approved' } },
      {
        type: 'update_related',
        lookupField: 'employee',
        fields: { pto_balance: "{{IF(record.type == 'Vacation' || record.type == 'Personal', BLANKVALUE(related.employee.pto_balance, 0) - record.days, related.employee.pto_balance)}}" },
      },
    ],
    onReject: [{ type: 'update_record', fields: { status: 'Rejected' } }],
    active: true,
  });
  const req = await s.approvals.createProcess({
    name: 'Job requisition approval',
    description: 'New headcount is approved by HR before the role opens for candidates.',
    object: 'job_requisition',
    entryConditions: all({ field: 'status', op: 'in', value: ['Draft', 'On Hold'] }),
    approver: { type: 'user', userId: approvers.hr },
    onSubmit: [{ type: 'update_record', fields: { status: 'Pending Approval' } }],
    onApprove: [{ type: 'update_record', fields: { status: 'Open' } }],
    onReject: [{ type: 'update_record', fields: { status: 'Draft' } }],
    active: true,
  });
  return { quoteDiscount: quote.id, timeOff: timeOff.id, requisition: req.id };
}

function automations(processes: SeededProcesses): AutomationInput[] {
  const notify = (to: string, title: string, body?: string): AutomationAction => ({ type: 'notify', to, title, body });
  return [
    {
      name: 'Opportunity stage defaults',
      description: 'Sets probability and forecast category whenever the stage changes.',
      object: 'opportunity',
      trigger: { type: 'saved', watchFields: ['stage'] },
      conditions: null,
      actions: [
        {
          type: 'update_record',
          fields: {
            probability: "{{CASE(record.stage, 'Prospecting', 10, 'Qualification', 20, 'Needs Analysis', 40, 'Proposal', 60, 'Negotiation', 80, 'Closed Won', 100, 0)}}",
            forecast_category: "{{CASE(record.stage, 'Closed Won', 'Closed', 'Closed Lost', 'Omitted', 'Negotiation', 'Commit', 'Proposal', 'Best Case', 'Pipeline')}}",
          },
        },
      ],
      active: true,
    },
    {
      name: 'Celebrate won deals',
      description: 'Notifies sales managers when an opportunity is closed won.',
      object: 'opportunity',
      trigger: { type: 'saved', watchFields: ['stage'] },
      conditions: all({ field: 'stage', op: 'eq', value: 'Closed Won' }),
      actions: [notify('role:sales_manager', '🎉 Deal won: {{record.name}}', "{{owner.name}} closed {{record.name}} for {{CONCAT('$', TEXT(ROUND(BLANKVALUE(record.amount, 0), 0)))}}.")],
      active: true,
    },
    {
      name: 'Qualify new leads with AI',
      description: 'Runs the Lead Qualifier agent on every new lead.',
      object: 'lead',
      trigger: { type: 'created' },
      conditions: null,
      actions: [{ type: 'run_agent', agentId: AGENT_IDS.leadQualifier, prompt: 'Qualify this lead' }],
      active: true,
    },
    {
      name: 'Alert owner about hot leads',
      description: 'Notifies the lead owner when a lead becomes Hot.',
      object: 'lead',
      trigger: { type: 'updated', watchFields: ['rating'] },
      conditions: all({ field: 'rating', op: 'eq', value: 'Hot' }),
      actions: [notify('owner', '🔥 Hot lead: {{record.name}}', '{{record.company}} scored {{record.lead_score}}. Reach out within 24 hours.')],
      active: true,
    },
    {
      name: 'Triage new cases with AI',
      description: 'Runs the Service Triage agent on every new case.',
      object: 'case',
      trigger: { type: 'created' },
      conditions: null,
      actions: [{ type: 'run_agent', agentId: AGENT_IDS.serviceTriage, prompt: 'Triage this case' }],
      active: true,
    },
    {
      name: 'Case SLA',
      description: 'Sets the SLA due time from priority: Urgent 4h, High 8h, Medium 24h, Low 72h after creation.',
      object: 'case',
      trigger: { type: 'saved', watchFields: ['priority'] },
      conditions: null,
      actions: [{ type: 'update_record', fields: { sla_due: "{{ADD_HOURS(record.created_at, CASE(record.priority, 'Urgent', 4, 'High', 8, 'Medium', 24, 72))}}" } }],
      active: true,
    },
    {
      name: 'Escalation alert',
      description: 'Notifies the support team when a case is escalated.',
      object: 'case',
      trigger: { type: 'updated', watchFields: ['status'] },
      conditions: all({ field: 'status', op: 'eq', value: 'Escalated' }),
      actions: [notify('role:support_agent', 'Case escalated: {{record.name}}', '{{related.account.name}} · priority {{record.priority}}')],
      active: true,
    },
    {
      name: 'Auto-submit large discounts',
      description: 'Submits draft quotes with a discount above 20% for approval.',
      object: 'quote',
      trigger: { type: 'saved', watchFields: ['discount'] },
      conditions: all({ field: 'discount', op: 'gt', value: 20 }, { field: 'status', op: 'eq', value: 'Draft' }),
      actions: [{ type: 'submit_approval', processId: processes.quoteDiscount, comment: 'Discount of {{record.discount}}% requires approval.' }],
      active: true,
    },
    {
      name: 'Notify work item assignee',
      description: 'Tells people when work is assigned to them.',
      object: 'work_item',
      trigger: { type: 'saved', watchFields: ['assignee'] },
      conditions: all({ field: 'assignee', op: 'is_not_empty' }),
      actions: [notify('field:assignee', 'Assigned to you: {{record.name}}', '{{related.project.name}}')],
      active: true,
    },
    {
      name: 'Hire candidate',
      description: 'Creates the employee record when a candidate is marked Hired (which then triggers onboarding).',
      object: 'candidate',
      trigger: { type: 'updated', watchFields: ['stage'] },
      conditions: all({ field: 'stage', op: 'eq', value: 'Hired' }),
      actions: [
        {
          type: 'create_record',
          object: 'employee',
          fields: {
            first_name: '{{record.first_name}}',
            last_name: '{{record.last_name}}',
            email: '{{record.email}}',
            phone: '{{record.phone}}',
            job_title: '{{related.requisition.name}}',
            department: '{{related.requisition.department}}',
            location: '{{related.requisition.location}}',
            employment_type: '{{related.requisition.employment_type}}',
            status: 'Active',
            hire_date: '{{ADD_DAYS(TODAY(), 14)}}',
          },
        },
      ],
      active: true,
    },
    {
      name: 'Employee onboarding',
      description: 'Creates an onboarding task for every new employee.',
      object: 'employee',
      trigger: { type: 'created' },
      conditions: null,
      actions: [
        {
          type: 'create_record',
          object: 'activity',
          fields: {
            subject: 'Onboard {{record.name}}',
            type: 'Task',
            status: 'Open',
            due_date: '{{ADD_DAYS(TODAY(), 3)}}',
            related_to: '{{record.id}}',
            description: 'Prepare accounts, equipment and a first-week plan for {{record.name}} ({{record.job_title}}).',
          },
        },
      ],
      active: true,
    },
  ];
}

type ReportSeed = Omit<ReportInput, 'description' | 'sort' | 'limit'> & Partial<Pick<ReportInput, 'description' | 'sort' | 'limit'>> & { key: string };

function reports(): ReportSeed[] {
  const open = all(OPEN_DEAL);
  const won = all({ field: 'stage', op: 'eq', value: 'Closed Won' });
  const openCase = all({ field: 'status', op: 'neq', value: 'Closed' });
  return [
    // Sales
    { key: 'pipeline_kpi', app: 'sales', name: 'Open pipeline', object: 'opportunity', filters: open, groupBy: null, metric: { fn: 'sum', field: 'amount' }, chart: 'kpi' },
    { key: 'won_qtr_kpi', app: 'sales', name: 'Won this quarter', object: 'opportunity', filters: all(won.rules[0]!, { field: 'close_date', op: 'eq', value: 'THIS_QUARTER' }), groupBy: null, metric: { fn: 'sum', field: 'amount' }, chart: 'kpi' },
    { key: 'open_deals_kpi', app: 'sales', name: 'Open deals', object: 'opportunity', filters: open, groupBy: null, metric: { fn: 'count' }, chart: 'kpi' },
    { key: 'pipeline_stage', app: 'sales', name: 'Pipeline by stage', object: 'opportunity', filters: open, groupBy: { field: 'stage' }, metric: { fn: 'sum', field: 'amount' }, chart: 'funnel' },
    { key: 'won_month', app: 'sales', name: 'Won revenue by month', object: 'opportunity', filters: won, groupBy: { field: 'close_date', interval: 'month' }, metric: { fn: 'sum', field: 'amount' }, chart: 'column' },
    { key: 'pipeline_owner', app: 'sales', name: 'Pipeline by owner', object: 'opportunity', filters: open, groupBy: { field: 'owner_id' }, metric: { fn: 'sum', field: 'amount' }, chart: 'bar', sort: 'value_desc' },
    { key: 'leads_source', app: 'sales', name: 'Leads by source', object: 'lead', filters: null, groupBy: { field: 'lead_source' }, metric: { fn: 'count' }, chart: 'donut', sort: 'value_desc' },
    { key: 'accounts_industry', app: 'sales', name: 'Accounts by industry', object: 'account', filters: null, groupBy: { field: 'industry' }, metric: { fn: 'count' }, chart: 'bar', sort: 'value_desc' },
    // Service
    { key: 'open_cases_kpi', app: 'service', name: 'Open cases', object: 'case', filters: openCase, groupBy: null, metric: { fn: 'count' }, chart: 'kpi' },
    { key: 'escalated_kpi', app: 'service', name: 'Escalated cases', object: 'case', filters: all({ field: 'status', op: 'eq', value: 'Escalated' }), groupBy: null, metric: { fn: 'count' }, chart: 'kpi' },
    { key: 'cases_priority', app: 'service', name: 'Open cases by priority', object: 'case', filters: openCase, groupBy: { field: 'priority' }, metric: { fn: 'count' }, chart: 'donut' },
    { key: 'cases_category', app: 'service', name: 'Cases by category', object: 'case', filters: null, groupBy: { field: 'category' }, metric: { fn: 'count' }, chart: 'bar', sort: 'value_desc' },
    { key: 'cases_day', app: 'service', name: 'New cases (last 30 days)', object: 'case', filters: all({ field: 'created_at', op: 'eq', value: 'LAST_N_DAYS:30' }), groupBy: { field: 'created_at', interval: 'day' }, metric: { fn: 'count' }, chart: 'line' },
    { key: 'cases_origin', app: 'service', name: 'Cases by origin', object: 'case', filters: null, groupBy: { field: 'origin' }, metric: { fn: 'count' }, chart: 'pie' },
    // Marketing
    { key: 'leads_month', app: 'marketing', name: 'New leads by month', object: 'lead', filters: null, groupBy: { field: 'created_at', interval: 'month' }, metric: { fn: 'count' }, chart: 'line' },
    { key: 'leads_campaign', app: 'marketing', name: 'Leads by campaign', object: 'lead', filters: all({ field: 'campaign', op: 'is_not_empty' }), groupBy: { field: 'campaign' }, metric: { fn: 'count' }, chart: 'bar', sort: 'value_desc' },
    { key: 'leads_status', app: 'marketing', name: 'Lead funnel', object: 'lead', filters: null, groupBy: { field: 'status' }, metric: { fn: 'count' }, chart: 'funnel' },
    { key: 'campaign_budget', app: 'marketing', name: 'Campaign budget', object: 'campaign', filters: null, groupBy: { field: 'name' }, metric: { fn: 'sum', field: 'budget' }, chart: 'column', sort: 'value_desc' },
    { key: 'converted_kpi', app: 'marketing', name: 'Converted leads', object: 'lead', filters: all({ field: 'status', op: 'eq', value: 'Converted' }), groupBy: null, metric: { fn: 'count' }, chart: 'kpi' },
    // Work
    { key: 'items_status', app: 'work', name: 'Work items by status', object: 'work_item', filters: null, groupBy: { field: 'status' }, metric: { fn: 'count' }, chart: 'column' },
    { key: 'items_assignee', app: 'work', name: 'Open work by assignee', object: 'work_item', filters: all({ field: 'status', op: 'neq', value: 'Done' }), groupBy: { field: 'assignee' }, metric: { fn: 'count' }, chart: 'bar', sort: 'value_desc' },
    { key: 'projects_status', app: 'work', name: 'Projects by status', object: 'project', filters: null, groupBy: { field: 'status' }, metric: { fn: 'count' }, chart: 'donut' },
    { key: 'overdue_kpi', app: 'work', name: 'Overdue work items', object: 'work_item', filters: all({ field: 'due_date', op: 'lt', value: 'TODAY' }, { field: 'status', op: 'neq', value: 'Done' }), groupBy: null, metric: { fn: 'count' }, chart: 'kpi' },
    // People
    { key: 'headcount_kpi', app: 'people', name: 'Headcount', object: 'employee', filters: all({ field: 'status', op: 'neq', value: 'Terminated' }), groupBy: null, metric: { fn: 'count' }, chart: 'kpi' },
    { key: 'headcount_dept', app: 'people', name: 'Headcount by department', object: 'employee', filters: all({ field: 'status', op: 'neq', value: 'Terminated' }), groupBy: { field: 'department' }, metric: { fn: 'count' }, chart: 'bar', sort: 'value_desc' },
    { key: 'employment_type', app: 'people', name: 'Employees by type', object: 'employee', filters: null, groupBy: { field: 'employment_type' }, metric: { fn: 'count' }, chart: 'donut' },
    { key: 'candidates_stage', app: 'people', name: 'Recruiting funnel', object: 'candidate', filters: null, groupBy: { field: 'stage' }, metric: { fn: 'count' }, chart: 'funnel' },
    { key: 'open_roles_kpi', app: 'people', name: 'Open positions', object: 'job_requisition', filters: all({ field: 'status', op: 'eq', value: 'Open' }), groupBy: null, metric: { fn: 'sum', field: 'openings' }, chart: 'kpi' },
    { key: 'time_off_type', app: 'people', name: 'Approved time off by type (days)', object: 'time_off_request', filters: all({ field: 'status', op: 'eq', value: 'Approved' }), groupBy: { field: 'type' }, metric: { fn: 'sum', field: 'days' }, chart: 'pie' },
  ];
}

const DASHBOARDS: { app: string; name: string; description: string; widgets: [string, 1 | 2 | 3][] }[] = [
  {
    app: 'sales',
    name: 'Sales Overview',
    description: 'Pipeline health, bookings and lead flow.',
    widgets: [['pipeline_kpi', 1], ['won_qtr_kpi', 1], ['open_deals_kpi', 1], ['pipeline_stage', 2], ['leads_source', 1], ['won_month', 2], ['pipeline_owner', 1]],
  },
  {
    app: 'service',
    name: 'Service Overview',
    description: 'Case volume, backlog and escalations.',
    widgets: [['open_cases_kpi', 1], ['escalated_kpi', 1], ['cases_priority', 1], ['cases_day', 3], ['cases_category', 2], ['cases_origin', 1]],
  },
  {
    app: 'marketing',
    name: 'Marketing Overview',
    description: 'Lead generation and campaign performance.',
    widgets: [['converted_kpi', 1], ['leads_status', 2], ['leads_month', 2], ['leads_campaign', 1], ['campaign_budget', 3]],
  },
  {
    app: 'work',
    name: 'Work Overview',
    description: 'Delivery status across projects.',
    widgets: [['overdue_kpi', 1], ['projects_status', 1], ['items_status', 1], ['items_assignee', 3]],
  },
  {
    app: 'people',
    name: 'People Overview',
    description: 'Headcount, recruiting and time off.',
    widgets: [['headcount_kpi', 1], ['open_roles_kpi', 1], ['employment_type', 1], ['headcount_dept', 2], ['candidates_stage', 1], ['time_off_type', 3]],
  },
];

const page = (p: 'home' | 'forecast' | 'org-chart' | 'reports', label: string, icon: string): AppNavItem => ({ type: 'page', page: p, label, icon });
const object = (o: string, label?: string): AppNavItem => ({ type: 'object', object: o, label });

/** Apps every organization starts with (their labels have built-in translations). */
export const STANDARD_APPS: { id: string; name: string; description: string; icon: string; color: string; nav: AppNavItem[] }[] = [
  {
    id: 'sales',
    name: 'Sales',
    description: 'Leads, accounts, opportunities, quotes and forecasting.',
    icon: 'briefcase',
    color: 'blue',
    nav: [
      page('home', 'Home', 'home'),
      object('lead'),
      object('account'),
      object('contact'),
      object('opportunity'),
      object('quote'),
      object('product'),
      object('activity'),
      page('forecast', 'Forecast', 'trending-up'),
      page('reports', 'Reports', 'bar-chart-3'),
    ],
  },
  {
    id: 'service',
    name: 'Service',
    description: 'Case management, SLAs and the knowledge base.',
    icon: 'headphones',
    color: 'teal',
    nav: [page('home', 'Home', 'home'), object('case'), object('account'), object('contact'), object('knowledge_article'), object('activity'), page('reports', 'Reports', 'bar-chart-3')],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Campaigns, web-to-lead forms and lead nurturing.',
    icon: 'megaphone',
    color: 'pink',
    nav: [page('home', 'Home', 'home'), object('campaign'), object('lead'), object('web_form'), object('contact'), page('reports', 'Reports', 'bar-chart-3')],
  },
  {
    id: 'work',
    name: 'Work',
    description: 'Projects, boards, timelines and team workload.',
    icon: 'kanban',
    color: 'purple',
    nav: [page('home', 'Home', 'home'), object('project'), object('work_item'), object('activity'), page('reports', 'Reports', 'bar-chart-3')],
  },
  {
    id: 'people',
    name: 'People',
    description: 'Employees, org chart, time off, reviews and recruiting.',
    icon: 'users',
    color: 'orange',
    nav: [
      page('home', 'Home', 'home'),
      object('employee'),
      object('department'),
      page('org-chart', 'Org Chart', 'network'),
      object('time_off_request'),
      object('performance_review'),
      object('job_requisition'),
      object('candidate'),
      page('reports', 'Reports', 'bar-chart-3'),
    ],
  },
];

function listViews(): ListViewInput[] {
  const v = (object: string, name: string, extra: Partial<ListViewInput>): ListViewInput => ({
    object,
    name,
    shared: true,
    filters: null,
    sort: null,
    columns: null,
    viewType: 'table',
    groupBy: null,
    ...extra,
  });
  return [
    v('lead', 'Hot Leads', {
      filters: all({ field: 'rating', op: 'eq', value: 'Hot' }, { field: 'status', op: 'not_in', value: ['Converted', 'Unqualified'] }),
      sort: { field: 'lead_score', dir: 'desc' },
      columns: ['name', 'company', 'status', 'lead_score', 'rating', 'lead_source', 'owner_id'],
    }),
    v('lead', 'My Leads', { filters: all(MINE), sort: { field: 'created_at', dir: 'desc' } }),
    v('lead', 'Lead Board', { viewType: 'kanban', groupBy: 'status' }),
    v('opportunity', 'Pipeline Board', { viewType: 'kanban', groupBy: 'stage' }),
    v('opportunity', 'My Open Deals', { filters: all(MINE, OPEN_DEAL), sort: { field: 'close_date', dir: 'asc' } }),
    v('opportunity', 'Closing This Month', { filters: all(OPEN_DEAL, { field: 'close_date', op: 'eq', value: 'THIS_MONTH' }), sort: { field: 'amount', dir: 'desc' } }),
    v('opportunity', 'Close Calendar', { viewType: 'calendar', groupBy: 'close_date' }),
    v('account', 'Customers', { filters: all({ field: 'type', op: 'eq', value: 'Customer' }) }),
    v('account', 'My Accounts', { filters: all(MINE) }),
    v('case', 'Open Cases', {
      filters: all({ field: 'status', op: 'neq', value: 'Closed' }),
      sort: { field: 'sla_due', dir: 'asc' },
      columns: ['name', 'priority', 'status', 'category', 'account', 'sla_due', 'owner_id'],
    }),
    v('case', 'My Open Cases', { filters: all(MINE, { field: 'status', op: 'neq', value: 'Closed' }), sort: { field: 'sla_due', dir: 'asc' } }),
    v('case', 'Case Board', { viewType: 'kanban', groupBy: 'status' }),
    v('knowledge_article', 'Published Articles', { filters: all({ field: 'status', op: 'eq', value: 'Published' }) }),
    v('campaign', 'Campaign Timeline', { viewType: 'timeline' }),
    v('campaign', 'Campaign Calendar', { viewType: 'calendar', groupBy: 'start_date' }),
    v('project', 'Project Timeline', { viewType: 'timeline' }),
    v('project', 'Project Board', { viewType: 'kanban', groupBy: 'status' }),
    v('work_item', 'Board', { viewType: 'kanban', groupBy: 'status' }),
    v('work_item', 'Timeline', { viewType: 'timeline' }),
    v('work_item', 'My Work', {
      filters: all({ field: 'assignee', op: 'eq', value: 'CURRENT_USER' }, { field: 'status', op: 'neq', value: 'Done' }),
      sort: { field: 'due_date', dir: 'asc' },
    }),
    v('activity', 'My Open Tasks', {
      filters: all(MINE, { field: 'status', op: 'eq', value: 'Open' }),
      sort: { field: 'due_date', dir: 'asc' },
      columns: ['name', 'type', 'due_date', 'related_to', 'status'],
    }),
    v('activity', 'Activity Calendar', { viewType: 'calendar', groupBy: 'due_date' }),
    v('employee', 'Active Employees', { filters: all({ field: 'status', op: 'neq', value: 'Terminated' }), sort: { field: 'last_name', dir: 'asc' } }),
    v('time_off_request', 'Team Calendar', { viewType: 'calendar', groupBy: 'start_date', filters: all({ field: 'status', op: 'in', value: ['Submitted', 'Approved'] }) }),
    v('job_requisition', 'Open Roles', { filters: all({ field: 'status', op: 'eq', value: 'Open' }) }),
    v('candidate', 'Candidate Pipeline', { viewType: 'kanban', groupBy: 'stage' }),
  ];
}

export interface SeededConfiguration {
  processes: SeededProcesses;
  reports: Record<string, ReportDef>;
  dashboards: Record<string, string>;
  views: ListViewDef[];
}

/** Creates the out-of-the-box configuration: agents, approvals, automations, reports, dashboards, apps and list views. */
export async function seedConfiguration(s: Services, admin: Principal, approvers: Approvers): Promise<SeededConfiguration> {
  for (const { id, ...a } of agents()) await s.agents.create(admin, a, { id, builtIn: true });
  const processes = await approvalProcesses(s, approvers);
  for (const a of automations(processes)) await s.automations.create(a, admin.userId);

  const byKey: Record<string, ReportDef> = {};
  for (const { key, ...r } of reports()) {
    byKey[key] = await s.analytics.createReport({ description: '', sort: 'natural', limit: null, ...r }, admin.userId);
  }
  const dashboards: Record<string, string> = {};
  for (const d of DASHBOARDS) {
    const created = await s.analytics.createDashboard(
      { name: d.name, description: d.description, app: d.app, widgets: d.widgets.map(([key, size]) => ({ reportId: byKey[key]!.id, size })) },
      admin.userId,
    );
    dashboards[d.app] = created.id;
  }
  let order = 1;
  for (const app of STANDARD_APPS) await s.apps.save(admin, { ...app, dashboardId: dashboards[app.id] ?? null, sortOrder: order++ });
  const views: ListViewDef[] = [];
  for (const view of listViews()) views.push(await s.views.create(admin, view));
  return { processes, reports: byKey, dashboards, views };
}
