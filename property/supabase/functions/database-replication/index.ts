// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  EXCLUDED_TABLES,
  errorResponse,
  filterExcludedColumns,
  filterSystemBusinesses,
  getClientContext,
  getOrCreateAdminUser,
  getServiceRoleClient,
  handleCors,
  RestoreEngine,
  setupProgressBroadcasting,
  successResponse,
} from '../_shared/index.ts';

serve(async req => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const startTime = new Date();

  try {
    let reqBody: any = {};
    if (req.method === 'POST') {
      try {
        reqBody = await req.clone().json();
      } catch (e) {
        console.log('Failed to parse request body', e);
      }
    }

    const action = reqBody.action;
    if (action !== 'replicate' && action !== 'restore') {
      return errorResponse('Invalid action. Must be "replicate" or "restore"', 400);
    }

    console.log(`🔄 [NEW] Starting database ${action} at:`, new Date().toISOString());

    // 1. SECURITY & CLIENTS
    const ctx = await getClientContext(req);
    if (ctx.error) return errorResponse(ctx.error, 401);

    const isInternal = ctx.isInternal;
    let sourceSupabase;
    let destSupabase;
    let userIdForMapping = ctx.user?.id || null;
    let userEmailForMapping = ctx.user?.email || null;
    let supabaseForBroadcast;

    const pat = Deno.env.get('BACKUP_PROJECT_PAT');
    const backupRef = reqBody.dest_ref || Deno.env.get('BACKUP_PROJECT_REF');
    const replicaUrl =
      reqBody.dest_url || (backupRef ? `https://${backupRef}.supabase.co` : '');

    let replicaClient: any;
    if (pat && backupRef) {
      console.log(
        '⚡ [Replication] Connecting directly to replica database via BACKUP_PROJECT_PAT for ref:',
        backupRef,
      );
      replicaClient = createPatSupabaseClient(pat, backupRef);
    } else if (replicaUrl && reqBody.dest_key) {
      replicaClient = createClient(replicaUrl, reqBody.dest_key);
    } else {
      throw new Error(
        'Missing replica configuration. Please configure BACKUP_PROJECT_PAT and BACKUP_PROJECT_REF.',
      );
    }

    if (action === 'replicate') {
      // Replicate: Current -> Replica
      if (isInternal) {
        sourceSupabase = getServiceRoleClient();
        userEmailForMapping = reqBody.user_email || Deno.env.get('BACKUP_TARGET_EMAIL');
      } else {
        sourceSupabase = ctx.supabase;
      }
      destSupabase = replicaClient;
      supabaseForBroadcast = sourceSupabase;
    } else {
      // Restore: Replica -> Current
      sourceSupabase = replicaClient;
      destSupabase = getServiceRoleClient();

      if (isInternal) {
        supabaseForBroadcast = getServiceRoleClient();
      } else {
        supabaseForBroadcast = ctx.supabase;
      }
    }

    // 2. PROGRESS BROADCASTING
    const {
      user_id: broadcastUserId,
      user_email: broadcastUserEmail,
      sendProgress,
    } = await setupProgressBroadcasting(req, supabaseForBroadcast);

    if (action === 'replicate') {
      if (!userEmailForMapping && broadcastUserEmail) {
        userEmailForMapping = broadcastUserEmail;
      }
      // Map user in destination database (replica)
      if (userEmailForMapping) {
        const destAdmin = await getOrCreateAdminUser(destSupabase, userEmailForMapping);
        userIdForMapping = destAdmin.id;
      }
    }

    if (!userIdForMapping) userIdForMapping = broadcastUserId;

    // 3. EXPORT DATA FROM SOURCE
    await sendProgress(
      action === 'replicate'
        ? 'Reading data from active database...'
        : 'Exporting data from replica...',
      'system',
      0.05,
    );
    const backupData = await exportAllData(
      sourceSupabase,
      sendProgress,
      action === 'replicate',
    );

    // 4. PREPARE REPLICATION PACKAGE
    const backup = {
      version: '1.1.0',
      timestamp: new Date().toISOString(),
      data: backupData,
    };

    // 5. EXECUTE RESTORATION ON DESTINATION
    const engine = new RestoreEngine({
      supabase: destSupabase,
      sendProgress: async (status, table, percentage) => {
        // Map destination write progress smoothly across 0.45 to 0.95
        const mappedPercentage = 0.45 + (percentage || 0) * 0.5;
        let displayStatus = status;
        if (action === 'replicate') {
          if (displayStatus.startsWith('Restoring ')) {
            displayStatus = `${displayStatus.replace(/^Restoring /, 'Syncing ')} to replica...`;
          } else if (displayStatus.includes('Clearing existing data')) {
            displayStatus = 'Preparing replica database...';
          }
        }
        await sendProgress(displayStatus, table, mappedPercentage);
      },
      userIdForMapping,
      isInternal,
    });

    const result = await engine.execute(backup);

    // 6. FINALIZE
    const duration = Math.round((Date.now() - startTime.getTime()) / 1000);
    const finalMessage =
      action === 'replicate'
        ? 'Replication completed successfully!'
        : 'Restoration from replica completed!';

    await sendProgress(finalMessage, 'finalizing', 1.0, {
      completed: true,
      success: result.success,
      restored_records: result.totalRecordsRestored,
      businesses_restored: result.businessesRestored,
      business_names: result.businessNames,
      duration: duration,
      failed_tables: result.failedTables,
      restore_results: result.results && result.results.length < 20 ? result.results : [],
    });

    return successResponse({
      success: result.success,
      total_records_restored: result.totalRecordsRestored,
      businesses_restored: result.businessesRestored,
      business_names: result.businessNames,
      duration: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Database operation failed:', error.message);
    return errorResponse(error.message, 500);
  }
});

/**
 * Export ALL data from source database
 */
async function exportAllData(supabase: any, sendProgress: any, isReplicate = false) {
  const { data: tablesData, error: tablesError } = await supabase.rpc('list_tables');
  if (tablesError) throw new Error(`Failed to get table list: ${tablesError.message}`);

  const data: Record<string, any[]> = {};
  const tablesToBackup = tablesData
    .map((table: any) => table.table_name)
    .filter((table: string) => !EXCLUDED_TABLES.includes(table));

  for (let i = 0; i < tablesToBackup.length; i++) {
    const tableName = tablesToBackup[i];
    // Smooth progress: 0.05 to 0.45 across source table exports
    const currentPercentage = 0.05 + (i / tablesToBackup.length) * 0.4;
    const label = isReplicate
      ? `Reading ${tableName} from active database...`
      : `Exporting ${tableName}...`;
    await sendProgress(label, tableName, currentPercentage);

    let allTableData: any[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const selectQuery = supabase.from(tableName).select('*');
      const { data: pageData, error } =
        typeof selectQuery.range === 'function'
          ? await selectQuery.range(from, to)
          : await selectQuery;

      if (error || !Array.isArray(pageData) || pageData.length === 0) {
        break;
      }

      allTableData = allTableData.concat(pageData);
      if (pageData.length < pageSize || typeof selectQuery.range !== 'function') {
        hasMore = false;
      } else {
        page++;
      }
    }

    if (allTableData.length > 0) {
      let filteredData = allTableData;
      if (tableName === 'businesses') filteredData = filterSystemBusinesses(allTableData);
      data[tableName] = filterExcludedColumns(filteredData);
    } else {
      data[tableName] = [];
    }
  }
  return data;
}

/**
 * High-performance database client that directly executes SQL using Supabase PAT
 */
function createPatSupabaseClient(pat: string, projectRef: string) {
  async function query(sql: string) {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pat}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Database query via PAT failed (${res.status}): ${errText}`);
    }

    return await res.json();
  }

  async function fallbackDirectInsert(table: string, records: any[]) {
    if (!Array.isArray(records) || records.length === 0) {
      return { success: true, count: 0 };
    }
    const batchSize = 250;
    let total = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const slice = records.slice(i, i + batchSize);
      const colSet = new Set<string>();
      for (const r of slice) {
        if (r && typeof r === 'object') {
          for (const k of Object.keys(r)) {
            colSet.add(k);
          }
        }
      }
      const cols = Array.from(colSet);
      if (cols.length === 0) continue;

      const colNamesSql = cols.map(c => `"${c}"`).join(', ');
      const valuesSql = slice
        .map(r => {
          const rowVals = cols.map(c => {
            const val = r[c];
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'boolean' || typeof val === 'number') return String(val);
            if (typeof val === 'object')
              return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
            return `'${String(val).replace(/'/g, "''")}'`;
          });
          return `(${rowVals.join(', ')})`;
        })
        .join(',\n');

      const updateCols = cols
        .filter(c => c !== 'id')
        .map(c => `"${c}" = EXCLUDED."${c}"`)
        .join(', ');
      const onConflict =
        cols.includes('id') && updateCols.length > 0
          ? `ON CONFLICT ("id") DO UPDATE SET ${updateCols}`
          : `ON CONFLICT DO NOTHING`;

      const sql = `INSERT INTO public."${table}" (${colNamesSql}) VALUES\n${valuesSql}\n${onConflict};`;
      await query(sql);
      total += slice.length;
    }
    return { success: true, count: total };
  }

  return {
    async rpc(fnName: string, params: Record<string, any> = {}) {
      try {
        if (fnName === 'list_tables') {
          const rows = await query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`,
          );
          return { data: rows, error: null };
        }

        if (fnName === 'get_table_columns') {
          const table = params.table_name || params.p_table || params.table;
          const rows = await query(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}';`,
          );
          return { data: rows, error: null };
        }

        if (fnName === 'delete_business_data' || fnName === 'delete_business_cascade') {
          const bId = params.p_business_id || params.business_id;
          try {
            await query(`SELECT delete_business_data('${bId}');`);
          } catch {
            await query(`DELETE FROM public."businesses" WHERE "id" = '${bId}';`);
          }
          return { data: null, error: null };
        }

        if (fnName === 'set_realtime_enabled' || fnName === 'set_all_triggers_enabled') {
          try {
            await query(`SELECT ${fnName}(${Boolean(params.p_enabled)});`);
          } catch {
            // Non-critical on replica
          }
          return { data: null, error: null };
        }

        if (fnName === 'set_maintenance_mode') {
          try {
            await query(`SELECT set_maintenance_mode(${Boolean(params.p_enabled)});`);
          } catch {
            // Non-critical
          }
          return { data: null, error: null };
        }

        if (fnName === 'bulk_restore_data') {
          const table = params.p_table_name;
          let parsedData: any[] = [];
          if (typeof params.p_data === 'string') {
            try {
              parsedData = JSON.parse(params.p_data);
            } catch {
              parsedData = [];
            }
          } else if (Array.isArray(params.p_data)) {
            parsedData = params.p_data;
          }

          const dataStr =
            typeof params.p_data === 'string'
              ? params.p_data
              : JSON.stringify(params.p_data);
          const escaped = dataStr.replace(/'/g, "''");

          try {
            const rows = await query(
              `SELECT bulk_restore_data('${table}', '${escaped}'::jsonb) AS result;`,
            );
            const resObj = rows[0]?.result ?? rows[0]?.bulk_restore_data ?? rows[0];
            if (resObj && (resObj.success === true || resObj.count !== undefined)) {
              return {
                data: { success: true, count: resObj.count ?? parsedData.length },
                error: null,
              };
            }
            console.warn(
              `⚠️ bulk_restore_data returned unsuccessful:`,
              JSON.stringify(resObj),
              `Falling back to direct SQL insert for ${table}`,
            );
          } catch (rpcErr: any) {
            console.warn(
              `⚠️ bulk_restore_data RPC failed for ${table}:`,
              rpcErr?.message || rpcErr,
              `Falling back to direct SQL insert.`,
            );
          }

          // Fallback: Direct SQL INSERT
          const fallbackRes = await fallbackDirectInsert(table, parsedData);
          return { data: fallbackRes, error: null };
        }

        // Generic RPC invocation
        const args = Object.values(params)
          .map(v => `'${String(v).replace(/'/g, "''")}'`)
          .join(', ');
        const rows = await query(`SELECT * FROM ${fnName}(${args});`);
        return { data: rows[0] || null, error: null };
      } catch (err: any) {
        console.error(`❌ RPC ${fnName} error:`, err?.message || err);
        return {
          data: null,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },

    from(tableName: string) {
      return {
        select: (cols = '*') => {
          const promise: any = (async () => {
            try {
              const rows = await query(`SELECT ${cols} FROM public."${tableName}";`);
              return { data: rows, error: null };
            } catch (err: any) {
              return { data: null, error: err };
            }
          })();

          promise.range = (from: number, to: number) =>
            (async () => {
              try {
                const limit = to - from + 1;
                const rows = await query(
                  `SELECT ${cols} FROM public."${tableName}" OFFSET ${from} LIMIT ${limit};`,
                );
                return { data: rows, error: null };
              } catch (err: any) {
                return { data: null, error: err };
              }
            })();

          promise.eq = (col: string, val: any) => ({
            maybeSingle: async () => {
              try {
                const rows = await query(
                  `SELECT ${cols} FROM public."${tableName}" WHERE "${col}" = '${String(val).replace(/'/g, "''")}' LIMIT 1;`,
                );
                return { data: rows[0] || null, error: null };
              } catch (err: any) {
                return { data: null, error: err };
              }
            },
          });

          return promise;
        },
        delete: () => ({
          eq: async (col: string, val: any) => {
            try {
              await query(
                `DELETE FROM public."${tableName}" WHERE "${col}" = '${String(val).replace(/'/g, "''")}';`,
              );
              return { data: null, error: null };
            } catch (err: any) {
              return { data: null, error: err };
            }
          },
        }),
      };
    },

    auth: {
      admin: {
        listUsers: async () => {
          try {
            const rows = await query(`SELECT id, email FROM auth.users;`);
            return { data: { users: rows }, error: null };
          } catch (err: any) {
            return { data: null, error: err };
          }
        },
        createUser: async ({ email }: { email: string }) => {
          try {
            const existing = await query(
              `SELECT id, email FROM auth.users WHERE email = '${email.replace(/'/g, "''")}' LIMIT 1;`,
            );
            if (existing && existing.length > 0) {
              return { data: { user: existing[0] }, error: null };
            }
            const inserted = await query(`
              INSERT INTO auth.users (
                instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
              ) VALUES (
                '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${email.replace(/'/g, "''")}',
                crypt('${crypto.randomUUID()}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
              ) RETURNING id, email;
            `);
            return { data: { user: inserted[0] }, error: null };
          } catch (err: any) {
            return { data: null, error: err };
          }
        },
      },
    },
  };
}
