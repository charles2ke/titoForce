import type { Translation } from '../../index.ts';

export default {
  title: 'Organigramme',
  objectCount: { one: '{count} {label}', other: '{count} {pluralLabel}' },
  employeeCount: { one: '{count} employé', other: '{count} employés' },
  departmentCount: { one: '{count} service', other: '{count} services' },
  managerCount: { one: '{count} responsable', other: '{count} responsables' },

  searchPlaceholder: 'Rechercher des personnes…',
  searchLabel: 'Rechercher des personnes',
  department: 'Service',
  allDepartments: 'Tous les services',
  expandAll: 'Tout développer',
  collapseAll: 'Tout réduire',

  reportingLines: 'Liens hiérarchiques',
  expandTeam: 'Développer l’équipe : {name} ({count})',
  collapseTeam: 'Réduire l’équipe : {name} ({count})',
  directReports: { one: '{count} subordonné direct', other: '{count} subordonnés directs' },

  empty: {
    title: 'Aucun employé pour le moment',
    body: 'Ajoutez des employés avec leur responsable pour construire l’organigramme.',
    bodyFor: 'Ajoutez des {objects} avec leur responsable pour construire l’organigramme.',
  },

  matchingPeople: 'Personnes correspondantes',
  truncated: 'Affichage des {limit} premiers résultats sur {total}.',
  noMatches: 'Personne ne correspond.',
} satisfies Translation['orgChart'];
