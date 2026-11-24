import { plural } from '../../plural.ts';

/** Setup → Approval processes. */
export default {
  title: 'Approval processes',
  subtitle: 'Route records to an approver and run actions when they are submitted, approved or rejected.',
  new: 'New approval process',
  edit: 'Edit {name}',
  list: {
    searchLabel: 'Search approval processes',
    searchPlaceholder: 'Search processes…',
    filterByObject: 'Filter by object',
    allObjects: 'All objects',
    noMatch: 'No approval processes match',
    empty: 'No approval processes yet',
    emptyText: 'Approval processes let people submit records such as discounts or time off for sign-off.',
    createFirst: 'Create your first approval process',
    entryConditions: 'Entry conditions',
    approver: 'Approver',
    /** Column: number of actions run on submit / approve / reject. */
    actions: 'Actions',
    actionsTitle: 'Actions on submit / approve / reject',
    rowActions: 'Row actions',
    conditionCount: plural({ other: '{count} conditions' }),
    noConditions: 'No conditions',
    /** {name} is the user who approves when the approver field is empty. */
    fallback: 'Fallback: {name}',
    /** Accessible name of the on/off switch of a process. */
    activeLabel: '{name} active',
    delete: 'Delete {name}',
    deleteTitle: 'Delete {name}?',
    deleteMessage: 'Records can no longer be submitted to this process. Processes with pending requests can’t be deleted.',
    deleteConfirm: 'Delete process',
  },
  toasts: {
    created: '{name} created',
    saved: '{name} saved',
    activated: '{name} activated',
    deactivated: '{name} deactivated',
    deleted: '{name} deleted',
  },
  form: {
    create: 'Create process',
    save: 'Save process',
    namePlaceholder: 'Discount approval',
    chooseObject: 'Choose an object…',
    objectFixed: 'The object of an existing process can’t be changed.',
    /** Section heading. */
    entryConditions: '1. Entry conditions (optional)',
    /** {objects} is the plural object name, lower-cased mid-sentence (e.g. "opportunities"). */
    entryConditionsHelp: 'Only records matching these conditions can be submitted. When several active processes exist for {objects}, the first matching one is used.',
    /** Section heading. */
    approver: '2. Approver',
    approverModes: {
      user: { title: 'A specific user', text: 'Every request goes to the same person.' },
      field: { title: 'Based on the record', text: 'Someone related to the record, e.g. its owner or the employee’s manager.' },
    },
    approverUser: 'Approver user',
    chooseUser: 'Choose a user…',
    approverField: 'Approver field',
    approverFieldHelp: 'The user found here at submission time approves the request.',
    customPath: 'Custom path…',
    fallbackApprover: 'Fallback approver',
    fallbackApproverHelp: 'Used when the field is empty or the user is inactive.',
    /** Empty choice of the fallback approver. */
    noFallback: 'None — submission fails',
    fieldPath: 'Field path',
    /** {ownerId} is the API name owner_id; {example} is a path such as employee.manager.user. */
    fieldPathHelp: 'Dot-separated API names: lookups to follow, ending in a user field or {ownerId} (up to 5 parts), e.g. {example}.',
    fieldPathError: 'Use lowercase API names separated by dots.',
    /** Section heading. */
    actions: '3. Actions',
    actionsNote: 'The approver is always notified. Actions run as the approval process, so they aren’t limited by anyone’s permissions.',
    actionsEmpty: 'No actions.',
    changeObjectTitle: 'Change the object?',
    changeObjectMessage: 'The entry conditions, approver field and actions refer to the current object and will be cleared.',
    changeObjectConfirm: 'Change object',
    problems: {
      enterName: 'Enter a name.',
      chooseObject: 'Choose an object.',
      chooseApprover: 'Choose the approver.',
      enterPath: 'Enter a valid approver field path.',
      /** {field} is the API name typed by the user. */
      noSuchField: '{object} has no field “{field}”.',
    },
  },
  /** Choices of the approver field. */
  approverPaths: {
    recordOwner: 'Record owner',
    /** Group of the record’s own user fields; {object} is the object name, lower-cased mid-sentence (e.g. "This opportunity"). */
    thisObject: 'This {object}',
  },
  /**
   * Actions of a process. `item` names one action in accessibility labels and problems (e.g. "On submit action 2");
   * {action} in `help` is the action type “Submit for approval”.
   */
  stages: {
    onSubmit: {
      title: 'When submitted',
      help: 'Runs right after the record is submitted, e.g. set Status to “In Review”.',
      item: 'On submit action',
      add: 'Add submit action',
    },
    onApprove: {
      title: 'When approved',
      help: 'Runs after the approver approves. Use “{action}” to chain a next approval step.',
      item: 'On approve action',
      add: 'Add approve action',
    },
    onReject: {
      title: 'When rejected',
      help: 'Runs after the approver rejects the request.',
      item: 'On reject action',
      add: 'Add reject action',
    },
  },
};
