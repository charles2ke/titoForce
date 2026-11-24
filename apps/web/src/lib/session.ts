import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicConfig, SessionInfo } from '@titoforce/shared';
import { useNavigate } from 'react-router';
import { api, rememberOrganization, serverUrl, setOrganization, storeDeviceToken } from '../api.ts';
import { getLocale, isLocale, setLocale } from '../i18n/index.ts';

/** Sign-in and sign-up responses; `token` only when asked for (the native app). */
export type SignInResult = SessionInfo & { token?: string };

/** Sign-in page data of an organization (null: the server's default, or the subdomain's). */
export function usePublicConfig(org: string | null) {
  return useQuery({
    queryKey: ['public-config', org, serverUrl()],
    queryFn: () => api.get<PublicConfig>('/api/config', { org }),
    staleTime: 5 * 60_000,
    retry: false,
    // While someone types an organization ID, keep showing the previous one's page instead of flickering.
    placeholderData: keepPreviousData,
  });
}

/** After signing in or up: work in that organization, keep the device token, switch to the user's language and continue. */
export function useCompleteSignIn(): (result: SignInResult, next: string) => void {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (result, next) => {
    const org = result.organization;
    // New tabs start in the last production organization, never in a sandbox that was opened to try something.
    setOrganization(org.slug, { remember: org.kind === 'production' });
    rememberOrganization({ slug: org.slug, name: org.name, kind: org.kind });
    if (result.token) storeDeviceToken(org.slug, result.token);
    qc.clear();
    qc.setQueryData<SessionInfo>(['session'], { user: result.user, permissions: result.permissions, organization: org });
    if (isLocale(result.user.locale) && result.user.locale !== getLocale()) void setLocale(result.user.locale);
    navigate(next, { replace: true });
  };
}
