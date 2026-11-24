import type { Translation } from '../../index.ts';

export default {
  title: 'Setup',
  nav: {
    groups: {
      dataModel: 'Datenmodell',
      usersAccess: 'Benutzer & Zugriff',
      experience: 'Benutzeroberfläche',
      automation: 'Automatisierung',
      ai: 'KI',
      environments: 'Umgebungen',
    },
    objects: 'Objekte & Felder',
    users: 'Benutzer',
    roles: 'Rollen & Berechtigungen',
    apps: 'Apps',
    translations: 'Übersetzungen',
    automations: 'Automatisierungen',
    approvalProcesses: 'Genehmigungsprozesse',
    runs: 'Ausführungsverlauf',
    agents: 'Agenten',
    sandboxes: 'Sandboxes',
  },
  noAccess: {
    title: 'Sie haben keinen Zugriff auf diesen Bereich',
    message: 'Dieser Teil des Setups erfordert zusätzliche Berechtigungen. Bitten Sie bei Bedarf einen Administrator, Ihre Rolle anzupassen.',
  },
} satisfies Translation['setup'];
