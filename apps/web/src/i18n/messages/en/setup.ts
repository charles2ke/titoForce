export default {
  /** Name of the administration area where the org is configured. */
  title: 'Setup',
  nav: {
    groups: {
      dataModel: 'Data model',
      usersAccess: 'Users & access',
      /** Group of settings that shape what users see (apps and their navigation). */
      experience: 'Experience',
      automation: 'Automation',
      ai: 'AI',
      /** Group for sandboxes (copies of the organization for building and testing) and deployments. */
      environments: 'Environments',
    },
    objects: 'Objects & Fields',
    users: 'Users',
    roles: 'Roles & Permissions',
    apps: 'Apps',
    /** Setup page where administrators translate object, field, picklist, layout and app labels. */
    translations: 'Translations',
    automations: 'Automations',
    approvalProcesses: 'Approval Processes',
    runs: 'Run History',
    agents: 'Agents',
    sandboxes: 'Sandboxes',
  },
  noAccess: {
    title: 'You don’t have access to this area',
    message: 'This part of Setup requires additional permissions. Ask an administrator to update your role if you need it.',
  },
};
