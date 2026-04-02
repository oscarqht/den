import assert from 'node:assert';
import { describe, it } from 'node:test';

import { CodexConnectionPool } from './codex-connection-pool.ts';

describe('CodexConnectionPool', () => {
  it('reuses an idle resource for the same key', async () => {
    const pool = new CodexConnectionPool<{ id: string }>(30_000);
    let createCount = 0;

    const first = await pool.acquire('key', async () => ({
      resource: { id: `resource-${++createCount}` },
      destroy: () => {},
    }));
    first.release();

    const second = await pool.acquire('key', async () => ({
      resource: { id: `resource-${++createCount}` },
      destroy: () => {},
    }));

    assert.equal(second.reused, true);
    assert.equal(second.resource.id, 'resource-1');
    second.release({ destroy: true });
    pool.destroyAll();
  });

  it('destroys idle resources after the TTL elapses', async () => {
    const scheduled = new Map<number, () => void>();
    const cleared: number[] = [];
    let nextTimerId = 1;
    let destroyed = 0;

    const pool = new CodexConnectionPool<{ id: string }>(
      50,
      (callback) => {
        const timerId = nextTimerId++;
        scheduled.set(timerId, callback);
        return timerId as ReturnType<typeof setTimeout>;
      },
      (handle) => {
        const timerId = handle as unknown as number;
        cleared.push(timerId);
        scheduled.delete(timerId);
      },
    );

    const lease = await pool.acquire('key', async () => ({
      resource: { id: 'resource-1' },
      destroy: () => {
        destroyed += 1;
      },
    }));
    lease.release();

    assert.equal(scheduled.size, 1);
    const [callback] = scheduled.values();
    callback?.();

    const recreated = await pool.acquire('key', async () => ({
      resource: { id: 'resource-2' },
      destroy: () => {
        destroyed += 1;
      },
    }));

    assert.equal(destroyed, 1);
    assert.equal(recreated.resource.id, 'resource-2');
    recreated.release({ destroy: true });
    assert.ok(cleared.length >= 1);
    pool.destroyAll();
  });

  it('drops stale resources instead of reusing them', async () => {
    const pool = new CodexConnectionPool<{ id: string; closed: boolean }>(30_000);
    let createCount = 0;

    const first = await pool.acquire('key', async () => ({
      resource: { id: `resource-${++createCount}`, closed: false },
      destroy: (resource) => {
        resource.closed = true;
      },
    }));
    first.resource.closed = true;
    first.release();

    const second = await pool.acquire('key', async () => ({
      resource: { id: `resource-${++createCount}`, closed: false },
      destroy: (resource) => {
        resource.closed = true;
      },
    }), (resource) => !resource.closed);

    assert.equal(second.reused, false);
    assert.equal(second.resource.id, 'resource-2');
    second.release({ destroy: true });
    pool.destroyAll();
  });
});
