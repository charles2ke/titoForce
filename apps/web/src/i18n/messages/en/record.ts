import { plural } from '../../plural.ts';

/** Record page: header, details, path, activity timeline, approvals, related lists and lead conversion. */
export default {
  /** Placeholder for a record whose name is empty. */
  noName: '(no name)',
  /** Name shown for changes made by the system rather than a person. */
  system: 'System',

  notAvailable: {
    title: 'Record not available',
    body: 'It may have been deleted, or you may not have access to it.',
    goHome: 'Go home',
    objectUnavailable: 'This record’s object is not available to you.',
  },

  page: {
    askAi: 'Ask AI',
    summarizeWithAi: 'Summarize with AI',
    /**
     * Prompt sent to the AI assistant; always sent in English (the built-in assistant only understands English).
     * {label} is the object's label in lower case.
     */
    summarizePrompt: 'Summarize this {label} and suggest next steps.',
    showRelated: 'Show related records',
    /** {label} is the object's label in lower case, e.g. "Delete account?". */
    deleteTitle: 'Delete {label}?',
    deleteMessage: '“{name}” will be permanently deleted. Records that reference it may be deleted too, or have the reference cleared.',
    /** e.g. "Account “Acme” deleted". */
    deleted: '{label} “{name}” deleted',
    /** Tab listing the records related to this one. */
    related: 'Related',
    relatedCount: 'Related ({count})',
    sidebarLabel: 'Activity and approvals',
  },

  details: {
    /** Default section title for fields without a section, e.g. "Account Information". */
    defaultSection: '{label} Information',
    systemInformation: 'System Information',
    lastModified: 'Last modified',
    /** Who created/last modified the record and when, e.g. "Maria Garcia, 3 days ago". */
    stamp: '{user}, {time}',
    /** Button that edits one field in place; {field} is the field label. */
    editField: 'Edit {field}',
    changeOwner: 'Change owner',
    ownerChanged: 'Owner changed',
  },

  /** Stage path above the record (the status picklist as clickable steps). */
  path: {
    /** {field} is the field label and {value} the picklist value, e.g. "Stage set to Proposal". */
    set: '{field} set to {value}',
    /** Tooltip; {field} is the field label in lower case, e.g. "Mark stage as Proposal". */
    markAs: 'Mark {field} as {value}',
  },

  activity: {
    title: 'Activity',
    formLabel: 'Log activity',
    typeLabel: 'Activity type',
    subject: 'Subject',
    /** {type} is the activity type (Call, Email, Meeting, …). */
    subjectPlaceholder: '{type} subject',
    notes: 'Notes',
    detailsPlaceholder: 'Details (optional)',
    whatHappenedPlaceholder: 'What happened? (optional)',
    /** Label of the due date input. */
    dueLabel: 'Due',
    /** Button for planned activities; {type} is the activity type in lower case, e.g. "Add task". */
    add: 'Add {type}',
    /** Button for past activities; {type} is the activity type in lower case, e.g. "Log call". */
    log: 'Log {type}',
    /** {type} is the activity type, e.g. "Meeting scheduled". */
    scheduled: '{type} scheduled',
    logged: '{type} logged',
    markComplete: 'Mark “{title}” complete',
    reopen: 'Reopen “{title}”',
    /** Shown when the person who logged an activity is unknown. */
    someone: 'Someone',
    dueOn: 'Due {date}',
    overdueDueOn: 'Overdue, due {date}',
    /** Label of the timeline filter tabs. */
    filterLabel: 'Show',
    filter: {
      activities: 'Activities',
      changes: 'Changes',
      /** Items produced by AI agents. */
      ai: 'AI',
    },
    empty: 'Nothing here yet.',
    upcomingLabel: 'Upcoming and overdue',
    upcoming: 'Upcoming & overdue',
    history: 'History',
  },

  /** Field-change history in the activity timeline; {actor} is the name of the person or process. */
  history: {
    updatedFields: plural({ one: '{actor} updated {count} field', other: '{actor} updated {count} fields' }),
    createdRecord: '{actor} created this record',
    /** Any other change; {action} is the server's description of the event in lower case. */
    other: '{actor} {action}',
    /** Shown below the first changes when there are more. */
    more: plural({ one: '…and {count} more', other: '…and {count} more' }),
    /** Badge for changes not made by a person directly. */
    actorType: {
      agent: 'agent',
      automation: 'automation',
      system: 'system',
      approval: 'approval',
    },
  },

  /** Badge on an AI agent run in the activity timeline. */
  agentRun: {
    status: {
      running: 'running',
      failed: 'failed',
    },
  },

  approvals: {
    title: 'Approvals',
    submit: 'Submit for approval',
    /** {name} is the approver's name. */
    submitted: 'Submitted to {name} for approval',
    processLabel: 'Approval process',
    automaticProcess: 'Automatic (first process whose criteria match)',
    /** {name} is the approval process name. */
    process: 'Process: {name}',
    comment: 'Comment',
    submitCommentHelp: 'Optional. The approver sees this with the request.',
    decisionCommentHelp: 'Optional. Shared with the submitter.',
    /** A comment quoted from a person. */
    quote: '“{comment}”',
    approveTitle: 'Approve request',
    rejectTitle: 'Reject request',
    approve: 'Approve',
    reject: 'Reject',
    /** Button: withdraw a pending approval request. */
    recall: 'Recall',
    /** {name} is the record name. */
    approvedRecord: 'Approved “{name}”',
    rejectedRecord: 'Rejected “{name}”',
    recalledToast: 'Request recalled',
    /** {name} is the submitter's name, {time} a relative time such as "2 hours ago". */
    submittedBy: 'Submitted by {name} {time}',
    pendingLabel: 'Pending approval',
    waitingOnYou: 'Waiting on you',
    /** {name} is the approver's name. */
    waitingOn: 'Waiting on {name}',
    /** Shown instead of the approver's name for a request its submitter withdrew. */
    recalled: 'Recalled',
    notSubmitted: 'Not submitted yet.',
    status: {
      pending: 'pending',
      approved: 'approved',
      rejected: 'rejected',
      recalled: 'recalled',
    },
  },

  convert: {
    /** Button: convert the lead into an account, contact and opportunity. */
    action: 'Convert',
    /** {name} is the lead's name. */
    title: 'Convert lead: {name}',
    intro: 'Converting creates a contact, links it to an account and, optionally, opens an opportunity. The lead is then marked Converted.',
    account: 'Account',
    /** {name} is the lead's company. */
    useNamedAccount: 'Use the account named “{name}” if it exists, otherwise create it',
    createAccount: 'Create a new account from the lead’s name',
    attachExisting: 'Attach to an existing account',
    searchAccounts: 'Search accounts…',
    createOpportunity: 'Create an opportunity',
    opportunityName: 'Opportunity name',
    /** “<Account> - New Business” is the default name the server gives the opportunity (it stays in English). */
    opportunityNameHelp: 'Leave blank to use “<Account> - New Business”.',
    /** {name} is the lead's name. */
    converted: '{name} converted',
    doneTitle: 'Lead converted',
    resultsLabel: 'Converted records',
    accountNew: 'Account (new)',
    accountExisting: 'Account (existing)',
    contactNew: 'Contact (new)',
    opportunityNew: 'Opportunity (new)',
  },

  related: {
    /** Accessible label of the "New" button on a related list; {label} is the related object's label. */
    newLabel: 'New {label}',
    /** {plural} is the related object's plural label in lower case. */
    empty: 'No {plural} yet.',
    viewAll: 'View all {count}',
    noListsTitle: 'No related lists',
    /** {label} is the object's label in lower case. */
    noListsBody: 'Nothing else in titoForce points to this {label} yet.',
  },
};
