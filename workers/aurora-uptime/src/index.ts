import { type Env, runReports, runUptime, shouldRunReports } from './check';

interface ScheduledEventLike {
  scheduledTime: number;
  cron: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async scheduled(event: ScheduledEventLike, env: Env, ctx: ExecutionContextLike) {
    ctx.waitUntil(
      runUptime(env).then(
        r => console.log('uptime', JSON.stringify(r)),
        e => console.error('uptime failed', e),
      ),
    );

    if (shouldRunReports(event.scheduledTime)) {
      ctx.waitUntil(
        runReports(env).then(
          r => console.log('reports', JSON.stringify(r)),
          e => console.error('reports failed', e),
        ),
      );
    }
  },

  async fetch() {
    return new Response('aurora-uptime ok', { headers: { 'content-type': 'text/plain' } });
  },
};
