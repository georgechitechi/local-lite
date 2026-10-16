# PropFlow: local-lite + Convex

The rental manager uses local-lite for SQLite reads, reactive queries, transactional
outbox writes, conflict resolution, and Convex synchronization. Convex is the only
remote backend. Local SQLite remains available offline.

## Setup

From the repository root, run `npm install` and `npm run build`.
Then from `example/`:

```sh
npm install
npm run convex:dev
```

Follow the Convex CLI prompts to create/select a development deployment and deploy
`convex/schema.ts` and `convex/sync.ts`. Set `EXPO_PUBLIC_CONVEX_URL` in `.env.local`
to its deployment URL (see `.env.example`), then run `npm start`.
Restart Expo after changing the URL. No generated API files are needed by the app.

This is a shared, unauthenticated demo backend. Use a development deployment with
sample data; add authentication and per-user authorization before using real data.

## Seed and clear

The Sync tab can seed SQLite (optionally queuing writes) or seed Convex through
local-lite's `ConvexRemoteAdapter`. CLI equivalents:

```sh
npm run seed -- 500
npm run seed -- 2000
npm run seed:clean
```

Clear sends tombstones through the same sync API so offline clients receive deletes.
The CLI reads `.env.local`. Shell environment variables take precedence.

## Sync protocol

`sync:pushBatch` accepts local-lite operations, deduplicates retries by operation ID,
merges partial updates, and applies last-write-wins using the write timestamp.
`sync:pullDeltas` returns SQL-facing payloads without Convex system fields. A strictly
increasing server cursor and retained tombstones support reconnects and cursor resets.
The four entity tables (`properties`, `tenants`, `maintenance_requests`, `payments`)
store business fields directly on each document, indexed by application ID and sync
cursor. `syncClock` and `syncOperations` contain only sync bookkeeping. The `payload`
field exists only in the local-lite wire protocol, never in the stored entity documents.
The demo pulls all changed rows; larger production datasets need a paginated protocol
and retention policy for operation IDs and tombstones.

The app uses `rental_property_convex.db` to avoid reusing a previous backend's cursor.
Existing local or remote data is not copied automatically.

## Checks

```sh
npm run typecheck
npm run lint
```

## Upgrading from the shared rentalRows table

Deploy the new schema and functions with `npm run convex:dev`. Run
`npx convex run sync:migrateRentalRows '{}'` repeatedly until it reports `migrated: 0`.
Each batch atomically copies up to 200 legacy records into their entity tables and
removes those legacy records. IDs, deletion markers, and write timestamps are
preserved; new sync cursors make migrated rows visible to connected clients.
Newer records already in the target tables are preserved. The migration is internal
and cannot be called by app clients. The old table is no longer part of the schema.
