import { plural } from '../../plural.ts';

export default {
  /** Autonomy level of an AI agent (badge). */
  autonomy: {
    readOnly: 'Read-only',
    approvalRequired: 'Changes need approval',
    autonomous: 'Autonomous',
  },
  autonomyHelp: {
    readOnly: 'Can look things up but never changes data.',
    approvalRequired: 'Proposes changes; a person approves each one before it runs.',
    autonomous: 'Makes changes directly, within your permissions. Every action is logged.',
  },

  page: {
    title: 'AI agents',
    /** Accessible name of the sidebar that lists the agents. */
    sidebar: 'Agents',
    manage: 'Manage agents',
    agentList: 'Agent list',
    conversations: 'Conversations',
    /** Label of the select that switches to another agent. */
    agent: 'Agent',
    /** Button that lists the tools the agent can use. */
    toolCount: plural({ one: '{count} tool', other: '{count} tools' }),
    tools: 'Tools',
    /** Button (noun): past conversations. */
    history: 'History',
    newChat: 'New chat',
  },
  empty: {
    title: 'No active agents',
    body: 'Ask an administrator to activate an agent.',
    setUp: 'Set up agents',
  },
  conversations: {
    empty: 'No conversations with {agent} yet.',
    label: 'Conversations with {agent}',
    untitled: 'Untitled conversation',
    /** Accessible name of the delete button; {title} is the conversation title. */
    delete: 'Delete conversation “{title}”',
    deleteTitle: 'Delete conversation?',
    deleteMessage: 'The conversation history will be removed. Agent run logs are kept.',
  },

  chat: {
    loadingConversation: 'Loading conversation…',
    offline:
      'Offline mode: no LLM is configured, so agents use the built-in rules engine. It understands common CRM requests; set an OpenAI or Anthropic API key for full natural-language reasoning.',
    /** {record}: name of the record the conversation is about. */
    context: 'Context: {record}',
    thinking: 'Thinking…',
    working: 'Working…',
    sending: 'Sending…',
    noResponse: 'No response',
    /** Markdown: keep the ** markers. {error} is the error message. */
    runError: '**Error:** {error}',
    /** Markdown: keep the ** markers. {error} is the error message. */
    sendFailed: "**Couldn't send:** {error}",
    showSteps: 'Show steps',
    toolCalls: plural({ one: '{count} tool call', other: '{count} tool calls' }),
    noTools: 'No tools were used.',
    /** Duration in milliseconds. */
    durationMs: '{ms} ms',
    /** Followed by a description of the change the agent wants to make. */
    awaitingApproval: 'Awaiting your approval:',
    /** Button (verb): approve the change proposed by the agent. */
    approve: 'Approve',
    /** Button (verb): reject the change proposed by the agent. */
    reject: 'Reject',
    /** Fallback name of a step whose tool is unknown. */
    tool: 'Tool',
    /** Fallback description of a proposed change. */
    action: 'Action',
    /** Accessible name of the message box; "Message" is a verb (send a message to the agent). */
    messageLabel: 'Message {agent}',
    /** Placeholder of the message box; "Message" is a verb (send a message to the agent). */
    messagePlaceholder: 'Message {agent}…',
    inactive: 'This agent is inactive',
    /** Button (verb): send the message. */
    send: 'Send',
    keepTyping: 'The agent is working; you can keep typing.',
  },
  /** Status of a tool call made by an agent (icon label). */
  stepStatus: {
    ok: 'Done',
    error: 'Failed',
    rejected: 'Rejected',
    pendingApproval: 'Awaiting approval',
  },
  /** Tools an agent can call, shown in its list of steps. */
  tools: {
    listObjects: 'List objects',
    describeObject: 'Describe object',
    searchRecords: 'Search records',
    queryRecords: 'Query records',
    getRecord: 'Get record',
    getRelatedRecords: 'Get related records',
    getTimeline: 'Get timeline',
    aggregateRecords: 'Aggregate records',
    searchKnowledge: 'Search knowledge',
    scoreLead: 'Score lead',
    listUsers: 'List users',
    createRecord: 'Create record',
    updateRecord: 'Update record',
    logActivity: 'Log activity',
    convertLead: 'Convert lead',
    submitForApproval: 'Submit for approval',
    sendNotification: 'Send notification',
  },
  /**
   * Suggested prompts, sent to the agent as the user's message. The built-in offline rules engine only understands
   * English, so these translations are used only when an LLM provider is configured.
   */
  suggestions: {
    myDay: "What's on my plate today?",
    myOpenOpportunities: 'Show my open opportunities',
    openCasesByPriority: 'How many open cases by priority?',
    pipeline: "What's our pipeline?",
    qualifyLeads: 'Qualify new leads',
    newLeads: 'Show all new leads',
    triageCases: 'Triage new cases',
    ptoBalance: 'How many PTO days do I have left?',
    employeesByDepartment: 'How many employees by department?',
    openRequisitions: 'Show open job requisitions',
    overdueWorkItems: 'Show overdue work items',
    workItemsByStatus: 'How many open work items by status?',
    summarizeRecord: 'Summarize this record',
    recordNextSteps: 'What are the next steps for this record?',
    /** Asks the agent to log a call on the record, with the call notes after the colon. */
    logCall: 'Log a call: discussed timeline and pricing',
  },
};
