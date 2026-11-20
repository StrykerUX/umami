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

## Variables de entorno (Railway)

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | Postgres de Railway |
| `APP_SECRET` | aleatorio, largo |
| `APP_URL` | `https://analytics.aurora33.dev` |
| `RESEND_API_KEY` | API key de Resend (sin ella los emails solo se guardan en `aurora_email_log`) |
| `MAIL_FROM` | `Aurora Analytics <analytics@aurora33.org>` |
| `AURORA_CRON_SECRET` | aleatorio ≥ 32 chars, **igual** al secreto del Worker |
| `MCP_ENABLED` | `1` |
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
