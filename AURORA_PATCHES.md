# Aurora — core patches

Aurora lives in its own folders so upstream Umami merges stay easy:

| Area | Location |
| --- | --- |
| Library, emails, UI components | `src/aurora/` |
| Aurora pages | `src/app/(main)/aurora/`, `src/app/invite/`, `src/app/forgot/`, `src/app/reset/`, `src/app/r/` |
| Aurora API | `src/app/api/aurora/` |
| Database | `// === AURORA ===` block at the **end** of `prisma/schema.prisma` + `prisma/migrations/aurora_*` |
| Uptime / scheduler worker | `workers/aurora-uptime/` (Cloudflare) |
| MCP tools | `src/aurora/mcp/` |
| MCP OAuth | `src/aurora/oauth/`, `src/app/api/aurora/oauth/`, `src/app/oauth/authorize/`, `src/app/.well-known/` (new files; upstream removed its own OAuth in `b18583706`) |
| Upstream sync | `.github/workflows/aurora-upstream-sync.yml` |
| Tests | `src/aurora/__tests__/` (unit), `tests/aurora/` + `scripts/aurora-e2e.ts` (end-to-end) |

Aurora tables never declare Prisma relations to core models, so no core model is edited.

## Core files touched (every change is marked `AURORA`)

If an upstream merge conflicts, it will be in one of these. Re-apply the marked lines.

| File | Change |
| --- | --- |
| `src/app/api/websites/route.ts` | `teamId = resolveCreateTeamId(body.teamId)` → new websites belong to the org |
| `src/app/api/links/route.ts` | same for links |
| `src/app/api/pixels/route.ts` | same for pixels |
| `src/app/api/boards/route.ts` | same for boards (+ `teamId` in insert data) |
| `src/app/(main)/App.tsx` | `useAuroraOrgRedirect()` keeps users inside the org (shows loader while redirecting) |
| `src/app/(main)/SideNav.tsx` | `useAuroraNavLinks(links)` + `<AuroraBrand />` |
| `src/app/(main)/TopNav.tsx` | `<AuroraOrgBadge />` instead of `<TeamsButton />` |
| `src/app/login/LoginForm.tsx` | Aurora brand + "¿Olvidaste tu contraseña?" link |
| `src/app/page.tsx` (+ `page.test.tsx`) | landing page → `/aurora/overview` (core behaviour kept in cloud mode) |
| `src/app/layout.tsx`, `src/app/(main)/layout.tsx` | title template "Aurora Analytics" |
| `next.config.ts` | `Cache-Control: no-store` for `/api/aurora/health` (Aurora Status) and `/api/aurora/oauth` (RFC 6749 §5.1); `frame-ancestors 'none'` + `X-Frame-Options: DENY` + `no-referrer` on `/oauth/*` (consent page) |
| `docker/proxy.ts` | `frame-ancestors 'none'` on `/oauth/*` (the Docker image sets CSP per request, overriding next.config) |
| `src/app/mcp/route.ts` | `tools: getMcpTools()` → Umami's MCP tools + `aurora_*` tools; `authenticateAuroraMcp()` accepts Aurora OAuth tokens or API keys and its 401 advertises `resource_metadata`; `withoutCredentialEcho()` strips tokens from `/api/me` responses inside MCP |
| `src/openapi/discover.ts` | skips `src/app/api/aurora` so the private API is not published in `openapi.json` / `@umami/api-client` |
| `package.json` | scripts `test:aurora`, `test:aurora:e2e` |

## Merging upstream

```bash
git fetch upstream
git checkout -b chore/upstream-sync
git merge upstream/master          # resolve conflicts using the table above
npx -y pnpm@12.3.4 install
npx -y pnpm@12.3.4 test            # core + aurora unit tests
npx -y pnpm@12.3.4 test:aurora:e2e # needs a disposable DATABASE_URL
```

Prisma applies any unapplied migration, so new upstream migrations (`28_*`, …) run fine after
`aurora_01_init` even though they sort earlier.

Escape hatch: `AURORA_DISABLE_ORG=1` turns off the "everything belongs to the org" default.
