import { type QueryClient, useQuery } from '@tanstack/react-query';
import type { AgentDef, AiStatus, AppDef, ObjectDef, ObjectPermission, RolePermissions, SessionInfo, UserDTO } from '@titoforce/shared';
import { createContext, useContext, useEffect, useState } from 'react';
import { ApiError, api } from '../api.ts';

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api.get<SessionInfo>('/api/auth/session');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export const SessionContext = createContext<SessionInfo | null>(null);

/** The signed-in user's session (only valid inside the authenticated layout). */
export function useAuth(): SessionInfo {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useAuth must be used inside the authenticated layout');
  return s;
}

const NO_ACCESS: ObjectPermission = { read: 'none', create: false, edit: 'none', delete: 'none' };

export function objectPerm(perms: RolePermissions, object: string): ObjectPermission {
  return perms.objects[object] ?? perms.objects['*'] ?? NO_ACCESS;
}

const allows = (level: string, ownerId: string | null, userId: string) => level === 'all' || (level === 'own' && ownerId === userId);

export function usePermissions() {
  const { user, permissions } = useAuth();
  return {
    permissions,
    isAdmin: permissions.setup,
    canManageAutomations: permissions.setup || permissions.manageAutomations,
    canManageAgents: permissions.setup || permissions.manageAgents,
    canCreate: (object: string) => objectPerm(permissions, object).create,
    canEdit: (object: string, ownerId: string | null) => allows(objectPerm(permissions, object).edit, ownerId, user.id),
    canDelete: (object: string, ownerId: string | null) => allows(objectPerm(permissions, object).delete, ownerId, user.id),
  };
}

export function useObjects() {
  return useQuery({ queryKey: ['objects'], queryFn: () => api.get<ObjectDef[]>('/api/objects'), staleTime: 5 * 60_000 });
}

export function useObjectDef(api: string | undefined): { def: ObjectDef | undefined; isLoading: boolean; error: unknown } {
  const q = useObjects();
  return { def: api ? q.data?.find((o) => o.apiName === api) : undefined, isLoading: q.isLoading, error: q.error };
}

export function useApps() {
  return useQuery({ queryKey: ['apps'], queryFn: () => api.get<AppDef[]>('/api/apps'), staleTime: 5 * 60_000 });
}

// Setup edits the English originals: these load metadata without translating labels into the UI language, so saving a
// form never writes a translation back as the base label.

export function useSetupObjects() {
  return useQuery({ queryKey: ['objects', 'raw'], queryFn: () => api.get<ObjectDef[]>('/api/objects?raw=1'), staleTime: 5 * 60_000 });
}

export function useSetupObjectDef(api: string | undefined): { def: ObjectDef | undefined; isLoading: boolean; error: unknown } {
  const q = useSetupObjects();
  return { def: api ? q.data?.find((o) => o.apiName === api) : undefined, isLoading: q.isLoading, error: q.error };
}

export function useSetupApps() {
  return useQuery({ queryKey: ['apps', 'raw'], queryFn: () => api.get<AppDef[]>('/api/apps?raw=1'), staleTime: 5 * 60_000 });
}

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: () => api.get<UserDTO[]>('/api/users'), staleTime: 5 * 60_000 });
}

export function useAgents() {
  return useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentDef[]>('/api/agents'), staleTime: 60_000 });
}

export function useAiStatus() {
  return useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<AiStatus>('/api/ai/status'), staleTime: 5 * 60_000 });
}

/** Refreshes everything derived from record data after a write (lists, record pages, reports, approvals, …). */
export function invalidateRecordData(qc: QueryClient): Promise<void> {
  const keys = ['records', 'record', 'related', 'timeline', 'dashboard', 'report', 'forecast', 'org-chart', 'approvals', 'agent-actions', 'agent-runs', 'notifications', 'kanban', 'calendar', 'timeline-view', 'home-tasks'];
  return Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] }))).then(() => undefined);
}

/** Refreshes metadata after setup changes. */
export function invalidateMetadata(qc: QueryClient): Promise<void> {
  // Page layouts follow field changes: the server places new fields and drops deleted ones.
  return Promise.all(['objects', 'apps', 'views', 'users', 'roles', 'layout', 'layouts', 'related'].map((k) => qc.invalidateQueries({ queryKey: [k] }))).then(() => undefined);
}

// ---------- current app (Salesforce-style app switcher) ----------

const APP_KEY = 'tf.app';

export const CurrentAppContext = createContext<{ appId: string | null; setAppId: (id: string) => void }>({ appId: null, setAppId: () => {} });

export const useCurrentApp = () => useContext(CurrentAppContext);

export function storedAppId(): string | null {
  try {
    return localStorage.getItem(APP_KEY);
  } catch {
    return null;
  }
}

export function storeAppId(id: string): void {
  try {
    localStorage.setItem(APP_KEY, id);
  } catch {
    // Storage can be unavailable (private mode); the app switcher still works for this tab.
  }
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ---------- AI side panel ----------

export interface AiPanelContextValue {
  open: (ctx?: { recordId?: string; recordName?: string; agentId?: string; prompt?: string }) => void;
  close: () => void;
  isOpen: boolean;
}

export const AiPanelContext = createContext<AiPanelContextValue>({ open: () => {}, close: () => {}, isOpen: false });

export const useAiPanel = () => useContext(AiPanelContext);
