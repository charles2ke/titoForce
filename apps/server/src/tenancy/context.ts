import { AsyncLocalStorage } from 'node:async_hooks';
import type { Services } from '../services.ts';
import type { Tenant } from './control.ts';

/** The organization an API request is working in. Routes see it through `tenantServices()` and `req.tenant`. */
export interface TenantContext {
  tenant: Tenant;
  services: Services;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runInTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * A `Services` object that forwards to the services of the organization handling the current request, so route
 * modules written for a single organization work unchanged. Using it outside a request is a programming error.
 */
export function tenantServices(): Services {
  return new Proxy({} as Services, {
    get(_target, prop) {
      const ctx = storage.getStore();
      if (!ctx) throw new Error(`Organization services used outside a request (accessing "${String(prop)}")`);
      return ctx.services[prop as keyof Services];
    },
  });
}
