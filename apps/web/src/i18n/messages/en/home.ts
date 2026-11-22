import { plural } from '../../plural.ts';

/** App home page: greeting, quick links, the app's dashboard and the "My work" cards. */
export default {
  /** Page heading; {name} is the user's first name. */
  greeting: {
    morning: 'Good morning, {name}',
    afternoon: 'Good afternoon, {name}',
    evening: 'Good evening, {name}',
  },
  askAi: 'Ask AI',
  quickLinks: 'Quick links',
  /** Side panel with the user's tasks, approvals and recent AI activity. */
  myWork: 'My work',
  appNotFound: {
    title: 'App not found',
    message: 'This app does not exist or was removed.',
    goHome: 'Go to your home page',
  },

  dashboard: {
    title: 'Dashboard',
    open: 'Open dashboard',
    noneAssigned: 'No dashboard is assigned to this app.',
    browse: 'Browse dashboards',
  },

  tasks: {
    /** "Open" = not completed yet. */
    title: 'My open tasks',
    allActivities: 'All activities',
    empty: 'Nothing open — you’re all caught up.',
    markComplete: 'Mark complete',
    markNamedComplete: 'Mark “{name}” complete',
    completed: 'Task completed',
    /** Due date of an overdue task, e.g. "Overdue · Mar 3, 2026". */
    overdue: 'Overdue · {date}',
    /** Due date of a task that is due today, e.g. "Today · Mar 3, 2026". */
    dueToday: 'Today · {date}',
    noDate: 'No date',
    more: plural({ one: '+{count} more open task', other: '+{count} more open tasks' }),
  },

  approvals: {
    title: 'Awaiting my approval',
    /** Link to the approvals inbox. */
    inbox: 'Inbox',
    empty: 'No requests waiting for you.',
    /** Approval process, who submitted the request and when, e.g. "Discount approval · from Maria Lopez · 2h ago". */
    details: '{process} · from {user} · {time}',
    viewAll: 'View all {count}',
  },

  runs: {
    title: 'Recent AI activity',
    /** Link to the AI agents page. */
    agents: 'Agents',
    empty: 'No agent runs yet. Ask an agent something to get started.',
    /** Status badge of an AI agent run (lower case in English). */
    status: {
      running: 'running',
      completed: 'completed',
      failed: 'failed',
    },
    /**
     * How an agent run was started, shown before the run's input. English shows the internal names; translate the meaning:
     * started by an automation, from a record action button, or through the API.
     */
    trigger: {
      automation: 'automation',
      recordAction: 'record_action',
      api: 'api',
    },
  },
};
