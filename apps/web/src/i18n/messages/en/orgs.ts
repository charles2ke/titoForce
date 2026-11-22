/** Organizations: choosing one at sign-in, signing up, switching, sandboxes and the mobile app's server. */
export default {
  signIn: {
    /** Field for the organization's ID (a short name such as "acme") on servers that host several organizations. */
    organization: 'Organization',
    organizationHelp: 'The ID your administrator gave you, such as "acme".',
    /** Under the sign-in heading. {name}: organization name. */
    to: 'Signing in to {name}',
    notFound: 'There is no organization "{slug}".',
    noAccount: 'New to titoForce?',
    createOrganization: 'Create an organization',
  },

  signUp: {
    title: 'Create your organization',
    subtitle: 'Your organization gets its own database. You will be its administrator.',
    organizationName: 'Organization name',
    /** The short ID people type to sign in (also shown in links). */
    organizationId: 'Organization ID',
    organizationIdHelp: 'Used to sign in: lowercase letters, numbers and hyphens.',
    yourName: 'Your name',
    passwordHelp: 'At least 8 characters.',
    demo: 'Add sample records so you can explore',
    submit: 'Create organization',
    haveAccount: 'Already have an organization?',
    signIn: 'Sign in',
    disabled: 'Sign-up is not enabled on this server. Ask its administrator for an account.',
  },

  switcher: {
    /** User menu item and dialog title. */
    title: 'Switch organization',
    help: 'Each organization has its own users and data, so you sign in to each one separately.',
    organizationId: 'Organization ID',
    recent: 'Recent',
    current: 'Current',
    open: 'Open',
  },

  sandbox: {
    /** Short label for a sandbox organization (a copy of production for building and testing). */
    badge: 'Sandbox',
    /** Banner on every page of a sandbox. {name}: sandbox name; {parent}: name of the production organization. */
    banner: 'Sandbox {name} of {parent}. Changes here do not affect production.',
    openProduction: 'Open production',
  },

  problem: {
    title: 'This organization is not available',
    tryAgain: 'Try again',
    otherOrganization: 'Sign in to another organization',
  },

  /** The iOS/Android app connects to a titoForce server that the user names. */
  native: {
    title: 'Connect to your server',
    subtitle: 'Enter the address of your organization’s titoForce server.',
    server: 'Server address',
    serverPlaceholder: 'crm.example.com',
    connect: 'Connect',
    invalid: 'Enter a web address such as crm.example.com.',
    /** {url}: server address. */
    unreachable: 'Could not reach a titoForce server at {url}. Check the address and that the server allows this app.',
    connectedTo: 'Server: {url}',
    change: 'Change',
  },
};
