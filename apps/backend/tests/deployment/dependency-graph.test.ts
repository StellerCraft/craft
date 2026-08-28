/**
 * Deployment Dependency Graph Tests
 *
 * Verifies that deployment dependency graphs are correctly calculated and
 * respected, covering:
 *   - Graph generation from deployment descriptors
 *   - Topological ordering (dependencies deploy before dependents)
 *   - Circular dependency detection
 *   - Dependency resolution (transitive closure)
 *   - Dependency updates (adding / removing edges)
 *
 * All logic is self-contained — no external services are required.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DependencyGraph,
  CircularDependencyError,
  buildGraph,
  executeAsync,
  type DeploymentNode,
} from '../../src/services/dependency-graph';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Dependency graph — generation', () => {
  it('creates a node for each deployment descriptor', () => {
    const g = buildGraph([
      { id: 'db', dependsOn: [] },
      { id: 'api', dependsOn: ['db'] },
      { id: 'web', dependsOn: ['api'] },
    ]);
    expect(g.nodeIds().sort()).toEqual(['api', 'db', 'web']);
  });

  it('records direct dependencies correctly', () => {
    const g = buildGraph([
      { id: 'db', dependsOn: [] },
      { id: 'api', dependsOn: ['db'] },
    ]);
    expect(g.dependenciesOf('api')).toEqual(['db']);
    expect(g.dependenciesOf('db')).toEqual([]);
  });

  it('supports multiple direct dependencies on a single node', () => {
    const g = buildGraph([
      { id: 'cache', dependsOn: [] },
      { id: 'db', dependsOn: [] },
      { id: 'api', dependsOn: ['db', 'cache'] },
    ]);
    expect(g.dependenciesOf('api').sort()).toEqual(['cache', 'db']);
  });

  it('handles an empty graph', () => {
    const g = buildGraph([]);
    expect(g.nodeIds()).toHaveLength(0);
    expect(g.topologicalOrder()).toEqual([]);
  });

  it('handles a single node with no dependencies', () => {
    const g = buildGraph([{ id: 'solo', dependsOn: [] }]);
    expect(g.topologicalOrder()).toEqual(['solo']);
  });
});

describe('Dependency graph — topological ordering', () => {
  it('places dependencies before dependents in a linear chain', () => {
    const g = buildGraph([
      { id: 'db', dependsOn: [] },
      { id: 'api', dependsOn: ['db'] },
      { id: 'web', dependsOn: ['api'] },
    ]);
    const order = g.topologicalOrder();
    expect(order.indexOf('db')).toBeLessThan(order.indexOf('api'));
    expect(order.indexOf('api')).toBeLessThan(order.indexOf('web'));
  });

  it('places shared dependency before all dependents (diamond graph)', () => {
    // shared ← left ← top
    //        ← right ← top
    const g = buildGraph([
      { id: 'shared', dependsOn: [] },
      { id: 'left', dependsOn: ['shared'] },
      { id: 'right', dependsOn: ['shared'] },
      { id: 'top', dependsOn: ['left', 'right'] },
    ]);
    const order = g.topologicalOrder();
    expect(order.indexOf('shared')).toBeLessThan(order.indexOf('left'));
    expect(order.indexOf('shared')).toBeLessThan(order.indexOf('right'));
    expect(order.indexOf('left')).toBeLessThan(order.indexOf('top'));
    expect(order.indexOf('right')).toBeLessThan(order.indexOf('top'));
  });

  it('returns all nodes exactly once', () => {
    const g = buildGraph([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['a'] },
      { id: 'd', dependsOn: ['b', 'c'] },
    ]);
    const order = g.topologicalOrder();
    expect(order).toHaveLength(4);
    expect(new Set(order).size).toBe(4);
  });

  it('produces a deterministic order for independent nodes', () => {
    const g = buildGraph([
      { id: 'z', dependsOn: [] },
      { id: 'a', dependsOn: [] },
      { id: 'm', dependsOn: [] },
    ]);
    expect(g.topologicalOrder()).toEqual(['a', 'm', 'z']);
  });

  it('preserves ordering for a large fan-out and fan-in graph', () => {
    const nodes: DeploymentNode[] = [{ id: 'root', dependsOn: [] }];
    for (let index = 0; index < 100; index++) {
      nodes.push({ id: `branch-${index}`, dependsOn: ['root'] });
    }
    nodes.push({
      id: 'release',
      dependsOn: nodes.filter((node) => node.id.startsWith('branch-')).map((node) => node.id),
    });

    const graph = buildGraph(nodes);
    const order = graph.topologicalOrder();
    const levels = graph.executionLevels();

    expect(order).toHaveLength(102);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toEqual(['root']);
    expect(levels[1]).toHaveLength(100);
    expect(levels[2]).toEqual(['release']);
  });
});

describe('Dependency graph — circular dependency detection', () => {
  it('detects a direct self-loop', () => {
    const g = new DependencyGraph();
    g.addNode('a');
    g.addEdge('a', 'a');
    expect(g.hasCycle()).toBe(true);
  });

  it('detects a two-node cycle (a → b → a)', () => {
    const g = buildGraph([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
    ]);
    expect(g.hasCycle()).toBe(true);
  });

  it('detects a three-node cycle', () => {
    const g = buildGraph([
      { id: 'a', dependsOn: ['c'] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
    ]);
    expect(g.hasCycle()).toBe(true);
  });

  it('throws CircularDependencyError with cycle info on topologicalOrder()', () => {
    const g = buildGraph([
      { id: 'x', dependsOn: ['y'] },
      { id: 'y', dependsOn: ['x'] },
    ]);
    expect(() => g.topologicalOrder()).toThrowError(CircularDependencyError);
  });

  it('cycle error message contains the involved node IDs', () => {
    const g = buildGraph([
      { id: 'x', dependsOn: ['y'] },
      { id: 'y', dependsOn: ['x'] },
    ]);
    try {
      g.topologicalOrder();
    } catch (e) {
      expect(e).toBeInstanceOf(CircularDependencyError);
      expect((e as CircularDependencyError).message).toMatch(/x/);
      expect((e as CircularDependencyError).message).toMatch(/y/);
    }
  });

  it('does NOT flag a valid DAG as cyclic', () => {
    const g = buildGraph([
      { id: 'db', dependsOn: [] },
      { id: 'api', dependsOn: ['db'] },
      { id: 'web', dependsOn: ['api', 'db'] },
    ]);
    expect(g.hasCycle()).toBe(false);
  });
});

describe('Dependency graph — resolution (transitive closure)', () => {
  it('resolves direct dependency only for depth-1 chain', () => {
    const g = buildGraph([
      { id: 'db', dependsOn: [] },
      { id: 'api', dependsOn: ['db'] },
    ]);
    expect(g.transitiveDependencies('api')).toEqual(new Set(['db']));
  });

  it('resolves transitive dependencies across a three-level chain', () => {
    const g = buildGraph([
      { id: 'db', dependsOn: [] },
      { id: 'api', dependsOn: ['db'] },
      { id: 'web', dependsOn: ['api'] },
    ]);
    expect(g.transitiveDependencies('web')).toEqual(new Set(['api', 'db']));
  });

  it('resolves shared transitive dependency in a diamond graph', () => {
    const g = buildGraph([
      { id: 'shared', dependsOn: [] },
      { id: 'left', dependsOn: ['shared'] },
      { id: 'right', dependsOn: ['shared'] },
      { id: 'top', dependsOn: ['left', 'right'] },
    ]);
    expect(g.transitiveDependencies('top')).toEqual(
      new Set(['left', 'right', 'shared'])
    );
  });

  it('returns empty set for a node with no dependencies', () => {
    const g = buildGraph([{ id: 'standalone', dependsOn: [] }]);
    expect(g.transitiveDependencies('standalone').size).toBe(0);
  });

  it('does not include the node itself in its own transitive set', () => {
    const g = buildGraph([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
    ]);
    expect(g.transitiveDependencies('b').has('b')).toBe(false);
  });
});

describe('Dependency graph — updates', () => {
  let g: DependencyGraph;

  beforeEach(() => {
    g = buildGraph([
      { id: 'db', dependsOn: [] },
      { id: 'api', dependsOn: ['db'] },
      { id: 'web', dependsOn: ['api'] },
    ]);
  });

  it('adding a new edge is reflected in dependenciesOf()', () => {
    g.addNode('cache');
    g.addEdge('api', 'cache');
    expect(g.dependenciesOf('api').sort()).toEqual(['cache', 'db']);
  });

  it('adding a new edge is reflected in topological order', () => {
    g.addNode('cache');
    g.addEdge('api', 'cache');
    const order = g.topologicalOrder();
    expect(order.indexOf('cache')).toBeLessThan(order.indexOf('api'));
  });

  it('removing an edge is reflected in dependenciesOf()', () => {
    g.removeEdge('api', 'db');
    expect(g.dependenciesOf('api')).toEqual([]);
  });

  it('removing the only cycle-forming edge resolves the cycle', () => {
    g.addEdge('db', 'web'); // introduces cycle: db → web → api → db
    expect(g.hasCycle()).toBe(true);
    g.removeEdge('db', 'web');
    expect(g.hasCycle()).toBe(false);
  });

  it('adding a new independent node does not affect existing order', () => {
    g.addNode('monitor');
    const order = g.topologicalOrder();
    expect(order.indexOf('db')).toBeLessThan(order.indexOf('api'));
    expect(order.indexOf('api')).toBeLessThan(order.indexOf('web'));
    expect(order).toContain('monitor');
  });

  it('adding an edge that creates a cycle is detected immediately', () => {
    g.addEdge('db', 'web'); // db now depends on web which depends on api which depends on db
    expect(g.hasCycle()).toBe(true);
  });
});

describe('Dependency graph — execution levels', () => {
  it('groups independent nodes into the same parallel level', () => {
    const g = buildGraph([
      { id: 'shared', dependsOn: [] },
      { id: 'left', dependsOn: ['shared'] },
      { id: 'right', dependsOn: ['shared'] },
      { id: 'top', dependsOn: ['left', 'right'] },
    ]);
    const levels = g.executionLevels();
    expect(levels[0]).toEqual(['shared']);
    expect(levels[1].sort()).toEqual(['left', 'right']);
    expect(levels[2]).toEqual(['top']);
  });

  it('throws CircularDependencyError with cycle path from executionLevels()', () => {
    const g = buildGraph([
      { id: 'x', dependsOn: ['y'] },
      { id: 'y', dependsOn: ['x'] },
    ]);
    expect(() => g.executionLevels()).toThrow(CircularDependencyError);
    try {
      g.executionLevels();
    } catch (e) {
      expect(e).toBeInstanceOf(CircularDependencyError);
      expect((e as CircularDependencyError).cycle.length).toBeGreaterThan(0);
      expect((e as CircularDependencyError).message).toMatch(/x.*y|y.*x/);
    }
  });
});

describe('Dependency graph — async parallel execution', () => {
  it('executes diamond dependencies in correct parallel batches', async () => {
    const g = buildGraph([
      { id: 'shared', dependsOn: [] },
      { id: 'left', dependsOn: ['shared'] },
      { id: 'right', dependsOn: ['shared'] },
      { id: 'top', dependsOn: ['left', 'right'] },
    ]);

    const order: string[] = [];
    const executors = new Map(
      ['shared', 'left', 'right', 'top'].map((id) => [
        id,
        async () => {
          order.push(id);
          return id;
        },
      ]),
    );

    const { levels, results } = await executeAsync(g, executors);
    expect(levels).toEqual([['shared'], ['left', 'right'], ['top']]);
    expect(results.get('top')).toBe('top');
    expect(order.indexOf('shared')).toBeLessThan(order.indexOf('left'));
    expect(order.indexOf('shared')).toBeLessThan(order.indexOf('right'));
    expect(order.indexOf('left')).toBeLessThan(order.indexOf('top'));
    expect(order.indexOf('right')).toBeLessThan(order.indexOf('top'));
  });

  it('runs nodes within a level concurrently', async () => {
    const g = buildGraph([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: [] },
      { id: 'c', dependsOn: ['a', 'b'] },
    ]);

    let aRunning = false;
    let bRunning = false;
    let overlapped = false;

    const executors = new Map([
      [
        'a',
        async () => {
          aRunning = true;
          await new Promise((r) => setTimeout(r, 30));
          overlapped = overlapped || bRunning;
          aRunning = false;
          return 'a';
        },
      ],
      [
        'b',
        async () => {
          bRunning = true;
          await new Promise((r) => setTimeout(r, 30));
          overlapped = overlapped || aRunning;
          bRunning = false;
          return 'b';
        },
      ],
      [
        'c',
        async () => 'c',
      ],
    ]);

    await executeAsync(g, executors);
    expect(overlapped).toBe(true);
  });

  it('throws CircularDependencyError before executing any stage when graph has a cycle', async () => {
    const g = buildGraph([
      { id: 'x', dependsOn: ['y'] },
      { id: 'y', dependsOn: ['x'] },
    ]);

    let executed = false;
    const executors = new Map([
      ['x', async () => { executed = true; return 'x'; }],
      ['y', async () => { executed = true; return 'y'; }],
    ]);

    await expect(executeAsync(g, executors)).rejects.toThrow(CircularDependencyError);
    expect(executed).toBe(false);
  });
});
