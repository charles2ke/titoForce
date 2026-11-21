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

### Business modules

| Area                     | Included                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales (CRM)              | Accounts, contacts, leads with lead scoring and **lead conversion**, opportunities with stages and forecast categories, products, quotes and quote lines, **sales forecast** (by month or owner) |
| Service                  | Cases with priority and SLA fields, knowledge base                                                                                                                               |
| Marketing                | Campaigns, **public web forms** that create leads (web-to-lead)                                                                                                                  |
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
  - Actions on approve and reject.
  - An approvals inbox, plus approve, reject and recall from the record page.

### Analytics

- **Reports**: filter, group by a field or a date interval, then count, sum, average, minimum or maximum.
  - Eight chart types: bar, column, line, pie, donut, KPI, table and funnel.
- **Dashboards** built from reports. Every app has one on its home page.

### AI agents

- **Six built-in agents**:
  - Copilot.
  - Lead Qualifier: runs automatically on new leads.
  - Service Triage: runs automatically on new cases.
  - Deal Coach.
  - HR Assistant.
  - Project Manager.
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
- **Providers**: any OpenAI-compatible API (OpenAI, Azure OpenAI, Ollama, vLLM and others) or Anthropic.
  - Without an API key, agents use a built-in offline rules engine. It handles common requests such as "show open
    deals over 50k closing this quarter", "total pipeline by stage", "summarize Acme Corporation", "qualify all new
    leads" and "log a call with Acme about renewal". It is useful for demos and tests, but it is not a language
    model.

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
| `sofia@titoforce.example`    | Support agent    | Cases, knowledge, service triage                                  |
| `liam@titoforce.example`     | Marketing        | Campaigns and web forms                                           |
| `hannah@titoforce.example`   | HR manager       | Employees, org chart, time off and requisition approvals          |
| `noah@titoforce.example`     | Employee         | Self-service time off, HR assistant                               |

For development, `npm run dev` starts the API with auto-restart and the Vite dev server on http://localhost:5173.
Run `npm run db:reset` to delete the local database and start over.

## Configuration

Settings are environment variables, or a `.env` file in the repository root. [`.env.example`](.env.example)
documents every option. The most important ones:

| Variable                                                      | Default                         | Purpose                                                                       |
| ------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| `TITO_PORT`, `TITO_HOST`                                      | `3000`, `127.0.0.1`             | Where the server listens (use `0.0.0.0` in containers)                        |
| `TITO_DATABASE_URL`                                           | `sqlite:./data/titoforce.db`    | SQLite file or `postgres://user:pass@host:5432/db`                            |
| `TITO_SEED_DEMO`                                              | `true` unless `NODE_ENV=production` | Load the demo company on first start                                     |
| `TITO_ADMIN_EMAIL`, `TITO_ADMIN_PASSWORD`                     | demo admin, or a generated password | First administrator (a generated password is printed once)                |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`                           | none                            | OpenAI or any OpenAI-compatible endpoint                                      |
| `ANTHROPIC_API_KEY`                                           | none                            | Anthropic                                                                     |
| `TITO_AI_PROVIDER`, `TITO_AI_MODEL`                           | auto-detected                   | Force `openai`, `anthropic` or `offline`, and choose the model               |

### PostgreSQL

SQLite (built into Node.js) is the default. For PostgreSQL, set `TITO_DATABASE_URL=postgres://…`. The schema is
created on first start, and the same migrations run on both databases.

## Architecture

```
apps/
  server/   Fastify API (Node.js, native TypeScript)
    src/platform/    metadata, records, query builder, users and roles, list views, CSV import, notifications
    src/automation/  automation engine, actions, approval processes
    src/analytics/   reports, dashboards
    src/ai/          agent runtime, tools, providers (OpenAI-compatible, Anthropic), offline rules engine
    src/modules/     lead conversion, forecast, org chart, web forms
    src/seed/        standard objects, roles, apps, agents and the demo company
  web/      React 19, Vite, Tailwind CSS 4, TanStack Query, Recharts
packages/
  shared/   types and pure logic shared by server and web (formulas, filters, validation)
e2e/        Playwright end-to-end tests
```

- **Records** are stored generically. A `records` table holds a JSON document per record (`JSONB` on PostgreSQL),
  and object and field definitions live in metadata tables.
  - The query builder compiles filters, sorting, search and aggregates into SQL for each database dialect.
  - Formula and roll-up fields are calculated by the platform.
- **Every write goes through one service.** People, automations, approvals and agents all use it, so validation,
  security, field history, automations and timeline entries apply the same way everywhere.
- **Agents run as background jobs.** The API returns a run ID straight away and the UI polls for the result. Runs
  are capped at a fixed number of model steps and tool calls, and automation chains have a depth limit, so agents
  and automations cannot trigger each other forever.

## Testing

```bash
npm run typecheck   # all workspaces, plus scripts and e2e
npm test            # unit and integration tests (shared + server, in-memory SQLite)
npm run e2e         # builds the web app, then runs Playwright against a fresh demo database
```

- **Browsers**: end-to-end tests need a browser. Install one with `npx playwright install chromium`, or set
  `PW_CHANNEL=chrome` to use an installed Google Chrome. Named screenshots of key screens are written to
  `e2e/screenshots/`.
- **PostgreSQL**: to run the server tests or the end-to-end tests against PostgreSQL, set
  `TITO_TEST_DATABASE_URL=postgres://…` or `E2E_DATABASE_URL=postgres://…`. Tests create their own schemas and drop
  them when they finish.
- **CI**: GitHub Actions runs typechecks and tests on Node 24 and 26, the server tests on PostgreSQL 17, and the
  Playwright suite. Screenshots and the Playwright report are uploaded as artifacts.

## Security notes

- **Disable demo data in production.** Demo users share a well-known password. The demo company is only loaded
  automatically when `NODE_ENV` is not `production`; set `TITO_SEED_DEMO=false` for any real deployment.
- **Sessions** use HttpOnly, SameSite=Lax cookies, which are Secure in production. API clients can request a bearer
  token. Failed sign-ins and password changes are rate limited.
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
- **Platform**: multi-tenancy, sandboxes, translations, mobile apps, real-time collaboration, a drag-and-drop page
  layout editor.

## License

[AGPL-3.0](LICENSE)
