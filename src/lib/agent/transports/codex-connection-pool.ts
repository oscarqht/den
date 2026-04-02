type TimeoutHandle = ReturnType<typeof setTimeout>;

type PoolEntry<T> = {
  resource: T;
  destroy: (resource: T) => void;
  inUse: boolean;
  idleTimer: TimeoutHandle | null;
};

type AcquireResult<T> = {
  resource: T;
  reused: boolean;
  release: (options?: { destroy?: boolean }) => void;
};

type CreateResourceResult<T> = {
  resource: T;
  destroy: (resource: T) => void;
};

export class CodexConnectionPool<T> {
  private readonly entries = new Map<string, PoolEntry<T>[]>();
  private readonly idleTtlMs: number;
  private readonly schedule: (callback: () => void, delayMs: number) => TimeoutHandle;
  private readonly cancel: (handle: TimeoutHandle) => void;

  constructor(
    idleTtlMs: number,
    schedule: (callback: () => void, delayMs: number) => TimeoutHandle = setTimeout,
    cancel: (handle: TimeoutHandle) => void = clearTimeout,
  ) {
    this.idleTtlMs = Math.max(0, idleTtlMs);
    this.schedule = schedule;
    this.cancel = cancel;
  }

  async acquire(
    key: string,
    create: () => Promise<CreateResourceResult<T>>,
    isReusable?: (resource: T) => boolean,
  ): Promise<AcquireResult<T>> {
    const reusable = this.takeReusableEntry(key, isReusable);
    if (reusable) {
      reusable.inUse = true;
      return this.buildLease(key, reusable, true);
    }

    const created = await create();
    const entry: PoolEntry<T> = {
      resource: created.resource,
      destroy: created.destroy,
      inUse: true,
      idleTimer: null,
    };
    const nextEntries = this.entries.get(key) ?? [];
    nextEntries.push(entry);
    this.entries.set(key, nextEntries);
    return this.buildLease(key, entry, false);
  }

  destroyAll() {
    for (const [key, entries] of this.entries.entries()) {
      for (const entry of entries) {
        this.clearIdleTimer(entry);
        entry.destroy(entry.resource);
      }
      this.entries.delete(key);
    }
  }

  private buildLease(key: string, entry: PoolEntry<T>, reused: boolean): AcquireResult<T> {
    let released = false;
    return {
      resource: entry.resource,
      reused,
      release: (options) => {
        if (released) {
          return;
        }
        released = true;

        const shouldDestroy = Boolean(options?.destroy);
        if (shouldDestroy || this.idleTtlMs === 0) {
          this.removeEntry(key, entry, true);
          return;
        }

        entry.inUse = false;
        this.clearIdleTimer(entry);
        entry.idleTimer = this.schedule(() => {
          this.removeEntry(key, entry, true);
        }, this.idleTtlMs);
        const idleTimer = entry.idleTimer as { unref?: () => void } | null;
        idleTimer?.unref?.();
      },
    };
  }

  private takeReusableEntry(
    key: string,
    isReusable?: (resource: T) => boolean,
  ): PoolEntry<T> | null {
    const entries = this.entries.get(key);
    if (!entries || entries.length === 0) {
      return null;
    }

    for (const entry of entries) {
      if (entry.inUse) {
        continue;
      }
      if (isReusable && !isReusable(entry.resource)) {
        this.removeEntry(key, entry, true);
        continue;
      }
      this.clearIdleTimer(entry);
      return entry;
    }

    return null;
  }

  private removeEntry(key: string, target: PoolEntry<T>, destroy: boolean) {
    const entries = this.entries.get(key);
    if (!entries || entries.length === 0) {
      return;
    }

    const nextEntries = entries.filter((entry) => entry !== target);
    if (nextEntries.length === 0) {
      this.entries.delete(key);
    } else {
      this.entries.set(key, nextEntries);
    }

    this.clearIdleTimer(target);
    if (destroy) {
      target.destroy(target.resource);
    }
  }

  private clearIdleTimer(entry: PoolEntry<T>) {
    if (!entry.idleTimer) {
      return;
    }
    this.cancel(entry.idleTimer);
    entry.idleTimer = null;
  }
}
