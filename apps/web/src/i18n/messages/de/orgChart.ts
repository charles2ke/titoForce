import type { Translation } from '../../index.ts';

export default {
  title: 'Organigramm',
  objectCount: { one: '{count} {label}', other: '{count} {pluralLabel}' },
  employeeCount: { one: '{count} Mitarbeiter', other: '{count} Mitarbeiter' },
  departmentCount: { one: '{count} Abteilung', other: '{count} Abteilungen' },
  managerCount: { one: '{count} Führungskraft', other: '{count} Führungskräfte' },

  searchPlaceholder: 'Personen suchen…',
  searchLabel: 'Personen suchen',
  department: 'Abteilung',
  allDepartments: 'Alle Abteilungen',
  expandAll: 'Alle aufklappen',
  collapseAll: 'Alle zuklappen',

  reportingLines: 'Berichtslinien',
  expandTeam: 'Team von {name} aufklappen ({count})',
  collapseTeam: 'Team von {name} zuklappen ({count})',
  directReports: { one: '{count} direkt unterstellte Person', other: '{count} direkt unterstellte Personen' },

  empty: {
    title: 'Noch keine Mitarbeiter',
    body: 'Fügen Sie Mitarbeiter mit Vorgesetzten hinzu, um das Organigramm aufzubauen.',
    bodyFor: 'Fügen Sie {objects} mit Vorgesetzten hinzu, um das Organigramm aufzubauen.',
  },

  matchingPeople: 'Passende Personen',
  truncated: 'Die ersten {limit} von {total} Treffern werden angezeigt.',
  noMatches: 'Keine Treffer.',
} satisfies Translation['orgChart'];
