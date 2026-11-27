import type { AnyToolDefinition } from '@umami/mcp';
import * as umamiMcp from '@umami/mcp';
import { auroraReadTools } from './tools/read';
import { auroraWriteTools } from './tools/write';

export const auroraTools = auroraReadTools as unknown as AnyToolDefinition[];
export { auroraWriteTools };

export function isAuroraMcpWriteEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.AURORA_MCP_WRITE === '1';
}

/**
 * Aurora tools registered on the embedded MCP endpoint. Write tools are only exposed when
 * AURORA_MCP_WRITE=1; even then, each call is still checked against the caller's Aurora role.
 */
export function getAuroraMcpTools(env: NodeJS.ProcessEnv = process.env): AnyToolDefinition[] {
  return [
    ...auroraTools,
    ...(isAuroraMcpWriteEnabled(env) ? (auroraWriteTools as unknown as AnyToolDefinition[]) : []),
  ];
}

/**
 * Full tool set for the embedded endpoint: Umami's tools plus Aurora's. Returns undefined when
 * Umami's tool list is unavailable (e.g. a mocked module in tests) so the handler keeps its default.
 */
export function getMcpTools(env: NodeJS.ProcessEnv = process.env) {
  const core = Reflect.has(umamiMcp, 'allTools') ? umamiMcp.allTools : undefined;

  return core ? [...core, ...getAuroraMcpTools(env)] : undefined;
}
