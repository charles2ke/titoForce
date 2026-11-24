import { plural } from '../../plural.ts';

/** Reports list, report page and report builder. */
export default {
  title: 'Reports',
  subtitle: 'Charts and KPIs over your records. Everyone sees results for the records they can access.',
  newReport: 'New report',
  notFound: 'Report not found',
  backToList: 'Back to reports',
  filters: 'Filters',
  /** Built-in field every record has: when it was created. */
  createdDate: 'Created Date',
  /** Chart types. */
  charts: {
    bar: 'Bar',
    column: 'Column',
    line: 'Line',
    pie: 'Pie',
    donut: 'Donut',
    kpi: 'KPI',
    table: 'Table',
    funnel: 'Funnel',
  },

  /** One-line description of what a report calculates, e.g. "Sum of Amount by Stage". {field} and {group} are field labels. */
  summary: {
    recordCount: 'Record count',
    sum: 'Sum of {field}',
    avg: 'Average of {field}',
    min: 'Min of {field}',
    max: 'Max of {field}',
    /** {metric} is one of the phrases above. */
    byGroup: '{metric} by {group}',
  },

  list: {
    search: 'Search reports',
    searchPlaceholder: 'Search reports…',
    filterByObject: 'Filter by object',
    allObjects: 'All objects',
    filterByApp: 'Filter by app',
    allApps: 'All apps',
    count: plural({ one: '{count} report', other: '{count} reports' }),
    emptyTitle: 'No reports yet',
    emptyAnalyst: 'Create a report to chart and summarize your records.',
    emptyViewer: 'Reports created by your analysts and admins will appear here.',
    noMatchTitle: 'No reports match',
    clearFilters: 'Clear filters',
    noMatchMessage: 'Try a different search, object or app.',
    /** Tooltip; {date} is a date and time. */
    lastModified: 'Last modified {date}',
    actionsFor: 'Actions for {name}',
    deleteTitle: 'Delete report?',
    deleteMessage: '“{name}” will be permanently deleted.',
    /** {names} is a comma-separated list of dashboard names. */
    usedOnDashboards: plural({
      one: 'It is used on {count} dashboard ({names}), where it will show as deleted until it is removed.',
      other: 'It is used on {count} dashboards ({names}), where it will show as deleted until it is removed.',
    }),
    deleted: 'Report “{name}” deleted',
  },

  view: {
    /** Group of records without a value in the grouped field. */
    blank: '(blank)',
    notFoundMessage: 'It may have been deleted, or you may not have access to its records.',
    unavailable: 'This report is not available.',
    fix: 'Fix report',
    exportCsv: 'Export CSV',
    /** Name of the exported file when the report name cannot be used (lower case, no spaces; ".csv" is added). */
    csvFileName: 'report',
    /** What the report calculates (column heading, and label of the calculation summary). */
    metric: 'Metric',
    /** Label of how the report groups its records. */
    grouping: 'Grouping',
    groupedBy: 'Grouped by {field}',
    notGrouped: 'Not grouped',
    noConditions: 'No conditions',
    conditionCount: plural({ one: '{count} condition', other: '{count} conditions' }),
    /** Followed by a relative time, e.g. "Modified 5m ago". */
    modified: 'Modified',
    /** {time} is a time of day. */
    resultsAsOf: 'Results as of {time}, counting only the records you can access.',
    /** Column heading for a date grouping, e.g. "Close Date (month)"; {field} is the date field. */
    groupInterval: {
      day: '{field} (day)',
      month: '{field} (month)',
      quarter: '{field} (quarter)',
      year: '{field} (year)',
    },
    /** Title of the table with the report's numbers. */
    data: 'Data',
    groupCount: plural({ one: '{count} group', other: '{count} groups' }),
    percentOfTotal: '% of total',
    noMatchingRecords: 'No matching records',
    overallAverage: 'Overall average',
    overallMinimum: 'Overall minimum',
    overallMaximum: 'Overall maximum',
    /** English uses the same form for every count. */
    limited: plural({ other: 'Showing the first {count} groups. The total covers all matching records.' }),
  },

  builder: {
    editTitle: 'Edit report',
    newSubtitle: 'Choose the records, what to measure and how to group it, then pick a chart.',
    save: 'Save report',
    create: 'Create report',
    saved: 'Report “{name}” saved',
    created: 'Report “{name}” created',
    discardTitle: 'Discard changes?',
    discardMessage: 'Your changes to this report have not been saved.',
    /** Button: throw away the unsaved changes. */
    discard: 'Discard',
    /** {error} is the server's explanation. */
    cannotRun: 'This report cannot run as saved ({error}). Fix it below and save.',
    namePlaceholder: 'e.g. Open pipeline by stage',
    nameRequired: 'Name is required',
    objectHelp: 'Changing the object resets the filters, grouping and measured field.',
    chooseObject: 'Choose an object',
    chooseObjectOption: 'Choose an object…',
    /** {name} is the API name of an object or field that was deleted or can no longer be accessed. */
    unavailable: '{name} (unavailable)',
    /** {name} is the API name of a field that was deleted or can no longer be accessed. */
    notAvailable: '{name} (not available)',
    /** Field label: the app the report is listed under. */
    app: 'App',
    appHelp: 'Lists the report under an app.',
    filtersHelp: 'Conditions without a value are ignored. Each viewer only counts the records they have access to.',
    filtersNeedObject: 'Choose an object to add filters.',
    groupAndMeasure: 'Group & measure',
    groupBy: 'Group by',
    noGrouping: 'None (single value)',
    /** Option group in the "Group by" list: the object's own fields. */
    fieldOptions: 'Fields',
    /** Option group in the "Group by" list: built-in fields (owner, created and modified dates). */
    systemOptions: 'System',
    groupFieldGone: 'This field is no longer available. Choose another one.',
    dateInterval: 'Date interval',
    /** Date grouping intervals. */
    intervals: {
      day: 'Day',
      month: 'Month',
      quarter: 'Quarter',
      year: 'Year',
    },
    /** Label of the calculation picker (what the report measures). */
    measure: 'Measure',
    /** {object} is an object label. */
    noNumericFields: '{object} has no numeric fields, so only record counts are available.',
    /** Calculations. */
    fns: {
      count: 'Count of records',
      sum: 'Sum',
      avg: 'Average',
      min: 'Minimum',
      max: 'Maximum',
    },
    /** The numeric field the calculation uses, e.g. Sum — of field: Amount. */
    ofField: 'Of field',
    chooseNumericField: 'Choose a numeric field',
    chooseFieldOption: 'Choose a field…',
    sortBy: 'Sort groups by',
    sorts: {
      natural: 'Natural order (picklist order, dates in order)',
      /** Alphabetical by group label. */
      label: 'Label (A–Z)',
      valueDesc: 'Value (highest first)',
      valueAsc: 'Value (lowest first)',
    },
    /** Maximum number of groups to show. */
    limit: 'Show at most',
    limitHelp: 'Number of groups (1–100). Leave empty to show all.',
    limitPlaceholder: 'All groups',
    limitError: 'Enter a whole number from 1 to 100, or leave it empty',
    chart: 'Chart',
    chartType: 'Chart type',
    kpiGroupedHint: 'A KPI shows only the overall value. The grouped breakdown is still listed in the report’s data table.',
    ungroupedHint: 'Without grouping the report has a single value, so a KPI usually works best.',
    preview: 'Preview',
    runningPreview: 'Running preview…',
    previewRows: plural({ one: '{count} row', other: '{count} rows' }),
    /** After the row count, e.g. "5 rows · total $12,000" (count and sum reports). */
    previewTotal: 'total {value}',
    /** After the row count, e.g. "5 rows · overall 42" (average, minimum and maximum reports). */
    previewOverall: 'overall {value}',
    backToReport: 'Back to report',
    noPermissionTitle: 'You don’t have permission to edit reports',
    /** "Setup" and "Manage Automations" are permission names. */
    noPermissionMessage: 'Creating and editing reports requires the Setup or Manage Automations permission. You can still view and run existing reports.',
    deletedMessage: 'It may have been deleted.',
    loadFailed: 'This report could not be loaded.',
    noObjectsTitle: 'No objects to report on',
    noObjectsMessage: 'You need read access to at least one object to build a report.',
  },
};
