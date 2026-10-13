import { LocalFirstClient } from 'local-lite';

/**
 * Clears all rental data from local SQLite tables.
 */
export async function clearRentalPortfolio(client: LocalFirstClient): Promise<void> {
  const tables = ['properties', 'tenants', 'maintenance_requests', 'payments'];
  for (const table of tables) {
    try {
      await client.db.execute(`DELETE FROM ${table}`);
    } catch {
      // Table may not exist yet
    }
  }
}
