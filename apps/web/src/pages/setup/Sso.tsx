import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type OidcSettings, type RoleDef, type SamlSettings, type SsoProvider, type SsoProviderList, type SsoProviderType, ssoUrls } from '@titoforce/shared';
import { Check, Copy, Info, KeyRound, Pencil, Plus, Trash } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useConfirm, useToast } from '../../components/feedback.tsx';
import { InlineToggle } from '../../components/pickers.tsx';
import { Badge, Button, cx, EmptyState, ErrorBanner, FormField, IconButton, KeyValue, Loading, Modal, PageHeader, Toggle } from '../../components/ui.tsx';

type TokenAuthMethod = OidcSettings['tokenAuthMethod'];
type UrlRow = { label: string; value: string };

const TYPE_LABELS: Record<SsoProviderType, string> = { oidc: 'OpenID Connect', saml: 'SAML 2.0' };
const TYPES: { id: SsoProviderType; text: string }[] = [
  { id: 'oidc', text: 'For most identity providers, e.g. Okta, Microsoft Entra ID, Google Workspace or Auth0.' },
  { id: 'saml', text: 'For identity providers that only offer SAML, e.g. AD FS.' },
];
const TOKEN_AUTH: { id: TokenAuthMethod; label: string }[] = [
  { id: 'client_secret_basic', label: 'Basic (client_secret_basic)' },
  { id: 'client_secret_post', label: 'POST body (client_secret_post)' },
];
const DEFAULT_SCOPES = 'openid email profile';
const ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

function useProviders() {
  return useQuery({ queryKey: ['sso-providers'], queryFn: () => api.get<SsoProviderList>('/api/sso-providers') });
}

function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleDef[]>('/api/roles') });
}

// The sign-in page lists the enabled providers.
const refresh = (qc: QueryClient) => Promise.all([qc.invalidateQueries({ queryKey: ['sso-providers'] }), qc.invalidateQueries({ queryKey: ['public-config'] })]);

/** Suggests an ID from the provider name: "Microsoft Entra ID" → "microsoft-entra-id". */
function idFrom(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

const parseDomains = (text: string) => [...new Set(text.split(/[\s,;]+/).filter(Boolean))];

/** Saves a provider as it is; the stored client secret is kept because it isn't sent. */
function inputOf(p: SsoProvider) {
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    enabled: p.enabled,
    ...(p.type === 'oidc' ? { oidc: p.config } : { saml: p.config }),
    jit: p.jit,
    // Like the form: the default role only matters when users are created on first sign-in.
    defaultRole: p.jit ? p.defaultRole : null,
    allowedDomains: p.allowedDomains,
  };
}

function urlRows(type: SsoProviderType, urls: SsoProvider['urls']): UrlRow[] {
  if (type === 'oidc') return [{ label: 'Redirect URI', value: urls.redirect ?? '' }];
  return [
    { label: 'ACS URL', value: urls.acs ?? '' },
    { label: 'Entity ID', value: urls.entityId ?? '' },
    { label: 'Metadata URL', value: urls.metadata ?? '' },
  ];
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The clipboard API needs a secure context and permission; fall back to a selected text area.
    const previous = document.activeElement as HTMLElement | null;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    previous?.focus();
    if (!ok) throw new Error('Copy failed');
  }
}

function CopyButton({ label, value, disabled }: { label: string; value: string; disabled?: boolean }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={`Copy ${label}`}
      disabled={disabled}
      className="shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={async () => {
        try {
          await copyText(value);
          setCopied(true);
          toast.success(`${label} copied`);
        } catch {
          toast.error('Couldn’t copy. Select the text and copy it instead.');
        }
      }}
    />
  );
}

function UrlList({ rows, disabled }: { rows: UrlRow[]; disabled?: boolean }) {
  return (
    <dl className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="text-xs font-medium text-slate-500">{r.label}</dt>
          <dd className="mt-0.5 flex items-center gap-1">
            <code className="min-w-0 flex-1 rounded-md bg-slate-50 px-2 py-1.5 font-mono text-xs break-all text-slate-800 ring-1 ring-slate-200 ring-inset">{r.value}</code>
            <CopyButton label={r.label} value={r.value} disabled={disabled} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ProviderForm({ provider, baseUrl, roles, takenIds, onClose }: { provider: SsoProvider | null; baseUrl: string; roles: RoleDef[]; takenIds: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = !provider;
  const formId = useId();
  const ids = {
    type: useId(),
    name: useId(),
    id: useId(),
    issuer: useId(),
    clientId: useId(),
    secret: useId(),
    scopes: useId(),
    tokenAuth: useId(),
    entryPoint: useId(),
    idpIssuer: useId(),
    cert: useId(),
    spEntityId: useId(),
    emailAttr: useId(),
    nameAttr: useId(),
    role: useId(),
    domains: useId(),
  };
  const oidc = provider?.type === 'oidc' ? (provider.config as OidcSettings) : null;
  const saml = provider?.type === 'saml' ? (provider.config as SamlSettings) : null;
  const [type, setType] = useState<SsoProviderType>(provider?.type ?? 'oidc');
  const [name, setName] = useState(provider?.name ?? '');
  // Until the ID is typed in, it follows the name.
  const [typedId, setTypedId] = useState<string | null>(provider?.id ?? null);
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [issuer, setIssuer] = useState(oidc?.issuer ?? '');
  const [clientId, setClientId] = useState(oidc?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [removeSecret, setRemoveSecret] = useState(false);
  const [scopes, setScopes] = useState(oidc?.scopes ?? DEFAULT_SCOPES);
  const [tokenAuthMethod, setTokenAuthMethod] = useState<TokenAuthMethod>(oidc?.tokenAuthMethod ?? 'client_secret_basic');
  const [entryPoint, setEntryPoint] = useState(saml?.entryPoint ?? '');
  const [idpIssuer, setIdpIssuer] = useState(saml?.idpIssuer ?? '');
  const [idpCert, setIdpCert] = useState(saml?.idpCert ?? '');
  const [spEntityId, setSpEntityId] = useState(saml?.spEntityId ?? '');
  const [emailAttribute, setEmailAttribute] = useState(saml?.emailAttribute ?? '');
  const [nameAttribute, setNameAttribute] = useState(saml?.nameAttribute ?? '');
  const [jit, setJit] = useState(provider?.jit ?? false);
  const [defaultRole, setDefaultRole] = useState(provider?.defaultRole ?? '');
  const [domains, setDomains] = useState((provider?.allowedDomains ?? []).join('\n'));
  const errorRef = useRef<HTMLDivElement>(null);

  const id = typedId ?? idFrom(name);
  const idValid = ID_PATTERN.test(id);
  const idError =
    !isNew || !id ? null : !idValid ? 'Use 2–40 lowercase letters, numbers and dashes, starting with a letter.' : takenIds.includes(id) ? 'A provider with this ID already exists.' : null;
  const hasStoredSecret = !!provider?.hasSecret;
  // New users must not get Setup access through single sign-on.
  const roleChoices = roles.filter((r) => !r.permissions.setup);
  const roleOk = roleChoices.some((r) => r.id === defaultRole);
  const urls = ssoUrls(baseUrl, id || '<id>', type, type === 'saml' ? spEntityId.trim() || null : null);

  const problem = !name.trim()
    ? 'Enter a name.'
    : !id
      ? 'Enter an ID.'
      : idError
        ? 'Fix the ID.'
        : type === 'oidc' && !issuer.trim()
          ? 'Enter the issuer URL.'
          : type === 'oidc' && !clientId.trim()
            ? 'Enter the client ID.'
            : type === 'saml' && !entryPoint.trim()
              ? 'Enter the single sign-on URL.'
              : type === 'saml' && !idpCert.trim()
                ? 'Paste the signing certificate.'
                : jit && !roleOk
                  ? 'Choose the default role.'
                  : null;

  const save = useMutation({
    mutationFn: () => {
      // Omitting the client secret keeps the stored one; '' removes it.
      const secret = type !== 'oidc' ? undefined : removeSecret ? '' : clientSecret.trim() || undefined;
      const body = {
        id,
        type,
        name: name.trim(),
        enabled,
        ...(type === 'oidc'
          ? { oidc: { issuer: issuer.trim(), clientId: clientId.trim(), scopes: scopes.trim() || DEFAULT_SCOPES, tokenAuthMethod } }
          : {
              saml: {
                entryPoint: entryPoint.trim(),
                idpIssuer: idpIssuer.trim() || null,
                idpCert: idpCert.trim(),
                spEntityId: spEntityId.trim() || null,
                emailAttribute: emailAttribute.trim() || null,
                nameAttribute: nameAttribute.trim() || null,
              },
            }),
        ...(secret === undefined ? {} : { clientSecret: secret }),
        jit,
        defaultRole: jit ? defaultRole : null,
        allowedDomains: parseDomains(domains),
      };
      return provider ? api.put<SsoProvider>(`/api/sso-providers/${provider.id}`, body) : api.post<SsoProvider>('/api/sso-providers', body);
    },
    onSuccess: async (saved) => {
      toast.success(isNew ? `${saved.name} added` : `${saved.name} saved`);
      onClose();
      await refresh(qc);
    },
  });

  // Server errors name the field ("oidc.issuer: …"); bring the message into view in the long form.
  useEffect(() => {
    if (save.error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [save.error]);

  return (
    <Modal
      open
      onClose={onClose}
      title={provider ? `Edit ${provider.name}` : 'New single sign-on provider'}
      size="lg"
      footer={
        <>
          {problem && <span className="mr-auto text-xs text-slate-500">{problem}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!!problem} loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) save.mutate();
        }}
      >
        <div ref={errorRef}>
          <ErrorBanner error={save.error} />
        </div>
        {isNew ? (
          <fieldset>
            <legend className="label">Type</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TYPES.map((t) => (
                <label
                  key={t.id}
                  className={cx('flex cursor-pointer items-start gap-2.5 rounded-lg border p-3', type === t.id ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500' : 'border-slate-200 hover:bg-slate-50')}
                >
                  <input
                    type="radio"
                    name={ids.type}
                    className="mt-0.5 size-4 accent-indigo-600"
                    checked={type === t.id}
                    aria-labelledby={`${ids.type}-${t.id}`}
                    aria-describedby={`${ids.type}-${t.id}-text`}
                    onChange={() => setType(t.id)}
                  />
                  <span>
                    <span id={`${ids.type}-${t.id}`} className="block text-sm font-medium text-slate-800">
                      {TYPE_LABELS[t.id]}
                    </span>
                    <span id={`${ids.type}-${t.id}-text`} className="block text-xs text-slate-500">
                      {t.text}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Badge color={type === 'oidc' ? 'blue' : 'purple'}>{TYPE_LABELS[type]}</Badge>
            The type of a provider can’t be changed.
          </p>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" required htmlFor={ids.name} help={`Shown on the sign-in page as “Sign in with ${name.trim() || '…'}”.`}>
            <input id={ids.name} className="input" value={name} maxLength={80} placeholder="Okta" onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="ID" htmlFor={ids.id} error={idError} help={isNew ? 'Part of the addresses below. It can’t be changed later.' : 'The ID of a provider can’t be changed.'}>
            <input
              id={ids.id}
              className="input font-mono"
              value={id}
              disabled={!isNew}
              maxLength={40}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!!idError}
              onChange={(e) => setTypedId(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            />
          </FormField>
          <div className="sm:col-span-2">
            <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
            <p className="mt-1 text-xs text-slate-500">Turned-off providers aren’t shown on the sign-in page and can’t be used to sign in.</p>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Addresses to register</h3>
            <p className="text-xs text-slate-500">
              {type === 'oidc'
                ? 'Add this redirect URI to the application you register with the identity provider.'
                : 'Give these to the identity provider, or let it read them from the metadata URL.'}
            </p>
          </div>
          <UrlList rows={urlRows(type, urls)} disabled={!idValid} />
        </section>

        {type === 'oidc' ? (
          <section className="space-y-4 rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">OpenID Connect settings</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Issuer URL" required htmlFor={ids.issuer} help="The https:// address of the identity provider, without /.well-known/openid-configuration." className="sm:col-span-2">
                <input id={ids.issuer} className="input" inputMode="url" spellCheck={false} placeholder="https://example.okta.com" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
              </FormField>
              <FormField label="Client ID" required htmlFor={ids.clientId}>
                <input id={ids.clientId} className="input" spellCheck={false} autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </FormField>
              <FormField
                label="Client secret"
                htmlFor={ids.secret}
                help={`${hasStoredSecret ? '' : 'Leave empty for a public client. '}Set TITO_SECRET_KEY on the server to encrypt client secrets in the database.`}
              >
                <input
                  id={ids.secret}
                  type="password"
                  autoComplete="off"
                  className="input"
                  value={clientSecret}
                  disabled={removeSecret}
                  placeholder={hasStoredSecret ? 'Stored — leave blank to keep it' : undefined}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              </FormField>
              {hasStoredSecret && (
                <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-indigo-600"
                    checked={removeSecret}
                    onChange={(e) => {
                      setRemoveSecret(e.target.checked);
                      if (e.target.checked) setClientSecret('');
                    }}
                  />
                  Remove stored secret
                </label>
              )}
              <FormField label="Scopes" htmlFor={ids.scopes} help="Separated by spaces. openid is always included.">
                <input id={ids.scopes} className="input" spellCheck={false} value={scopes} placeholder={DEFAULT_SCOPES} onChange={(e) => setScopes(e.target.value)} />
              </FormField>
              <FormField label="Token endpoint authentication" htmlFor={ids.tokenAuth} help="How titoForce sends the client secret to the identity provider.">
                <select id={ids.tokenAuth} className="input" value={tokenAuthMethod} onChange={(e) => setTokenAuthMethod(e.target.value as TokenAuthMethod)}>
                  {TOKEN_AUTH.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          </section>
        ) : (
          <section className="space-y-4 rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">SAML 2.0 settings</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Single sign-on URL" required htmlFor={ids.entryPoint} help="The https:// address that receives sign-in requests (HTTP-Redirect binding)." className="sm:col-span-2">
                <input id={ids.entryPoint} className="input" inputMode="url" spellCheck={false} placeholder="https://idp.example.com/saml/sso" value={entryPoint} onChange={(e) => setEntryPoint(e.target.value)} />
              </FormField>
              <FormField label="Identity provider issuer" htmlFor={ids.idpIssuer} help="The identity provider’s entity ID. Leave empty to skip the issuer check." className="sm:col-span-2">
                <input id={ids.idpIssuer} className="input" spellCheck={false} value={idpIssuer} onChange={(e) => setIdpIssuer(e.target.value)} />
              </FormField>
              <FormField label="Signing certificate" required htmlFor={ids.cert} help="The identity provider’s signing certificate in PEM format." className="sm:col-span-2">
                <textarea
                  id={ids.cert}
                  className="input font-mono text-xs"
                  rows={6}
                  spellCheck={false}
                  placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
                  value={idpCert}
                  onChange={(e) => setIdpCert(e.target.value)}
                />
              </FormField>
              <FormField label="Service provider entity ID" htmlFor={ids.spEntityId} help="Leave empty to use the metadata URL." className="sm:col-span-2">
                <input
                  id={ids.spEntityId}
                  className="input"
                  spellCheck={false}
                  placeholder={ssoUrls(baseUrl, id || '<id>', 'saml').metadata}
                  value={spEntityId}
                  onChange={(e) => setSpEntityId(e.target.value)}
                />
              </FormField>
              <FormField label="Email attribute" htmlFor={ids.emailAttr} help="Leave empty when the NameID is the email address.">
                <input id={ids.emailAttr} className="input" spellCheck={false} value={emailAttribute} onChange={(e) => setEmailAttribute(e.target.value)} />
              </FormField>
              <FormField label="Name attribute" htmlFor={ids.nameAttr} help="Leave empty to use a common one, such as displayName.">
                <input id={ids.nameAttr} className="input" spellCheck={false} value={nameAttribute} onChange={(e) => setNameAttribute(e.target.value)} />
              </FormField>
            </div>
          </section>
        )}

        <section className="space-y-4 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-800">Who can sign in</h3>
          <div>
            <Toggle checked={jit} onChange={setJit} label="Create users on first sign-in" />
            <p className="mt-1 text-xs text-slate-500">
              {jit
                ? 'People whose email address doesn’t match a user yet get a new user with the default role.'
                : 'Only existing, active users can sign in. Their email address must match the one from the identity provider.'}
            </p>
          </div>
          {jit && (
            <FormField label="Default role" required htmlFor={ids.role} help="The role new users get. Roles with Setup access can’t be used." className="sm:w-80">
              <select id={ids.role} className="input" value={roleOk ? defaultRole : ''} onChange={(e) => setDefaultRole(e.target.value)}>
                {!roleOk && <option value="">Choose a role…</option>}
                {roleChoices.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <FormField label="Allowed email domains" htmlFor={ids.domains} help="One per line or separated by commas. Leave empty to allow any domain.">
            <textarea id={ids.domains} className="input font-mono" rows={3} spellCheck={false} placeholder="example.com" value={domains} onChange={(e) => setDomains(e.target.value)} />
          </FormField>
        </section>
      </form>
    </Modal>
  );
}

function ProviderCard({
  provider: p,
  roleName,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  provider: SsoProvider;
  roleName: (id: string | null) => string;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const headingId = useId();
  const oidc = p.type === 'oidc' ? (p.config as OidcSettings) : null;
  const saml = p.type === 'saml' ? (p.config as SamlSettings) : null;
  return (
    <section aria-labelledby={headingId} className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 id={headingId} className="text-sm font-semibold text-slate-900">
            {p.name}
          </h2>
          <Badge color={p.type === 'oidc' ? 'blue' : 'purple'}>{TYPE_LABELS[p.type]}</Badge>
          {!p.enabled && <Badge color="gray">Disabled</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <InlineToggle checked={p.enabled} label={`${p.name} enabled`} disabled={busy} onChange={onToggle} />
          <IconButton icon={Pencil} label={`Edit ${p.name}`} onClick={onEdit} />
          <IconButton icon={Trash} label={`Delete ${p.name}`} className="hover:text-rose-600" disabled={busy} onClick={onDelete} />
        </div>
      </header>
      <div className="grid gap-6 p-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Register with the identity provider</h3>
          <UrlList rows={urlRows(p.type, p.urls)} />
        </div>
        <dl className="grid content-start gap-3 sm:grid-cols-2">
          <KeyValue label="ID">
            <code className="font-mono text-xs">{p.id}</code>
          </KeyValue>
          {oidc && (
            <>
              <KeyValue label="Issuer URL">
                <span className="break-all">{oidc.issuer}</span>
              </KeyValue>
              <KeyValue label="Client ID">
                <span className="break-all">{oidc.clientId}</span>
              </KeyValue>
              <KeyValue label="Client secret">{p.hasSecret ? 'Stored' : 'None'}</KeyValue>
            </>
          )}
          {saml && (
            <>
              <KeyValue label="Single sign-on URL">
                <span className="break-all">{saml.entryPoint}</span>
              </KeyValue>
              <KeyValue label="Identity provider issuer">
                <span className="break-all">{saml.idpIssuer ?? 'Not checked'}</span>
              </KeyValue>
            </>
          )}
          <KeyValue label="New users">{p.jit ? `Creates users with role ${roleName(p.defaultRole)}` : 'Only existing users can sign in'}</KeyValue>
          <KeyValue label="Allowed email domains">{p.allowedDomains.length ? p.allowedDomains.join(', ') : 'Any domain'}</KeyValue>
        </dl>
      </div>
    </section>
  );
}

export default function Sso() {
  const list = useProviders();
  const roles = useRoles();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<SsoProvider | 'new' | null>(null);
  const providers = list.data?.providers ?? [];
  const ready = !!list.data && !!roles.data;
  const roleName = (id: string | null) => roles.data?.find((r) => r.id === id)?.name ?? id ?? 'none';

  const toggle = useMutation({
    mutationFn: ({ p, enabled }: { p: SsoProvider; enabled: boolean }) => api.put<SsoProvider>(`/api/sso-providers/${p.id}`, { ...inputOf(p), enabled }),
    onMutate: ({ p, enabled }) => {
      qc.setQueryData<SsoProviderList>(['sso-providers'], (old) => old && { ...old, providers: old.providers.map((x) => (x.id === p.id ? { ...x, enabled } : x)) });
    },
    onSuccess: (_r, { p, enabled }) => toast.success(`${p.name} ${enabled ? 'enabled' : 'disabled'}`),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => refresh(qc),
  });
  const remove = useMutation({
    mutationFn: (p: SsoProvider) => api.del(`/api/sso-providers/${p.id}`),
    onSuccess: async (_r, p) => {
      toast.success(`${p.name} deleted`);
      await refresh(qc);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const newButton = (label: string) => (
    <Button variant="primary" icon={Plus} disabled={!ready} onClick={() => setEditing('new')}>
      {label}
    </Button>
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader
        title="Single Sign-On"
        subtitle={
          <p className="max-w-3xl">
            Let people sign in with your identity provider, using OpenID Connect or SAML 2.0. On the sign-in page they click “Sign in with” and the provider’s name. The verified email address from
            the identity provider must match an active user, unless the provider creates users on first sign-in. The identity provider handles multi-factor authentication for these sign-ins.
            Single logout isn’t supported.
          </p>
        }
        actions={newButton('New provider')}
      />
      <ErrorBanner error={roles.error} className="mb-4" />
      {list.isLoading ? (
        <div className="card">
          <Loading />
        </div>
      ) : !list.data ? (
        <ErrorBanner error={list.error} />
      ) : (
        <>
          <p className="mb-4 flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Provider addresses start with <code className="font-mono text-slate-700">{list.data.baseUrl}</code>. If people or the identity provider reach titoForce at another address, set
              TITO_PUBLIC_URL on the server.
            </span>
          </p>
          {providers.length === 0 ? (
            <div className="card">
              <EmptyState icon={KeyRound} title="No single sign-on providers yet" action={newButton('Add your first provider')}>
                Connect an identity provider such as Okta, Microsoft Entra ID or Google Workspace.
              </EmptyState>
            </div>
          ) : (
            <div className="space-y-4">
              {providers.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  roleName={roleName}
                  busy={toggle.isPending || remove.isPending}
                  onToggle={(enabled) => toggle.mutate({ p, enabled })}
                  onEdit={() => setEditing(p)}
                  onDelete={async () => {
                    const ok = await confirm({
                      title: `Delete ${p.name}?`,
                      message: `People can no longer sign in with ${p.name}. Their users are kept, but people without a password can’t sign in until they get one.`,
                      confirmLabel: 'Delete provider',
                      danger: true,
                    });
                    if (ok) remove.mutate(p);
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
      {editing && list.data && roles.data && (
        <ProviderForm
          key={editing === 'new' ? '__new' : editing.id}
          provider={editing === 'new' ? null : editing}
          baseUrl={list.data.baseUrl}
          roles={roles.data}
          takenIds={providers.map((p) => p.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
