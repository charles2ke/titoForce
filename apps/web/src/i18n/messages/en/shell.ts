import { plural } from '../../plural.ts';

/** App chrome: header, global search, notifications, user menu, sidebar navigation and the AI side panel. */
export default {
  /** Accessible name of the logo link in the header; "titoForce" is the product name (do not translate). */
  homeLink: 'titoForce home',
  /** Header button that opens the AI assistant panel. */
  askAi: 'Ask AI',

  search: {
    /** Accessible name of the global search box. */
    label: 'Search all records',
    placeholder: 'Search accounts, contacts, deals, cases…',
    /** Keyboard shortcut hint shown inside the search box; use the key name printed on local keyboards (e.g. "Strg K"). */
    shortcut: 'Ctrl K',
    searching: 'Searching…',
    failed: 'Search failed',
    /** {term} is the text the user typed. */
    noMatches: 'No matches for “{term}”',
  },

  notifications: {
    title: 'Notifications',
    /** Accessible name of the bell button when there are unread notifications. */
    labelUnread: plural({ one: 'Notifications ({count} unread)', other: 'Notifications ({count} unread)' }),
    markAllRead: 'Mark all as read',
    empty: "You're all caught up.",
  },

  inbox: {
    /** Accessible name of the approvals inbox button in the header. */
    label: 'Approvals inbox',
    labelPending: plural({ one: 'Approvals inbox ({count} pending)', other: 'Approvals inbox ({count} pending)' }),
  },

  changePassword: {
    title: 'Change password',
    /** Button that submits the change-password form. */
    submit: 'Change password',
    current: 'Current password',
    new: 'New password',
    help: 'At least 8 characters.',
    success: 'Password changed',
  },

  userMenu: {
    /** Accessible name of the avatar button that opens the user menu. */
    label: 'User menu',
    settings: 'My settings',
    changePassword: 'Change password',
    signOut: 'Sign out',
  },

  apps: {
    /** Accessible name of the app switcher button. */
    switch: 'Switch app',
    /** Small caption above the current app's name in the app switcher. */
    caption: 'App',
    choose: 'Choose an app',
    /** Accessible name of the list of apps in the app switcher. */
    list: 'Apps',
  },

  nav: {
    /** Accessible name of the main navigation landmark. */
    main: 'Main',
    /** Heading of the sidebar section with links that are available in every app. */
    workspace: 'Workspace',
    agents: 'AI Agents',
    approvals: 'Approvals',
    reports: 'Reports',
    dashboards: 'Dashboards',
    setup: 'Setup',
  },

  ai: {
    /** Sidebar footer: AI provider in use; {provider} is a technical name such as "openai · gpt-4o". */
    status: 'AI: {provider}',
    /** Sidebar footer when no AI provider is configured and the built-in rules engine answers instead. */
    offline: 'AI: offline rules engine',
  },

  aiPanel: {
    /** Accessible name of the AI assistant side panel. */
    label: 'AI assistant',
    agent: 'Agent',
    newChat: 'New chat',
    close: 'Close assistant',
    /** {record} is the name of the record the assistant is looking at. */
    context: 'Context: {record}',
    loadingAgents: 'Loading agents…',
    noAgents: 'No active agents.',
  },

  mobile: {
    openNav: 'Open navigation',
    closeNav: 'Close navigation',
    /** Accessible name of the slide-in navigation on small screens. */
    nav: 'Navigation',
  },
};
