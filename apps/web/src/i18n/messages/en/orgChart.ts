import { plural } from '../../plural.ts';

export default {
  title: 'Org chart',
  /** Number of people, named with the employee object's labels as they appear mid-sentence: {label} singular, {pluralLabel} plural. */
  objectCount: plural({ one: '{count} {label}', other: '{count} {pluralLabel}' }),
  employeeCount: plural({ one: '{count} employee', other: '{count} employees' }),
  departmentCount: plural({ one: '{count} department', other: '{count} departments' }),
  managerCount: plural({ one: '{count} manager', other: '{count} managers' }),

  searchPlaceholder: 'Search people…',
  searchLabel: 'Search people',
  department: 'Department',
  allDepartments: 'All departments',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',

  /** Accessible name of the org chart tree. */
  reportingLines: 'Reporting lines',
  /** Button label; {count} is the number of direct reports. */
  expandTeam: "Expand {name}'s team ({count})",
  /** Button label; {count} is the number of direct reports. */
  collapseTeam: "Collapse {name}'s team ({count})",
  directReports: plural({ one: '{count} direct report', other: '{count} direct reports' }),

  empty: {
    title: 'No employees yet',
    body: 'Add employees with a manager to build the org chart.',
    /** {objects}: the employee object's plural label as it appears mid-sentence. */
    bodyFor: 'Add {objects} with a manager to build the org chart.',
  },

  matchingPeople: 'Matching people',
  truncated: 'Showing the first {limit} of {total} matches.',
  noMatches: 'No one matches.',
};
