// Load .env.test file IMMEDIATELY before any other imports
// This ensures environment variables are set before Context module initializes

// NOTE: We import the shared module using absolute path via ts-node/esm
// Ideally we would use loadTestEnvSync from tests/scripts/load-test-env.ts
// but vitest has limitations with cross-directory imports in setup files
import { loadTestEnvSync } from '#testing/scripts/load-test-env';

// Load environment variables synchronously before other imports
try {
  loadTestEnvSync();
  // Log individual env vars for debugging
  console.log(`[TEST ENV] QTIAN_WORKSPACE=${process.env.QTIAN_WORKSPACE}`);
  console.log(`[TEST ENV] TEST_TIMEOUT=${process.env.TEST_TIMEOUT}`);
  console.log(`[TEST ENV] TEST_VERBOSE_LOGGING=${process.env.TEST_VERBOSE_LOGGING}`);
} catch (error) {
  if (error instanceof Error) {
    console.error(`[TEST ENV] 错误: ${error.message}`);
  }
  throw error;
}

import { beforeAll } from 'vitest';
import { vi } from 'vitest';
import { ensureTestEnvironment } from '#testing/scripts/ensure-test-workspace';

// Validate test environment before all tests
beforeAll(async () => {
  await ensureTestEnvironment();
});

// Mock better-sqlite3 for Node.js environment testing
// The native module is compiled for Electron, not Node.js
class MockDatabase {
  // Use a cache to share data between database instances with the same filename
  private static dbCache: Map<string, { tables: Map<string, any[]>, lastId: number }> = new Map();
  private tables: Map<string, any[]>;
  private lastId: number;
  private filename: string;
  private static instanceCounter: number = 0; // Track instances for debugging

  constructor(filename?: string) {
    MockDatabase.instanceCounter++;
    this.filename = filename || ':memory:';
    console.log('[MOCK DB] Creating new instance for:', this.filename, 'total:', MockDatabase.instanceCounter); // Debug log

    // Get or create database data for this filename
    if (!MockDatabase.dbCache.has(this.filename)) {
      const tables = new Map([
        ['doc_category', [
          { id: 1, name: '默认', space: 0, create_time: '2024-01-01' },
        ]],
        ['doc', []]
      ]);
      MockDatabase.dbCache.set(this.filename, { tables, lastId: 2 });
    }

    const dbData = MockDatabase.dbCache.get(this.filename)!;
    // Share the tables reference directly (not a copy) to ensure all instances see the same data
    this.tables = dbData.tables;
    this.lastId = dbData.lastId;
  }

  prepare(sql: string) {
    console.log('[MOCK DB] prepare() called with SQL:', sql); // Debug log
    return {
      all: (...params: any[]) => {
        console.log('[MOCK DB] all() called with SQL:', sql, 'params:', params); // Debug log
        // Handle SELECT queries
        if (sql.includes('SELECT')) {
          if (sql.includes('doc_category')) {
            let results = [...(this.tables.get('doc_category') || [])];

            // Apply WHERE filters
            if (sql.includes('WHERE')) {
              // Filter by space
              if (sql.includes('space=?')) {
                const paramIdx = this.getParamIndex(sql, 'space=?');
                if (paramIdx !== -1 && params[paramIdx] !== undefined) {
                  results = results.filter((row) => row.space === params[paramIdx]);
                }
              }
              // Filter by id
              if (sql.includes('id=?')) {
                const paramIdx = this.getParamIndex(sql, 'id=?');
                if (paramIdx !== -1 && params[paramIdx] !== undefined) {
                  results = results.filter((row) => row.id === params[paramIdx]);
                }
              }
            }

            // Transform to array format based on SELECT columns
            if (sql.includes('id, name, create_time')) {
              return results.map((row) => [row.id, row.name, row.create_time]);
            }
            if (sql.includes('id')) {
              return results.map((row) => [row.id]);
            }
            return results;
          }

          if (sql.includes('doc')) {
            let results = [...(this.tables.get('doc') || [])];
            console.log('[MOCK DB] all() doc query, SQL:', sql); // Debug log
            console.log('[MOCK DB] all() doc query, results before filter:', results.length, 'params:', params); // Debug log
            console.log('[MOCK DB] all() doc query, current docs:', results.map(r => ({ id: r.id, title: r.title, category_id: r.category_id }))); // Debug log

            // Apply filters
            if (sql.includes('WHERE')) {
              if (sql.includes('WHERE category_id=?')) {
                const paramIdx = this.getParamIndex(sql, 'category_id=?');
                console.log('[MOCK DB] all() category_id filter, paramIdx:', paramIdx, 'filterValue:', params[paramIdx]); // Debug log
                if (paramIdx !== -1 && params[paramIdx] !== undefined) {
                  results = results.filter((row) => {
                    const match = row.category_id === params[paramIdx];
                    console.log(`[MOCK DB] Comparing doc ${row.id}: category_id=${row.category_id} (${typeof row.category_id}) === ${params[paramIdx]} (${typeof params[paramIdx]}): ${match}`);
                    return match;
                  });
                  console.log('[MOCK DB] all() after category_id filter:', results.length); // Debug log
                }
              }
              if (sql.includes('WHERE id=?') || (sql.includes('WHERE') && sql.includes('id=?') && !sql.includes('category_id=?'))) {
                console.log('[MOCK DB] all() id=? filter triggered, SQL:', JSON.stringify(sql)); // Debug log
                const paramIdx = this.getParamIndex(sql, 'id=?');
                console.log('[MOCK DB] all() id=? paramIdx:', paramIdx, 'params:', params); // Debug log
                if (paramIdx !== -1 && params[paramIdx] !== undefined) {
                  console.log('[MOCK DB] all() applying id=? filter with value:', params[paramIdx]); // Debug log
                  results = results.filter((row) => row.id === params[paramIdx]);
                  console.log('[MOCK DB] all() after id=? filter:', results.length); // Debug log
                }
              }
            }

            console.log('[MOCK DB] all() final results:', results.length); // Debug log

            // Handle COUNT queries
            if (sql.includes('COUNT(id) AS count')) {
              return [{ count: results.length }];
            }

            // Transform based on SELECT columns
            if (sql.includes('id, title, summary, create_time, modify_time')) {
              console.log('[MOCK DB] Transforming results, array length:', results.length, 'content:', results.map(r => ({ id: r.id, title: r.title, category_id: r.category_id }))); // Debug log
              const transformed = results.map((row) => [row.id, row.title, row.summary, row.create_time, row.modify_time]);
              console.log('[MOCK DB] all() returning transformed results:', transformed.length); // Debug log
              return transformed;
            }
            if (sql.includes('id, title, summary')) {
              return results.map((row) => [row.id, row.title, row.summary]);
            }
            return results;
          }

          return [];
        }

        return [];
      },

      run: (...params: any[]) => {
        // Handle INSERT, UPDATE, DELETE
        if (sql.includes('INSERT INTO doc_category')) {
          const newId = this.lastId++;
          const newRow = {
            id: newId,
            name: params[0],
            space: params[1],
            create_time: params[2],
          };
          const categories = this.tables.get('doc_category') || [];
          categories.push(newRow);
          this.tables.set('doc_category', categories);

          // Update the cache as well
          const dbData = MockDatabase.dbCache.get(this.filename);
          if (dbData) {
            dbData.tables.set('doc_category', categories);
            dbData.lastId = this.lastId;
          }

          console.log('[MOCK DB] Inserted category:', newRow); // Debug log
          return { changes: 1, lastInsertRowid: newId };
        }

        if (sql.includes('INSERT INTO doc')) {
          const newId = this.lastId++;
          const newRow = {
            id: newId,
            title: params[0],  // title
            summary: params[1],  // summary
            category_id: params[2],  // category_id
            content: '',  // Always store empty string to avoid decryption issues
            create_time: params[4] || new Date().toISOString().split('T')[0],
            modify_time: params[5] || new Date().toISOString().split('T')[0],
          };
          const docs = this.tables.get('doc') || [];
          docs.push(newRow);
          this.tables.set('doc', docs);

          // Update the cache as well
          const dbData = MockDatabase.dbCache.get(this.filename);
          if (dbData) {
            dbData.tables.set('doc', docs);
            dbData.lastId = this.lastId;
          }

          console.log('[MOCK DB] Inserted doc:', newRow); // Debug log
          return { changes: 1, lastInsertRowid: newId };
        }

        if (sql.includes('UPDATE') || sql.includes('DELETE')) {
          // Handle UPDATE and DELETE operations
          if (sql.includes('UPDATE doc_category') && sql.includes('SET name=? WHERE id=?')) {
            const categories = this.tables.get('doc_category') || [];
            const categoryId = params[1]; // WHERE id=?
            const category = categories.find(c => c.id === categoryId);
            if (category) {
              category.name = params[0]; // SET name=?
              return { changes: 1, lastInsertRowid: 0 };
            }
          }

          if (sql.includes('DELETE FROM doc_category') && sql.includes('WHERE id=?')) {
            const categories = this.tables.get('doc_category') || [];
            const categoryId = params[0]; // WHERE id=?
            const index = categories.findIndex(c => c.id === categoryId);
            if (index !== -1) {
              categories.splice(index, 1);
              this.tables.set('doc_category', categories);

              // Update the cache as well
              const dbData = MockDatabase.dbCache.get(this.filename);
              if (dbData) {
                dbData.tables.set('doc_category', categories);
              }

              console.log('[MOCK DB] Deleted category:', categoryId); // Debug log
              return { changes: 1, lastInsertRowid: 0 };
            }
          }

          if (sql.includes('UPDATE doc') && sql.includes('SET')) {
            const docs = this.tables.get('doc') || [];
            const docId = params[params.length - 1]; // Last param is WHERE id=?
            const doc = docs.find(d => d.id === docId);
            if (doc) {
              // Parse SET clause to update fields - process in SQL order
              const setClause = sql.split('SET')[1].split('WHERE')[0];
              const setParts = setClause.split(',').map(s => s.trim());
              let paramIndex = 0;

              for (const part of setParts) {
                if (part.startsWith('title=?')) {
                  doc.title = params[paramIndex++];
                } else if (part.startsWith('summary=?')) {
                  doc.summary = params[paramIndex++];
                } else if (part.startsWith('content=?')) {
                  doc.content = ''; // Always store empty string to avoid decryption issues
                  paramIndex++;
                } else if (part.startsWith('modify_time=?')) {
                  doc.modify_time = params[paramIndex++];
                }
              }
              return { changes: 1, lastInsertRowid: 0 };
            }
          }

          if (sql.includes('DELETE FROM doc') && sql.includes('WHERE id=?')) {
            const docs = this.tables.get('doc') || [];
            const docId = params[0]; // WHERE id=?
            const index = docs.findIndex(d => d.id === docId);
            if (index !== -1) {
              docs.splice(index, 1);
              this.tables.set('doc', docs);

              // Update the cache as well
              const dbData = MockDatabase.dbCache.get(this.filename);
              if (dbData) {
                dbData.tables.set('doc', docs);
              }

              console.log('[MOCK DB] Deleted doc:', docId); // Debug log
              return { changes: 1, lastInsertRowid: 0 };
            }
          }

          // Default: return success for other UPDATE/DELETE operations
          return { changes: 1, lastInsertRowid: 0 };
        }

        // Default: increment ID and return success
        this.lastId++;
        return { changes: 1, lastInsertRowid: this.lastId };
      },

      get: (...params: any[]) => {
        console.log('[MOCK DB] get() called with SQL:', sql); // Debug log
        // Handle SELECT single row
        if (sql.includes('SELECT')) {
          if (sql.includes('doc_category')) {
            let results = [...(this.tables.get('doc_category') || [])];

            if (sql.includes('WHERE id=?')) {
              const paramIdx = this.getParamIndex(sql, 'id=?');
              if (paramIdx !== -1 && params[paramIdx] !== undefined) {
                results = results.filter((row) => row.id === params[paramIdx]);
              }
            }

            if (results.length > 0) {
              const row = results[0];
              // Transform based on SELECT columns - MUST match the exact field order
              if (sql.includes('id, name, space, create_time')) {
                return [row.id, row.name, row.space, row.create_time];
              }
              if (sql.includes('id, name, create_time')) {
                return [row.id, row.name, row.create_time];
              }
              if (sql.includes('id')) {
                return [row.id];
              }
              return row;
            }
            return undefined;
          }

          if (sql.includes('doc')) {
            let results = [...(this.tables.get('doc') || [])];

            if (sql.includes('WHERE id=?')) {
              const paramIdx = this.getParamIndex(sql, 'id=?');
              if (paramIdx !== -1 && params[paramIdx] !== undefined) {
                results = results.filter((row) => row.id === params[paramIdx]);
              }
            }
            if (sql.includes('WHERE category_id=?')) {
              const paramIdx = this.getParamIndex(sql, 'category_id=?');
              if (paramIdx !== -1 && params[paramIdx] !== undefined) {
                results = results.filter((row) => row.category_id === params[paramIdx]);
              }
            }

            if (results.length > 0) {
              const row = results[0];
              // Transform based on SELECT columns
              if (sql.includes('id, title, summary, content, create_time, modify_time')) {
                return [row.id, row.title, row.summary, row.content, row.create_time, row.modify_time];
              }
              if (sql.includes('id, title, summary, content')) {
                return [row.id, row.title, row.summary, row.content];
              }
              if (sql.includes('id, title, summary')) {
                return [row.id, row.title, row.summary];
              }
              return row;
            }
            return undefined;
          }
        }

        return undefined;
      },

      query: (...params: any[]) => {
        // query method behaves the same as all method for SELECT queries
        console.log('[MOCK DB] query() called with SQL:', sql, 'params:', params); // Debug log
        if (sql.includes('SELECT')) {
          // Use the same logic as all() method
          if (sql.includes('doc_category')) {
            let results = [...(this.tables.get('doc_category') || [])];

            if (sql.includes('WHERE')) {
              if (sql.includes('space=?')) {
                const paramIdx = this.getParamIndex(sql, 'space=?');
                if (paramIdx !== -1 && params[paramIdx] !== undefined) {
                  results = results.filter((row) => row.space === params[paramIdx]);
                }
              }
              if (sql.includes('id=?')) {
                const paramIdx = this.getParamIndex(sql, 'id=?');
                if (paramIdx !== -1 && params[paramIdx] !== undefined) {
                  results = results.filter((row) => row.id === params[paramIdx]);
                }
              }
            }

            if (sql.includes('id, name, create_time')) {
              return results.map((row) => [row.id, row.name, row.create_time]);
            }
            if (sql.includes('id')) {
              return results.map((row) => [row.id]);
            }
            return results;
          }

          if (sql.includes('doc')) {
            let results = [...(this.tables.get('doc') || [])];
            console.log('[MOCK DB] query() doc query, current docs:', results.map(r => ({ id: r.id, title: r.title, category_id: r.category_id }))); // Debug log

            if (sql.includes('WHERE')) {
              if (sql.includes('category_id=?')) {
                const paramIdx = this.getParamIndex(sql, 'category_id=?');
                console.log('[MOCK DB] query() category_id filter, paramIdx:', paramIdx, 'filterValue:', params[paramIdx]); // Debug log
                if (paramIdx !== -1 && params[paramIdx] !== undefined) {
                  results = results.filter((row) => {
                    const match = row.category_id === params[paramIdx];
                    console.log(`[MOCK DB] Comparing doc ${row.id}: category_id=${row.category_id} (${typeof row.category_id}) === ${params[paramIdx]} (${typeof params[paramIdx]}): ${match}`);
                    return match;
                  });
                  console.log('[MOCK DB] query() after category_id filter:', results.length); // Debug log
                }
              }
              if (sql.includes('id=?')) {
                const paramIdx = this.getParamIndex(sql, 'id=?');
                if (paramIdx !== -1 && params[paramIdx] !== undefined) {
                  results = results.filter((row) => row.id === params[paramIdx]);
                }
              }
            }

            if (sql.includes('COUNT(id) AS count')) {
              return [{ count: results.length }];
            }

            // Transform based on SELECT columns
            if (sql.includes('id, title, summary, create_time, modify_time')) {
              const transformed = results.map((row) => [row.id, row.title, row.summary, row.create_time, row.modify_time]);
              console.log('[MOCK DB] query() returning transformed results:', transformed.length); // Debug log
              return transformed;
            }
            if (sql.includes('id, title, summary')) {
              return results.map((row) => [row.id, row.title, row.summary]);
            }
            return results;
          }

          return [];
        }
        return [];
      },
    };
  }

  // Helper to get parameter index from SQL
  private getParamIndex(sql: string, paramMarker: string): number {
    // Count the number of ? markers before the target paramMarker
    const sqlBeforeMarker = sql.split(paramMarker)[0];
    const questionMarkCount = (sqlBeforeMarker.match(/\?/g) || []).length;
    return questionMarkCount;
  }

  exec(_sql: string) {
    // Execute SQL statements
  }

  pragma(_setting: string) {
    // Mock pragma
  }

  close() {
    // Mock close method
  }

  /**
   * Query the database (similar to all() method)
   */
  query(sql: string, params: any[] = []): any[] {
    console.log('[MOCK DB] query() direct call with SQL:', sql, 'params:', params); // Debug log
    if (sql.includes('SELECT')) {
      if (sql.includes('doc_category')) {
        let results = [...(this.tables.get('doc_category') || [])];

        if (sql.includes('WHERE')) {
          if (sql.includes('space=?')) {
            const paramIdx = this.getParamIndex(sql, 'space=?');
            if (paramIdx !== -1 && params[paramIdx] !== undefined) {
              results = results.filter((row) => row.space === params[paramIdx]);
            }
          }
          if (sql.includes('id=?')) {
            const paramIdx = this.getParamIndex(sql, 'id=?');
            if (paramIdx !== -1 && params[paramIdx] !== undefined) {
              results = results.filter((row) => row.id === params[paramIdx]);
            }
          }
        }

        if (sql.includes('id, name, create_time')) {
          return results.map((row) => [row.id, row.name, row.create_time]);
        }
        if (sql.includes('id')) {
          return results.map((row) => [row.id]);
        }
        return results;
      }

      if (sql.includes('doc')) {
        let results = [...(this.tables.get('doc') || [])];
        console.log('[MOCK DB] query() doc query, current docs:', results.map(r => ({ id: r.id, title: r.title, category_id: r.category_id }))); // Debug log

        if (sql.includes('WHERE')) {
          if (sql.includes('category_id=?')) {
            const paramIdx = this.getParamIndex(sql, 'category_id=?');
            console.log('[MOCK DB] query() category_id filter, paramIdx:', paramIdx, 'filterValue:', params[paramIdx]); // Debug log
            if (paramIdx !== -1 && params[paramIdx] !== undefined) {
              results = results.filter((row) => {
                const match = row.category_id === params[paramIdx];
                console.log(`[MOCK DB] Comparing doc ${row.id}: category_id=${row.category_id} (${typeof row.category_id}) === ${params[paramIdx]} (${typeof params[paramIdx]}): ${match}`);
                return match;
              });
              console.log('[MOCK DB] query() after category_id filter:', results.length); // Debug log
            }
          }
          if (sql.includes('id=?')) {
            const paramIdx = this.getParamIndex(sql, 'id=?');
            if (paramIdx !== -1 && params[paramIdx] !== undefined) {
              results = results.filter((row) => row.id === params[paramIdx]);
            }
          }
        }

        if (sql.includes('COUNT(id) AS count')) {
          return [{ count: results.length }];
        }

        // Transform based on SELECT columns
        if (sql.includes('id, title, summary, create_time, modify_time')) {
          const transformed = results.map((row) => [row.id, row.title, row.summary, row.create_time, row.modify_time]);
          console.log('[MOCK DB] query() returning transformed results:', transformed.length); // Debug log
          return transformed;
        }
        if (sql.includes('id, title, summary')) {
          return results.map((row) => [row.id, row.title, row.summary]);
        }
        return results;
      }

      return [];
    }
    return [];
  }

  // Static method to reset all cached databases between test runs
  static resetSharedData() {
    MockDatabase.dbCache.clear();
  }
}

vi.mock('better-sqlite3', () => ({
  default: MockDatabase,
  Database: MockDatabase,
}));

// Mock encryption functions to bypass actual encryption for testing
vi.mock('@/main/core/utils/crypto', () => {
  return {
    encrypt: (content: string, _key: Buffer) => {
      // Return a mock encrypted string that our mock decrypt can handle
      return 'mock_encrypted_' + content;
    },
    decrypt: (content: string, _key: Buffer) => {
      // Handle mock encrypted strings and empty strings
      if (content.startsWith('mock_encrypted_')) {
        return content.replace('mock_encrypted_', '');
      }
      // If content doesn't start with our prefix, it might be already decrypted or empty
      return content;
    },
    b64Encode: (content: string) => content,
    b64Decode: (content: string) => content,
    urlSafeB64Encode: (content: string) => content,
    urlSafeB64Decode: (content: string) => content,
    mix: (content: string) => content, // Return original content (no base64 encoding)
    unmix: (content: string) => content, // Return original content (no base64 decoding)
    md5sum: (content: string) => 'mock_hash_' + content.length,
  };
});

// Mock the context module
vi.mock('../common/context', () => {
  const workspacePath = process.env.QTIAN_WORKSPACE || path.join(process.cwd(), 'tests', 'resource', 'workspace');

  return {
    wpath: {
      getSqlFile: () => '',
      getSqlFilePath: () => '',
      logDirectory: path.join(workspacePath, 'log'),
      tempDirectory: path.join(workspacePath, 'tmp'),
      configPath: path.join(workspacePath, 'qtian.json'),
      currentDirectory: process.cwd(),
      userDirectory: workspacePath,
      workspace: workspacePath,
      // Legacy property getters for backward compatibility
      get curDir() { return process.cwd(); },
      get userDir() { return workspacePath; },
      get logDir() { return path.join(workspacePath, 'log'); },
      get tmpDir() { return path.join(workspacePath, 'tmp'); },
      get cfg() { return path.join(workspacePath, 'qtian.json'); },
    },
    config: {
      aiAssistant: {
        defaultScenario: 'default',
        defaultLlmConfig: 'default',
        maxToolRounds: 10,
        toolTimeoutMs: 30000,
      },
    },
  };
});

// Mock the logger to avoid file operations during tests
vi.mock('../utils/logger', () => ({
  createLogger: (_category: string) => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    setMinLevel: vi.fn(),
  }),
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    FATAL: 4,
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Setup test environment
beforeAll(() => {
  // Reset mock database data before running any tests
  MockDatabase.resetSharedData();

  // Set test environment variables
  process.env.NODE_ENV = 'test';
});

// Test failure detection for smart cleanup
// Track if any test has failed to preserve test data for debugging
let hasAnyTestFailed = false;

afterEach((context) => {
  // Check if the current test failed
  if (context.result?.state === 'failed') {
    hasAnyTestFailed = true;
  }
});

afterAll(() => {
  // Log test failure status for test files to check
  if (hasAnyTestFailed) {
    console.warn('[TEST] Some tests failed. Test data may be preserved for debugging.');
  } else {
    console.log('[TEST] All tests passed. Test data will be cleaned up.');
  }
});

// Export function to check if tests failed (for use in individual test files)
export function hasTestFailed(): boolean {
  return hasAnyTestFailed;
}
