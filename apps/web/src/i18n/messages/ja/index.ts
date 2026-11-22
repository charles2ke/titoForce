import type { Translation } from '../../index.ts';
import common from './common.ts';
import shell from './shell.ts';
import components from './components.ts';
import filters from './filters.ts';
import format from './format.ts';
import errors from './errors.ts';
import publicForm from './publicForm.ts';
import list from './list.ts';
import views from './views.ts';
import record from './record.ts';
import home from './home.ts';
import dashboards from './dashboards.ts';
import reports from './reports.ts';
import forecast from './forecast.ts';
import orgChart from './orgChart.ts';
import approvals from './approvals.ts';
import agents from './agents.ts';
import login from './login.ts';
import settings from './settings.ts';
import setup from './setup.ts';
import setupObjects from './setupObjects.ts';
import setupUsers from './setupUsers.ts';
import setupRoles from './setupRoles.ts';
import setupApps from './setupApps.ts';
import setupAutomations from './setupAutomations.ts';
import setupApprovals from './setupApprovals.ts';
import setupAgents from './setupAgents.ts';
import setupRuns from './setupRuns.ts';
import orgs from './orgs.ts';
import setupSandboxes from './setupSandboxes.ts';
import setupTranslations from './setupTranslations.ts';
import setupLayouts from './setupLayouts.ts';
import collab from './collab.ts';

const messages: Translation = {
  common,
  shell,
  components,
  filters,
  format,
  errors,
  publicForm,
  list,
  views,
  record,
  home,
  dashboards,
  reports,
  forecast,
  orgChart,
  approvals,
  agents,
  login,
  settings,
  setup,
  setupObjects,
  setupUsers,
  setupRoles,
  setupApps,
  setupAutomations,
  setupApprovals,
  setupAgents,
  setupRuns,
  orgs,
  setupSandboxes,
  setupTranslations,
  setupLayouts,
  collab,
};

export default messages;
