import type { CrmRecord, RecordData, UserDTO } from '@titoforce/shared';
import { scoreLead } from '../ai/tools.ts';
import type { Principal } from '../platform/principal.ts';
import type { Services } from '../services.ts';
import { addDays, isoDate } from '../util.ts';
import type { SeededProcesses } from './setup.ts';

export type DemoUserKey = 'admin' | 'maria' | 'james' | 'priya' | 'sofia' | 'liam' | 'hannah' | 'noah';
export type DemoUsers = Record<DemoUserKey, UserDTO>;

/** Probability and forecast category per stage; mirrors the "Opportunity stage defaults" automation. */
export const STAGE_DEFAULTS: Record<string, [number, string]> = {
  Prospecting: [10, 'Pipeline'],
  Qualification: [20, 'Pipeline'],
  'Needs Analysis': [40, 'Pipeline'],
  Proposal: [60, 'Best Case'],
  Negotiation: [80, 'Commit'],
  'Closed Won': [100, 'Closed'],
  'Closed Lost': [0, 'Omitted'],
};
/** Mirrors the "Case SLA" automation. */
const SLA_HOURS: Record<string, number> = { Urgent: 4, High: 8, Medium: 24, Low: 72 };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const emailOf = (first: string, last: string, domain: string) => `${slug(first)}.${slug(last)}@${domain}`;

// [key, name, industry, type, city, country, annual revenue, employees, owner, description]
const ACCOUNTS: [string, string, string, string, string, string, number, number, DemoUserKey, string][] = [
  ['acme', 'Acme Robotics', 'Manufacturing', 'Customer', 'Detroit', 'United States', 48_000_000, 320, 'james', 'Industrial robotics maker; uses titoForce for fleet analytics and field service.'],
  ['globex', 'Globex Financial', 'Financial Services', 'Customer', 'New York', 'United States', 910_000_000, 4200, 'priya', 'Global retail bank. Strategic account with an active service rollout.'],
  ['initech', 'Initech Software', 'Technology', 'Customer', 'Austin', 'United States', 62_000_000, 450, 'james', 'B2B SaaS vendor; expanding to more teams.'],
  ['blueharbor', 'Blue Harbor Health', 'Healthcare', 'Prospect', 'Boston', 'United States', 230_000_000, 1800, 'priya', 'Regional hospital network evaluating patient engagement tools.'],
  ['summit', 'Summit Retail Group', 'Retail', 'Customer', 'Denver', 'United States', 540_000_000, 6100, 'maria', 'Omnichannel retailer with 140 stores. Renewal due this quarter.'],
  ['brightpath', 'Brightpath Education', 'Education', 'Prospect', 'Toronto', 'Canada', 18_000_000, 140, 'james', 'Online university looking for an admissions CRM.'],
  ['northstar', 'Northstar Energy', 'Energy', 'Customer', 'Houston', 'United States', 1_200_000_000, 7800, 'priya', 'Energy producer; field service add-on in evaluation.'],
  ['vertex', 'Vertex Media', 'Media', 'Prospect', 'London', 'United Kingdom', 75_000_000, 380, 'james', 'Digital publisher interested in marketing automation.'],
  ['cobalt', 'Cobalt Logistics', 'Manufacturing', 'Partner', 'Rotterdam', 'Netherlands', 150_000_000, 1100, 'maria', 'Implementation and referral partner in Europe.'],
  ['evergreen', 'Evergreen Bank', 'Financial Services', 'Prospect', 'Seattle', 'United States', 380_000_000, 2300, 'priya', 'Community bank modernizing compliance workflows.'],
  ['helix', 'Helix Biotech', 'Healthcare', 'Customer', 'San Diego', 'United States', 95_000_000, 520, 'james', 'Biotech lab using work boards for lab operations.'],
  ['orbit', 'Orbit Telecom', 'Technology', 'Churned', 'Dublin', 'Ireland', 260_000_000, 1900, 'priya', 'Churned last quarter after moving to a competitor.'],
  ['pioneer', 'Pioneer Foods', 'Retail', 'Prospect', 'Chicago', 'United States', 120_000_000, 950, 'james', 'Food distributor building a supplier portal.'],
  ['quantum', 'Quantum Analytics', 'Technology', 'Customer', 'San Francisco', 'United States', 34_000_000, 210, 'priya', 'Analytics startup; fast-growing seat count.'],
  ['redwood', 'Redwood Capital', 'Financial Services', 'Prospect', 'Charlotte', 'United States', 66_000_000, 160, 'maria', 'Private equity firm evaluating an investor CRM.'],
  ['silverline', 'Silverline Airlines', 'Other', 'Prospect', 'Atlanta', 'United States', 2_400_000_000, 14000, 'priya', 'Airline modernizing customer care across 30 call centers.'],
];

// [key, first, last, title, account, lead source]
const CONTACTS: [string, string, string, string, string, string][] = [
  ['dana', 'Dana', 'Whitfield', 'VP Operations', 'acme', 'Referral'],
  ['marcus', 'Marcus', 'Lee', 'Procurement Manager', 'acme', 'Referral'],
  ['elena', 'Elena', 'Petrova', 'Chief Information Officer', 'globex', 'Partner'],
  ['tom', 'Tom', 'Becker', 'Director of IT', 'globex', 'Partner'],
  ['sophie', 'Sophie', 'Laurent', 'Regional IT Director, EMEA', 'globex_emea', 'Referral'],
  ['grace', 'Grace', 'Okafor', 'CTO', 'initech', 'Web'],
  ['peter', 'Peter', 'Novak', 'Engineering Manager', 'initech', 'Web'],
  ['aisha', 'Aisha', 'Rahman', 'Chief Medical Information Officer', 'blueharbor', 'Web'],
  ['kevin', 'Kevin', 'Doyle', 'IT Director', 'blueharbor', 'Web'],
  ['laura', 'Laura', 'Chen', 'SVP Digital', 'summit', 'Event'],
  ['diego', 'Diego', 'Alvarez', 'Head of Customer Experience', 'summit', 'Event'],
  ['natalie', 'Natalie', 'Brooks', 'Dean of Technology', 'brightpath', 'Webinar'],
  ['victor', 'Victor', 'Hughes', 'COO', 'northstar', 'Event'],
  ['ingrid', 'Ingrid', 'Svensson', 'Head of Procurement', 'northstar', 'Event'],
  ['oliver', 'Oliver', 'Grant', 'Head of Partnerships', 'vertex', 'Advertisement'],
  ['jan', 'Jan', 'de Vries', 'Partner Manager', 'cobalt', 'Partner'],
  ['sanne', 'Sanne', 'Bakker', 'Operations Lead', 'cobalt', 'Partner'],
  ['robert', 'Robert', 'Hale', 'CFO', 'evergreen', 'Referral'],
  ['mei', 'Mei', 'Tanaka', 'VP Technology', 'evergreen', 'Referral'],
  ['samuel', 'Samuel', 'Ortiz', 'Director of Research Operations', 'helix', 'Web'],
  ['chloe', 'Chloe', 'Martin', 'IT Manager', 'helix', 'Web'],
  ['fiona', 'Fiona', 'Walsh', 'Customer Operations Lead', 'orbit', 'Other'],
  ['ahmed', 'Ahmed', 'Hassan', 'VP Supply Chain', 'pioneer', 'Trade Show'],
  ['lily', 'Lily', 'Zhang', 'CEO', 'quantum', 'Referral'],
  ['ben', 'Ben', 'Carter', 'Head of Data', 'quantum', 'Referral'],
  ['charles', 'Charles', 'Dunn', 'Managing Partner', 'redwood', 'Referral'],
  ['monica', 'Monica', 'Reyes', 'VP Customer Experience', 'silverline', 'Event'],
  ['arjun', 'Arjun', 'Nair', 'Director of Digital', 'silverline', 'Event'],
];

// [key, name, account, contact, stage, amount, close (days from today), type, source, next step, owner, created days ago, loss reason]
const OPPORTUNITIES: [string, string, string, string, string, number, number, string, string, string, DemoUserKey, number, string?][] = [
  ['acme_fleet', 'Acme Robotics — Fleet Analytics Expansion', 'acme', 'dana', 'Negotiation', 185_000, 12, 'Existing Business', 'Referral', 'Legal review of MSA', 'james', 60],
  ['globex_service', 'Globex Financial — Service Rollout', 'globex', 'elena', 'Proposal', 420_000, 35, 'Existing Business', 'Partner', 'Present proposal to the CIO', 'priya', 45],
  ['blueharbor', 'Blue Harbor Health — Patient Engagement', 'blueharbor', 'aisha', 'Needs Analysis', 260_000, 70, 'New Business', 'Web', 'Discovery workshop with clinical IT', 'priya', 30],
  ['brightpath', 'Brightpath Education — Admissions CRM', 'brightpath', 'natalie', 'Qualification', 48_000, 55, 'New Business', 'Webinar', 'Confirm the budget owner', 'james', 20],
  ['northstar_fs', 'Northstar Energy — Field Service Add-on', 'northstar', 'victor', 'Proposal', 310_000, 28, 'Existing Business', 'Event', 'Pricing call with procurement', 'priya', 50],
  ['vertex_ma', 'Vertex Media — Marketing Automation', 'vertex', 'oliver', 'Prospecting', 95_000, 90, 'New Business', 'Advertisement', 'Intro call with marketing team', 'james', 10],
  ['evergreen_compliance', 'Evergreen Bank — Compliance Workflows', 'evergreen', 'mei', 'Needs Analysis', 230_000, 60, 'New Business', 'Referral', 'Complete the security questionnaire', 'priya', 25],
  ['pioneer_portal', 'Pioneer Foods — Supplier Portal', 'pioneer', 'ahmed', 'Qualification', 140_000, 75, 'New Business', 'Trade Show', 'Map stakeholders', 'james', 18],
  ['quantum_seats', 'Quantum Analytics — Seat Expansion', 'quantum', 'ben', 'Negotiation', 62_000, 8, 'Existing Business', 'Other', 'Finalize seat count', 'priya', 35],
  ['redwood', 'Redwood Capital — Investor CRM', 'redwood', 'charles', 'Proposal', 88_000, -5, 'New Business', 'Referral', '', 'maria', 70],
  ['silverline', 'Silverline Airlines — Customer Care Modernization', 'silverline', 'monica', 'Prospecting', 750_000, 120, 'New Business', 'Event', 'Executive briefing', 'priya', 7],
  ['summit_renewal', 'Summit Retail — Annual Renewal', 'summit', 'laura', 'Negotiation', 210_000, 20, 'Renewal', 'Other', 'Send the renewal quote', 'maria', 40],
  ['helix_labops', 'Helix Biotech — Lab Ops Projects', 'helix', 'samuel', 'Needs Analysis', 76_000, 45, 'Existing Business', 'Web', 'Demo work boards', 'james', 22],
  ['cobalt_referral', 'Cobalt Logistics — Partner Referral Program', 'cobalt', 'jan', 'Qualification', 54_000, 40, 'New Business', 'Partner', 'Agree on referral terms', 'maria', 15],
  ['initech_expansion', 'Initech Software — Platform Expansion', 'initech', 'grace', 'Proposal', 128_000, -12, 'Existing Business', 'Web', 'Follow up on proposal', 'james', 80],
  ['globex_emea', 'Globex Financial EMEA — Regional Rollout', 'globex_emea', 'sophie', 'Prospecting', 180_000, 100, 'Existing Business', 'Referral', 'Intro with EMEA IT', 'priya', 5],
  ['acme_initial', 'Acme Robotics — Initial Platform', 'acme', 'dana', 'Closed Won', 150_000, -160, 'New Business', 'Referral', '', 'james', 220],
  ['globex_sales', 'Globex Financial — Sales Platform', 'globex', 'elena', 'Closed Won', 380_000, -130, 'New Business', 'Partner', '', 'priya', 200],
  ['summit_commerce', 'Summit Retail — Commerce Integration', 'summit', 'diego', 'Closed Won', 96_000, -100, 'Existing Business', 'Other', '', 'maria', 150],
  ['northstar_platform', 'Northstar Energy — Platform', 'northstar', 'victor', 'Closed Won', 275_000, -75, 'New Business', 'Event', '', 'priya', 140],
  ['helix_starter', 'Helix Biotech — Starter', 'helix', 'chloe', 'Closed Won', 42_000, -50, 'New Business', 'Web', '', 'james', 90],
  ['quantum_platform', 'Quantum Analytics — Platform', 'quantum', 'lily', 'Closed Won', 58_000, -30, 'New Business', 'Referral', '', 'priya', 75],
  ['initech_support', 'Initech Software — Premium Support', 'initech', 'peter', 'Closed Won', 36_000, -12, 'Existing Business', 'Web', '', 'james', 40],
  ['acme_training', 'Acme Robotics — Training Services', 'acme', 'marcus', 'Closed Won', 24_000, -3, 'Existing Business', 'Referral', '', 'james', 20],
  ['orbit_renewal', 'Orbit Telecom — Renewal', 'orbit', 'fiona', 'Closed Lost', 190_000, -40, 'Renewal', 'Other', '', 'priya', 100, 'Competitor'],
  ['vertex_pilot', 'Vertex Media — Pilot', 'vertex', 'oliver', 'Closed Lost', 30_000, -90, 'New Business', 'Advertisement', '', 'james', 130, 'No Budget'],
  ['evergreen_pilot', 'Evergreen Bank — Branch Pilot', 'evergreen', 'robert', 'Closed Lost', 65_000, -20, 'New Business', 'Referral', '', 'priya', 80, 'Timing'],
  ['pioneer_ecom', 'Pioneer Foods — E-commerce', 'pioneer', 'ahmed', 'Closed Lost', 45_000, -110, 'New Business', 'Trade Show', '', 'james', 160, 'Price'],
];

// [key, name, type, status, start, end (days from today), budget, actual cost, expected revenue, owner, description]
const CAMPAIGNS: [string, string, string, string, number, number, number, number, number, DemoUserKey, string][] = [
  ['webinar', 'Spring Product Webinar', 'Webinar', 'Completed', -75, -74, 8_000, 7_200, 150_000, 'liam', 'Live product tour of AI agents and automation.'],
  ['summit', 'Annual Customer Summit', 'Event', 'Active', -30, 15, 60_000, 41_000, 600_000, 'liam', 'Two-day customer event with partner booths.'],
  ['ai_launch', 'AI Assistant Launch Emails', 'Email', 'Active', -45, 30, 5_000, 2_600, 120_000, 'liam', 'Nurture series announcing titoForce Copilot.'],
  ['paid_search', 'Paid Search — CRM Switchers', 'Advertisement', 'Active', -60, 60, 25_000, 14_000, 200_000, 'liam', 'Search ads targeting teams replacing legacy CRMs.'],
  ['roadshow', 'Partner Roadshow', 'Event', 'Planned', 20, 50, 30_000, 0, 250_000, 'liam', 'Five-city roadshow with implementation partners.'],
];

// [key, first, last, title, company, domain, source, industry, revenue, employees, status, campaign, estimated value, owner, created days ago, description]
const LEADS: [string, string, string, string, string, string, string, string, number, number, string, string | null, number, DemoUserKey, number, string][] = [
  ['jordan', 'Jordan', 'Blake', 'VP of Operations', 'Lakeside Manufacturing', 'lakesidemfg.example', 'Trade Show', 'Manufacturing', 85_000_000, 600, 'New', 'summit', 90_000, 'james', 0.1, 'Met at the summit booth. Replacing a legacy CRM; asked for pricing and a demo next week.'],
  ['sara', 'Sara', 'Nilsson', 'Head of Customer Support', 'Fjord Outfitters', 'fjordoutfitters.example', 'Web', 'Retail', 40_000_000, 320, 'New', 'paid_search', 60_000, 'priya', 0.6, 'Filled in the Contact Sales form. Wants help desk and CRM in one tool; timeline is this quarter.'],
  ['kenji', 'Kenji', 'Watanabe', 'IT Manager', 'Sakura Logistics', 'sakuralogistics.example', 'Webinar', 'Manufacturing', 22_000_000, 180, 'New', 'webinar', 35_000, 'james', 2, 'Attended the webinar and asked about integrations.'],
  ['lucy', 'Lucy', 'Hart', 'Owner', 'Hart & Co Bakery', 'gmail.example', 'Advertisement', 'Retail', 1_200_000, 18, 'New', 'paid_search', 3_000, 'priya', 3, 'Small bakery looking for a simple contact list.'],
  ['omar', 'Omar', 'Farouk', 'Chief Digital Officer', 'Desert Sun Hotels', 'desertsunhotels.example', 'Referral', 'Other', 300_000_000, 2500, 'New', null, 220_000, 'maria', 1, 'Referred by Northstar Energy. Budget approved for a CRM consolidation; RFP goes out next month.'],
  ['tessa', 'Tessa', 'Moreau', 'Director of IT', 'Alpine Credit Union', 'alpinecu.example', 'Web', 'Financial Services', 120_000_000, 700, 'New', 'ai_launch', 80_000, 'priya', 4, 'Downloaded the security whitepaper.'],
  ['felix', 'Felix', 'Wagner', 'Procurement Lead', 'Rheinwerk Tools', 'rheinwerk.example', 'Cold Call', 'Manufacturing', 60_000_000, 400, 'New', null, 45_000, 'james', 5, ''],
  ['carmen', 'Carmen', 'Ruiz', 'Founder', 'Ruiz Design Studio', 'ruizdesign.example', 'Web', 'Media', 2_000_000, 12, 'New', 'paid_search', 6_000, 'james', 2, 'Interested in a trial for a small team.'],
  ['samuel', 'Samuel', 'Adeyemi', 'CTO', 'Lagos FinServe', 'lagosfinserve.example', 'Partner', 'Financial Services', 45_000_000, 260, 'Working', null, 70_000, 'james', 12, 'Partner introduction via Cobalt Logistics. Discussing a proposal timeline.'],
  ['nora', 'Nora', 'Lindqvist', 'VP Customer Experience', 'Nordic Telecom Group', 'nordictelecom.example', 'Event', 'Technology', 900_000_000, 5200, 'Working', 'summit', 300_000, 'priya', 15, 'Wants a demo of AI case triage for 400 agents.'],
  ['victor', 'Victor', 'Chang', 'Director of Sales Operations', 'Pacific Rim Traders', 'pacificrim.example', 'Webinar', 'Retail', 70_000_000, 450, 'Working', 'webinar', 65_000, 'james', 20, 'Asked for pricing after the webinar.'],
  ['amelia', 'Amelia', 'Scott', 'Operations Manager', 'Greenfield Clinics', 'greenfieldclinics.example', 'Web', 'Healthcare', 30_000_000, 240, 'Working', 'ai_launch', 40_000, 'priya', 9, ''],
  ['patrick', 'Patrick', "O'Neill", 'Head of IT', 'Emerald Insurance', 'emeraldins.example', 'Referral', 'Financial Services', 210_000_000, 1300, 'Working', null, 150_000, 'maria', 25, 'Evaluating three vendors; decision expected next quarter.'],
  ['yuki', 'Yuki', 'Sato', 'Product Manager', 'Neon Arcade Games', 'neonarcade.example', 'Web', 'Media', 15_000_000, 90, 'Working', 'paid_search', 20_000, 'james', 18, ''],
  ['hugo', 'Hugo', 'Lambert', 'VP Finance', 'Lumière Cosmetics', 'lumiere.example', 'Trade Show', 'Retail', 140_000_000, 800, 'Qualified', 'summit', 120_000, 'priya', 30, 'Budget approved; wants a proposal by the end of the month.'],
  ['isaac', 'Isaac', 'Newman', 'CIO', 'Meridian Health Partners', 'meridianhealth.example', 'Referral', 'Healthcare', 400_000_000, 3000, 'Qualified', null, 280_000, 'maria', 22, 'Executive sponsor confirmed. RFP response due soon.'],
  ['zara', 'Zara', 'Ahmed', 'Director of Operations', 'Swift Couriers', 'swiftcouriers.example', 'Partner', 'Manufacturing', 55_000_000, 900, 'Qualified', null, 90_000, 'james', 28, 'Needs field service and dispatch boards.'],
  ['tom_f', 'Tom', 'Fischer', 'Student', 'University Research Lab', 'gmail.example', 'Web', 'Education', 0, 5, 'Unqualified', null, 0, 'james', 40, 'Student project, no purchase intent.'],
  ['bea', 'Bea', 'Larsen', 'Assistant', 'Larsen Family Farm', 'outlook.example', 'Advertisement', 'Other', 500_000, 6, 'Unqualified', 'paid_search', 0, 'priya', 35, ''],
  ['mark', 'Mark', 'Ellis', 'Sales Representative', 'Contoso CRM Systems', 'contosocrm.example', 'Web', 'Technology', 20_000_000, 150, 'Unqualified', null, 0, 'james', 50, 'Competitor research.'],
  ['grace_l', 'Grace', 'Okafor', 'CTO', 'Initech Software', 'initechsoftware.example', 'Web', 'Technology', 62_000_000, 450, 'Converted', 'ai_launch', 128_000, 'james', 85, 'Converted to an expansion opportunity.'],
  ['lily_l', 'Lily', 'Zhang', 'CEO', 'Quantum Analytics', 'quantumanalytics.example', 'Referral', 'Technology', 34_000_000, 210, 'Converted', null, 58_000, 'priya', 80, ''],
  ['aisha_l', 'Aisha', 'Rahman', 'Chief Medical Information Officer', 'Blue Harbor Health', 'blueharborhealth.example', 'Web', 'Healthcare', 230_000_000, 1800, 'Converted', 'webinar', 260_000, 'priya', 35, ''],
  ['ahmed_l', 'Ahmed', 'Hassan', 'VP Supply Chain', 'Pioneer Foods', 'pioneerfoods.example', 'Trade Show', 'Retail', 120_000_000, 950, 'Converted', 'summit', 140_000, 'james', 25, ''],
];
const CONVERTED: Record<string, [string, string, string]> = {
  grace_l: ['initech', 'grace', 'initech_expansion'],
  lily_l: ['quantum', 'lily', 'quantum_platform'],
  aisha_l: ['blueharbor', 'aisha', 'blueharbor'],
  ahmed_l: ['pioneer', 'ahmed', 'pioneer_portal'],
};

// [key, name, code, family, list price, description]
const PRODUCTS: [string, string, string, string, number, string][] = [
  ['enterprise', 'Platform — Enterprise (per user / year)', 'TF-PLAT-ENT', 'Platform', 1_500, 'All apps, unlimited custom objects, automations and approvals.'],
  ['professional', 'Platform — Professional (per user / year)', 'TF-PLAT-PRO', 'Platform', 900, 'Sales, service and marketing apps for growing teams.'],
  ['ai', 'AI Agents Add-on (per user / year)', 'TF-AI', 'Add-on', 360, 'Copilot and autonomous agents with approval controls.'],
  ['service', 'Service Hub Add-on (per user / year)', 'TF-SVC', 'Add-on', 600, 'Case management, SLAs and knowledge base.'],
  ['implementation', 'Implementation Services (per day)', 'TF-IMPL', 'Services', 1_800, 'Solution architect day rate.'],
  ['support', 'Premium Support (annual)', 'TF-SUP', 'Support', 12_000, '24/7 support with a 1-hour response time for urgent cases.'],
];

// [key, name, opportunity, account, status, discount, owner, lines: [product, quantity, unit price?]]
const QUOTES: [string, string, string, string, string, number, DemoUserKey, [string, number, number?][]][] = [
  ['acme', 'Q-1001 Acme Fleet Analytics', 'acme_fleet', 'acme', 'Sent', 10, 'james', [['enterprise', 100], ['ai', 100], ['implementation', 10]]],
  ['globex', 'Q-1002 Globex Service Rollout', 'globex_service', 'globex', 'Draft', 25, 'priya', [['service', 400], ['enterprise', 100], ['support', 1]]],
  ['summit', 'Q-1003 Summit Annual Renewal', 'summit_renewal', 'summit', 'Sent', 5, 'maria', [['professional', 200], ['support', 1], ['implementation', 5, 1_600]]],
];

// [key, title, category, status, body]
const ARTICLES: [string, string, string, string, string][] = [
  ['password', 'Resetting your password', 'Access', 'Published', 'Click **Forgot password** on the sign-in page and follow the emailed link within 30 minutes. If no email arrives, check spam or ask your administrator to reset it from Setup → Users. Accounts lock for 15 minutes after 10 failed attempts.'],
  ['sso', 'Troubleshooting SAML single sign-on', 'Access', 'Published', 'Login loops after an identity provider certificate rotation usually mean the new signing certificate was not uploaded. Upload the new certificate under Setup → Security → SSO, confirm the entity ID, and ask users to clear cookies. Keep the old certificate active until all sessions have expired.'],
  ['invoice', 'Understanding your invoice', 'Billing', 'Published', 'Invoices list active seats on the billing date. Seats removed mid-cycle are credited on the next invoice. Contact billing to correct seat counts or update purchase order numbers.'],
  ['duplicate_charge', 'Duplicate credit card charges', 'Billing', 'Published', 'A duplicate charge is usually a pending authorization that drops off within 5 business days. If both charges settle, open a Billing case with the last four digits of the card and we will refund the duplicate.'],
  ['rate_limits', 'Fixing API rate limit (429) errors', 'Technical', 'Published', 'The API allows 100 requests per 10 seconds per integration user. Batch updates, honor the Retry-After header, and spread nightly syncs across the hour to avoid 429 errors.'],
  ['csv', 'Importing data from CSV without duplicates', 'Technical', 'Published', 'Duplicate rules compare emails case-insensitively. Clean the file, map the email column, and run the import with duplicate checking enabled. Use Export CSV to back up records before large imports.'],
  ['approvals', 'Building approval processes', 'General', 'Published', 'Go to Automations → Approval Processes. Choose the object, entry conditions (for example Discount greater than 15), the approver (a user or a field path such as employee.manager.user) and the actions to run on submit, approve and reject.'],
  ['export', 'Exporting dashboards and reports', 'Technical', 'Published', 'Open a report and click Export CSV. Large exports are limited to 10,000 rows; filter the report to export in smaller batches. A 500 error during export usually means a formula field references a deleted field.'],
  ['dependencies', 'Roadmap: dependencies on the timeline view', 'Feature Request', 'Draft', 'Dependencies between work items are planned. Until then, use the Blocked tag and due dates to sequence work.'],
];

// [key, subject, account, contact, status, priority, category, origin, owner, created hours ago, description, resolution]
const CASES: [string, string, string, string, string, string, string, string, DemoUserKey, number, string, string?][] = [
  ['export', 'Dashboard export failing with a 500 error', 'acme', 'marcus', 'Working', 'High', 'Technical', 'Email', 'sofia', 30, 'Exports of the Fleet dashboard fail with a 500 error since this morning. This is blocking our weekly operations review.'],
  ['sso', 'SSO login loop after certificate rotation', 'globex', 'tom', 'Escalated', 'Urgent', 'Access', 'Phone', 'sofia', 6, 'All users at Globex cannot access the app after we rotated the SAML certificate. Production impact for 4,000 users.'],
  ['invoice', 'Invoice shows the wrong seat count', 'summit', 'diego', 'New', 'Medium', 'Billing', 'Email', 'sofia', 3, 'Our latest invoice lists 220 seats; we only have 200 active users.'],
  ['gantt', 'Request: dependencies on the timeline view', 'helix', 'samuel', 'New', 'Low', 'Feature Request', 'Web', 'sofia', 26, 'It would be nice to link work items on the timeline so delays move dependent tasks.'],
  ['rate_limit', 'API rate limit errors during nightly sync', 'northstar', 'victor', 'Working', 'High', 'Technical', 'Email', 'sofia', 50, 'Our integration sync fails with 429 errors between 01:00 and 02:00 UTC.'],
  ['reset', 'Password reset email not received', 'brightpath', 'natalie', 'Closed', 'Medium', 'Access', 'Chat', 'sofia', 120, 'I requested a password reset three times but no email arrived.', 'The email was quarantined by the customer’s spam filter. They allow-listed our sender domain.'],
  ['custom_field', 'How do I add a custom field to cases?', 'quantum', 'ben', 'Closed', 'Low', 'General', 'Chat', 'sofia', 200, 'We want to track the product version on each case.', 'Shared the Object Manager guide; customer added the field.'],
  ['duplicates', 'Duplicate contacts after CSV import', 'initech', 'peter', 'Working', 'Medium', 'Technical', 'Web', 'sofia', 70, 'Importing a CSV created duplicates for contacts whose emails were uppercase.'],
  ['refund', 'Refund for unused add-on licenses', 'orbit', 'fiona', 'Closed', 'Low', 'Billing', 'Email', 'admin', 400, 'Please refund the 15 AI add-on licenses we never assigned.', 'Refund processed for 15 unused licenses.'],
  ['tablet', 'Reports page crashes on tablet browsers', 'acme', 'dana', 'New', 'High', 'Technical', 'Phone', 'sofia', 1, 'The reports page crashes when opened on iPad Safari. Field managers cannot see their numbers.'],
  ['bulk_delete', 'Accounts missing after bulk delete', 'cobalt', 'sanne', 'Escalated', 'Urgent', 'Technical', 'Email', 'admin', 20, 'A bulk delete removed more records than expected. We need to restore 40 accounts urgently (possible data loss).'],
  ['double_charge', 'Credit card charged twice this month', 'helix', 'chloe', 'Working', 'Medium', 'Billing', 'Phone', 'sofia', 40, 'We see two identical charges on our corporate card.'],
  ['approval_help', 'Help configuring a discount approval', 'summit', 'laura', 'Working', 'Low', 'General', 'Web', 'sofia', 90, 'How do we require VP approval for discounts over 15%?'],
  ['webhooks', 'Webhook deliveries arriving late', 'quantum', 'ben', 'New', 'Medium', 'Technical', 'Web', 'sofia', 10, 'Our webhook endpoint receives some requests minutes late.'],
  ['mfa', 'MFA codes rejected', 'northstar', 'ingrid', 'Closed', 'High', 'Access', 'Phone', 'sofia', 300, 'Several users get "invalid code" when signing in with MFA.', 'Device clock drift on the users’ laptops; syncing time fixed it.'],
  ['slack', 'Feature request: approval notifications in Slack', 'initech', 'grace', 'New', 'Low', 'Feature Request', 'Email', 'sofia', 48, 'It would be nice to approve requests directly from Slack.'],
  ['slow_views', 'Slow list views with 50k records', 'globex', 'elena', 'Working', 'Medium', 'Technical', 'Email', 'admin', 100, 'List views take 8+ seconds to load for the service team.'],
  ['archived', 'Cannot find archived knowledge articles', 'acme', 'marcus', 'Closed', 'Low', 'Access', 'Chat', 'sofia', 500, 'Two articles disappeared from search.', 'Articles had been archived; restored both to Published.'],
];

// [key, name, cost center]
const DEPARTMENTS: [string, string, string][] = [
  ['exec', 'Executive', 'EX-100'],
  ['sales', 'Sales', 'SA-200'],
  ['cs', 'Customer Success', 'CS-300'],
  ['eng', 'Engineering', 'EN-400'],
  ['marketing', 'Marketing', 'MK-500'],
  ['people', 'People', 'PE-600'],
  ['finance', 'Finance', 'FI-700'],
];

// [key, first, last, title, department, manager, user, location, status, type, hired (days ago), salary, pto balance]
const EMPLOYEES: [string, string, string, string, string, string | null, DemoUserKey | null, string, string, string, number, number, number][] = [
  ['olivia', 'Olivia', 'Bennett', 'Chief Executive Officer', 'exec', null, null, 'San Francisco', 'Active', 'Full-time', 2900, 320_000, 18],
  ['maria', 'Maria', 'Garcia', 'VP of Sales', 'sales', 'olivia', 'maria', 'New York', 'Active', 'Full-time', 1600, 210_000, 15],
  ['james', 'James', 'Chen', 'Account Executive', 'sales', 'maria', 'james', 'Austin', 'Active', 'Full-time', 700, 120_000, 20],
  ['priya', 'Priya', 'Patel', 'Account Executive', 'sales', 'maria', 'priya', 'San Francisco', 'Active', 'Full-time', 900, 125_000, 19],
  ['ethan', 'Ethan', 'Brooks', 'Sales Development Representative', 'sales', 'maria', null, 'Austin', 'Active', 'Full-time', 200, 70_000, 20],
  ['daniel', 'Daniel', 'Wright', 'VP of Customer Success', 'cs', 'olivia', null, 'Chicago', 'Active', 'Full-time', 1400, 190_000, 22],
  ['sofia', 'Sofia', 'Rossi', 'Support Lead', 'cs', 'daniel', 'sofia', 'Dublin', 'Active', 'Full-time', 1100, 95_000, 23],
  ['mia', 'Mia', 'Thompson', 'Support Specialist', 'cs', 'sofia', null, 'Dublin', 'On Leave', 'Full-time', 400, 62_000, 12],
  ['raj', 'Raj', 'Mehta', 'Chief Technology Officer', 'eng', 'olivia', null, 'San Francisco', 'Active', 'Full-time', 2800, 290_000, 25],
  ['alex', 'Alex', 'Morgan', 'CRM Administrator', 'eng', 'raj', 'admin', 'Remote', 'Active', 'Full-time', 1000, 140_000, 20],
  ['grace', 'Grace', 'Liu', 'Engineering Manager', 'eng', 'raj', null, 'Seattle', 'Active', 'Full-time', 1300, 185_000, 16],
  ['noah', 'Noah', 'Williams', 'Software Engineer', 'eng', 'grace', 'noah', 'Remote', 'Active', 'Full-time', 500, 135_000, 20],
  ['lucas', 'Lucas', 'Fernandez', 'Senior Software Engineer', 'eng', 'grace', null, 'Barcelona', 'Active', 'Full-time', 1200, 150_000, 24],
  ['hannah', 'Hannah', 'Kim', 'HR Director', 'people', 'olivia', 'hannah', 'Chicago', 'Active', 'Full-time', 1500, 170_000, 21],
  ['zoe', 'Zoe', 'Martinez', 'Recruiter', 'people', 'hannah', null, 'Remote', 'Active', 'Contractor', 150, 85_000, 0],
  ['liam', 'Liam', "O'Brien", 'Marketing Manager', 'marketing', 'olivia', 'liam', 'Boston', 'Active', 'Full-time', 800, 130_000, 17],
  ['ava', 'Ava', 'Nguyen', 'Content Marketer', 'marketing', 'liam', null, 'Boston', 'Active', 'Part-time', 300, 55_000, 10],
  ['benjamin', 'Benjamin', 'Cole', 'Finance Director', 'finance', 'olivia', null, 'New York', 'Active', 'Full-time', 2000, 200_000, 19],
  ['emma', 'Emma', 'Johansson', 'Accountant', 'finance', 'benjamin', null, 'New York', 'Active', 'Full-time', 600, 80_000, 20],
  ['ryan', 'Ryan', 'Foster', 'Sales Development Representative', 'sales', 'maria', null, 'Austin', 'Terminated', 'Full-time', 500, 68_000, 0],
];
const DEPARTMENT_HEADS: Record<string, string> = { exec: 'olivia', sales: 'maria', cs: 'daniel', eng: 'raj', marketing: 'liam', people: 'hannah', finance: 'benjamin' };

// [key, project, name, status, priority, assignee, start, due (days from today), estimate hours, tags]
const WORK_ITEMS: [string, string, string, string, string, DemoUserKey, number, number, number, string[]][] = [
  ['kickoff', 'acme', 'Kickoff workshop', 'Done', 'Medium', 'admin', -30, -28, 6, ['Customer']],
  ['objects', 'acme', 'Configure fleet objects and fields', 'Done', 'High', 'noah', -27, -18, 24, ['Backend']],
  ['dash_design', 'acme', 'Dashboard designs', 'In Review', 'Medium', 'admin', -15, -1, 16, ['Design']],
  ['migration', 'acme', 'Data migration from legacy CRM', 'In Progress', 'Critical', 'noah', -10, 5, 40, ['Backend']],
  ['sso', 'acme', 'Set up SSO', 'To Do', 'High', 'admin', 2, 8, 8, ['Backend']],
  ['training', 'acme', 'User training sessions', 'To Do', 'Medium', 'sofia', 20, 30, 12, ['Customer', 'Docs']],
  ['golive', 'acme', 'Go-live checklist', 'Backlog', 'Medium', 'james', 35, 44, 4, ['Customer']],
  ['copy', 'website', 'New homepage copy', 'Done', 'Medium', 'liam', -40, -25, 10, ['Docs']],
  ['pricing', 'website', 'Pricing page redesign', 'In Progress', 'High', 'liam', -20, -2, 20, ['Design']],
  ['nav', 'website', 'Implement new navigation', 'In Progress', 'High', 'noah', -8, 3, 16, ['Frontend']],
  ['links', 'website', 'Fix broken links from the old site', 'To Do', 'Low', 'noah', 1, 6, 4, ['Bug', 'Frontend']],
  ['seo', 'website', 'SEO audit', 'In Review', 'Medium', 'liam', -12, 0, 8, ['Research']],
  ['launch_email', 'website', 'Launch announcement email', 'Backlog', 'Medium', 'liam', 8, 12, 3, ['Docs']],
  ['venue', 'kickoff', 'Book the venue', 'Done', 'High', 'maria', -35, -30, 2, []],
  ['agenda', 'kickoff', 'Agenda and speakers', 'In Progress', 'Medium', 'maria', -10, 7, 6, []],
  ['stories', 'kickoff', 'Customer success stories', 'To Do', 'Medium', 'james', 0, 10, 8, ['Customer']],
  ['demo_script', 'kickoff', 'Demo script for AI agents', 'To Do', 'High', 'priya', 2, 12, 6, ['Docs']],
  ['swag', 'kickoff', 'Order event swag', 'Backlog', 'Low', 'liam', 5, 15, 2, []],
  ['export_hr', 'hris', 'Export employee data from the old HRIS', 'To Do', 'High', 'hannah', 5, 12, 6, []],
  ['map_fields', 'hris', 'Map fields to People objects', 'Backlog', 'Medium', 'admin', 10, 20, 12, ['Backend']],
  ['org_check', 'hris', 'Validate the org chart', 'Backlog', 'Medium', 'hannah', 20, 30, 4, []],
  ['pto_pilot', 'hris', 'Self-service time off pilot', 'Backlog', 'Medium', 'noah', 30, 60, 24, ['Frontend']],
];
// [key, name, status, start, due, account, budget, owner, description]
const PROJECTS: [string, string, string, number, number, string | null, number, DemoUserKey, string][] = [
  ['acme', 'Acme Fleet Analytics Implementation', 'On Track', -30, 45, 'acme', 120_000, 'admin', 'Roll out fleet analytics dashboards and field service for Acme Robotics.'],
  ['website', 'Website Relaunch', 'At Risk', -45, 10, null, 40_000, 'liam', 'New brand, pricing page and navigation.'],
  ['kickoff', 'Sales Kickoff Event', 'On Track', -35, 25, null, 25_000, 'maria', 'Annual sales kickoff with customer speakers.'],
  ['hris', 'HRIS Migration', 'Not Started', 5, 90, null, 60_000, 'hannah', 'Move employee records and time off into titoForce People.'],
];

// [subject, type, status, due (days from today), related key, owner, created days ago, description]
const ACTIVITIES: [string, string, string, number, string | null, DemoUserKey, number, string?][] = [
  ['Discovery call with Dana', 'Call', 'Completed', -55, 'opp:acme_fleet', 'james', 55, 'Pain points: no fleet visibility, manual reporting.'],
  ['Sent MSA redlines', 'Email', 'Completed', -6, 'opp:acme_fleet', 'james', 6],
  ['Negotiation meeting with procurement', 'Meeting', 'Completed', -2, 'opp:acme_fleet', 'james', 2, 'Agreed on a 3-year term; legal is reviewing the liability cap.'],
  ['Send revised order form', 'Task', 'Open', 1, 'opp:acme_fleet', 'james', 2],
  ['Proposal walkthrough with Elena', 'Meeting', 'Completed', -4, 'opp:globex_service', 'priya', 4],
  ['Clinical IT discovery workshop', 'Meeting', 'Completed', -8, 'opp:blueharbor', 'priya', 8],
  ['Pricing call with procurement', 'Call', 'Completed', -3, 'opp:northstar_fs', 'priya', 3],
  ['Intro call with Oliver', 'Call', 'Completed', -9, 'opp:vertex_ma', 'james', 9],
  ['Security questionnaire received', 'Email', 'Completed', -5, 'opp:evergreen_compliance', 'priya', 5],
  ['Answer the security questionnaire', 'Task', 'Open', 3, 'opp:evergreen_compliance', 'priya', 5],
  ['Renewal kickoff with Laura', 'Meeting', 'Completed', -10, 'opp:summit_renewal', 'maria', 10],
  ['Send renewal quote to Summit', 'Task', 'Open', -1, 'opp:summit_renewal', 'maria', 10],
  ['Proposal sent to Grace', 'Email', 'Completed', -40, 'opp:initech_expansion', 'james', 40],
  ['Follow up on the Initech proposal', 'Task', 'Open', -3, 'opp:initech_expansion', 'james', 20],
  ['Prepare executive briefing deck', 'Task', 'Open', 0, 'opp:silverline', 'priya', 3],
  ['Quarterly business review', 'Meeting', 'Completed', -20, 'acc:northstar', 'priya', 20],
  ['Weekly pipeline review', 'Meeting', 'Open', 2, null, 'maria', 1],
  ['Partner intro follow-up', 'Email', 'Completed', -7, 'lead:samuel', 'james', 7],
  ['Webinar follow-up', 'Email', 'Completed', -12, 'lead:victor', 'james', 12],
  ['Called Tom about the SSO outage', 'Call', 'Completed', 0, 'case:sso', 'sofia', 0.2, 'Customer confirmed the new certificate was not uploaded.'],
  ['Escalated to engineering', 'Note', 'Completed', 0, 'case:sso', 'sofia', 0.1],
  ['Asked the customer for a HAR file', 'Email', 'Completed', -1, 'case:export', 'sofia', 1],
  ['Restore deleted accounts for Cobalt', 'Task', 'Open', 0, 'case:bulk_delete', 'admin', 0.8],
  ['Reply to the seat count question', 'Task', 'Open', -1, 'case:invoice', 'sofia', 0.1],
  ['Publish the SSO troubleshooting update', 'Task', 'Open', 5, 'kav:sso', 'sofia', 1],
  ['Approve launch email copy', 'Task', 'Open', 2, 'cmp:ai_launch', 'liam', 3],
  ['Shortlist roadshow venues', 'Task', 'Open', 7, 'cmp:roadshow', 'liam', 2],
  ['Review paid search spend', 'Task', 'Open', -2, 'cmp:paid_search', 'liam', 6],
  ['Prepare the offer for Divya Iyer', 'Task', 'Open', 0, 'cnd:divya', 'hannah', 2],
  ['Plan next month’s onboarding cohort', 'Task', 'Open', 4, null, 'hannah', 1],
  ['Code review: data migration', 'Task', 'Open', 1, 'wki:migration', 'noah', 1],
  ['Fix the navigation bug on mobile', 'Task', 'Open', -1, 'wki:nav', 'noah', 3],
  ['Review agent automation logs', 'Task', 'Open', 1, null, 'admin', 1],
  ['Set up SSO for Acme', 'Task', 'Open', 3, 'wki:sso', 'admin', 2],
];

/**
 * Loads a realistic, fictional demo company. Records are written silently (no automations) with
 * backdated timestamps; computed values the automations would set are filled in directly.
 */
export async function seedDemoData(s: Services, users: DemoUsers, processes: SeededProcesses, now = new Date()): Promise<void> {
  const ids = new Map<string, string>();
  const ref = (key: string): string => {
    const id = ids.get(key);
    if (!id) throw new Error(`Demo seed: unknown reference ${key}`);
    return id;
  };
  const as = (u: DemoUserKey): Principal => ({ type: 'user', userId: users[u].id, name: users[u].name, permissions: null });
  const day = (n: number) => isoDate(addDays(now, n));
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const make = async (key: string | null, object: string, owner: DemoUserKey, createdDaysAgo: number, fields: RecordData): Promise<CrmRecord> => {
    const rec = await s.records.create(as(owner), object, { ...fields, owner_id: users[owner].id }, { silent: true, allowDuplicates: true, timestamp: ago(createdDaysAgo) });
    if (key) ids.set(key, rec.id);
    return rec;
  };
  const domains = new Map<string, string>();

  // ----- Marketing -----
  for (const [key, name, type, status, start, end, budget, cost, expected, owner, description] of CAMPAIGNS) {
    await make(`cmp:${key}`, 'campaign', owner, Math.max(1, -start + 20), {
      name,
      type,
      status,
      start_date: day(start),
      end_date: day(end),
      budget,
      actual_cost: cost,
      expected_revenue: expected,
      description,
    });
  }

  // ----- Sales -----
  let phone = 100;
  const nextPhone = () => `+1 555 01${String(phone++ % 100).padStart(2, '0')}`;
  for (const [key, name, industry, type, city, country, revenue, employees, owner, description] of ACCOUNTS) {
    const domain = `${slug(name)}.example`;
    domains.set(key, domain);
    await make(`acc:${key}`, 'account', owner, 250 - ACCOUNTS.findIndex((a) => a[0] === key) * 8, {
      name,
      industry,
      type,
      website: `https://www.${domain}`,
      phone: nextPhone(),
      annual_revenue: revenue,
      employees,
      billing_city: city,
      billing_country: country,
      description,
    });
  }
  domains.set('globex_emea', 'globexfinancial.example');
  await make('acc:globex_emea', 'account', 'priya', 60, {
    name: 'Globex Financial EMEA',
    industry: 'Financial Services',
    type: 'Customer',
    parent_account: ref('acc:globex'),
    website: 'https://emea.globexfinancial.example',
    phone: nextPhone(),
    annual_revenue: 210_000_000,
    employees: 900,
    billing_city: 'Paris',
    billing_country: 'France',
    description: 'European subsidiary of Globex Financial.',
  });
  const accountOwner = (key: string): DemoUserKey => (key === 'globex_emea' ? 'priya' : ACCOUNTS.find((a) => a[0] === key)![8]);

  for (const [key, first, last, title, account, source] of CONTACTS) {
    const a = ACCOUNTS.find((x) => x[0] === account);
    await make(`con:${key}`, 'contact', accountOwner(account), 200 - CONTACTS.findIndex((c) => c[0] === key) * 5, {
      first_name: first,
      last_name: last,
      title,
      account: ref(`acc:${account}`),
      email: emailOf(first, last, domains.get(account)!),
      phone: nextPhone(),
      lead_source: source,
      mailing_city: a?.[4] ?? 'Paris',
      mailing_country: a?.[5] ?? 'France',
    });
  }

  for (const [key, name, code, family, price, description] of PRODUCTS) {
    await make(`prd:${key}`, 'product', 'admin', 300, { name, product_code: code, family, list_price: price, active: true, description });
  }

  for (const [key, name, account, contact, stage, amount, close, type, source, nextStep, owner, created, loss] of OPPORTUNITIES) {
    const [probability, forecast] = STAGE_DEFAULTS[stage]!;
    await make(`opp:${key}`, 'opportunity', owner, created, {
      name,
      account: ref(`acc:${account}`),
      primary_contact: ref(`con:${contact}`),
      stage,
      amount,
      probability,
      forecast_category: forecast,
      close_date: day(close),
      type,
      lead_source: source,
      next_step: nextStep || null,
      loss_reason: loss ?? null,
    });
  }

  for (const [key, first, last, title, company, domain, source, industry, revenue, employees, status, campaign, value, owner, created, description] of LEADS) {
    const fields: RecordData = {
      first_name: first,
      last_name: last,
      title,
      company,
      email: emailOf(first, last, domain),
      phone: status === 'New' && key === 'felix' ? null : nextPhone(),
      website: domain.startsWith('gmail') || domain.startsWith('outlook') ? null : `https://www.${domain}`,
      status,
      lead_source: source,
      campaign: campaign ? ref(`cmp:${campaign}`) : null,
      industry,
      annual_revenue: revenue || null,
      employees,
      estimated_value: value || null,
      description: description || null,
    };
    // New leads are left unscored so the Lead Qualifier agent has work to do in the demo.
    if (status !== 'New') {
      const score = scoreLead(fields);
      fields.lead_score = score.score;
      fields.rating = score.rating;
    }
    const conv = CONVERTED[key];
    if (conv) {
      fields.converted_account = ref(`acc:${conv[0]}`);
      fields.converted_contact = ref(`con:${conv[1]}`);
      fields.converted_opportunity = ref(`opp:${conv[2]}`);
    }
    await make(`lead:${key}`, 'lead', owner, created, fields);
  }

  for (const [key, name, opp, account, status, discount, owner, lines] of QUOTES) {
    const q = await make(`quo:${key}`, 'quote', owner, 6, {
      name,
      opportunity: ref(`opp:${opp}`),
      account: ref(`acc:${account}`),
      status,
      discount,
      expiration_date: day(30),
      terms: 'Annual subscription billed yearly in advance. Prices in USD. Valid for 30 days.',
    });
    for (const [product, quantity, price] of lines) {
      const p = PRODUCTS.find((x) => x[0] === product)!;
      await make(null, 'quote_line_item', owner, 6, { name: p[1], quote: q.id, product: ref(`prd:${product}`), quantity, unit_price: price ?? p[4] });
    }
  }

  // ----- Service -----
  for (const [key, title, category, status, body] of ARTICLES) {
    await make(`kav:${key}`, 'knowledge_article', 'sofia', 120 - ARTICLES.findIndex((a) => a[0] === key) * 10, { title, category, status, body });
  }

  for (const [key, subject, account, contact, status, priority, category, origin, owner, hoursAgo, description, resolution] of CASES) {
    const createdAt = new Date(now.getTime() - hoursAgo * 3_600_000);
    await make(`case:${key}`, 'case', owner, hoursAgo / 24, {
      subject,
      status,
      priority,
      category,
      origin,
      account: ref(`acc:${account}`),
      contact: ref(`con:${contact}`),
      sla_due: new Date(createdAt.getTime() + SLA_HOURS[priority]! * 3_600_000).toISOString(),
      description,
      resolution: resolution ?? null,
    });
  }

  await make('wfm:sales', 'web_form', 'james', 90, {
    name: 'Contact Sales',
    active: true,
    target_object: 'lead',
    form_fields: 'first_name,last_name,email,phone,company,title,description',
    description: 'Tell us about your team and we will get back to you within one business day.',
    submit_label: 'Talk to sales',
    success_message: 'Thanks! A product specialist will reach out within one business day.',
    campaign: ref('cmp:paid_search'),
    submissions: 0,
  });
  await make('wfm:support', 'web_form', 'sofia', 90, {
    name: 'Support Request',
    active: true,
    target_object: 'case',
    form_fields: 'supplied_name,supplied_email,subject,description',
    description: 'Describe the problem and our support team will respond according to your plan’s SLA.',
    submit_label: 'Submit request',
    success_message: 'Thanks — we created a support case and will reply by email.',
    submissions: 0,
  });

  // ----- People -----
  for (const [key, name, costCenter] of DEPARTMENTS) await make(`dep:${key}`, 'department', 'hannah', 1000, { name, cost_center: costCenter });
  for (const [key, first, last, title, dept, manager, user, location, status, type, hired, salary, pto] of EMPLOYEES) {
    await make(`emp:${key}`, 'employee', 'hannah', Math.min(hired, 900), {
      first_name: first,
      last_name: last,
      job_title: title,
      department: ref(`dep:${dept}`),
      manager: manager ? ref(`emp:${manager}`) : null,
      user: user ? users[user].id : null,
      email: user ? users[user].email : emailOf(first, last, 'titoforce.example'),
      phone: nextPhone(),
      location,
      status,
      employment_type: type,
      hire_date: day(-hired),
      salary,
      pto_balance: pto,
    });
  }
  for (const [dept, head] of Object.entries(DEPARTMENT_HEADS)) {
    await s.records.update(as('hannah'), 'department', ref(`dep:${dept}`), { head: ref(`emp:${head}`) }, { silent: true, timestamp: ago(900) });
  }

  const timeOff: [string, string, string, number, number, string, string][] = [
    ['noah', 'noah', 'Vacation', 14, 18, 'Draft', 'Family trip.'],
    ['james', 'james', 'Vacation', 21, 25, 'Draft', 'Visiting family.'],
    ['liam', 'liam', 'Vacation', 40, 49, 'Draft', 'Two weeks in Portugal.'],
    ['priya', 'priya', 'Personal', -10, -10, 'Approved', 'Moving day.'],
    ['sofia', 'sofia', 'Sick', -3, -2, 'Approved', ''],
    ['lucas', 'hannah', 'Parental', 30, 120, 'Approved', 'Parental leave.'],
    ['mia', 'hannah', 'Parental', -20, 70, 'Approved', 'Parental leave.'],
  ];
  for (const [emp, owner, type, start, end, status, reason] of timeOff) {
    await make(`tor:${emp}`, 'time_off_request', owner as DemoUserKey, start < 0 ? -start + 7 : 3, {
      employee: ref(`emp:${emp}`),
      type,
      start_date: day(start),
      end_date: day(end),
      status,
      reason: reason || null,
    });
  }

  const period = `${now.getUTCFullYear()} H${now.getUTCMonth() < 6 ? 1 : 2}`;
  const reviews: [string, DemoUserKey, string, string | null, number, string, string | null][] = [
    ['james', 'maria', 'Self Review', null, 14, 'Close $1.2M in new business; mentor the new SDR.', null],
    ['priya', 'maria', 'Manager Review', 'Exceeds', 7, 'Grow strategic accounts by 30%; launch the EMEA rollout.', 'Exceptional quarter; led the Globex expansion.'],
    ['noah', 'admin', 'Not Started', null, 21, 'Ship the data migration tooling; improve test coverage.', null],
    ['sofia', 'hannah', 'Manager Review', 'Meets', 10, 'Cut first-response time to under 2 hours.', 'Strong customer feedback; needs to delegate more.'],
    ['liam', 'hannah', 'Completed', 'Meets', -5, 'Launch the new website and two campaigns.', 'Campaign delivery on track; website slipped by two weeks.'],
  ];
  for (const [emp, reviewer, status, rating, due, goals, feedback] of reviews) {
    const e = EMPLOYEES.find((x) => x[0] === emp)!;
    await make(`prv:${emp}`, 'performance_review', 'hannah', 20, {
      name: `${period} review — ${e[1]} ${e[2]}`,
      employee: ref(`emp:${emp}`),
      reviewer: users[reviewer].id,
      period,
      status,
      rating,
      due_date: day(due),
      goals,
      feedback,
    });
  }

  const requisitions: [string, string, string, DemoUserKey, string, number, string, number, number, string][] = [
    ['backend', 'Senior Backend Engineer', 'eng', 'admin', 'Open', 2, 'Remote (US)', 150_000, 185_000, 'Build the metadata engine, automation runtime and agent tooling.'],
    ['ae', 'Account Executive, Enterprise', 'sales', 'maria', 'Open', 1, 'New York, NY', 90_000, 120_000, 'Own a territory of enterprise accounts. OTE doubles the base.'],
    ['support', 'Customer Support Specialist', 'cs', 'sofia', 'Open', 2, 'Dublin, Ireland', 45_000, 55_000, 'Resolve customer cases across email, chat and phone.'],
    ['pmm', 'Product Marketing Manager', 'marketing', 'liam', 'Draft', 1, 'Boston, MA', 110_000, 135_000, 'Own positioning and launches for AI agents.'],
  ];
  for (const [key, name, dept, manager, status, openings, location, min, max, description] of requisitions) {
    await make(`req:${key}`, 'job_requisition', key === 'pmm' ? 'liam' : 'hannah', 30, {
      name,
      department: ref(`dep:${dept}`),
      hiring_manager: users[manager].id,
      status,
      openings,
      location,
      employment_type: 'Full-time',
      salary_min: min,
      salary_max: max,
      description,
    });
  }

  const candidates: [string, string, string, string, string, string, number | null, string][] = [
    ['arash', 'Arash', 'Karimi', 'backend', 'Interview', 'LinkedIn', 82, 'Strong distributed systems background.'],
    ['beatriz', 'Beatriz', 'Souza', 'backend', 'Screening', 'Referral', 75, 'Referred by Lucas.'],
    ['connor', 'Connor', 'Walsh', 'backend', 'Applied', 'Careers Site', null, ''],
    ['divya', 'Divya', 'Iyer', 'backend', 'Offer', 'Agency', 90, 'Excellent system design interview.'],
    ['elliot', 'Elliot', 'Turner', 'ae', 'Interview', 'Job Board', 70, ''],
    ['fatima', 'Fatima', 'Zahra', 'ae', 'Screening', 'LinkedIn', 78, 'Enterprise SaaS experience.'],
    ['gabriel', 'Gabriel', 'Costa', 'support', 'Applied', 'Careers Site', null, ''],
    ['hana', 'Hana', 'Novak', 'support', 'Interview', 'Referral', 85, 'Speaks four languages.'],
    ['ian', 'Ian', 'McAllister', 'support', 'Rejected', 'Job Board', 40, 'Not available for shift work.'],
  ];
  for (const [key, first, last, req, stage, source, score, notes] of candidates) {
    await make(`cnd:${key}`, 'candidate', 'hannah', 12, {
      first_name: first,
      last_name: last,
      email: emailOf(first, last, 'mail.example'),
      phone: nextPhone(),
      requisition: ref(`req:${req}`),
      stage,
      source,
      score,
      notes: notes || null,
    });
  }

  // ----- Work -----
  for (const [key, name, status, start, due, account, budget, owner, description] of PROJECTS) {
    await make(`prj:${key}`, 'project', owner, Math.max(2, -start + 5), {
      name,
      status,
      start_date: day(start),
      due_date: day(due),
      account: account ? ref(`acc:${account}`) : null,
      budget,
      description,
    });
  }
  for (const [key, project, name, status, priority, assignee, start, due, estimate, tags] of WORK_ITEMS) {
    const owner = PROJECTS.find((p) => p[0] === project)![7];
    await make(`wki:${key}`, 'work_item', owner, Math.max(1, -start + 3), {
      name,
      project: ref(`prj:${project}`),
      status,
      priority,
      assignee: users[assignee].id,
      start_date: day(start),
      due_date: day(due),
      estimate_hours: estimate,
      tags,
    });
  }

  for (const [subject, type, status, due, related, owner, created, description] of ACTIVITIES) {
    await make(null, 'activity', owner, created, {
      subject,
      type,
      status,
      due_date: day(due),
      related_to: related ? ref(related) : null,
      description: description ?? null,
    });
  }

  // ----- Pending approvals (these run the processes' submit actions) -----
  await s.approvals.submit(await s.users.principalForUser(users.priya.id), ref('quo:globex'), {
    processId: processes.quoteDiscount,
    comment: 'Multi-year commitment from Globex; 25% matches the competing offer.',
  });
  await s.approvals.submit(await s.users.principalForUser(users.james.id), ref('tor:james'), { processId: processes.timeOff });
  await s.approvals.submit(await s.users.principalForUser(users.noah.id), ref('tor:noah'), { processId: processes.timeOff });
  await s.approvals.submit(await s.users.principalForUser(users.liam.id), ref('req:pmm'), {
    processId: processes.requisition,
    comment: 'Needed for the AI agents launch.',
  });
}
