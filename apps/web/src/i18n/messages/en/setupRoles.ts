import { plural } from '../../plural.ts';

export default {
  title: 'Roles & Permissions',
  subtitle: 'Control what each role can see and do, object by object.',
  newRole: 'New role',
  empty: 'No roles yet',
  /** Accessible name of the list of roles. */
  listLabel: 'Roles',
  /** Badge on roles with Setup (administrator) access. */
  admin: 'Admin',
  /** Number of users who have the role. */
  userCount: plural({ one: '{count} user', other: '{count} users' }),
  roleName: 'Role name',

  /** Access levels for reading, editing and deleting the records of an object. */
  levels: {
    /** No access to any record. */
    none: 'None',
    own: 'Own records',
    all: 'All records',
  },

  /** Permissions that are not tied to an object. */
  capabilities: {
    title: 'Capabilities',
    adminAlwaysOn: 'Always on for the administrator role, so nobody gets locked out.',
    setup: {
      label: 'Administrator (Setup access)',
      help: 'Manage objects, fields, users, roles and apps. Also grants automations and AI agents.',
    },
    viewSensitive: {
      label: 'View sensitive fields',
      help: 'See and edit fields marked as sensitive, such as salaries.',
    },
    manageAutomations: {
      label: 'Manage automations',
      help: 'Create and edit automations, approval processes, reports and dashboards, and see automation run history.',
    },
    manageAgents: {
      label: 'Manage AI agents',
      help: 'Create and edit AI agents and see every agent run.',
    },
  },

  /** Editing an existing role. */
  editor: {
    deleteRole: 'Delete role',
    deleteTitle: 'Delete {name}?',
    deleteMessage: 'The role and its permissions are permanently deleted.',
    adminNotDeletable: 'The administrator role can’t be deleted.',
    reassignUsers: plural({
      one: 'Assign the {count} user with this role to another role first.',
      other: 'Assign the {count} users with this role to another role first.',
    }),
    saved: '{name} saved',
    deleted: '{name} deleted',
    removeOwnSetupTitle: 'Remove your own Setup access?',
    removeOwnSetupMessage: 'You have this role, so after saving you will no longer be able to open Setup.',
    saveAnyway: 'Save anyway',
    unsavedChanges: 'Unsaved changes',
    /** Button: throw away unsaved changes. */
    discard: 'Discard',
    save: 'Save role',
  },

  /** Table of per-object permissions of a role. */
  objectPermissions: {
    title: 'Object permissions',
    /** {own}: the access level “Own records”. */
    help: '“{own}” means records the user owns. Objects without their own settings use the default row.',
    /** Variant of `help` for roles with Setup access. {own}: the access level “Own records”. */
    helpSetup: '“{own}” means records the user owns. Objects without their own settings use the default row. Setup access doesn’t bypass these settings.',
    /** First row of the table: the permissions of all objects that have no row of their own. */
    defaultRow: 'Default for other objects',
    /** Column headers: what users with the role may do with the records of an object. */
    columns: {
      read: 'Read',
      create: 'Create',
      edit: 'Edit',
      delete: 'Delete',
    },
    /** Accessible names of the permission controls in a row; {object} is the row's object name. */
    controls: {
      read: '{object}: read',
      create: '{object}: create',
      edit: '{object}: edit',
      delete: '{object}: delete',
    },
    /** Badge: the object uses the permissions of the default row. */
    inherited: 'Default',
    unknownObject: 'Unknown object',
    unknownObjectHelp: 'This object no longer exists or you can’t read it. Remove the row if the object was deleted — otherwise saving fails.',
    removeRow: 'Remove permissions for {object}',
    useDefault: 'Use default for {object}',
  },

  /** Dialog to create a role. */
  createForm: {
    title: 'New role',
    create: 'Create role',
    created: '{name} created',
    /** Example role name. */
    namePlaceholder: 'Customer Success',
    roleId: 'Role id',
    /** {example} is an example identifier. */
    roleIdHelp: 'Permanent identifier, e.g. {example}.',
    idInvalid: 'Use 2–40 lowercase letters, numbers and underscores, starting with a letter.',
    idExists: 'A role with this id already exists.',
    startFrom: 'Start from',
    startFromHelp: 'Copy the permissions of an existing role, or start with no access.',
    /** Option of “Start from”: begin with no permissions at all. */
    noAccess: 'No access',
  },
};
