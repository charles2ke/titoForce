import type { CrmRecord } from '@titoforce/shared';
import type { Principal } from './principal.ts';

export interface RecordChangeEvent {
  type: 'created' | 'updated' | 'deleted';
  object: string;
  /** Current state (for deletions: the last state before deletion). */
  record: CrmRecord;
  previous: CrmRecord | null;
  /** Field api names that changed (includes owner_id). */
  changed: string[];
  principal: Principal;
}

type Handler = (event: RecordChangeEvent) => Promise<void>;

/** In-process event bus. Handlers run sequentially after the originating transaction commits. */
export class EventBus {
  private handlers: Handler[] = [];

  on(handler: Handler): void {
    this.handlers.push(handler);
  }

  async emit(event: RecordChangeEvent): Promise<void> {
    for (const h of this.handlers) {
      try {
        await h(event);
      } catch (err) {
        console.error('[events] handler failed', err);
      }
    }
  }
}

/** Minimal in-memory background job queue (jobs are not persisted across restarts). */
export class JobQueue {
  private queue: { name: string; fn: () => Promise<void> }[] = [];
  private running = 0;
  private idleWaiters: (() => void)[] = [];
  private concurrency: number;

  constructor(concurrency = 2) {
    this.concurrency = concurrency;
  }

  enqueue(name: string, fn: () => Promise<void>): void {
    this.queue.push({ name, fn });
    this.pump();
  }

  get pending(): number {
    return this.queue.length + this.running;
  }

  /** Resolves once the queue is empty and nothing is running (used by tests and graceful shutdown). */
  drain(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      job
        .fn()
        .catch((err) => console.error(`[jobs] ${job.name} failed`, err))
        .finally(() => {
          this.running--;
          this.pump();
          if (this.pending === 0) this.idleWaiters.splice(0).forEach((w) => w());
        });
    }
  }
}
