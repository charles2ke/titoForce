import { plural } from '../../plural.ts';

/** Setup → Automations, and the actions editor shared with approval processes. */
export default {
  /** What an automation action does (verb phrases). */
  actionTypes: {
    updateRecord: 'Update this record',
    updateRelated: 'Update related record',
    createRecord: 'Create record',
    notify: 'Send notification',
    runAgent: 'Run AI agent',
    webhook: 'Call webhook',
    submitApproval: 'Submit for approval',
  },

  chooseObject: 'Choose an object…',

  // Actions editor
  editor: {
    /** Default name of one action in the list (numbered with `numbered`). */
    item: 'Action',
    /** Accessible name of an action card: {label} is the action name, {n} its position, e.g. "Action 2" or "On approve action 2". */
    numbered: '{label} {n}',
    empty: 'No actions yet.',
    add: 'Add action',
    actionType: 'Action type',
    moveUp: 'Move action up',
    moveDown: 'Move action down',
    remove: 'Remove action',
    /** Option for an inactive agent or approval process. */
    inactiveOption: '{name} (inactive)',
    /** Every placeholder is a code sample such as {{record.name}}; {userName} is the user who made the change. */
    templateHint: 'Insert dynamic values with {braces}, e.g. {recordName}, {previousValue}, {ownerName}, {userName} (who made the change) or formulas like {formula}.',
    /** Same as templateHint, plus {relatedName}: a field of a related record, e.g. {{related.account.name}}. */
    templateHintRelated: 'Insert dynamic values with {braces}, e.g. {recordName}, {previousValue}, {ownerName}, {userName} (who made the change), {relatedName} or formulas like {formula}.',
  },
  /** Problems with an action; {item} is the numbered action, e.g. "Action 2". */
  problems: {
    chooseObjectToCreate: '{item}: choose the object to create.',
    addField: '{item}: add at least one field.',
    chooseRelatedRecord: '{item}: choose the related record.',
    chooseRecipient: '{item}: choose who to notify.',
    enterNotificationTitle: '{item}: enter a notification title.',
    chooseAgent: '{item}: choose an agent.',
    enterPrompt: '{item}: enter a prompt.',
    enterUrl: '{item}: enter an http(s) URL.',
  },
  /** "Field = value" rows of update and create actions. */
  fieldValues: {
    valueFor: 'Value for {field}',
    /** {template} is the code sample {{template}}. */
    valuePlaceholder: 'Text or {template}',
    useFormulaFor: 'Use a formula for {field}',
    useFixedValue: 'Switch back to a fixed value',
    useFormula: 'Use a formula / template',
    remove: 'Remove {field}',
    chooseObjectFirst: 'Choose an object first.',
    empty: 'No fields yet — add the fields this action should set.',
    add: 'Add field',
  },
  updateRelated: {
    relatedRecord: 'Related record',
    relatedRecordHelp: 'The record referenced by this lookup field is updated.',
    noLookupFields: '{object} has no lookup fields.',
    chooseLookupField: 'Choose a lookup field…',
    /** Target of a lookup field that can point to records of any object. */
    anyObject: 'any object',
    showFieldsOf: 'Show fields of',
    showFieldsOfHelp: 'The lookup can point to any object; pick the object whose fields you want to set.',
  },
  createRecord: {
    object: 'Object to create',
    /** “Owner” is the name of the Owner field; {example} is the code sample {{record.id}}. */
    objectHelp: 'The new record is owned by this record’s owner unless you set Owner. Use {example} in a lookup field to link it back.',
  },
  notify: {
    sendTo: 'Send to',
    recipients: {
      owner: 'Record owner',
      triggeringUser: 'User who made the change',
      user: 'A specific user',
      role: 'Everyone with a role',
      field: 'User in a field of the record',
    },
    user: 'User',
    chooseUser: 'Choose a user…',
    chooseRole: 'Choose a role…',
    roleId: 'Role id',
    /** {example} is a role id such as sales_manager. */
    roleIdHelp: 'e.g. {example}',
    userField: 'User field',
    userFieldHelp: 'The user stored in this field is notified.',
    noUserFields: '{object} has no user fields.',
    title: 'Notification title',
    /** Example title; {recordName} is the code sample {{record.name}}. */
    titlePlaceholder: 'Hot lead: {recordName}',
    message: 'Notification message',
  },
  runAgent: {
    agent: 'Agent',
    chooseAgent: 'Choose an agent…',
    prompt: 'Prompt',
    /** {example} is the code sample {{record.name}}. */
    promptHelp: 'The agent runs in the background with this record as context. Templates like {example} are allowed.',
    promptPlaceholder: 'Qualify this lead',
  },
  webhook: {
    url: 'Webhook URL',
    urlHelp: 'Receives a JSON payload with the event, object, record and previous values. Calls run in the background.',
    /** HTTP method (POST or PUT). */
    method: 'Method',
  },
  submitApproval: {
    process: 'Approval process',
    processHelp: 'Leave on automatic to use the first active process whose entry conditions match.',
    automatic: 'Automatic (first matching process)',
    comment: 'Submission comment',
    commentHelp: 'Optional; templates allowed.',
  },

  // Automations page
  title: 'Automations',
  subtitle: 'Run actions automatically when records are created, updated or deleted.',
  runHistory: 'Run history',
  runHistoryOf: 'Run history of {name}',
  new: 'New automation',
  edit: 'Edit {name}',
  /** Label of the field and table column that says when an automation runs. */
  trigger: 'Trigger',
  list: {
    searchLabel: 'Search automations',
    searchPlaceholder: 'Search automations…',
    filterByObject: 'Filter by object',
    allObjects: 'All objects',
    noMatch: 'No automations match',
    empty: 'No automations yet',
    emptyText: 'Automations update fields, create follow-up records, notify people, call webhooks or hand work to AI agents.',
    createFirst: 'Create your first automation',
    conditions: 'Conditions',
    /** Column: the actions an automation performs. */
    actions: 'Actions',
    /** Column: number of times an automation ran. */
    runs: 'Runs',
    lastRun: 'Last run',
    rowActions: 'Row actions',
    conditionCount: plural({ other: '{count} conditions' }),
    noConditions: 'No conditions',
    /** Number of failed runs. */
    failedCount: plural({ other: '{count} failed' }),
    /** Last run: the automation has not run yet. */
    never: 'Never',
    /** Accessible name of the on/off switch of an automation. */
    activeLabel: '{name} active',
    delete: 'Delete {name}',
    deleteTitle: 'Delete {name}?',
    deleteMessage: 'The automation stops running and is permanently deleted, together with its run history.',
    deleteConfirm: 'Delete automation',
  },
  toasts: {
    created: '{name} created',
    saved: '{name} saved',
    activated: '{name} activated',
    deactivated: '{name} deactivated',
    deleted: '{name} deleted',
  },
  /** {object} is the object name, lower-cased mid-sentence (e.g. "A lead is created"). `short` is used in the automation list. */
  triggers: {
    created: { label: 'A {object} is created', short: 'Created' },
    updated: { label: 'A {object} is updated', short: 'Updated' },
    saved: { label: 'A {object} is created or updated', short: 'Created or updated' },
    deleted: { label: 'A {object} is deleted', short: 'Deleted' },
  },
  /** {trigger} is a short trigger (e.g. "Updated"), {fields} a comma-separated list of field names; {count} is the number of fields. */
  triggerSummary: plural({ one: '{trigger} · when {fields} changes', other: '{trigger} · when {fields} change' }),
  watch: {
    legend: 'Only when these fields change',
    /** “created or updated” quotes the trigger “Created or updated”. */
    selected: plural({ other: '{count} selected — record creations still run for “created or updated”.' }),
    none: 'Leave all unchecked to run on any change.',
  },
  form: {
    create: 'Create automation',
    save: 'Save automation',
    namePlaceholder: 'Notify owner of large deals',
    objectFixed: 'The object of an existing automation can’t be changed.',
    /** Section heading: the trigger of the automation. */
    when: '1. When',
    deletedNote: 'The record is already gone when the automation runs, so it can only notify, call webhooks, create records or update related records.',
    /** Section heading: the conditions of the automation. */
    onlyIf: '2. Only if (optional)',
    conditionsBeforeDelete: 'Conditions are checked against the record as it was before deletion.',
    conditionsAfterChange: 'Conditions are checked against the record after the change.',
    /** “Current user” quotes a value of the condition editor. */
    currentUserNote: '“Current user” means the person who made the change.',
    /** Section heading: the actions of the automation. */
    then: '3. Then',
    actionsEmpty: 'Add the first action this automation should perform.',
    retriggerWarning:
      'This automation updates the record it runs on, and that update can trigger it again. Repeats stop once a run changes nothing, or after 4 levels. To run it once per change, watch specific fields (not the ones it sets) or add a condition.',
    changeObjectTitle: 'Change the object?',
    changeObjectMessage: 'The conditions, watched fields and actions refer to the current object and will be cleared.',
    changeObjectConfirm: 'Change object',
    problems: {
      enterName: 'Enter a name.',
      chooseObject: 'Choose an object.',
      addAction: 'Add at least one action.',
      /** {n} is the position of the action, {action} its type, e.g. “Update this record”. */
      actionAfterDelete: 'Action {n} ({action}) can’t run after a record is deleted.',
    },
  },
};
