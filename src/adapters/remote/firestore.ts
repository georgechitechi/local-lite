import { RemoteDBAdapter } from './index.js';
import { DeltaChange, DeltaChanges, SyncOp, SyncOperation, PushResult } from '../../core/types.js';
import {
  SyncLogger,
  CustomLogger,
  LogLevel,
  createSyncLogger,
  formatFirestoreError,
} from '../../utils/logger.js';

export interface FirestoreAdapterOptions {
  /**
   * Collections (tables) synchronized with Firestore.
   * e.g. ['properties', 'tenants']
   */
  tables?: string[];

  /**
   * Primary key field name in documents. Default: 'id'
   */
  primaryKey?: string;

  /**
   * Field used for soft deletes. Default: 'deleted'
   */
  deletedColumn?: string;

  /**
   * Field used for updated timestamp tracking. Default: 'updatedAt'
   */
  updatedAtColumn?: string;

  /**
   * Optional reference to modular firebase/firestore SDK if not globally available.
   */
  firestoreModule?: any;

  /**
   * Custom logger or false to silence logs in production.
   */
  logger?: SyncLogger | CustomLogger | boolean;

  /**
   * Minimum log level. Default: 'info'
   */
  logLevel?: LogLevel;
}

/**
 * Safely extracts epoch milliseconds from numbers, Firestore Timestamps, or ISO strings.
 */
function extractTimestamp(val: any): number {
  if (!val) return Date.now();
  if (typeof val === 'number') return val;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (typeof val.seconds === 'number') {
    return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
  }
  if (typeof val.string === 'string') {
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export class FirestoreRemoteAdapter implements RemoteDBAdapter {
  private db: any;
  private tables: string[];
  private primaryKey: string;
  private deletedColumn: string;
  private updatedAtColumn: string;
  private firestoreModule: any;
  private unsubscribers: Array<() => void> = [];
  public logger: SyncLogger;

  constructor(db: any, options: FirestoreAdapterOptions = {}) {
    if (!db) {
      throw new Error('FirestoreRemoteAdapter requires a firestore db instance.');
    }
    this.db = db;
    this.tables = options.tables ?? [];
    this.primaryKey = options.primaryKey ?? 'id';
    this.deletedColumn = options.deletedColumn ?? 'deleted';
    this.updatedAtColumn = options.updatedAtColumn ?? 'updatedAt';
    this.firestoreModule = options.firestoreModule;

    this.logger = createSyncLogger(options.logger, options.logLevel);
  }

  setTables(tables: string[]): void {
    this.tables = tables;
  }

  private async getModule(): Promise<any> {
    if (this.firestoreModule) {
      return this.firestoreModule;
    }
    try {
      const dynamicImport = new Function('moduleName', 'return import(moduleName)');
      this.firestoreModule = await dynamicImport('firebase/firestore');
      return this.firestoreModule;
    } catch {
      return null;
    }
  }

  /**
   * Pushes outbox operations as batch writes to Firestore.
   * Chunks operations into batches of 450 (below Firestore 500-write limit).
   * Falls back to individual writes if a batch fails, returning partial push results.
   */
  async pushChanges(operations: SyncOperation[]): Promise<boolean | PushResult> {
    if (!operations || operations.length === 0) {
      return true;
    }

    const failedIds: string[] = [];
    const errors: Record<string, string> = {};

    try {
      const isCompat = typeof this.db.batch === 'function' && typeof this.db.collection === 'function';
      const mod = isCompat ? null : await this.getModule();

      const CHUNK_SIZE = 450;
      for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
        const chunk = operations.slice(i, i + CHUNK_SIZE);
        const now = Date.now();

        const buildDocData = (op: SyncOperation) => {
          if (op.operation === 'DELETE') {
            return {
              [this.primaryKey]: op.rowId,
              [this.deletedColumn]: true,
              [this.updatedAtColumn]: now,
            };
          } else {
            return {
              ...(op.payload || {}),
              [this.primaryKey]: op.rowId,
              [this.deletedColumn]: false,
              [this.updatedAtColumn]: now,
            };
          }
        };

        if (isCompat) {
          // React Native Firebase / Compat SDK
          try {
            const batch = this.db.batch();
            for (const op of chunk) {
              const docRef = this.db.collection(op.tableName).doc(op.rowId);
              batch.set(docRef, buildDocData(op), { merge: true });
            }
            await batch.commit();
          } catch (batchError: any) {
            this.logger.warn(
              `[Firestore] Batch write failed, falling back to per-document writes: ${batchError?.message || batchError}`
            );
            for (const op of chunk) {
              try {
                const docRef = this.db.collection(op.tableName).doc(op.rowId);
                await docRef.set(buildDocData(op), { merge: true });
              } catch (opErr: any) {
                failedIds.push(op.id);
                errors[op.id] = opErr?.message || String(opErr);
              }
            }
          }
        } else if (mod && typeof mod.writeBatch === 'function') {
          // Modular Firebase SDK
          try {
            const batch = mod.writeBatch(this.db);
            for (const op of chunk) {
              const docRef = mod.doc(mod.collection(this.db, op.tableName), op.rowId);
              batch.set(docRef, buildDocData(op), { merge: true });
            }
            await batch.commit();
          } catch (batchError: any) {
            this.logger.warn(
              `[Firestore] Batch write failed, falling back to per-document writes: ${batchError?.message || batchError}`
            );
            for (const op of chunk) {
              try {
                const docRef = mod.doc(mod.collection(this.db, op.tableName), op.rowId);
                if (typeof mod.setDoc === 'function') {
                  await mod.setDoc(docRef, buildDocData(op), { merge: true });
                } else {
                  throw batchError;
                }
              } catch (opErr: any) {
                failedIds.push(op.id);
                errors[op.id] = opErr?.message || String(opErr);
              }
            }
          }
        } else {
          throw new Error(
            'Firestore client does not have .batch() and modular firebase/firestore writeBatch could not be loaded.'
          );
        }
      }

      if (failedIds.length > 0) {
        return {
          success: false,
          failedIds,
          errors,
        };
      }
      return true;
    } catch (error) {
      this.logger.error(formatFirestoreError(error, { operation: 'pushChanges' }));
      return false;
    }
  }

  /**
   * Fetches delta changes across tracked collections where updatedAt > sinceTimestamp.
   */
  async fetchChanges(sinceTimestamp: number): Promise<DeltaChanges> {
    if (!this.tables || this.tables.length === 0) {
      return { timestamp: sinceTimestamp, changes: [] };
    }

    try {
      const isCompat = typeof this.db.collection === 'function';
      const mod = isCompat ? null : await this.getModule();

      let maxServerTimestamp = sinceTimestamp;
      const changes: DeltaChange[] = [];

      const CHUNK_SIZE = 5;
      for (let i = 0; i < this.tables.length; i += CHUNK_SIZE) {
        const chunk = this.tables.slice(i, i + CHUNK_SIZE);
        const results = await Promise.all(
          chunk.map(async (table) => {
            let docs: any[] = [];

            if (isCompat) {
              const snapshot = await this.db
                .collection(table)
                .where(this.updatedAtColumn, '>', sinceTimestamp)
                .get();
              docs = snapshot.docs || [];
            } else if (mod && typeof mod.getDocs === 'function') {
              const q = mod.query(
                mod.collection(this.db, table),
                mod.where(this.updatedAtColumn, '>', sinceTimestamp)
              );
              const snapshot = await mod.getDocs(q);
              docs = snapshot.docs || [];
            }
            return { table, docs };
          })
        );

        for (const { table, docs } of results) {
          for (const doc of docs) {
            const data = typeof doc.data === 'function' ? doc.data() : doc;
            const isSoftDeleted = Boolean(
              data[this.deletedColumn] === true ||
              data[this.deletedColumn] === 1 ||
              (data[this.deletedColumn] &&
                !['false', '0', 'null', 'undefined'].includes(String(data[this.deletedColumn]).toLowerCase()))
            );

            const rowTime = extractTimestamp(data[this.updatedAtColumn]);
            if (rowTime > maxServerTimestamp) {
              maxServerTimestamp = rowTime;
            }

            const rowId = String(data[this.primaryKey] || doc.id || data.id);
            const operation: SyncOp = isSoftDeleted ? 'DELETE' : 'UPDATE';

            changes.push({
              tableName: table,
              operation,
              rowId,
              payload: isSoftDeleted ? null : data,
              timestamp: rowTime,
            });
          }
        }
      }

      return {
        timestamp: changes.length > 0 ? maxServerTimestamp : sinceTimestamp,
        changes,
      };
    } catch (error) {
      this.logger.error(formatFirestoreError(error, { operation: 'fetchChanges' }));
      return { timestamp: sinceTimestamp, changes: [] };
    }
  }

  /**
   * Subscribes to live real-time query updates via onSnapshot.
   */
  subscribeToLiveChanges(callback: (changes: DeltaChanges) => void): void {
    this.destroy();

    if (!this.tables || this.tables.length === 0) {
      return;
    }

    const setupListeners = async () => {
      const isCompat = typeof this.db.collection === 'function';
      const mod = isCompat ? null : await this.getModule();
      const currentCursor = Date.now() - 2000;

      for (const table of this.tables) {
        try {
          const handleSnapshot = (snapshot: any) => {
            if (!snapshot) return;

            let docList: any[] = [];
            if (typeof snapshot.docChanges === 'function') {
              const docChanges = snapshot.docChanges();
              if (docChanges && docChanges.length > 0) {
                docList = docChanges.map((dc: any) => ({
                  doc: dc.doc,
                  isRemoved: dc.type === 'removed',
                }));
              }
            } else if (snapshot.docs) {
              docList = snapshot.docs.map((doc: any) => ({ doc, isRemoved: false }));
            }

            if (docList.length === 0) return;

            const changes: DeltaChange[] = [];
            for (const item of docList) {
              const doc = item.doc;
              const data = typeof doc.data === 'function' ? doc.data() : doc;
              const isSoftDeleted = Boolean(
                item.isRemoved ||
                data[this.deletedColumn] === true ||
                data[this.deletedColumn] === 1
              );

              const rowTime = extractTimestamp(data[this.updatedAtColumn]);
              const rowId = String(data[this.primaryKey] || doc.id || data.id);

              changes.push({
                tableName: table,
                operation: isSoftDeleted ? 'DELETE' : 'UPDATE',
                rowId,
                payload: isSoftDeleted ? null : data,
                timestamp: rowTime,
              });
            }

            if (changes.length > 0) {
              const maxTime = Math.max(...changes.map((c) => c.timestamp || 0));
              callback({
                timestamp: maxTime > 0 ? maxTime : Date.now(),
                changes,
              });
            }
          };

          if (isCompat) {
            const unsub = this.db
              .collection(table)
              .where(this.updatedAtColumn, '>', currentCursor)
              .onSnapshot(handleSnapshot, (err: any) => {
                console.warn(`Firestore onSnapshot error on ${table}:`, err);
              });
            if (typeof unsub === 'function') {
              this.unsubscribers.push(unsub);
            }
          } else if (mod && typeof mod.onSnapshot === 'function') {
            const q = mod.query(
              mod.collection(this.db, table),
              mod.where(this.updatedAtColumn, '>', currentCursor)
            );
            const unsub = mod.onSnapshot(q, handleSnapshot, (err: any) => {
              console.warn(`Firestore modular onSnapshot error on ${table}:`, err);
            });
            if (typeof unsub === 'function') {
              this.unsubscribers.push(unsub);
            }
          }
        } catch (err) {
          console.warn(`Failed to initialize Firestore live listener for table ${table}:`, err);
        }
      }
    };

    setupListeners();
  }

  /**
   * Cleans up all active real-time listeners.
   */
  destroy(): void {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.unsubscribers = [];
  }
}
