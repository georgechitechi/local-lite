export interface PresencePeer<TState = Record<string, any>> {
  peerId: string;
  state: TState;
  lastSeen: number;
}

export interface PresenceTransport {
  send(message: any): void;
  onMessage(handler: (message: any) => void): () => void;
  close?(): void;
}

export interface PresenceChannelOptions {
  room: string;
  peerId: string;
  ttlMs?: number;
  transport?: PresenceTransport;
  channelPrefix?: string;
}

/**
 * Creates a BroadcastChannel-backed PresenceTransport for same-origin browser tabs.
 */
export function createBroadcastPresenceTransport(
  channelName: string,
): PresenceTransport {
  const BC = (globalThis as any).BroadcastChannel;
  if (typeof BC !== 'function') {
    return {
      send() {},
      onMessage() {
        return () => {};
      },
    };
  }
  const channel: BroadcastChannel = new BC(channelName);
  return {
    send(message: any) {
      channel.postMessage(message);
    },
    onMessage(handler: (message: any) => void) {
      const listener = (ev: MessageEvent) => handler(ev.data);
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
    close() {
      channel.close();
    },
  };
}

/**
 * Ephemeral, non-persisted presence channel for live cursors, typing indicators, and active record locks.
 */
export class PresenceChannel<TState = Record<string, any>> {
  readonly room: string;
  readonly peerId: string;
  private ttlMs: number;
  private transport: PresenceTransport;
  private peers = new Map<string, PresencePeer<TState>>();
  private listeners = new Set<(peers: PresencePeer<TState>[]) => void>();
  private unsubTransport?: () => void;
  private localState: TState = {} as TState;
  private joined = false;

  constructor(options: PresenceChannelOptions) {
    this.room = options.room;
    this.peerId = options.peerId;
    this.ttlMs = options.ttlMs ?? 30_000;
    const prefix = options.channelPrefix ?? 'local-lite:presence:';
    this.transport =
      options.transport ??
      createBroadcastPresenceTransport(`${prefix}${options.room}`);
  }

  join(initialState: TState = {} as TState): void {
    this.localState = initialState;
    if (!this.joined) {
      this.joined = true;
      this.unsubTransport = this.transport.onMessage((msg) => {
        this.handleMessage(msg);
      });
    }
    this.broadcast('presence:join', this.localState);
  }

  updateState(patch: Partial<TState>): void {
    this.localState = { ...this.localState, ...patch };
    if (this.joined) {
      this.broadcast('presence:update', this.localState);
    }
  }

  leave(): void {
    if (!this.joined) return;
    this.broadcast('presence:leave', null);
    this.joined = false;
    this.unsubTransport?.();
    this.unsubTransport = undefined;
    this.peers.clear();
    this.notify();
  }

  getPeers(now: number = Date.now()): PresencePeer<TState>[] {
    let pruned = false;
    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > this.ttlMs) {
        this.peers.delete(id);
        pruned = true;
      }
    }
    if (pruned) {
      this.notify();
    }
    return Array.from(this.peers.values());
  }

  onPeersChange(callback: (peers: PresencePeer<TState>[]) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  dispose(): void {
    this.leave();
    this.transport.close?.();
    this.listeners.clear();
  }

  private broadcast(type: string, state: any): void {
    this.transport.send({
      type,
      room: this.room,
      peerId: this.peerId,
      state,
      ts: Date.now(),
    });
  }

  private handleMessage(msg: any): void {
    if (!msg || msg.room !== this.room || msg.peerId === this.peerId) return;
    if (msg.type === 'presence:leave') {
      if (this.peers.delete(msg.peerId)) {
        this.notify();
      }
      return;
    }
    if (msg.type === 'presence:join' || msg.type === 'presence:update') {
      this.peers.set(msg.peerId, {
        peerId: msg.peerId,
        state: msg.state ?? ({} as TState),
        lastSeen: typeof msg.ts === 'number' ? msg.ts : Date.now(),
      });
      this.notify();
    }
  }

  private notify(): void {
    const snapshot = Array.from(this.peers.values());
    for (const cb of this.listeners) {
      try {
        cb(snapshot);
      } catch {}
    }
  }
}
