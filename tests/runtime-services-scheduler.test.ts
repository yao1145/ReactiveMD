import { describe, expect, it } from 'vitest';
import { createLocalScheduler, type LocalSchedulerPorts } from '../src/runtime-services';

class ManualPorts implements LocalSchedulerPorts {
  time = 0;
  hidden = false;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; run: () => void }>();
  private readonly listeners = new Set<(hidden: boolean) => void>();

  now = (): number => this.time;

  setTimeout = (run: () => void, ms: number): unknown => {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.time + ms, run });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  isHidden = (): boolean => this.hidden;

  subscribeVisibility = (listener: (hidden: boolean) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of this.listeners) listener(hidden);
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Number.POSITIVE_INFINITY;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (timer.at < nextAt || (timer.at === nextAt && (nextId === null || id < nextId)))) {
          nextAt = timer.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const timer = this.timers.get(nextId);
      this.timers.delete(nextId);
      if (timer === undefined) continue;
      this.time = timer.at;
      timer.run();
    }
    this.time = target;
  }

  get pending(): number {
    return this.timers.size;
  }
}

describe('local scheduler', () => {
  it('runs intervals and stops on cancel', () => {
    const ports = new ManualPorts();
    const scheduler = createLocalScheduler({ ports, minIntervalMs: 1 });
    let calls = 0;
    const cancel = scheduler.every(100, () => { calls += 1; });
    ports.advance(350);
    expect(calls).toBe(3);
    cancel();
    ports.advance(500);
    expect(calls).toBe(3);
    scheduler.dispose();
  });

  it('pauses intervals without catch-up and resumes with the remaining delay', () => {
    const ports = new ManualPorts();
    const scheduler = createLocalScheduler({ ports, minIntervalMs: 1 });
    let calls = 0;
    scheduler.every(100, () => { calls += 1; });
    ports.advance(150);
    expect(calls).toBe(1);
    scheduler.suspend();
    ports.advance(1000);
    expect(calls).toBe(1);
    scheduler.resume();
    ports.advance(49);
    expect(calls).toBe(1);
    ports.advance(1);
    expect(calls).toBe(2);
    scheduler.dispose();
  });

  it('does not fire early after repeated suspend/resume cycles', () => {
    const ports = new ManualPorts();
    const scheduler = createLocalScheduler({ ports, minIntervalMs: 1 });
    let calls = 0;
    scheduler.every(100, () => { calls += 1; });
    ports.advance(150);
    expect(calls).toBe(1);
    scheduler.suspend();
    ports.advance(1000);
    scheduler.resume();
    ports.advance(1);
    scheduler.suspend();
    scheduler.resume();
    ports.advance(48);
    expect(calls).toBe(1);
    ports.advance(1);
    expect(calls).toBe(2);
    scheduler.dispose();
  });

  it('settles wall-clock work once on resume', () => {
    const ports = new ManualPorts();
    const scheduler = createLocalScheduler({ ports, minIntervalMs: 1 });
    let calls = 0;
    scheduler.after(100, () => { calls += 1; }, { background: 'wall-clock' });
    ports.advance(50);
    scheduler.suspend();
    ports.advance(500);
    scheduler.resume();
    expect(calls).toBe(1);
    ports.advance(1000);
    expect(calls).toBe(1);
    scheduler.dispose();
  });

  it('keeps paused after callbacks for their remaining delay', () => {
    const ports = new ManualPorts();
    const scheduler = createLocalScheduler({ ports, minIntervalMs: 1 });
    let calls = 0;
    scheduler.after(100, () => { calls += 1; }, { background: 'pause' });
    ports.advance(30);
    scheduler.suspend();
    ports.advance(500);
    scheduler.resume();
    expect(calls).toBe(0);
    ports.advance(69);
    expect(calls).toBe(0);
    ports.advance(1);
    expect(calls).toBe(1);
    scheduler.dispose();
  });

  it('reacts to page visibility through the injected port', () => {
    const ports = new ManualPorts();
    const scheduler = createLocalScheduler({ ports, minIntervalMs: 1 });
    let calls = 0;
    scheduler.every(100, () => { calls += 1; });
    ports.advance(100);
    expect(calls).toBe(1);
    ports.setHidden(true);
    ports.advance(1000);
    expect(calls).toBe(1);
    ports.setHidden(false);
    ports.advance(100);
    expect(calls).toBe(2);
    scheduler.dispose();
  });

  it('does not consume hidden time for activeNow', () => {
    const ports = new ManualPorts();
    const scheduler = createLocalScheduler({ ports, minIntervalMs: 1 });
    ports.advance(100);
    scheduler.suspend();
    ports.advance(500);
    scheduler.resume();
    ports.advance(100);
    expect(scheduler.now()).toBe(700);
    expect(scheduler.activeNow()).toBe(200);
    scheduler.dispose();
  });

  it('enforces subscription and interval budgets', () => {
    const ports = new ManualPorts();
    const scheduler = createLocalScheduler({ ports, maxSubscriptions: 1, minIntervalMs: 20 });
    scheduler.every(1, () => {});
    expect(() => scheduler.every(1, () => {})).toThrow(RangeError);
    scheduler.dispose();
  });

  it('stops all work after dispose', () => {
    const ports = new ManualPorts();
    const scheduler = createLocalScheduler({ ports, minIntervalMs: 1 });
    let calls = 0;
    scheduler.every(20, () => { calls += 1; });
    ports.advance(20);
    expect(calls).toBe(1);
    scheduler.dispose();
    ports.advance(1000);
    expect(calls).toBe(1);
    expect(ports.pending).toBe(0);
  });
});
