import { McpToolError, type McpToolErrorCode, type ToolContext } from '@umami/mcp';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

// Route handlers declare their own `params` shapes; `any` keeps the table assignable.
type RouteHandler = (request: Request, context: { params: Promise<any> }) => Promise<Response>;
type RouteModule = Partial<Record<Method, RouteHandler>>;

interface AuroraRoute {
  method: Method;
  path: `/api/aurora/${string}`;
  load: () => Promise<RouteModule>;
}

/**
 * Aurora API routes reachable from the MCP tools. Anything not listed is unreachable.
 * Calls run in-process through the same handlers (auth, role checks, validation) as HTTP.
 */
export const AURORA_MCP_ROUTES: readonly AuroraRoute[] = [
  {
    method: 'GET',
    path: '/api/aurora/workspaces',
    load: () => import('@/app/api/aurora/workspaces/route'),
  },
  {
    method: 'GET',
    path: '/api/aurora/client-types',
    load: () => import('@/app/api/aurora/client-types/route'),
  },
  {
    method: 'GET',
    path: '/api/aurora/clients',
    load: () => import('@/app/api/aurora/clients/route'),
  },
  {
    method: 'POST',
    path: '/api/aurora/clients',
    load: () => import('@/app/api/aurora/clients/route'),
  },
  {
    method: 'GET',
    path: '/api/aurora/clients/{id}',
    load: () => import('@/app/api/aurora/clients/[id]/route'),
  },
  {
    method: 'PATCH',
    path: '/api/aurora/clients/{id}',
    load: () => import('@/app/api/aurora/clients/[id]/route'),
  },
  {
    method: 'GET',
    path: '/api/aurora/websites',
    load: () => import('@/app/api/aurora/websites/route'),
  },
  {
    method: 'PUT',
    path: '/api/aurora/websites/{websiteId}/meta',
    load: () => import('@/app/api/aurora/websites/[websiteId]/meta/route'),
  },
  {
    method: 'GET',
    path: '/api/aurora/overview',
    load: () => import('@/app/api/aurora/overview/route'),
  },
  {
    method: 'GET',
    path: '/api/aurora/reports',
    load: () => import('@/app/api/aurora/reports/route'),
  },
  {
    method: 'GET',
    path: '/api/aurora/reports/{id}/runs',
    load: () => import('@/app/api/aurora/reports/[id]/runs/route'),
  },
  {
    method: 'POST',
    path: '/api/aurora/reports/{id}/run',
    load: () => import('@/app/api/aurora/reports/[id]/run/route'),
  },
  {
    method: 'GET',
    path: '/api/aurora/reports/runs/{runId}',
    load: () => import('@/app/api/aurora/reports/runs/[runId]/route'),
  },
  {
    method: 'GET',
    path: '/api/aurora/uptime',
    load: () => import('@/app/api/aurora/uptime/route'),
  },
  {
    method: 'GET',
    path: '/api/aurora/health/details',
    load: () => import('@/app/api/aurora/health/details/route'),
  },
];

const compiled = AURORA_MCP_ROUTES.map(route => {
  const names: string[] = [];
  const source = route.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    names.push(name);
    return '([^/]+)';
  });

  return { ...route, pattern: new RegExp(`^${source}$`), names };
});

export function matchAuroraRoute(method: string, pathname: string) {
  for (const route of compiled) {
    if (route.method !== method.toUpperCase()) {
      continue;
    }

    const match = route.pattern.exec(pathname);

    if (match) {
      const params: Record<string, string> = {};
      route.names.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });

      return { route, params };
    }
  }

  return null;
}

export interface AuroraCallOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

const STATUS_CODES: Record<number, McpToolErrorCode> = {
  400: 'invalid_input',
  401: 'auth_expired',
  403: 'access_denied',
  404: 'not_found',
  429: 'rate_limited',
};

function errorMessage(status: number, data: any) {
  const message = typeof data?.error === 'object' ? data.error?.message : data?.message;

  if (typeof message === 'string' && message && status < 500) {
    return message.slice(0, 300);
  }

  switch (status) {
    case 401:
      return 'Aurora authentication failed or the API key is no longer valid.';
    case 403:
      return 'Your Aurora role does not allow this action.';
    case 404:
      return 'The requested Aurora resource was not found.';
    default:
      return status >= 500
        ? 'Aurora returned a server error. Try again later.'
        : `Aurora request failed with status ${status}.`;
  }
}

/** Reads the caller's bearer credential from the Umami client the MCP handler built. */
export function getAuthorization(context: Pick<ToolContext, 'client'>) {
  const headers = (context.client as { headers?: Record<string, string> } | undefined)?.headers;
  const value = headers?.authorization ?? headers?.Authorization;

  if (!value) {
    throw new McpToolError('auth_expired', 'Missing credentials for the Aurora API.');
  }

  return value;
}

/**
 * Calls an Aurora route handler in-process with the caller's credentials and returns its JSON.
 * Non-2xx responses become McpToolError with a safe message.
 */
export async function auroraCall<T = any>(
  context: Pick<ToolContext, 'client'>,
  method: Method,
  path: string,
  options: AuroraCallOptions = {},
): Promise<T> {
  const matched = matchAuroraRoute(method, path);

  if (!matched) {
    throw new McpToolError('api_error', `Route ${method} ${path} is not available to MCP.`);
  }

  const module = await matched.route.load();
  const handler = module[method];

  if (!handler) {
    throw new McpToolError('api_error', `Method ${method} is not supported for ${path}.`);
  }

  const url = new URL(path, 'http://aurora.internal');

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const hasBody = options.body !== undefined && method !== 'GET';
  const request = new Request(url, {
    method,
    headers: {
      authorization: getAuthorization(context),
      ...(hasBody && { 'content-type': 'application/json' }),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  const response = await handler(request, { params: Promise.resolve(matched.params) });
  const text = await response.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new McpToolError(
      STATUS_CODES[response.status] ?? 'api_error',
      errorMessage(response.status, data),
    );
  }

  return data as T;
}
