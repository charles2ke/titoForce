export default {
  title: 'Users',
  subtitle: 'People who can sign in, their roles and access.',
  newUser: 'New user',
  searchLabel: 'Search users',
  searchPlaceholder: 'Search by name, email, title or role…',
  showInactive: 'Show inactive ({count})',
  noMatches: 'No users match your search',
  empty: 'No users',
  /** Job title of a user (column header and form label), e.g. “Account Executive”. */
  jobTitle: 'Title',
  /** Badge on the signed-in user's own row. */
  you: 'You',
  /** Badge on the service user that AI agents act as. */
  aiAgent: 'AI agent',
  editUser: 'Edit {name}',

  /** Dialog to create or edit a user. */
  form: {
    newTitle: 'New user',
    create: 'Create user',
    save: 'Save user',
    added: '{name} added',
    saved: '{name} saved',
    chooseRole: 'Choose a role…',
    invalidEmail: 'Enter a valid email address.',
    passwordTooShort: 'At least 8 characters.',
    agentNotice: 'This is the service user of the AI agents. Agents started by automations act as this user, so its role limits what they can do. It can’t sign in.',
    emailHelp: 'Used to sign in.',
    fullName: 'Full name',
    /** Example job title. */
    titlePlaceholder: 'Account Executive',
    roleHelp: 'Controls what the user can see and do.',
    ownRoleHelp: 'You can’t change your own role.',
    newPassword: 'New password',
    passwordHelp: 'At least 8 characters. Share it with the user securely.',
    ownPasswordHelp: 'Leave empty to keep the current password. Changing it signs you out everywhere.',
    userPasswordHelp: 'Leave empty to keep the current password. Changing it signs the user out.',
    cantDeactivateSelf: 'You can’t deactivate yourself.',
    inactiveHelp: 'Inactive users can’t sign in. Their records are kept.',
  },
};
