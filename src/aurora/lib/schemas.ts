import { z } from 'zod';
import { AURORA_ROLES, REPORT_FREQUENCIES, REPORT_SCOPES, WORKSPACE_KINDS } from './constants';
import { normalizeEmail } from './tokens';

export const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(WORKSPACE_KINDS),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
});

export const clientSchema = z.object({
  name: z.string().trim().min(1).max(150),
  workspaceId: z.uuid().nullable().optional(),
  clientTypeId: z.uuid().nullable().optional(),
  contactEmails: z.array(z.email().max(320)).max(50).optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

export function cleanClientInput(body: Partial<z.infer<typeof clientSchema>>) {
  return {
    ...body,
    ...(body.contactEmails && {
      contactEmails: Array.from(new Set(body.contactEmails.map(normalizeEmail))),
    }),
  };
}

export const roleSchema = z.enum(AURORA_ROLES);

export const reportSectionsSchema = z.object({
  kpis: z.boolean().optional(),
  topPages: z.boolean().optional(),
  referrers: z.boolean().optional(),
  countries: z.boolean().optional(),
  uptime: z.boolean().optional(),
});

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const reportScheduleSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    scope: z.enum(REPORT_SCOPES),
    scopeId: z.uuid().nullable().optional(),
    frequency: z.enum(REPORT_FREQUENCIES),
    sections: reportSectionsSchema.optional(),
    recipients: z.array(z.email().max(320)).max(50).optional(),
    includeClientContacts: z.boolean().optional(),
    timezone: z.string().max(64).refine(isValidTimeZone, 'Zona horaria inválida.').optional(),
    active: z.boolean().optional(),
  })
  .refine(v => v.scope === 'all' || !!v.scopeId, {
    message: 'Selecciona a qué aplica el reporte.',
    path: ['scopeId'],
  });

export const monitorSchema = z.object({
  url: z
    .url()
    .max(2000)
    .refine(u => /^https?:\/\//i.test(u), 'Usa http(s)://'),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(30000).optional(),
  keyword: z.string().max(200).nullable().optional(),
  alertEmails: z.array(z.email().max(320)).max(20).optional(),
});

export const websiteMetaSchema = z.object({
  workspaceId: z.uuid().nullable().optional(),
  clientId: z.uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const uptimeResultsSchema = z.object({
  results: z
    .array(
      z.object({
        websiteId: z.uuid(),
        checkedAt: z.iso.datetime(),
        ok: z.boolean(),
        statusCode: z.number().int().nullable().optional(),
        latencyMs: z.number().int().min(0).nullable().optional(),
        error: z.string().max(500).nullable().optional(),
        region: z.string().max(20).nullable().optional(),
      }),
    )
    .max(1000),
});
