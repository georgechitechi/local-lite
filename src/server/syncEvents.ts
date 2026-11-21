import { EventEmitter } from 'node:events';

export interface SyncChangeEvent {
  scopeId: string;
  tableName: string;
  checkpoint: number;
}

export interface SyncEventBroker {
  publish(event: SyncChangeEvent): void;
  subscribe(listener: (event: SyncChangeEvent) => void): () => void;
}

export function createSyncEventBroker(): SyncEventBroker {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  return {
    publish(event: SyncChangeEvent): void {
      if (!event.scopeId) return;
      emitter.emit('change', event);
    },
    subscribe(listener: (event: SyncChangeEvent) => void): () => void {
      emitter.on('change', listener);
      return () => {
        emitter.off('change', listener);
      };
    },
  };
}

export interface SyncEventsEndpointOptions {
  broker: SyncEventBroker;
  authenticate: (request: Request) => Promise<boolean>;
  scopeQueryParam?: string;
  heartbeatMs?: number;
}

export function createSyncEventsHandler(
  options: SyncEventsEndpointOptions,
): (request: Request) => Promise<Response> {
  const scopeParam = options.scopeQueryParam ?? 'businessId';
  const heartbeatMs = options.heartbeatMs ?? 25_000;

  return async (request: Request): Promise<Response> => {
    if (request.method.toUpperCase() !== 'GET') {
      return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    }
    const ok = await options.authenticate(request);
    if (!ok) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const filterScope = url.searchParams.get(scopeParam)?.trim() || '';
    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cleanup?.();
          }
        };

        send(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

        const unsubscribe = options.broker.subscribe((event) => {
          if (filterScope && event.scopeId !== filterScope) return;
          send(`data: ${JSON.stringify(event)}\n\n`);
        });

        const heartbeat = setInterval(() => {
          send(': keep-alive\n\n');
        }, heartbeatMs);

        cleanup = () => {
          clearInterval(heartbeat);
          unsubscribe();
          cleanup = null;
        };

        request.signal.addEventListener('abort', () => cleanup?.());
      },
      cancel() {
        cleanup?.();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  };
}
