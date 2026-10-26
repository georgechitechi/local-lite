# Instant Full-Text Search (`client.search`)

`local-lite` provides high-performance Full-Text Search (FTS5) for your local tables. Search through thousands of property listings, tenant notes, documents, and messages offline in milliseconds with BM25 ranking and keyword highlighting snippets.

---

## Features

- **SQLite FTS5 Native Engine**: Fast text indexing with Porter stemming and Unicode tokenizers.
- **Prefix & Multi-term Match**: Type-ahead search (`"apart"*`, `"luxury villa"*`).
- **Highlight Snippets**: Automatic `<mark>` match highlighting.
- **Auto-Sync Hooks**: Seamlessly updates search indices whenever `client.mutate()` or reactive writes occur.
- **Hydration**: Returns matched `rowId`, relevance `rank`, and the complete hydrated table row.

---

## Creating an Index

Create an FTS index on any table:

```typescript
await client.search.createIndex({
  table: 'properties',
  columns: ['title', 'address', 'description'],
  tokenize: 'unicode61', // optional, defaults to 'unicode61'
});
```

---

## Querying

```typescript
// Instant full-text search
const results = await client.search.query('properties', 'beachfront pool', {
  limit: 20,
  highlight: true,
  hydrateRow: true, // attaches base table row in .data
});

for (const match of results) {
  console.log(`ID: ${match.rowId}`);
  console.log(`Rank: ${match.rank}`);
  console.log(`Snippet: ${match.snippet}`);
  console.log(`Title: ${match.data.title}`);
}
```

---

## Manual Index Management

When syncing or importing data in bulk:

```typescript
// Index single record manually
await client.search.indexRecord('properties', 'prop-1', {
  title: 'Penthouse Apartment',
  address: '101 Skyline Ave',
});

// Remove from search index
await client.search.removeRecord('properties', 'prop-1');

// Rebuild index from existing database records
const properties = await client.findMany('properties');
await client.search.rebuildIndex('properties', properties);

// Drop search index
await client.search.dropIndex('properties');
```
