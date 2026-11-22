import { plural } from '../../plural.ts';

export default {
  /** Badge: an object or field created by the customer (not built in). */
  custom: 'Custom',
  /** Badge: a built-in object or field. */
  standard: 'Standard',
  apiNameInvalid: 'Use lowercase letters, numbers and underscores, starting with a letter (max 40).',
  /** Plural form of an object's name, e.g. “Vehicles”. */
  pluralLabel: 'Plural label',
  /** The field (or template) that gives each record its title in lists, lookups and search. */
  recordName: 'Record name',
  /** Whether a field holds sensitive data (only visible to roles allowed to view sensitive fields). */
  sensitive: 'Sensitive',
  /** Group of fields on the record page. */
  section: 'Section',
  unsavedChanges: 'Unsaved changes',
  /** Accessible name of an edit button; {name} is a field or validation rule. */
  editItem: 'Edit {name}',
  /** Accessible name of a delete button; {name} is a field or validation rule. */
  deleteItem: 'Delete {name}',

  /** Field data types. */
  fieldTypes: {
    text: 'Text',
    longtext: 'Long text',
    email: 'Email',
    phone: 'Phone',
    url: 'URL',
    number: 'Number',
    currency: 'Currency',
    percent: 'Percent',
    date: 'Date',
    datetime: 'Date & time',
    checkbox: 'Checkbox',
    picklist: 'Picklist',
    multipicklist: 'Multi-select picklist',
    lookup: 'Lookup (relationship)',
    user: 'User',
    formula: 'Formula',
    rollup: 'Roll-up summary',
  },
  /** Aggregate functions of a roll-up summary field. */
  rollupFns: {
    count: 'Count of records',
    sum: 'Sum',
    avg: 'Average',
    min: 'Minimum',
    max: 'Maximum',
  },
  /** Short type descriptions in the fields table. */
  typeSummary: {
    /** {object}: the object a lookup field points to. */
    lookup: 'Lookup → {object}',
    anyObject: 'Any object',
    /** {type}: the formula's result type, e.g. “number”. */
    formula: 'Formula ({type})',
    /** {fn}: the aggregate function, e.g. “sum”. */
    rollup: 'Roll-up ({fn})',
    /** Short aggregate function names shown in “Roll-up ({fn})”. */
    rollupFns: {
      count: 'count',
      sum: 'sum',
      avg: 'avg',
      min: 'min',
      max: 'max',
    },
  },

  list: {
    title: 'Objects & Fields',
    subtitle: 'Standard and custom objects, their fields, page layouts and validation rules.',
    newObject: 'New object',
    searchLabel: 'Search objects',
    searchPlaceholder: 'Search objects…',
    noMatches: 'No objects match your search',
    empty: 'No objects yet',
    /** Column header: number of fields of an object. */
    fields: 'Fields',
  },

  newObject: {
    title: 'New object',
    create: 'Create object',
    created: '{label} created',
    alreadyExists: 'An object with this API name already exists.',
    labelHelp: 'Singular, e.g. “Vehicle”.',
    /** {plural}: the default plural label the server derives from the label. */
    pluralHelp: 'Defaults to “{plural}”.',
    apiNameHelp: 'Used by the API, formulas and templates. It cannot be changed later.',
    preview: 'Preview',
    /** {field}: label of the record name field created with the object, e.g. “Vehicle Name”. */
    nameFieldHint: 'A “{field}” text field is created automatically.',
  },

  /** Up/down/remove controls of an ordered list; {label} is a field name or “value 3”. */
  orderedList: {
    moveUp: 'Move {label} up',
    moveDown: 'Move {label} down',
    remove: 'Remove {label}',
    maxReached: 'Maximum of {max} reached',
    addField: 'Add a field…',
    noMoreFields: 'No more fields',
  },

  /** Placeholders are code: field API names, operators and function names. */
  formulaHelp: {
    title: 'Formula syntax',
    fields: 'Reference fields by API name (e.g. {example}) plus {name}, {ownerId}, {createdAt}, {updatedAt}. Text goes in single quotes.',
    operators: 'Operators: {arithmetic}, {concat} (join text), {comparison}, {logical}, {conditional}.',
    functions: 'Functions: {functions}.',
    examples: 'Examples:',
  },

  fields: {
    /** The English “one” form deliberately matches the current UI (“1 fields”); translations should use their correct singular. */
    count: plural({ one: '{count} field', other: '{count} fields' }),
    newField: 'New field',
    /** Column header: whether a field is standard or custom. */
    origin: 'Origin',
    nameFieldLocked: 'The record name field can’t be deleted',
    standardLocked: 'Standard fields can’t be deleted',
    deleted: '{label} deleted',
    deleteTitle: 'Delete {label}?',
    /** {object}: object name inside the sentence, e.g. “account”. */
    deleteMessage: 'The field and its data on every {object} record are permanently deleted. It is also removed from layouts and list columns.',
    deleteConfirm: 'Delete field',
  },

  fieldForm: {
    newTitle: 'New field on {object}',
    create: 'Create field',
    save: 'Save field',
    created: '{label} field created',
    saved: '{label} saved',
    fieldLabel: 'Field label',
    apiNameHelp: 'Cannot be changed later.',
    reserved: '“{apiName}” is reserved.',
    alreadyExists: 'A field with this API name already exists.',
    typeHelp: 'The type of an existing field can’t be changed.',
    sectionHelp: 'Groups fields on the record page.',
    problems: {
      label: 'Enter a label.',
      apiName: 'Fix the API name.',
      noOptions: 'Add at least one picklist value.',
      emptyOption: 'Picklist values cannot be empty.',
      duplicateOption: 'Picklist values must be unique.',
      lookupTarget: 'Choose the object this lookup points to.',
      formula: 'Enter a formula.',
      rollupSource: 'Choose the child object and relationship.',
      rollupField: 'Choose the field to aggregate.',
    },
    /** Picklist values editor. */
    options: {
      values: 'Values',
      renameHint: 'Renaming a value doesn’t change existing records.',
      value: 'Value {n}',
      /** Used inside “Move {label} up/down”. */
      valueInSentence: 'value {n}',
      color: 'Color of value {n}',
      remove: 'Remove value {n}',
      add: 'Add value',
    },
    lookup: {
      relatedObject: 'Related object',
      newHelp: 'Records of this object can be linked.',
      editHelp: 'The target object can’t be changed.',
      chooseObject: 'Choose an object…',
      anyObject: 'Any object (*)',
      cascadeDelete: 'Delete with the related record',
      cascadeHelp: 'Master-detail: deleting the referenced record also deletes this one.',
    },
    formula: {
      resultType: 'Result type',
      insertField: 'Insert field',
      chooseField: 'Choose a field to insert…',
      /** Label of the input that holds the formula expression. */
      formula: 'Formula',
      help: 'Recalculated automatically whenever a record is saved.',
    },
    rollup: {
      /** {object}: the parent object's name. */
      noChildren: 'No object has a lookup to {object} yet. Add a lookup field pointing to {object} on a child object first.',
      childObject: 'Child object',
      relationshipField: 'Relationship field',
      relationshipHelp: 'Lookup on the child that points to {object}.',
      /** Aggregate function (sum, average, …) of the roll-up. */
      fn: 'Function',
      field: 'Field to aggregate',
      chooseNumeric: 'Choose a numeric field…',
      filter: 'Only include child records where (optional)',
    },
    precision: 'Decimal places',
    precisionCurrencyHelp: 'Defaults to 2.',
    precisionHelp: 'Leave empty for the default.',
    defaultValue: 'Default value',
    /** The placeholders are template code. */
    defaultValueHelp: 'Applied to new records. Templates work too, e.g. {today}, {addDays} or {userId} (the creating user).',
    noDefault: 'No default',
    /** Default value of a checkbox field. */
    checked: 'Checked',
    /** Default value of a checkbox field. */
    unchecked: 'Unchecked',
    helpText: 'Help text',
    helpTextHelp: 'Shown as a hint next to the field.',
    /** {capability}: name of the role capability, as shown in Roles & Permissions. */
    sensitiveHint: 'Only roles with “{capability}” can see or edit this field.',
  },

  /** “Details & behavior” tab. */
  layout: {
    saved: 'Details & behavior saved',
    problems: {
      labels: 'Labels are required.',
      nameTemplate: 'Enter a name template.',
      timeline: 'Choose both timeline fields or neither.',
    },
    recordNameHelp: 'How records are titled in lists, lookups and search.',
    recordNameSource: 'Record name source',
    useField: 'Use a text field',
    useTemplate: 'Build from a template',
    nameField: 'Name field',
    nameTemplate: 'Name template',
    /** {placeholder} and {example} are template code. */
    nameTemplateHelp: 'Use {placeholder} placeholders, e.g. {example}.',
    /** Section heading: settings of list, Kanban, calendar and timeline views. */
    views: 'Views',
    statusField: 'Status field',
    statusFieldHelp: 'Picklist that drives the path bar and default Kanban grouping.',
    dateField: 'Calendar date field',
    dateFieldHelp: 'Default date for calendar views.',
    timelineStart: 'Timeline start',
    timelineStartHelp: 'Start and end dates for timeline (Gantt) views.',
    timelineEnd: 'Timeline end',
    /** Section heading: highlight fields, list columns and duplicate-check fields. */
    layout: 'Fields & columns',
    highlightFields: 'Highlight fields ({count}/{max})',
    highlightFieldsHelp: 'Key fields shown in search results and used by agents. They are the record header until a page layout is saved.',
    listColumns: 'List columns ({count}/{max})',
    listColumnsHelp: 'Default columns of list views.',
    duplicateCheck: 'Duplicate check ({count}/{max})',
    duplicateCheckHelp: 'Saving a record whose value matches another record (case-insensitive) asks for confirmation.',
  },

  /** Validation rules tab. */
  rules: {
    /** {object}: object name inside the sentence, e.g. “opportunity”. */
    intro: 'Rules are checked whenever a {object} is saved. Up to {max} rules.',
    newRule: 'New rule',
    empty: 'No validation rules',
    emptyHelp: 'Add a rule to block saves that break your data standards, e.g. a negative amount or a missing close date.',
    errorCondition: 'Error condition',
    /** Column header: the error message of a rule. */
    message: 'Message',
    /** Accessible name of the switch that turns a rule on or off. */
    activeLabel: '{name} active',
    activated: '{name} activated',
    deactivated: '{name} deactivated',
    deleteTitle: 'Delete “{name}”?',
    deleteMessage: 'Records will no longer be checked against this rule.',
    deleteConfirm: 'Delete rule',
    deleted: 'Validation rule deleted',
  },

  ruleForm: {
    newTitle: 'New validation rule',
    editTitle: 'Edit “{name}”',
    save: 'Save rule',
    created: 'Validation rule created',
    saved: 'Validation rule saved',
    name: 'Rule name',
    conditionHelp: 'A formula that returns TRUE when the record is invalid — the save is then rejected with the message below.',
    errorMessage: 'Error message',
  },

  /** Object detail page. */
  detail: {
    /** Link back to the list of objects. */
    back: 'Objects',
    backToObjects: 'Back to objects',
    notFound: 'Object not found',
    notFoundHelp: 'It may have been deleted, or you may not have access to it.',
    viewRecords: 'View records',
    deleteObject: 'Delete object',
    deleteTitle: 'Delete {label}?',
    /** {object}: the object's name. */
    deleteMessage: 'This permanently deletes the {object} object together with all of its records, automations and list views. This cannot be undone.',
    deleted: 'Object deleted',
    tabs: {
      fields: 'Fields ({count})',
      /** Object settings: labels, icon, record name, view defaults, highlight and list fields. */
      layout: 'Details & behavior',
      /** Drag-and-drop editor of record pages. */
      pageLayouts: 'Page layouts',
      rules: 'Validation rules ({count})',
    },
  },
};
