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

  emit(event: string, data: any): void {
    const eventSet = this.listeners.get(event);
    if (eventSet) {
      eventSet.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error("Emitter error:", err);
        }
      });
    }
  }
}