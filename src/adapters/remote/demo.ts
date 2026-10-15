import { RemoteDBAdapter } from './index.js';
import { DeltaChanges, SyncOperation } from '../../core/types.js';

/**
 * Built-in In-Memory Demo Remote Adapter.
 * Useful for prototyping, offline testing, and previewing without a live backend.
 */
export class MemoryDemoRemoteAdapter implements RemoteDBAdapter {
  public pushedBatches: SyncOperation[][] = [];
  public allPushedOperations: SyncOperation[] = [];
  private liveSubscribers: ((changes: DeltaChanges) => void)[] = [];
  private simulatedLatencyMs: number;

  constructor(simulatedLatencyMs: number = 300) {
    this.simulatedLatencyMs = simulatedLatencyMs;
  }

  async pushChanges(operations: SyncOperation[]): Promise<boolean> {
    if (this.simulatedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedLatencyMs));
    }
    this.pushedBatches.push(operations);
    this.allPushedOperations.push(...operations);
    return true;
  }

  async fetchChanges(_sinceTimestamp: number): Promise<DeltaChanges> {
    return {
      timestamp: Date.now(),
      changes: [],
    };
  }

  subscribeToLiveChanges(callback: (changes: DeltaChanges) => void): () => void {
    this.liveSubscribers.push(callback);
    return () => {
      this.liveSubscribers = this.liveSubscribers.filter((subscriber) => subscriber !== callback);
    };
  }

  /**
   * Manually emit simulated server deltas to subscribers.
   */
  emitLiveChanges(changes: DeltaChanges): void {
    for (const sub of this.liveSubscribers) {
      sub(changes);
    }
  }

  clear(): void {
    this.pushedBatches = [];
    this.allPushedOperations = [];
  }
}
