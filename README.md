# titoForce

**An open-source, agentic CRM and work platform.** Sales, service, marketing, work management and HR run on one
metadata-driven core. AI agents work through the same permissions, approvals and audit trail as people.

titoForce takes ideas from Salesforce, Microsoft Dynamics 365, HubSpot, monday.com and Workday. It is an early
project (v0.1), not a drop-in replacement for any of them. See [What is not there yet](#what-is-not-there-yet).

## Features

### Platform (Salesforce-style metadata)

- **Custom objects and fields** created in Setup, with no code or migrations.
  - Field types: text, long text, email, phone, URL, number, currency, percent, date, date/time, checkbox,
    picklist, multi-select, lookup, user, formula and roll-up summary.
  - Required, default-value and help-text options, plus sensitive fields that only some roles can see.
- **Record pages**:
  - Highlights, plus a stage path you can click through.
  - Inline editing and field sections.
  - Related lists with quick create.
  - An activity composer and a unified timeline of activities, field history and AI actions.
- **Page layouts**, edited with drag and drop in Setup (_Objects_ → an object → _Page layouts_).
  - Drag fields into sections of one or two columns, and arrange the sections, the highlights in the record header
    and the related lists. Buttons and menus do the same without dragging, for keyboards and touch screens.
  - Assign a layout to roles; everyone else gets the object's default layout. Record pages and edit forms follow it.
- **List views**: table, Kanban board (drag to change stage), calendar and timeline (Gantt-style).
  - Saved views with filters and sorting.
  - Search, bulk edit, and CSV import and export.
- **Security**:
  - Roles with create, read, edit and delete access per object. Read, edit and delete can each be all records,
    own records or none.
  - A permission to view sensitive fields.
  - Setup, automation and agent administration permissions.
- **Apps**: each app has its own navigation, home page and dashboard. Five are included: Sales, Service, Marketing,
  Work and People.

### Organizations, sandboxes and collaboration

- **Multi-tenancy**: one server can host many organizations. Each has its own database (a SQLite file or a
  PostgreSQL schema), with its own users, configuration and records.
  - People enter their organization's ID on the sign-in page, or use its subdomain when `TITO_BASE_DOMAIN` is set.
  - With `TITO_ALLOW_SIGNUP=true`, anyone can create an organization and becomes its administrator. Operators manage
    organizations with `npm run orgs` (`list`, `create`, `suspend`, `resume` and `delete`).
  - A single-organization install works as before: its organization keeps using `TITO_DATABASE_URL`.
- **Sandboxes**: copies of an organization for building and testing changes, in Setup → _Sandboxes_ (up to 10).
  - _Developer_ sandboxes copy the configuration and users. _Full copy_ sandboxes also copy every record and its
    history. Refreshing a sandbox copies production again.
  - **Deploy** compares a sandbox with production component by component: objects and fields, page layouts,
    translations, apps, automations, approval processes, agents, reports, dashboards and roles. You choose what to
    copy to production, and every deployment is recorded.
- **Real-time collaboration**: pages update as soon as someone changes a record, a notification arrives or an
  administrator changes the configuration.
  - Record pages show who else is viewing the record and which field someone is editing.
  - Editing a record, in its edit form or inline, never silently overwrites someone else's changes. Their changes to
    other fields are merged into your open form. If you both changed the same field, whoever saves second sees both
    values and chooses which one to keep.

### Languages and mobile

- **Six languages**: the interface is available in English, Spanish, French, German, Portuguese (Brazil) and
  Japanese. Everyone picks a language in _My settings_ (by default, the browser's), and dates, numbers and
  currencies follow it.
- **Translations** (Setup → _Translations_) translate the labels of objects, fields, picklist values, page layout
  sections and apps. Standard objects and apps come with built-in translations, which you can replace.
- **Mobile**: the layout adapts to phones and tablets. On small screens, the navigation moves into a drawer.
  - Browsers can **install titoForce as an app** (a progressive web app). Installed, it opens without a connection
    and shows a retry message until the server is reachable. Data is never stored offline.
  - **iOS and Android apps** wrap the same web app with Capacitor. See [Mobile apps](#mobile-apps).

### Business modules

| Area                     | Included                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales (CRM)              | Accounts, contacts, leads with lead scoring and **lead conversion**, opportunities with stages and forecast categories, products, quotes and quote lines, **sales forecast** (by month or owner) |
| Service                  | Cases with priority and SLA fields, knowledge base                                                                                                                               |
| Marketing                | Campaigns, **public web forms** that create leads or cases (web-to-lead, web-to-case)                                                                                            |
| Work (monday.com-style)  | Projects and work items on boards, calendars and timelines                                                                                                                       |
| People (Workday-style)   | Departments, employees, **org chart**, time off requests with manager approval, performance reviews, job requisitions and candidates                                             |

### Automation and approvals

- **Record-triggered automations** run when a record is created, updated, saved or deleted.
  - An automation can watch specific fields and have entry conditions.
  - Actions: update the record, update a related record, create a record, notify users, run an AI agent, call a
    webhook, or submit for approval.
  - Templates such as `{{record.name}}`. Run history for every execution.
- **Approval processes**:
  - Entry criteria.
  - Approver chosen as a fixed user or from a field, for example the employee's manager.
  - Actions on submit, approve and reject.
  - An approvals inbox, plus approve, reject and recall from the record page.

### Analytics

- **Reports**: filter, group by a field or a date interval, then count, sum, average, minimum or maximum.
  - Eight chart types: bar, column, line, pie, donut, KPI, table and funnel.
- **Dashboards** built from reports. Every app has one on its home page.

### AI agents

- **Six built-in agents**:
  - titoForce Copilot: a general assistant for every app.
  - Lead Qualifier: runs automatically on new leads.
  - Service Triage: runs automatically on new cases.
  - Deal Coach.
  - HR Assistant.
  - Project Manager.
- **Ask AI** in the header opens an assistant panel on any page. Choose an active agent and chat with it.
  - On a record page, _Ask AI_ and _Summarize with AI_ give the agent the record as context.
  - The panel docks beside the page on screens at least 1280px wide, and overlays it on narrower screens.
  - The **Agents** page keeps your past conversations with each agent.
- **You can build your own agent** in Setup: write its instructions, pick from 17 tools, and set its autonomy.
  - Tools let an agent search, query, aggregate, read the timeline, search knowledge, score leads, create and update
    records, log activities, convert leads, submit approvals and notify people.
- **Autonomy levels**:
  - _Read only_.
  - _Approval required_: write actions wait in the approvals inbox until a person approves them.
  - _Autonomous_.
- **Agents never bypass security**:
  - In chat, an agent acts with the permissions of the user it is helping.
  - When an automation runs an agent, it acts as the dedicated "titoForce AI" user and its role.
  - Every run records its steps and tool calls, and every change appears on the record timeline.
- **Providers**: any OpenAI-compatible API (OpenAI, Azure OpenAI, Ollama, vLLM and others) or Anthropic. See
  [AI providers](#ai-providers) for setup.
  - Until a provider is configured, agents use a built-in offline rules engine. It handles common requests such as
    "show open deals over 50k closing this quarter", "total pipeline by stage", "summarize Acme Corporation",
    "qualify all new leads" and "log a call with Acme about renewal". It is useful for demos and tests, but it is not
    a language model.

## Quick start

You need **Node.js 24 or newer**. TypeScript runs natively, so there is no compile step for the server.

```bash
git clone https://github.com/charles2ke/titoForce.git
cd titoForce
npm install
npm run build      # builds the web app
npm start          # http://127.0.0.1:3000
```

On first start, the server creates `data/titoforce.db` (SQLite) and loads a demo company. Every demo user's password
is `titoforce`.

| User                         | Role             | Good for trying                                                   |
| ---------------------------- | ---------------- | ----------------------------------------------------------------- |
| `admin@titoforce.example`    | Administrator    | Setup: objects, fields, roles, apps, automations, agents          |
| `maria@titoforce.example`    | Sales manager    | Pipeline, forecast, approvals for quote discounts                 |
| `james@titoforce.example`    | Sales rep        | Own-record security, deal coaching                                |
| `priya@titoforce.example`    | Sales rep        | A second rep's pipeline, a pending quote discount request         |
| `sofia@titoforce.example`    | Support agent    | Cases, knowledge, service triage                                  |
| `liam@titoforce.example`     | Marketing        | Campaigns and web forms                                           |
| `hannah@titoforce.example`   | HR manager       | Employees, org chart, time off and requisition approvals          |
| `noah@titoforce.example`     | Employee         | Self-service time off, HR assistant                               |

For development, `npm run dev` starts the API with auto-restart and the Vite dev server on http://localhost:5173,
which forwards `/api` requests to the API on `TITO_PORT`. Set `TITO_WEB_PORT` to run Vite on another port. Run
`npm run db:reset` to delete the local database, and those of any other organizations, and start over.

To try a second organization, create one with demo data, then enter its ID (`acme`) on the sign-in page. The
command prints the administrator's generated password.

```bash
npm run orgs -- create acme --name "Acme Inc" --admin-email ada@acme.example --demo
```

## Configuration

Settings are environment variables, or a `.env` file in the repository root. Variables already set in the environment
take precedence. [`.env.example`](.env.example) documents every server option. The most important ones:

| Variable                                  | Default                                                    | Purpose                                                                                |
| ----------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `TITO_PORT`, `TITO_HOST`                  | `3000`, `127.0.0.1`                                        | Where the server listens (use `0.0.0.0` in containers)                                 |
| `TITO_DATABASE_URL`                       | `data/titoforce.db` in the repository root                 | `sqlite:/path/to/file.db` or `postgres://user:pass@host:5432/db`                       |
| `TITO_SEED_DEMO`                          | `true` unless `NODE_ENV=production`                        | Load the demo company on first start                                                   |
| `TITO_ADMIN_EMAIL`, `TITO_ADMIN_PASSWORD` | `admin@titoforce.example`, `titoforce` (demo) or generated | First administrator, created on first start only. A generated password is printed once |
| `TITO_TRUST_PROXY`                        | `false`                                                    | Set to `true` only when direct server access is blocked and trusted proxies overwrite client-supplied forwarding headers |
| `TITO_ALLOW_SIGNUP`                       | `false`                                                    | Let anyone create an organization on the sign-up page                                  |
| `TITO_BASE_DOMAIN`                        | none                                                       | Organizations by subdomain: with `crm.example.com`, `acme.crm.example.com` is organization `acme` |
| `TITO_CORS_ORIGINS`                       | none                                                       | Origins that may call the API, such as the [mobile apps](#mobile-apps)                 |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`       | none, `https://api.openai.com/v1`                          | OpenAI or any OpenAI-compatible endpoint                                               |
| `ANTHROPIC_API_KEY`                       | none                                                       | Anthropic                                                                              |
| `TITO_AI_PROVIDER`, `TITO_AI_MODEL`       | auto-detected, see [AI providers](#ai-providers)           | Choose `openai`, `anthropic` or `offline`, and the model                               |

To store the SQLite database elsewhere, use an absolute path. Relative paths resolve from the server's working
directory, which is `apps/server` under the npm scripts.

### AI providers

Setting `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` switches agents from the offline engine to that provider. If both are
set, OpenAI is used unless `TITO_AI_PROVIDER=anthropic`. `TITO_AI_PROVIDER=offline` keeps agents offline even when a
key is set. Agents rely on tool calling, so choose a model that supports it.

- **OpenAI**: set `OPENAI_API_KEY`. The model defaults to `gpt-4.1-mini`.
- **Anthropic**: set `ANTHROPIC_API_KEY`. The model defaults to `claude-sonnet-4-5`.
- **Other OpenAI-compatible APIs**, such as vLLM or Azure OpenAI's v1 API
  (`https://<resource>.openai.azure.com/openai/v1`): also set `OPENAI_BASE_URL` and `TITO_AI_MODEL` (on Azure, the
  deployment name). Requests go to `{OPENAI_BASE_URL}/chat/completions`, with the key sent as a bearer token.
- **Local servers without a key**, such as Ollama: set `TITO_AI_PROVIDER=openai`,
  `OPENAI_BASE_URL=http://localhost:11434/v1` and a `TITO_AI_MODEL` the server provides. Without
  `TITO_AI_PROVIDER`, agents stay offline.

### PostgreSQL

SQLite (built into Node.js) is the default. For PostgreSQL, set `TITO_DATABASE_URL=postgres://…`. The schema is
created on first start, and the same migrations run on both databases. On PostgreSQL, `npm run db:reset` drops every
titoForce table and organization schema, so it only runs when confirmed: `npm run db:reset -- --yes`.

## Mobile apps

**Installable web app.** Production builds (`npm run build`) include a web app manifest and a service worker, so
browsers can install titoForce: _Install app_ in Chrome and Edge, or _Share_ → _Add to Home Screen_ in Safari on iOS.
The service worker caches the app itself, never API data.

**iOS and Android apps.** `apps/mobile` packages the web app with [Capacitor](https://capacitorjs.com). The native
projects are generated on your machine rather than committed. Building them needs Android Studio, or Xcode on macOS.

```bash
npm run build              # in the repository root: build the web app
cd apps/mobile
npx cap add android        # once (or: npx cap add ios)
npm run assets             # app icons and splash screens from apps/mobile/assets
npm run sync               # after each change to the web app: rebuild it and copy it into the native projects
npm run android            # open the project in Android Studio (or: npm run ios, for Xcode)
```

Before publishing your own build, change `appId` and `appName` in `apps/mobile/capacitor.config.json`.

On first launch, the app asks for the server's address, then shows the usual sign-in page. The server must:

- use **HTTPS** with a trusted certificate, because iOS and Android block plain HTTP by default;
- allow the apps' origins: `TITO_CORS_ORIGINS=capacitor://localhost,https://localhost` (iOS, Android).

The apps send bearer tokens instead of cookies, and keep a separate session for each organization.

## Architecture

```
apps/
  server/   Fastify API (Node.js, native TypeScript)
    src/db/          SQLite and PostgreSQL adapters, schema and versioned migrations
    src/tenancy/     organizations and sandboxes: a database for each, copies and deployments
    src/routes/      HTTP API routes, and the WebSocket for real-time updates
    src/platform/    metadata, records, query builder, users and roles, list views, page layouts, translations,
                     CSV import, notifications, real-time updates
    src/automation/  automation engine, actions, approval processes
    src/analytics/   reports, dashboards
    src/ai/          agent runtime, tools, providers (OpenAI-compatible, Anthropic), offline rules engine
    src/modules/     lead conversion, forecast, org chart, web forms
    src/seed/        standard objects, roles, apps, agents and the demo company
    src/i18n/        built-in translations of the standard objects and apps
    src/cli/         database reset (`npm run db:reset`) and organizations (`npm run orgs`)
  web/      React 19, Vite, Tailwind CSS 4, TanStack Query, Recharts; interface text in src/i18n/messages/
  mobile/   Capacitor project for the iOS and Android apps
packages/
  shared/   types and pure logic shared by server and web (formulas, filters, validation)
scripts/    development runner (`npm run dev`)
e2e/        Playwright end-to-end tests
```

- **Records** are stored generically. A `records` table holds a JSON document per record (`JSONB` on PostgreSQL),
  and object and field definitions live in metadata tables.
  - The query builder compiles filters, sorting, search and aggregates into SQL for each database dialect.
  - Formula and roll-up fields are calculated by the platform.
- **Every write goes through one service.** People, automations, approvals and agents all use it, so validation,
  security, field history, automations and timeline entries apply the same way everywhere.
  - An update can name the version it started from (`expectedUpdatedAt`). If someone has changed the same fields
    since, it is refused with their changes; changes to other fields go through.
  - After each change, the server tells the connected users who can read the record, sending only its ID. Their
    browsers then reload what they show.
- **Each organization has its own database.** On SQLite it is a file in a folder next to the main database
  (`titoforce-orgs/` for `titoforce.db`); on PostgreSQL, a schema in the same database.
  - The default organization uses `TITO_DATABASE_URL` itself, which also lists the other organizations.
  - A request's organization comes from its subdomain (with `TITO_BASE_DOMAIN`), the `X-Tito-Org` header or the
    `org` query parameter. Databases unused for 10 minutes are closed and reopened on the next request.
- **Agents run as background jobs.** The API returns a run ID straight away and the UI polls for the result. Runs
  are capped at a fixed number of model steps and tool calls, and automation chains have a depth limit, so agents
  and automations cannot trigger each other forever.

## Testing

```bash
npm run typecheck   # all workspaces, plus scripts and e2e
npm test            # unit and integration tests (shared + server, in-memory SQLite)
npm run i18n:check  # translations: placeholders, plural forms and no empty messages
npm run e2e         # builds the web app, then runs Playwright against a fresh demo database
```

- **Translations**: the typecheck makes sure every language has the same messages as English (in
  `apps/web/src/i18n/messages/`). `npm run i18n:check` checks what types cannot.
- **Browsers**: end-to-end tests need a browser. Install one with `npx playwright install chromium`, or set
  `PW_CHANNEL=chrome` to use an installed Google Chrome. Named screenshots of key screens are written to
  `e2e/screenshots/`.
- **PostgreSQL**: to run the server tests or the end-to-end tests against PostgreSQL, set
  `TITO_TEST_DATABASE_URL=postgres://…` or `E2E_DATABASE_URL=postgres://…`. Tests create their own schemas and drop
  them when they finish.
- **CI**: GitHub Actions runs typechecks, the translation check and tests on Node 24 and 26, the server tests on
  PostgreSQL 17, and the Playwright suite. Screenshots and the Playwright report are uploaded as artifacts.

## Security notes

- **Disable demo data in production.** Demo users share a well-known password. The demo company is only loaded
  automatically when `NODE_ENV` is not `production`; set `TITO_SEED_DEMO=false` for any real deployment.
- **Sessions** last 7 days and use HttpOnly, SameSite=Lax cookies, which are Secure in production. API clients can
  sign in with `"issueToken": true` and send the returned token as `Authorization: Bearer <token>`.
- **Organizations are separated by database.** Users, sessions and records live in each organization's own
  database, so a session only works in the organization where it was created.
- **Sign-up is off by default.** With `TITO_ALLOW_SIGNUP=true`, anyone who can reach the server can create an
  organization, and with it a database. Sign-ups are limited to 10 per client IP per hour.
- **Sandboxes copy production's users, including their password hashes**, and _Full copy_ sandboxes copy every
  record too. Only administrators can create them, but anyone who could sign in to production when a sandbox was
  copied can sign in to it, with the password they had then.
- **Cross-origin requests**, from the mobile apps for example, are only allowed from the origins in
  `TITO_CORS_ORIGINS`, and only with bearer tokens: the server never allows cookies cross-origin.
- **Rate limits** are kept in memory by each server process:
  - Sign-in: 10 failures per account and 50 per client IP in 15 minutes.
  - Password changes: 10 failures per user in 15 minutes.
  - Agent chat: 30 messages per user per minute.
  - Public web forms: 10 submissions per client IP per form per minute.
- **Behind a reverse proxy**, set `TITO_TRUST_PROXY=true` only when direct server access is blocked and trusted
  proxies overwrite client-supplied forwarding headers; otherwise clients could fake their IP address.
- **Public web forms** accept submissions without signing in. Only active forms accept them, and a submission can only
  fill in the fields its form lists.
- **Webhook actions can call any HTTP(S) URL**, including internal addresses. Only give the _Manage automations_
  permission to people you trust.
- **When an LLM provider is configured**, prompts that include CRM data are sent to that provider. Use the offline
  engine, or a self-hosted OpenAI-compatible model, if data must stay on your network.

## What is not there yet

titoForce covers the core of each product area but none of these products in full. Notable gaps:

- **Lead conversion recovery**: if the server stops during conversion, its database claim remains. Before deleting the
  corresponding row from `lead_conversion_claims`, check the lead and any partially created records.
- **Integrations**: email sending and inbox sync, calendar sync, telephony, file attachments.
- **Sales and finance**: multi-currency, territories, CPQ pricing rules, invoicing.
- **Marketing**: email marketing campaigns and journeys.
- **HR**: payroll, benefits and compensation planning.
- **Security**: SSO (SAML/OIDC), multi-factor authentication, field-level permissions per role (beyond the sensitive
  flag), sharing rules.
- **Platform**:
  - Real-time updates only reach people connected to the same server process. Running several processes would
    need a shared message bus.
  - Deployments add and update components in production but never delete them, and they cannot be undone.
  - Organizations are managed with `npm run orgs`; there is no operator console.
- **Mobile**: offline data, push notifications, app store releases. The iOS and Android projects have not been
  built and tested on devices yet.
- **Languages**: right-to-left languages. The translations have not yet been reviewed by native speakers.

## License

[AGPL-3.0](LICENSE)
