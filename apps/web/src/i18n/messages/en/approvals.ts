export default {
  title: 'Approvals',
  subtitle: 'Record approval requests and AI agent actions that need a human decision.',
  tabs: {
    inbox: 'Awaiting me',
    submitted: 'Submitted by me',
    all: 'All requests',
    agent: 'Agent actions',
  },
  empty: {
    inbox: 'Nothing is waiting for your approval',
    submitted: 'You haven’t submitted anything for approval',
    all: 'No approval requests yet',
  },

  /** Button (verb): approve a request or an agent action. */
  approve: 'Approve',
  /** Button (verb): reject a request or an agent action. */
  reject: 'Reject',
  /** Button (verb): withdraw an approval request you submitted. */
  recall: 'Recall',

  /** Status badge of a record approval request (lower case in English). */
  requestStatus: {
    pending: 'pending',
    approved: 'approved',
    rejected: 'rejected',
    recalled: 'recalled',
  },
  request: {
    /** {time}: relative time or date, e.g. "2h ago". */
    submittedBy: 'submitted by {name} {time}',
    /** {time}: relative time or date, e.g. "2h ago". */
    submittedByYou: 'submitted by you {time}',
    /** {name}: the user who must approve the request. */
    approver: 'approver {name}',
    approverYou: 'approver you',
    /** {time}: relative time or date, e.g. "2h ago". */
    approvedAt: 'Approved {time}',
    /** {time}: relative time or date, e.g. "2h ago". */
    rejectedAt: 'Rejected {time}',
    /** {time}: relative time or date, e.g. "2h ago". */
    recalledAt: 'Recalled {time}',
    /** A comment written by a user, in quotation marks. */
    quote: '“{text}”',
    recalled: 'Request recalled',
  },

  /** Status badge of an AI agent action (lower case in English). */
  status: {
    pending: 'pending',
    executing: 'executing',
    executed: 'executed',
    rejected: 'rejected',
    failed: 'failed',
  },
  action: {
    /** {tool}: the technical name of the tool, e.g. "update_record". */
    wantsToRun: '{agent} wants to run {tool}',
    viewRecord: 'View record',
    /** Heading above the input values the agent passed to the tool. */
    arguments: 'Arguments',
    /** Heading above the output of the tool. */
    result: 'Result',
    failed: 'The action failed: {error}',
    failedUnknown: 'The action failed: unknown error',
    rejected: 'Action rejected',
    executed: 'Action approved and executed',
  },
  agentActions: {
    intro: 'Agents with the “approval required” autonomy level pause here before changing data.',
    /** Filter option: only agent actions waiting for a decision. */
    pending: 'Pending',
    emptyPending: 'No agent actions waiting',
    emptyAll: 'No agent actions yet',
  },
};
