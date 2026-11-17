type EventCallback = (data: any) => void;

export class EventEmitter {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.off(event, callback);
    };
  }

  off(event: string, callback: EventCallback): void {
    const eventSet = this.listeners.get(event);
    if (eventSet) {
      eventSet.delete(callback);
      if (eventSet.size === 0) this.listeners.delete(event);
    }
  }

  emit(event: string, data: any, options?: { skipBroadcast?: boolean }): void {
    const eventSet = this.listeners.get(event);
    if (eventSet) {
      eventSet.forEach((callback) => {
        try {
          callback(data);
        } catch (err) {
          console.error('Emitter error:', err);
        }
      });
    }
    if (!options?.skipBroadcast && this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          sourceTabId: this.tabId,
          event,
          data,
        });
      } catch {
        // Ignore serialization errors for non-cloneable payloads
      }
    }
  }

  private broadcastChannel: BroadcastChannel | null = null;
  private tabId: string = Math.random().toString(36).slice(2);

  /**
   * Bridges emitted events across browser tabs/windows via BroadcastChannel.
   * No-ops safely in environments without BroadcastChannel (Node, React Native).
   */
  enableCrossTab(channelName: string = 'local-lite-events'): () => void {
    const BC = (globalThis as any).BroadcastChannel;
    if (typeof BC !== 'function') {
      return () => {};
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
    }
    const channel: BroadcastChannel = new BC(channelName);
    this.broadcastChannel = channel;
    channel.onmessage = (msg: MessageEvent) => {
      const payload = msg?.data;
      if (
        payload &&
        payload.sourceTabId !== this.tabId &&
        typeof payload.event === 'string'
      ) {
        this.emit(payload.event, payload.data, { skipBroadcast: true });
      }
    };
    return () => {
      if (this.broadcastChannel === channel) {
        this.broadcastChannel = null;
      }
      channel.close();
    };
  }
}
