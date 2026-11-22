import { expressionIdentifiers, type FieldDef, fieldAccess, nameFieldNames, type ObjectDef, type RoleDef, type RolePermissions } from '@titoforce/shared';
import { badRequest } from '../util.ts';

export interface FieldSecurityProblem {
  /** Identifies the problem independently of labels, to tell problems a change introduces from ones that already existed. */
  key: string;
  message: string;
}

function identifiers(formula: string): string[] {
  try {
    return expressionIdentifiers(formula);
  } catch {
    return [];
  }
}

/**
 * Places where a role would see a value it cannot see in the field itself: record names made from hidden fields, and
 * formulas and roll-ups calculated from hidden fields. Uses the role's effective access, so sensitive fields count as
 * hidden for roles without viewSensitive unless a field permission says otherwise. `roleRef` names the role in messages.
 */
export function fieldSecurityProblems(objects: Iterable<ObjectDef>, perms: RolePermissions, roleRef: string): FieldSecurityProblem[] {
  if (perms.setup) return [];
  const byName = new Map([...objects].map((o) => [o.apiName, o]));
  const field = (def: ObjectDef, name: string | undefined) => def.fields.find((f) => f.apiName === name);
  const hidden = (def: ObjectDef, f: FieldDef) => fieldAccess(perms, def.apiName, f) === 'none';
  const explicit = (def: ObjectDef, f: FieldDef) => perms.fields?.[def.apiName]?.[f.apiName] !== undefined;
  const problems = new Map<string, string>();
  for (const def of byName.values()) {
    // Record names and calculated values are only shown to roles that can read the object.
    if (((perms.objects[def.apiName] ?? perms.objects['*'])?.read ?? 'none') === 'none') continue;
    for (const name of nameFieldNames(def)) {
      const f = field(def, name);
      if (f && hidden(def, f)) problems.set(`name:${def.apiName}.${name}`, `${def.label} ${f.label} is part of the record name, so ${roleRef} must be able to see it`);
    }
    for (const g of def.fields) {
      if (hidden(def, g)) continue;
      const sources: [ObjectDef, string | undefined][] = [];
      if (g.type === 'formula' && g.formula) for (const id of identifiers(g.formula)) sources.push([def, id]);
      const r = g.type === 'rollup' ? g.rollup : undefined;
      const child = r && byName.get(r.childObject);
      // Roll-ups count the child records that point at the parent and match the filter, so all of these fields feed the value.
      if (r && child) for (const id of [r.relationshipField, r.field, ...(r.filter?.rules ?? []).map((x) => x.field)]) sources.push([child, id]);
      for (const [o, id] of sources) {
        const f = field(o, id);
        if (!f || !hidden(o, f)) continue;
        const kind = g.type === 'formula' ? 'Formula' : 'Roll-up';
        const source = g.type === 'formula' ? f.label : `${o.label} ${f.label}`;
        // A source hidden only for being sensitive: marking the calculated field sensitive hides it from this role too.
        const fix = explicit(o, f) || explicit(def, g) ? 'hide it as well' : 'mark it as sensitive or hide it as well';
        problems.set(`calc:${def.apiName}.${g.apiName}:${o.apiName}.${f.apiName}`, `${kind} ${def.label} ${g.label} is calculated from ${source}, which ${roleRef} cannot see; ${fix}`);
      }
    }
  }
  return [...problems].map(([key, message]) => ({ key, message }));
}

/** The first problem in `after` that was not in `before`, so a change is not blocked by problems it did not cause. */
export function firstNewProblem(before: FieldSecurityProblem[], after: FieldSecurityProblem[]): FieldSecurityProblem | undefined {
  const known = new Set(before.map((p) => p.key));
  return after.find((p) => !known.has(p.key));
}

/** Rejects an object or field change that would show some role values it cannot see, e.g. a new formula or a field marked sensitive. */
export function assertObjectChangeAllowed(roles: RoleDef[], objects: ObjectDef[], next: ObjectDef): void {
  const changed = objects.map((o) => (o.apiName === next.apiName ? next : o));
  for (const role of roles) {
    const ref = `the ${role.name} role`;
    const problem = firstNewProblem(fieldSecurityProblems(objects, role.permissions, ref), fieldSecurityProblems(changed, role.permissions, ref));
    if (problem) throw badRequest(problem.message);
  }
}
