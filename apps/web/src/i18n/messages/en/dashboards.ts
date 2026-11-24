import { plural } from '../../plural.ts';

/** Dashboards list, dashboard page and dashboard editor. */
export default {
  title: 'Dashboards',
  subtitle: 'Collections of report charts. Everyone sees results for the records they can access.',
  newDashboard: 'New dashboard',

  list: {
    emptyTitle: 'No dashboards yet',
    emptyAnalyst: 'Create a dashboard to put several report charts on one page.',
    emptyViewer: 'Dashboards created by your analysts and admins will appear here.',
    noDescription: 'No description',
    noWidgets: 'No widgets yet',
    widgetCount: plural({ one: '{count} widget', other: '{count} widgets' }),
    /** Tooltip; {date} is a date and time. */
    lastModified: 'Last modified {date}',
    /** {time} is a relative time such as "5m ago" or "just now". */
    updated: 'Updated {time}',
  },

  create: {
    namePlaceholder: 'e.g. Sales overview',
    hint: 'You can add reports to the dashboard next.',
    created: 'Dashboard “{name}” created',
  },

  view: {
    notFound: 'Dashboard not found',
    notFoundMessage: 'It may have been deleted.',
    backToList: 'Back to dashboards',
    loadFailed: 'This dashboard could not be loaded.',
    deleteDashboard: 'Delete dashboard',
    deleteTitle: 'Delete dashboard?',
    deleteMessage: '“{name}” will be permanently deleted. Its reports are kept.',
    /** {apps} is a comma-separated list of app names. */
    deleteHomeOf: 'It is the home dashboard of {apps}.',
    deleted: 'Dashboard “{name}” deleted',
    /** {time} is a time of day. */
    dataAsOf: 'Data as of {time}. Each widget only counts the records you can access.',
  },

  editor: {
    title: 'Edit dashboard',
    save: 'Save dashboard',
    saved: 'Dashboard “{name}” saved',
    nameRequired: 'Name is required',
    discardTitle: 'Discard changes?',
    discardMessage: 'Your changes to this dashboard have not been saved.',
    /** Button: throw away the unsaved changes. */
    discard: 'Discard',
    /** Field label: the app the dashboard is listed under. */
    app: 'App',
    appHelp: 'Lists the dashboard under an app.',
    widgets: 'Widgets',
    noWidgets: 'No widgets yet. Add a report below.',
    deletedReport: 'Deleted report. It will be removed when you save.',
    /** Placeholder title of a widget whose report name is not known. */
    report: 'Report',
    loadingReport: 'Loading report…',
    /** Shown when a widget has no title of its own. */
    usesReportName: 'uses the report name as title',
    widgetTitle: 'Title of widget {number}',
    widgetSize: 'Size of widget {number}',
    moveUp: 'Move widget {number} up',
    moveDown: 'Move widget {number} down',
    remove: 'Remove widget {number}',
    /** Widget sizes: the share of the dashboard width a widget takes. */
    sizes: {
      small: 'Small (⅓ width)',
      medium: 'Medium (⅔ width)',
      full: 'Full width',
    },
    addReport: 'Add a report',
    addReportOption: 'Add a report…',
    loadingReports: 'Loading reports…',
    noReports: 'No reports available',
    maxWidgets: 'Maximum of {max} widgets reached',
    deletedReportsRemoved: plural({
      one: '{count} deleted report will be removed on save.',
      other: '{count} deleted reports will be removed on save.',
    }),
    layoutPreview: 'Layout preview',
    smallScreens: 'On small screens every widget takes the full width.',
  },
};
