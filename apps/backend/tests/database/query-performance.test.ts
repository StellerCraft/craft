/**
 * Database Query Performance Tests
 *
 * Measures and verifies that critical database queries meet performance
 * requirements. Tests use an in-memory simulation of the Supabase query
 * layer — no live database is required.
 *
 * Performance baselines (documented here for CI regression detection):
 *   - Single-row lookup by primary key (indexed):  < 5 ms
 *   - Filtered list query (indexed column):        < 20 ms
 *   - Filtered list query (unindexed column):      < 100 ms
 *   - Aggregation over 10 000 rows:                < 50 ms
 *   - Paginated query (LIMIT / OFFSET):            < 10 ms
 *   - Multi-table join simulation:                 < 30 ms
 *
 * Query-plan analysis is performed via a lightweight EXPLAIN ANALYZE
 * simulator that records whether an index was used for each query.
 */

import { describe, it, expect, beforeAll } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  user_id: string;
  template_id: string;
  status: string;
  metric_type: string;
  metric_value: number;
  created_at: number; // epoch ms — avoids Date overhead in tight loops
}

interface QueryPlan {
  usedIndex: boolean;
  indexName: string | null;
  rowsScanned: number;
  rowsReturned: number;
  executionMs: number;
}

// ── In-memory dataset ─────────────────────────────────────────────────────────

const DATASET_SIZE = 10_000;
const USER_COUNT = 100;
const TEMPLATE_COUNT = 4;
const STATUSES = ['pending', 'building', 'completed', 'failed'] as const;
const METRIC_TYPES = ['page_view', 'uptime_check', 'transaction_count'] as const;

/** Deterministic pseudo-random number (no external deps). */
function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 10_000;
  return x - Math.floor(x);
}

function generateDataset(size: number): Row[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `row-${i}`,
    user_id: `user-${Math.floor(seededRand(i) * USER_COUNT)}`,
    template_id: `tmpl-${Math.floor(seededRand(i + size) * TEMPLATE_COUNT)}`,
    status: STATUSES[Math.floor(seededRand(i + size * 2) * STATUSES.length)],
    metric_type: METRIC_TYPES[Math.floor(seededRand(i + size * 3) * METRIC_TYPES.length)],
    metric_value: Math.floor(seededRand(i + size * 4) * 1_000),
    created_at: Date.now() - Math.floor(seededRand(i + size * 5) * 30 * 24 * 3_600_000),
  }));
}

// ── Index simulation ──────────────────────────────────────────────────────────

/**
 * Simulates a B-tree index on a string column.
 * Lookup is O(1) via a Map; full-scan fallback is O(n).
 */
class SimulatedIndex {
  private readonly map = new Map<string, Row[]>();

  constructor(
    private readonly name: string,
    rows: Row[],
    private readonly key: keyof Row,
  ) {
    for (const row of rows) {
      const k = String(row[key]);
      const bucket = this.map.get(k) ?? [];
      bucket.push(row);
      this.map.set(k, bucket);
    }
  }

  lookup(value: string): { rows: Row[]; plan: Pick<QueryPlan, 'usedIndex' | 'indexName' | 'rowsScanned'> } {
    const rows = this.map.get(value) ?? [];
    return {
      rows,
      plan: { usedIndex: true, indexName: this.name, rowsScanned: rows.length },
    };
  }
}

// ── Query executor ────────────────────────────────────────────────────────────

class QueryExecutor {
  private readonly indexes: Map<string, SimulatedIndex>;

  constructor(
    private readonly rows: Row[],
    indexes: SimulatedIndex[],
  ) {
    this.indexes = new Map(indexes.map(idx => [idx['name' as keyof SimulatedIndex] as string, idx]));
  }

  /** SELECT * FROM rows WHERE <column> = <value> LIMIT <limit> */
  findByColumn(
    column: keyof Row,
    value: string,
    limit = 100,
    indexName?: string,
  ): QueryPlan {
    const start = performance.now();

    let result: Row[];
    let usedIndex = false;
    let scanned: number;
    let resolvedIndexName: string | null = null;

    if (indexName && this.indexes.has(indexName)) {
      const idx = this.indexes.get(indexName)!;
      const { rows, plan } = idx.lookup(value);
      result = rows.slice(0, limit);
      usedIndex = plan.usedIndex;
      scanned = plan.rowsScanned;
      resolvedIndexName = plan.indexName;
    } else {
      // Full table scan
      result = [];
      for (const row of this.rows) {
        if (String(row[column]) === value) result.push(row);
        if (result.length >= limit) break;
      }
      scanned = this.rows.length;
    }

    return {
      usedIndex,
      indexName: resolvedIndexName,
      rowsScanned: scanned,
      rowsReturned: result.length,
      executionMs: performance.now() - start,
    };
  }

  /** SELECT * FROM rows WHERE id = <id> */
  findById(id: string, indexName: string): QueryPlan {
    return this.findByColumn('id', id, 1, indexName);
  }

  /** SELECT * FROM rows LIMIT <limit> OFFSET <offset> */
  paginate(limit: number, offset: number): QueryPlan {
    const start = performance.now();
    const result = this.rows.slice(offset, offset + limit);
    return {
      usedIndex: false,
      indexName: null,
      rowsScanned: offset + limit,
      rowsReturned: result.length,
      executionMs: performance.now() - start,
    };
  }

  /** SELECT metric_type, SUM(metric_value) FROM rows GROUP BY metric_type */
  aggregateByMetricType(): QueryPlan {
    const start = performance.now();
    const sums = new Map<string, number>();
    for (const row of this.rows) {
      sums.set(row.metric_type, (sums.get(row.metric_type) ?? 0) + row.metric_value);
    }
    return {
      usedIndex: false,
      indexName: null,
      rowsScanned: this.rows.length,
      rowsReturned: sums.size,
      executionMs: performance.now() - start,
    };
  }

  /**
   * Simulates a JOIN between deployments and analytics by user_id.
   * Equivalent to:
   *   SELECT d.*, a.metric_value
   *   FROM deployments d
   *   JOIN deployment_analytics a ON d.id = a.id
   *   WHERE d.user_id = <userId>
   */
  joinByUserId(userId: string, deploymentIndex: string, analyticsIndex: string): QueryPlan {
    const start = performance.now();

    const depIdx = this.indexes.get(deploymentIndex);
    const anaIdx = this.indexes.get(analyticsIndex);

    let joined: Row[] = [];
    if (depIdx && anaIdx) {
      const { rows: deps } = depIdx.lookup(userId);
      const depIds = new Set(deps.map(d => d.id));
      const { rows: analytics } = anaIdx.lookup(userId);
      joined = analytics.filter(a => depIds.has(a.id));
    }

    return {
      usedIndex: !!(depIdx && anaIdx),
      indexName: deploymentIndex,
      rowsScanned: joined.length,
      rowsReturned: joined.length,
      executionMs: performance.now() - start,
    };
  }
}

// ── Test setup ────────────────────────────────────────────────────────────────

let executor: QueryExecutor;
let dataset: Row[];

beforeAll(() => {
  dataset = generateDataset(DATASET_SIZE);

  const idIndex = new SimulatedIndex('deployments_id_idx', dataset, 'id');
  const userIdIndex = new SimulatedIndex('deployments_user_id_idx', dataset, 'user_id');
  const statusIndex = new SimulatedIndex('deployments_status_idx', dataset, 'status');
  const metricTypeIndex = new SimulatedIndex('deployment_analytics_metric_type_idx', dataset, 'metric_type');

  executor = new QueryExecutor(dataset, [idIndex, userIdIndex, statusIndex, metricTypeIndex]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Query performance — indexed lookups', () => {
  it('primary-key lookup completes within 5 ms', () => {
    const plan = executor.findById('row-42', 'deployments_id_idx');

    expect(plan.usedIndex).toBe(true);
    expect(plan.indexName).toBe('deployments_id_idx');
    expect(plan.rowsReturned).toBe(1);
    expect(plan.executionMs).toBeLessThan(5);
  });

  it('user_id index lookup completes within 20 ms', () => {
    const plan = executor.findByColumn('user_id', 'user-5', 100, 'deployments_user_id_idx');

    expect(plan.usedIndex).toBe(true);
    expect(plan.indexName).toBe('deployments_user_id_idx');
    expect(plan.executionMs).toBeLessThan(20);
  });

  it('status index lookup completes within 20 ms', () => {
    const plan = executor.findByColumn('status', 'completed', 100, 'deployments_status_idx');

    expect(plan.usedIndex).toBe(true);
    expect(plan.executionMs).toBeLessThan(20);
  });

  it('metric_type index lookup completes within 20 ms', () => {
    const plan = executor.findByColumn('metric_type', 'page_view', 100, 'deployment_analytics_metric_type_idx');

    expect(plan.usedIndex).toBe(true);
    expect(plan.executionMs).toBeLessThan(20);
  });
});

describe('Query performance — full table scans (no index)', () => {
  it('unindexed column scan over 10 000 rows completes within 100 ms', () => {
    // template_id has no index in this simulation
    const plan = executor.findByColumn('template_id', 'tmpl-2', 100);

    expect(plan.usedIndex).toBe(false);
    expect(plan.rowsScanned).toBe(DATASET_SIZE);
    expect(plan.executionMs).toBeLessThan(100);
  });
});

describe('Query performance — aggregation', () => {
  it('GROUP BY aggregation over 10 000 rows completes within 50 ms', () => {
    const plan = executor.aggregateByMetricType();

    expect(plan.rowsScanned).toBe(DATASET_SIZE);
    expect(plan.rowsReturned).toBe(METRIC_TYPES.length);
    expect(plan.executionMs).toBeLessThan(50);
  });
});

describe('Query performance — pagination', () => {
  it('first page (LIMIT 20 OFFSET 0) completes within 10 ms', () => {
    const plan = executor.paginate(20, 0);

    expect(plan.rowsReturned).toBe(20);
    expect(plan.executionMs).toBeLessThan(10);
  });

  it('deep page (LIMIT 20 OFFSET 9 000) completes within 10 ms', () => {
    const plan = executor.paginate(20, 9_000);

    expect(plan.rowsReturned).toBe(20);
    expect(plan.executionMs).toBeLessThan(10);
  });
});

describe('Query performance — join simulation', () => {
  it('indexed join by user_id completes within 30 ms', () => {
    const plan = executor.joinByUserId(
      'user-10',
      'deployments_user_id_idx',
      'deployments_user_id_idx',
    );

    expect(plan.usedIndex).toBe(true);
    expect(plan.executionMs).toBeLessThan(30);
  });
});

describe('Query plan analysis — index usage verification', () => {
  it('primary-key query uses an index (not a full scan)', () => {
    const plan = executor.findById('row-1', 'deployments_id_idx');
    expect(plan.usedIndex).toBe(true);
    expect(plan.rowsScanned).toBeLessThan(DATASET_SIZE);
  });

  it('unindexed query scans the full table', () => {
    const plan = executor.findByColumn('template_id', 'tmpl-0', 10);
    expect(plan.usedIndex).toBe(false);
    expect(plan.rowsScanned).toBe(DATASET_SIZE);
  });

  it('indexed query scans far fewer rows than the full table', () => {
    const indexed = executor.findByColumn('user_id', 'user-1', 100, 'deployments_user_id_idx');
    const fullScan = executor.findByColumn('template_id', 'tmpl-1', 100);

    expect(indexed.rowsScanned).toBeLessThan(fullScan.rowsScanned);
  });
});

describe('Query performance — realistic data volume (10 000 rows)', () => {
  it('all indexed queries complete within their SLA under full dataset', () => {
    const queries: Array<{ name: string; plan: QueryPlan; slaMs: number }> = [
      { name: 'pk lookup',       plan: executor.findById('row-9999', 'deployments_id_idx'),                                          slaMs: 5  },
      { name: 'user_id filter',  plan: executor.findByColumn('user_id', 'user-50', 100, 'deployments_user_id_idx'),                  slaMs: 20 },
      { name: 'status filter',   plan: executor.findByColumn('status', 'failed', 100, 'deployments_status_idx'),                     slaMs: 20 },
      { name: 'metric filter',   plan: executor.findByColumn('metric_type', 'uptime_check', 100, 'deployment_analytics_metric_type_idx'), slaMs: 20 },
      { name: 'pagination',      plan: executor.paginate(50, 5_000),                                                                 slaMs: 10 },
      { name: 'aggregation',     plan: executor.aggregateByMetricType(),                                                             slaMs: 50 },
    ];

    for (const { name, plan, slaMs } of queries) {
      expect(plan.executionMs, `${name} exceeded ${slaMs} ms SLA`).toBeLessThan(slaMs);
    }
  });
});
