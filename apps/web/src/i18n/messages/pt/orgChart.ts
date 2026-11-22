import type { Translation } from '../../index.ts';

export default {
  title: 'Organograma',
  objectCount: { one: '{count} {label}', other: '{count} {pluralLabel}' },
  employeeCount: { one: '{count} funcionário', other: '{count} funcionários' },
  departmentCount: { one: '{count} departamento', other: '{count} departamentos' },
  managerCount: { one: '{count} gerente', other: '{count} gerentes' },

  searchPlaceholder: 'Pesquisar pessoas…',
  searchLabel: 'Pesquisar pessoas',
  department: 'Departamento',
  allDepartments: 'Todos os departamentos',
  expandAll: 'Expandir tudo',
  collapseAll: 'Recolher tudo',

  reportingLines: 'Estrutura hierárquica',
  expandTeam: 'Expandir a equipe de {name} ({count})',
  collapseTeam: 'Recolher a equipe de {name} ({count})',
  directReports: { one: '{count} subordinado direto', other: '{count} subordinados diretos' },

  empty: {
    title: 'Nenhum funcionário ainda',
    body: 'Adicione funcionários com um gerente para montar o organograma.',
    bodyFor: 'Adicione {objects} com um gerente para montar o organograma.',
  },

  matchingPeople: 'Pessoas correspondentes',
  truncated: 'Mostrando os primeiros {limit} de {total} resultados.',
  noMatches: 'Nenhuma pessoa encontrada.',
} satisfies Translation['orgChart'];
