import { plural } from '../../plural.ts';

/** Setup → Apps. */
export default {
  title: 'Apps',
  subtitle: 'Bundle objects and pages into apps for each team. Users switch between apps from the app launcher.',
  new: 'New app',
  /** {name} is an app name. */
  edit: 'Edit {name}',
  /** The dashboard shown on an app’s Home page. */
  homeDashboard: 'Home dashboard',
  /** The tabs in an app’s sidebar. */
  navigation: 'Navigation',
  /** Built-in pages that can be added to an app’s navigation. */
  pages: {
    home: { label: 'Home', help: 'The app’s home dashboard and assistant.' },
    forecast: { label: 'Forecast', help: 'Sales forecast by owner and period.' },
    /** Page showing the employee hierarchy. */
    orgChart: { label: 'Org Chart', help: 'Employee hierarchy.' },
    reports: { label: 'Reports', help: 'Reports and dashboards.' },
  },
  /** Ways to display a list of records. */
  views: {
    table: 'Table',
    kanban: 'Kanban',
    calendar: 'Calendar',
    timeline: 'Timeline',
  },
  list: {
    empty: 'No apps yet',
    createFirst: 'Create your first app',
    /** Column header. */
    app: 'App',
    /** Column: the app’s position in the app switcher. */
    order: 'Order',
    /** Navigation items not shown in the list. */
    more: plural({ other: '+{count} more' }),
    delete: 'Delete {name}',
    deleteTitle: 'Delete the {name} app?',
    deleteMessage: 'Only the app is removed. Its objects, records, reports and dashboards are kept.',
    deleteConfirm: 'Delete app',
  },
  toasts: {
    created: '{name} app created',
    saved: '{name} saved',
    deleted: '{name} deleted',
  },
  form: {
    create: 'Create app',
    save: 'Save app',
    name: 'App name',
    /** Example app name. */
    namePlaceholder: 'Customer Success',
    id: 'App id',
    idHelp: 'Permanent identifier used in links.',
    idInvalid: 'Use 2–40 lowercase letters, numbers and underscores, starting with a letter.',
    idTaken: 'An app with this id already exists.',
    homeDashboardHelp: 'Shown on the app’s Home page.',
    sortOrder: 'Sort order',
    sortOrderHelp: 'Lower numbers come first in the app switcher.',
    navigationHelp: 'Tabs shown in the app’s sidebar, in order. Leave an object’s label empty to use its plural name.',
    problems: {
      enterName: 'Enter a name.',
      fixId: 'Fix the app id.',
      sortOrder: 'Sort order must be a whole number from 0 to 1000.',
      pageLabel: 'Every page needs a label.',
    },
  },
  /** Editor for the navigation items of an app; {n} is an item’s position. */
  nav: {
    empty: 'No navigation items yet. Add objects and pages below.',
    /** Badge: the navigation item is a page (not an object). */
    page: 'Page',
    itemObject: 'Item {n} object',
    itemLabel: 'Item {n} label',
    itemView: 'Item {n} default view',
    itemPage: 'Item {n} page',
    itemIcon: 'Item {n} icon',
    defaultView: 'Default view',
    moveUp: 'Move item {n} up',
    moveDown: 'Move item {n} down',
    remove: 'Remove item {n}',
    addObject: 'Add object',
    addPage: 'Add page',
    /** {used} of at most {max} navigation items. */
    count: '{used}/{max} items',
  },
};
