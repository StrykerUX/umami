# Aurora Analytics

Fork de Umami con: organización única, invitaciones por email/link, workspaces
(internal/external) + clientes + tipos de cliente, reportes programados con comparación
contra el periodo anterior, y uptime por sitio desde Cloudflare.

Producción: `https://analytics.aurora33.dev` (Railway) · Worker: `aurora-uptime` (Cloudflare).

## Roles

| Aurora | Puede |
| --- | --- |
| Admin | todo + invitar, cambiar roles, quitar miembros, borrar workspaces/clientes |
| Editor | crear/editar sitios, clientes, workspaces, reportes y monitores |
| Solo lectura | ver todo |

Todos los miembros ven todos los sitios de la organización. Los clientes **no** tienen cuenta:
reciben los reportes en los emails de contacto del cliente y un link web firmado (vence en 120 días).

## Reportes

- Frecuencias: semanal (lun–dom), quincenal calendario (1–15 / 16–fin), mensual, bimestral (ene–feb, mar–abr, …).
- Siempre cubren el último periodo **completo** y lo comparan con el anterior de la misma frecuencia.
- Se envían a las 08:00 (zona horaria del reporte) del primer día del periodo siguiente.
- Destinatarios = lista del reporte + contactos del cliente (si el reporte es de un cliente o de un sitio con cliente).
- Cada envío guarda un snapshot: el histórico no cambia aunque cambien los datos.

## Uptime

- El Worker revisa cada URL cada minuto. 2 fallos seguidos = caído; 1 éxito = recuperado.
- Cada caída abre un incidente, crea una anotación en la gráfica del sitio y manda email a las alertas.
- Retención de checks: 90 días.

## Health (Aurora Status)

Formato: https://status.aurora33.org/healthcheck

- `GET /api/aurora/health` — sin token: `{ "status": "ok" | "degraded" | "down" }`. Con
  `Authorization: Bearer <AURORA_HEALTH_TOKEN>`: además `checks` y `version`. Token ausente o
  incorrecto ⇒ misma respuesta que sin token (nunca 401). `down` ⇒ 503, resto 200.
  `Cache-Control: no-store`, sin sesión, sin escrituras, cada revisión con límite de 1.5 s.
- Revisiones (`key` estables): `db` (puede dar `down`), `migrations`, `cron` (30 min degradado,
  2 h caído), `uptime_worker` (5 min), `email`, `reports` (atraso > 1 h), `monitors` (informativa).
- El cron guarda su latido en `app_setting` (`aurora.cron.lastRunAt`).
- Admins: página **Health** (`/aurora/health`) vía `/api/aurora/health/details`.
- El healthcheck de Railway sigue en `/api/heartbeat` (trivial; no reinicia por fallas de la base).

## MCP

Endpoint: `https://analytics.aurora33.dev/mcp` (requiere `MCP_ENABLED=1`). Autenticación con
**API key de Umami** (Configuración → API keys); cada key ve lo que permite el rol de su usuario.

```bash
claude mcp add --transport http aurora https://analytics.aurora33.dev/mcp \
  --header "Authorization: Bearer <API_KEY>"
```

- Herramientas de Umami (stats, métricas, sesiones, eventos, funnels, retención, etc.).
- Lectura Aurora: `aurora_list_workspaces`, `aurora_list_client_types`, `aurora_list_clients`,
  `aurora_list_sites`, `aurora_overview`, `aurora_client_summary`, `aurora_list_reports`,
  `aurora_get_report_run`, `aurora_uptime_status`, `aurora_list_incidents`, `aurora_health` (admin).
- Escritura (solo con `AURORA_MCP_WRITE=1`, rol Editor+): `aurora_run_report` (por defecto
  vista previa, sin enviar), `aurora_classify_website`, `aurora_upsert_client`.
- Las herramientas llaman a `/api/aurora/*` en proceso con la misma API key (`src/aurora/mcp/`).

## Variables de entorno (Railway)

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | Postgres de Railway |
| `APP_SECRET` | aleatorio, largo |
| `APP_URL` | `https://analytics.aurora33.dev` |
| `RESEND_API_KEY` | API key de Resend (sin ella los emails solo se guardan en `aurora_email_log`) |
| `MAIL_FROM` | `Aurora Analytics <analytics@aurora33.org>` |
| `AURORA_CRON_SECRET` | aleatorio ≥ 32 chars, **igual** al secreto del Worker |
| `AURORA_HEALTH_TOKEN` | aleatorio ≥ 32 chars; se registra en Aurora Status |
| `MCP_ENABLED` | `1` |
| `AURORA_MCP_WRITE` | `1` para exponer herramientas MCP de escritura (opcional) |
| `AURORA_ORG_NAME` | `Aurora` (opcional) |

Worker: `AURORA_CRON_SECRET` (secret) y `AURORA_URL` (var en `wrangler.jsonc`).

## Desarrollo

```bash
npx -y pnpm@12.3.4 install
npx -y pnpm@12.3.4 dev
npx -y pnpm@12.3.4 test:aurora       # unit
npx -y pnpm@12.3.4 test:aurora:e2e   # end-to-end (servidor + Postgres reales)
```

Ver `AURORA_PATCHES.md` para cómo convivir con upstream.

## Sincronizar con Umami

`master` es espejo exacto de upstream; Railway despliega `aurora/foundation`.
La Action `.github/workflows/aurora-upstream-sync.yml` corre cada lunes (o a mano): adelanta
`master`, mezcla upstream en una rama `aurora/upstream-sync-<sha>`, corre typecheck + unit tests
y abre un PR. Si hay conflictos abre un issue. Antes de mergear: `pnpm test:aurora:e2e`.
