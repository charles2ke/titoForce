import { plural } from '../../plural.ts';

/** Setup → Sandboxes: copies of the production organization for building and testing changes, then deploying them. */
export default {
  title: 'Sandboxes',
  subtitle: 'Copies of this organization for building and testing changes without affecting anyone. Deploy what works to production.',
  newSandbox: 'New sandbox',
  /** {count}: sandboxes that exist; {max}: how many are allowed. */
  usage: '{count} of {max} sandboxes',
  limitReached: 'This organization has the maximum number of sandboxes. Delete one to create another.',
  unavailable: 'Sandboxes are managed from the production organization.',
  empty: {
    title: 'No sandboxes yet',
    message: 'Create a sandbox to try out new fields, page layouts, automations or agents before your users see them.',
  },
  /** People sign in to a sandbox with the email and password they had in production when it was copied. */
  signInHint: 'Sandboxes open in a new tab. Sign in with the email and password you had in production when the sandbox was copied.',

  columns: {
    sandbox: 'Sandbox',
    type: 'Copy',
    status: 'Status',
    createdBy: 'Created by',
    /** When production was last copied into the sandbox (created or refreshed). */
    copied: 'Copied',
  },

  types: {
    developer: {
      label: 'Developer',
      help: 'Configuration and users. Quick to create; starts without records.',
    },
    full: {
      label: 'Full copy',
      help: 'Configuration, users and all records. Takes longer for large organizations.',
    },
  },

  status: {
    active: 'Ready',
    provisioning: 'Copying…',
    refreshing: 'Refreshing…',
    suspended: 'Suspended',
    failed: 'Copy failed',
  },

  actions: {
    /** Opens the sandbox in a new tab. */
    open: 'Open',
    /** Opens the page that compares the sandbox with production. */
    deploy: 'Compare and deploy',
    refresh: 'Refresh',
    delete: 'Delete',
    /** Accessible name of a row's action menu. {name}: sandbox name. */
    more: 'More actions for {name}',
  },

  create: {
    title: 'New sandbox',
    name: 'Name',
    /** {slug}: the organization ID the sandbox will get, such as "acme--dev". */
    nameHelp: 'Letters, numbers and hyphens, such as "dev" or "uat". People open it as {slug}.',
    invalidName: 'Use up to 20 letters, numbers and single hyphens, starting and ending with a letter or number.',
    type: 'What to copy',
    submit: 'Create sandbox',
    /** {name}: sandbox name. */
    started: 'Copying production into sandbox {name}…',
  },

  ready: 'Sandbox {name} is ready',
  failed: 'Copying sandbox {name} failed',

  refresh: {
    title: 'Refresh sandbox {name}?',
    message: 'Everything in the sandbox is replaced by a new copy of production. Changes that were not deployed are lost, and everyone signed in to the sandbox is signed out.',
    confirm: 'Refresh sandbox',
    started: 'Refreshing sandbox {name}…',
  },

  delete: {
    title: 'Delete sandbox {name}?',
    message: 'The sandbox and everything in it are deleted. Changes that were not deployed are lost. This cannot be undone.',
    confirm: 'Delete sandbox',
    done: 'Sandbox {name} deleted',
  },

  deploy: {
    back: 'Sandboxes',
    /** Page title. {name}: sandbox name. */
    title: 'Deploy from {name}',
    subtitle: 'Choose the changes to copy into production. Deployments add and update configuration; they never delete anything in production.',
    notReady: 'The sandbox is not ready yet. Try again when it has finished copying.',
    showUnchanged: 'Show unchanged',
    selectAll: 'Select all changes',
    /** Accessible name of a row checkbox. {name}: component name. */
    select: 'Select {name}',
    noChanges: {
      title: 'Nothing to deploy',
      message: 'The sandbox has the same configuration as production.',
    },
    columns: {
      component: 'Component',
      type: 'Type',
      object: 'Object',
      change: 'Change',
    },
    /** Kinds of configuration that can be deployed. */
    types: {
      object: 'Object',
      layout: 'Page layout',
      translation: 'Translations',
      app: 'App',
      automation: 'Automation',
      approval_process: 'Approval process',
      agent: 'Agent',
      report: 'Report',
      dashboard: 'Dashboard',
      role: 'Role',
    },
    statuses: {
      new: 'New',
      changed: 'Changed',
      unchanged: 'Unchanged',
      /** The component exists in production but not in the sandbox. Deployments leave it alone. */
      production_only: 'Only in production',
    },
    /** What changed inside an object (its fields). */
    fields: {
      added: plural({ one: '{count} new field', other: '{count} new fields' }),
      changed: plural({ one: '{count} changed field', other: '{count} changed fields' }),
      productionOnly: plural({ one: '{count} field only in production', other: '{count} fields only in production' }),
    },
    /** What changed in a language's translations (its labels). */
    labels: {
      added: plural({ one: '{count} new label', other: '{count} new labels' }),
      changed: plural({ one: '{count} changed label', other: '{count} changed labels' }),
      productionOnly: plural({ one: '{count} label only in production', other: '{count} labels only in production' }),
    },
    selected: plural({ one: '{count} component selected', other: '{count} components selected' }),
    submit: 'Deploy to production',
    confirm: {
      title: 'Deploy to production?',
      message: plural({
        one: '{count} component is copied into production and takes effect for everyone at once. Deployments cannot be undone, but you can deploy again.',
        other: '{count} components are copied into production and take effect for everyone at once. Deployments cannot be undone, but you can deploy again.',
      }),
      confirm: 'Deploy',
    },
    done: plural({ one: 'Deployed {count} component to production', other: 'Deployed {count} components to production' }),
  },

  history: {
    title: 'Deployment history',
    empty: 'Nothing has been deployed to this organization yet.',
    columns: {
      date: 'Date',
      from: 'From sandbox',
      by: 'Deployed by',
      components: 'Components',
      status: 'Result',
    },
    componentCount: plural({ one: '{count} component', other: '{count} components' }),
    succeeded: 'Deployed',
    failed: 'Failed',
  },
};
