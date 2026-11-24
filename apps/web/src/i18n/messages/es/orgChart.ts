import type { Translation } from '../../index.ts';

export default {
  title: 'Organigrama',
  objectCount: { one: '{count} {label}', other: '{count} {pluralLabel}' },
  employeeCount: { one: '{count} empleado', other: '{count} empleados' },
  departmentCount: { one: '{count} departamento', other: '{count} departamentos' },
  managerCount: { one: '{count} responsable', other: '{count} responsables' },

  searchPlaceholder: 'Buscar personas…',
  searchLabel: 'Buscar personas',
  department: 'Departamento',
  allDepartments: 'Todos los departamentos',
  expandAll: 'Expandir todo',
  collapseAll: 'Contraer todo',

  reportingLines: 'Líneas jerárquicas',
  expandTeam: 'Expandir el equipo de {name} ({count})',
  collapseTeam: 'Contraer el equipo de {name} ({count})',
  directReports: { one: '{count} persona a cargo', other: '{count} personas a cargo' },

  empty: {
    title: 'Todavía no hay empleados',
    body: 'Añada empleados con un responsable para crear el organigrama.',
    bodyFor: 'Añada {objects} con un responsable para crear el organigrama.',
  },

  matchingPeople: 'Personas coincidentes',
  truncated: 'Se muestran las primeras {limit} de {total} coincidencias.',
  noMatches: 'Ninguna persona coincide.',
} satisfies Translation['orgChart'];
