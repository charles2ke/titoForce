import { type ComponentType, lazy, type LazyExoticComponent, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { RequireAuth } from './components/RequireAuth.tsx';
import { Shell } from './components/Shell.tsx';
import { Loading } from './components/ui.tsx';
import { HomeRedirect } from './pages/HomeRedirect.tsx';
import NotFound, { RouteError } from './pages/NotFound.tsx';

type Page = LazyExoticComponent<ComponentType>;
const page = (C: Page) => (
  <Suspense fallback={<Loading />}>
    <C />
  </Suspense>
);

const Login = lazy(() => import('./pages/Login.tsx'));
const Signup = lazy(() => import('./pages/Signup.tsx'));
const PublicForm = lazy(() => import('./pages/PublicForm.tsx'));
const AppHome = lazy(() => import('./pages/AppHome.tsx'));
const ObjectList = lazy(() => import('./pages/ObjectList.tsx'));
const RecordPage = lazy(() => import('./pages/RecordPage.tsx'));
const Reports = lazy(() => import('./pages/Reports.tsx'));
const ReportView = lazy(() => import('./pages/ReportView.tsx'));
const ReportBuilder = lazy(() => import('./pages/ReportBuilder.tsx'));
const Dashboards = lazy(() => import('./pages/Dashboards.tsx'));
const DashboardView = lazy(() => import('./pages/DashboardView.tsx'));
const Forecast = lazy(() => import('./pages/Forecast.tsx'));
const OrgChart = lazy(() => import('./pages/OrgChart.tsx'));
const Agents = lazy(() => import('./pages/Agents.tsx'));
const Approvals = lazy(() => import('./pages/Approvals.tsx'));
const Settings = lazy(() => import('./pages/Settings.tsx'));

const SetupLayout = lazy(() => import('./pages/setup/SetupLayout.tsx'));
const SetupIndex = lazy(() => import('./pages/setup/SetupLayout.tsx').then((m) => ({ default: m.SetupIndex })));
const SetupObjects = lazy(() => import('./pages/setup/Objects.tsx'));
const SetupObjectDetail = lazy(() => import('./pages/setup/ObjectDetail.tsx'));
const SetupUsers = lazy(() => import('./pages/setup/Users.tsx'));
const SetupRoles = lazy(() => import('./pages/setup/Roles.tsx'));
const SetupApps = lazy(() => import('./pages/setup/Apps.tsx'));
const SetupAutomations = lazy(() => import('./pages/setup/Automations.tsx'));
const SetupApprovalProcesses = lazy(() => import('./pages/setup/ApprovalProcesses.tsx'));
const SetupAgents = lazy(() => import('./pages/setup/Agents.tsx'));
const SetupRuns = lazy(() => import('./pages/setup/Runs.tsx'));
const SetupTranslations = lazy(() => import('./pages/setup/Translations.tsx'));
const SetupSandboxes = lazy(() => import('./pages/setup/Sandboxes.tsx'));
const SetupSandboxDeploy = lazy(() => import('./pages/setup/Sandboxes.tsx').then((m) => ({ default: m.SandboxDeploy })));

export const router = createBrowserRouter([
  { path: '/login', element: page(Login), errorElement: <RouteError /> },
  { path: '/signup', element: page(Signup), errorElement: <RouteError /> },
  { path: '/f/:formId', element: page(PublicForm), errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <Shell />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <HomeRedirect /> },
          { path: 'app/:appId', element: page(AppHome) },
          { path: 'o/:object', element: page(ObjectList) },
          { path: 'r/:id', element: page(RecordPage) },
          { path: 'reports', element: page(Reports) },
          { path: 'reports/new', element: page(ReportBuilder) },
          { path: 'reports/:id', element: page(ReportView) },
          { path: 'reports/:id/edit', element: page(ReportBuilder) },
          { path: 'dashboards', element: page(Dashboards) },
          { path: 'dashboards/:id', element: page(DashboardView) },
          { path: 'forecast', element: page(Forecast) },
          { path: 'org-chart', element: page(OrgChart) },
          { path: 'agents', element: page(Agents) },
          { path: 'agents/:agentId', element: page(Agents) },
          { path: 'approvals', element: page(Approvals) },
          { path: 'settings', element: page(Settings) },
          {
            path: 'setup',
            element: page(SetupLayout),
            children: [
              { index: true, element: page(SetupIndex) },
              { path: 'objects', element: page(SetupObjects) },
              { path: 'objects/:api', element: page(SetupObjectDetail) },
              { path: 'users', element: page(SetupUsers) },
              { path: 'roles', element: page(SetupRoles) },
              { path: 'apps', element: page(SetupApps) },
              { path: 'automations', element: page(SetupAutomations) },
              { path: 'approval-processes', element: page(SetupApprovalProcesses) },
              { path: 'agents', element: page(SetupAgents) },
              { path: 'runs', element: page(SetupRuns) },
              { path: 'translations', element: page(SetupTranslations) },
              { path: 'sandboxes', element: page(SetupSandboxes) },
              { path: 'sandboxes/:id', element: page(SetupSandboxDeploy) },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
