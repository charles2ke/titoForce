import { plural } from '../../plural.ts';

/** List presentations: table, kanban board, calendar and timeline. */
export default {
  /** Placeholder for a record whose name is empty. */
  noName: '(no name)',
  /** Button/legend: jump to (or mark) the current date. */
  today: 'Today',

  table: {
    selectAll: 'Select all on this page',
    /** Checkbox label for one row; {name} is the record name. */
    selectRecord: 'Select {name}',
    rowActions: 'Actions for {name}',
    /** Number of selected rows in the bulk action bar. */
    selected: plural({ one: '{count} selected', other: '{count} selected' }),
    updateField: 'Update field',
    clearSelection: 'Clear selection',
    /** {plural} is the object's plural label in lower case, e.g. "No accounts found". */
    emptyTitle: 'No {plural} found',
    emptyFiltered: 'Try a different search or remove filters.',
    /** {label} is the object's label in lower case. */
    emptyCreate: 'Create your first {label} to get started.',
    /** {label} is the object's label in lower case, e.g. "Delete account?". */
    deleteTitle: 'Delete {label}?',
    deleteMessage: '“{name}” will be permanently deleted.',
    deleted: 'Deleted “{name}”',
    bulkDeleteTitle: plural({ one: 'Delete {count} record?', other: 'Delete {count} records?' }),
    bulkDeleteMessage: 'This cannot be undone. Records you are not allowed to delete are skipped.',
    bulkDeleted: plural({ one: 'Deleted {count} record', other: 'Deleted {count} records' }),
    /** {done}/{failed} are record counts; {error} is the first server error message. */
    bulkDeletePartial: 'Deleted {done}; {failed} could not be deleted: {error}',
    /** Bulk edit dialog title; {singular}/{plural} are the object's labels in lower case, e.g. "Update 3 accounts". */
    bulkUpdateTitle: plural({ one: 'Update {count} {singular}', other: 'Update {count} {plural}' }),
    /** Button: apply the bulk update. */
    update: 'Update',
    newValue: 'New value',
    newValueHelp: 'Leave empty to clear the field.',
    bulkUpdated: plural({ one: 'Updated {count} record', other: 'Updated {count} records' }),
    /** {done}/{failed} are record counts; {error} is the first server error message. */
    bulkUpdatePartial: 'Updated {done}; {failed} failed: {error}',
  },

  kanban: {
    /** {field} is the API name of the configured group-by field. */
    needsPicklist: 'Kanban boards need a picklist to group by; “{field}” is not one.',
    /** Lane for records without a value; {field} is the group-by field label in lower case, e.g. "No stage". */
    noValue: 'No {field}',
    truncated: 'Showing the first {shown} of {total} records. Add filters to narrow the board.',
    /** Accessible label of the board, e.g. "Opportunities by Stage". */
    boardLabel: '{plural} by {field}',
    /** Button that moves a card to another lane; {name} is the record name. */
    move: 'Move {name}',
    dropHere: 'Drop cards here',
  },

  calendar: {
    /** {field} is the API name of the configured date field. */
    needsDateField: 'Calendar views need a date field; “{field}” is not one.',
    /** Next to the month title: which date field places records on the calendar, e.g. "by Close Date". */
    byField: 'by {field}',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    gridLabel: 'Calendar',
    /** Accessible label of a day cell, e.g. "Monday, March 2: 3 items". */
    dayItems: plural({ one: '{date}: {count} item', other: '{date}: {count} items' }),
    /** {label} is the object's label in lower case, e.g. "New task on Monday, March 2". */
    newOn: 'New {label} on {date}',
    /** Link that reveals the records that do not fit in a day cell. */
    more: plural({ one: '+{count} more', other: '+{count} more' }),
    truncated: 'Showing the first {shown} of {total} records in this range.',
  },

  timeline: {
    /** {label} is the object's label. */
    notConfigured: '{label} has no start/end dates configured for timelines.',
    /** Fallback names of the start and end date fields. */
    start: 'Start',
    end: 'End',
    /** Range of months shown, e.g. "Jan 2031 – Mar 2031". */
    range: '{start} – {end}',
    /** Buttons that move the timeline back or forward by a month. */
    earlier: 'Earlier',
    later: 'Later',
    /** {plural} is the object's plural label in lower case. */
    emptyTitle: 'No {plural} in this period',
    emptyBody: 'Use the arrows to look at other months.',
    /** Tooltip of a timeline bar, e.g. "Website relaunch: Jan 5, 2031 – Feb 20, 2031". */
    barTitle: '{name}: {start} – {end}',
    barTitleNoEnd: '{name}: {start} – no end date',
    truncated: 'Showing the first {shown} of {total} records in this period.',
  },
};
