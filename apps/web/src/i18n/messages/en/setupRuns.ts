/** Setup → Run history (automation runs and agent runs). */
export default {
  title: 'Run history',
  subtitle: 'What automations and AI agents did, step by step.',
  noAccessTitle: 'Nothing to show',
  noAccessText: 'You need permission to manage automations or agents to see run history.',
  tabs: {
    automations: 'Automation runs',
    agents: 'Agent runs',
  },
  /** The lists show the 100 most recent runs. */
  latest: 'Latest 100 runs',
  /** Column: when the run happened. */
  time: 'Time',
  /** Column: the record the run was about. */
  record: 'Record',
  /** Column and field: what started an agent run. */
  trigger: 'Trigger',
  /** Status of an automation run. */
  runStatus: {
    success: 'Success',
    failed: 'Failed',
    skipped: 'Skipped',
  },
  /** Status of an agent run. */
  agentStatus: {
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
  },
  /** Status of one tool call of an agent run. */
  stepStatus: {
    /** The tool call succeeded. */
    ok: 'OK',
    error: 'Error',
    pendingApproval: 'Awaiting approval',
    rejected: 'Rejected',
  },
  /** What started an agent run. */
  triggers: {
    chat: 'Chat',
    automation: 'Automation',
    /** An action button on a record page. */
    recordAction: 'Record action',
    /** Started through the REST API. */
    api: 'API',
  },
  /** AI providers that are not brand names. Shown capitalized by CSS. */
  providers: {
    /** The built-in rules engine used when no AI provider is configured. */
    offline: 'offline',
  },
  automations: {
    filterLabel: 'Filter by automation',
    all: 'All automations',
    deleted: 'Deleted automation',
    /** Active filter chip; {name} is an automation. */
    filterChip: 'Automation: {name}',
    clearFilter: 'Clear automation filter',
    empty: 'No automation runs yet',
    emptyText: 'Runs appear here when an active automation’s trigger and conditions match a record change.',
    /** Column header. */
    automation: 'Automation',
    /** Column: what the run did. */
    result: 'Result',
    showDetails: 'Show run details',
    hideDetails: 'Hide run details',
    showOnly: 'Show only this automation',
    /** Fallback name of an action whose type is unknown. */
    unknownAction: 'Action',
    /** {action} is an action type (e.g. “Send notification”); {reason} is the reason given by the server. */
    skipped: '{action} (skipped: {reason})',
    /** {id} is the run ID, {time} its date and time. */
    runInfo: 'Run {id} · {time}',
  },
  agents: {
    filterLabel: 'Filter by agent',
    all: 'All agents',
    deleted: 'Deleted agent',
    /** Active filter chip; {name} is an agent. */
    filterChip: 'Agent: {name}',
    clearFilter: 'Clear agent filter',
    empty: 'No agent runs yet',
    emptyText: 'Runs appear here when someone chats with an agent or an automation runs one.',
    /** Column header. */
    agent: 'Agent',
    /** Column and heading: the request given to the agent. */
    input: 'Input',
    /** Heading: the agent’s reply. */
    output: 'Output',
    provider: 'Provider',
    /** Column: number of steps. */
    steps: 'Steps',
    viewDetails: 'View run details',
    noInput: '(no input)',
    /** Title of the run details dialog when the agent is not loaded yet. */
    run: 'Agent run',
    /** {name} is the agent, e.g. “Sales assistant run”. */
    runOf: '{name} run',
    started: 'Started',
    duration: 'Duration',
    /** {seconds} is a number such as 2.5. */
    durationSeconds: '{seconds} s',
    toolCalls: 'Tool calls',
    runId: 'Run ID',
    stepsCount: 'Steps ({count})',
    working: 'Working…',
    noSteps: 'No steps were recorded.',
  },
  /** One step of an agent run; {n} is its position. */
  steps: {
    message: '{n}. Message',
    error: '{n}. Error',
    /** {duration} is a number of milliseconds. */
    durationMs: '{duration} ms',
    openApprovals: 'Open approvals',
    /** Heading: the arguments of a tool call. */
    arguments: 'Arguments',
    /** Heading: what a tool call returned. */
    result: 'Result',
  },
};
