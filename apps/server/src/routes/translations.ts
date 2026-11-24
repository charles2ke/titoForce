import type { FastifyInstance } from 'fastify';
import { assertSetup } from '../platform/principal.ts';
import { isSupportedLocale } from '../platform/translations.ts';
import type { Services } from '../services.ts';
import { badRequest } from '../util.ts';
import { params, parse, principalOf, query } from './http.ts';
import * as schemas from './schemas.ts';

const localeParam = (value: string | undefined) => {
  if (!isSupportedLocale(value)) throw badRequest('Unsupported language');
  return value;
};

/** Setup → Translations: administrators translate object, field, picklist, section and app labels. */
export function translationRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/translations', async (req) => {
    assertSetup(principalOf(req));
    return s.translations.entries(localeParam(query(req).locale));
  });

  app.put('/api/translations/:locale', async (req) => {
    assertSetup(principalOf(req));
    return s.translations.save(localeParam(params(req).locale), parse(schemas.saveTranslations, req.body).entries);
  });
}
