import { plural } from '../../plural.ts';

/** Setup → AI agents. */
export default {
  title: 'AI agents',
  subtitle: 'Configure the assistants people chat with and that automations can run.',
  runHistory: 'Run history',
  new: 'New agent',
  /** {name} is an agent name. */
  edit: 'Edit {name}',
  /** How much an agent may do on its own. */
  autonomy: {
    readOnly: {
      label: 'Read only',
      text: 'Looks up and analyzes data but never changes anything. Write tools are not offered to the agent.',
    },
    approvalRequired: {
      label: 'Approval required',
      text: 'Proposed changes are queued in Approvals and run only after the requesting user (or the record owner, for automation runs) approves them.',
    },
    autonomous: {
      label: 'Autonomous',
      text: 'Changes run immediately, limited to what the requesting user — or the AI agent user, for automation runs — is allowed to do.',
    },
  },
  /** Kinds of tools: read tools look data up, write tools change data. */
  toolKinds: {
    read: {
      title: 'Read tools',
      text: 'Look things up',
      selectAll: 'Select all read tools',
      clear: 'Clear read tools',
    },
    write: {
      title: 'Write tools',
      text: 'Create and change data',
      selectAll: 'Select all write tools',
      clear: 'Clear write tools',
    },
  },
  /**
   * Names of the tools agents can use, keyed by the server’s tool id in camelCase (aggregate_records → aggregateRecords).
   * Tools without a message show their humanized id.
   */
  toolNames: {
    aggregateRecords: 'Aggregate records',
    convertLead: 'Convert lead',
    createRecord: 'Create record',
    describeObject: 'Describe object',
    getRecord: 'Get record',
    getRelatedRecords: 'Get related records',
    getTimeline: 'Get timeline',
    listObjects: 'List objects',
    listUsers: 'List users',
    logActivity: 'Log activity',
    queryRecords: 'Query records',
    scoreLead: 'Score lead',
    searchKnowledge: 'Search knowledge',
    searchRecords: 'Search records',
    sendNotification: 'Send notification',
    submitForApproval: 'Submit for approval',
    updateRecord: 'Update record',
  },
  /** AI providers that are not brand names. Shown capitalized by CSS. */
  providers: {
    /** The built-in rules engine used when no AI provider is configured. */
    offline: 'offline',
  },
  /** Card showing which AI provider is in use. */
  status: {
    title: 'AI provider',
    connected: 'Connected',
    offline: 'Offline rules engine',
    provider: 'Provider',
    /** The AI model, e.g. gpt-4o. */
    model: 'Model',
    offlineNote:
      'Agents still work offline: the rules engine plans tool calls itself (agent instructions are not used) with the same tools, permissions and approval rules, so you can try everything without an API key.',
  },
  list: {
    searchLabel: 'Search agents',
    searchPlaceholder: 'Search agents…',
    noMatch: 'No agents match',
    empty: 'No agents yet',
    emptyText: 'Agents answer questions and take actions in the CRM using the tools you allow.',
    createFirst: 'Create your first agent',
    /** Badge: the agent ships with titoForce. */
    builtIn: 'Built-in',
    toolCount: plural({ one: '{count} tool', other: '{count} tools' }),
    /** Accessible label of the switch that turns an agent on or off. */
    activeLabel: '{name} active',
    noDescription: 'No description',
    /** Link that opens a chat with the agent. */
    chat: 'Chat',
    chatWith: 'Chat with {name}',
    activateToChat: 'Activate to chat',
    runHistoryOf: 'Run history of {name}',
    delete: 'Delete {name}',
    deleteTitle: 'Delete {name}?',
    deleteMessage: 'People can no longer chat with this agent. Agents used by an automation can’t be deleted.',
    deleteConfirm: 'Delete agent',
  },
  toasts: {
    created: '{name} created',
    saved: '{name} saved',
    activated: '{name} activated',
    deactivated: '{name} deactivated',
    deleted: '{name} deleted',
  },
  form: {
    create: 'Create agent',
    save: 'Save agent',
    builtInNote: 'This is a built-in agent. You can change it, but it can’t be deleted — deactivate it instead.',
    /** Example agent name. */
    namePlaceholder: 'Renewal assistant',
    descriptionHelp: 'Shown to people choosing an agent to chat with.',
    instructions: 'Instructions',
    /** {length} is the number of characters typed so far (at most 8000). */
    instructionsHelp: 'The agent’s goal, tone, steps and limits — used as the system prompt when an LLM provider is configured. {length}/8000 characters.',
    /** Example instructions; keep the line breaks. */
    instructionsPlaceholder: 'You help account managers prepare renewals.\n1. Look up the account and its open opportunities.\n2. Summarize risks and suggest next steps.',
    autonomy: 'Autonomy',
    tools: 'Tools',
    /** {count} is the number of selected tools. */
    toolsHelp: plural({
      other: '{count} selected. Agents can only use the tools you enable here, and every tool call is checked against the permissions of the user the agent acts for.',
    }),
    writeToolsIgnored: 'This agent is read only, so the selected write tools are ignored.',
    problems: {
      enterName: 'Enter a name.',
      chooseTool: 'Choose at least one tool.',
    },
  },
};
