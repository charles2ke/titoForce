import { plural } from '../../plural.ts';

/** Object list page: list views, toolbar, columns and CSV import. */
export default {
  /** Ways to display a list (also shown as a tag next to saved views). */
  viewType: {
    table: 'Table',
    kanban: 'Kanban',
    calendar: 'Calendar',
    timeline: 'Timeline',
  },

  views: {
    /** Built-in view listing every record, e.g. "All Accounts" ({plural} is the object's plural label). */
    all: 'All {plural}',
    pickerLabel: 'Select list view',
    menuLabel: 'List views',
    shared: 'Shared views',
    mine: 'My views',
    others: "Other users' views",
    actions: 'View actions',
    /** Menu item: rename the current list view. */
    rename: 'Rename',
    delete: 'Delete view',
    saveAs: 'Save as view',
    saveAsTitle: 'Save as new view',
    renameTitle: 'Rename view',
    /** Suggested name when saving a copy of a view. */
    copyName: '{name} (copy)',
    nameLabel: 'View name',
    nameRequired: 'Give the view a name.',
    shareWithEveryone: 'Share with everyone',
    savedNew: 'Saved view “{name}”',
    saved: 'View saved',
    deleteTitle: 'Delete list view?',
    deleteMessage: '“{name}” will be removed.',
    deleteMessageShared: '“{name}” will be removed for everyone.',
    deleted: 'View deleted',
  },

  columns: {
    button: 'Columns',
    /** e.g. "6 of 20 columns shown" */
    shown: '{shown} of {max} columns shown',
    reset: 'Reset to default',
  },

  toolbar: {
    displayAs: 'Display as',
    groupBy: 'Group by',
    /** Label of the picker that chooses which date field places records on the calendar. */
    dateField: 'Date',
    /** {plural} is the object's plural label in lower case, e.g. "Search accounts…". */
    searchPlaceholder: 'Search {plural}…',
    searchLabel: 'Search {plural}',
    filters: 'Filters',
    /** Filters button with the number of active filter rules. */
    filtersCount: 'Filters ({count})',
    clearFilters: 'Clear filters',
    resetToView: 'Reset to view',
    filteredBy: 'Filtered by:',
  },

  import: {
    /** e.g. "Import accounts" */
    title: 'Import {plural}',
    instructions:
      'The first row must contain column headers matching {label} field labels or API names. Lookups and users can be given by name, id or (for users) email. Up to {max} rows.',
    file: 'CSV file',
    contentsOf: 'Contents of {file}',
    paste: 'Or paste CSV',
    /** Import result; {singular}/{plural} are the object's labels in lower case. */
    created: plural({ one: 'Created {count} {singular}.', other: 'Created {count} {plural}.' }),
    /** Import result when some rows failed; {rows} is list.import.rows, e.g. "Created 8 accounts; 2 rows failed." */
    createdWithFailures: plural({ one: 'Created {count} {singular}; {rows} failed.', other: 'Created {count} {plural}; {rows} failed.' }),
    rows: plural({ one: '{count} row', other: '{count} rows' }),
    /** Error for one CSV row, e.g. "Row 4: Name is required". */
    rowError: 'Row {row}: {message}',
    columnMapping: 'Column mapping',
    /** Shown next to a CSV column that does not match any field. */
    ignored: 'ignored',
  },

  objectNotFound: {
    title: 'Object not found',
    body: 'It may have been deleted, or you may not have access to it.',
  },
};
