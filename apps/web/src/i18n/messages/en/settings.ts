export default {
  title: 'My settings',

  profile: {
    title: 'Profile',
    /** The user's job title. */
    jobTitle: 'Title',
    /** {link}: a link labelled with profile.usersLink. */
    adminHint: 'Edit names, titles and roles in {link}.',
    /** Link to the Users page of Setup. */
    usersLink: 'Setup › Users',
    askAdmin: 'Ask an administrator to change your name, title or role.',
  },

  password: {
    title: 'Change password',
    current: 'Current password',
    new: 'New password',
    help: 'At least 8 characters.',
    confirm: 'Confirm new password',
    mismatch: 'Passwords do not match',
    submit: 'Update password',
    changed: 'Password changed. Your other sessions were signed out.',
  },

  language: {
    title: 'Language',
    help: 'The language of titoForce on every device you sign in to. Labels that your administrators have not translated stay in English.',
    /** Option: follow the language of the browser or phone. */
    browserDefault: 'Browser language ({language})',
  },

  defaultApp: {
    title: 'Default app',
    help: 'Where you land after signing in. Switching apps from the app launcher also updates this (saved in this browser).',
    /** {app}: name of the app. */
    changed: '{app} is now your default app',
  },

  ai: {
    title: 'AI provider',
    connected: 'Connected',
    offline: 'Offline mode',
    /** An AI provider that implements the OpenAI API. */
    openai: 'OpenAI-compatible',
    rulesEngine: 'Built-in rules engine',
    configuredBy: 'The provider is configured by an administrator through server environment variables.',
  },

  access: {
    title: 'Your access',
    capabilities: {
      setup: 'Administer setup',
      manageAutomations: 'Manage automations, reports & dashboards',
      manageAgents: 'Manage AI agents',
      viewSensitive: 'View sensitive fields',
    },
    /** Column header: permission to read the object's records. */
    read: 'Read',
    /** Column header: permission to create records of the object. */
    create: 'Create',
    /** Column header: permission to edit the object's records. */
    edit: 'Edit',
    /** Column header: permission to delete the object's records. */
    delete: 'Delete',
    /** Access level: all records of the object. */
    all: 'All',
    /** Access level: only the records the user owns. */
    own: 'Own',
    /** {own}: the access level label “Own”. */
    footnote: '“{own}” means records you own. Objects you cannot read are hidden.',
  },
};
