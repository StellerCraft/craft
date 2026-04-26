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

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeploymentNode {
  id: string;
  /** IDs of deployments that must complete before this one starts. */
  dependsOn: string[];
}

// ── DependencyGraph ───────────────────────────────────────────────────────────

class CircularDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' → ')}`);
    this.name = 'CircularDependencyError';
  }
}

class DependencyGraph {
  private nodes = new Map<string, Set<string>>();

  /** Add a node (idempotent). */
  addNode(id: string): void {
    if (!this.nodes.has(id)) this.nodes.set(id, new Set());
  }

  /** Add a directed edge: `from` depends on `to`. */
  addEdge(from: string, to: string): void {
    this.addNode(from);
    this.addNode(to);
    this.nodes.get(from)!.add(to);
  }

  /** Remove a directed edge. */
  removeEdge(from: string, to: string): void {
    this.nodes.get(from)?.delete(to);
  }

  /** Direct dependencies of a node. */
  dependenciesOf(id: string): string[] {
    return Array.from(this.nodes.get(id) ?? []);
  }

  /** All node IDs in the graph. */
  nodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  /**
   * Transitive closure: all nodes that `id` depends on (directly or
   * indirectly), excluding `id` itself.
   */
  transitiveDependencies(id: string): Set<string> {
    const visited = new Set<string>();
    const stack = [...this.dependenciesOf(id)];
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      stack.push(...this.dependenciesOf(cur));
    }
    return visited;
  }

  /**
   * Kahn's algorithm — returns nodes in topological order (dependencies
   * first). Throws CircularDependencyError if a cycle is detected.
   *
   * Edge direction: addEdge(from, to) means `from` depends on `to`.
   * In-degree here counts the number of prerequisites a node has
   * (i.e., how many entries appear in its own dependsOn set).
   */
  topologicalOrder(): string[] {
    // in-degree = number of direct dependencies the node itself has
    const inDegree = new Map<string, number>();
    for (const [id, deps] of this.nodes) {
      inDegree.set(id, deps.size);
    }

    // Start with nodes that have no prerequisites
    const queue = [...inDegree.entries()]
      .filter(([, d]) => d === 0)
      .map(([id]) => id)
      .sort(); // deterministic

    const order: string[] = [];
    while (queue.length) {
      const node = queue.shift()!;
      order.push(node);
      // Reduce in-degree of every node that listed `node` as a dependency
      for (const [id, deps] of this.nodes) {
        if (deps.has(node)) {
          const newDeg = (inDegree.get(id) ?? 0) - 1;
          inDegree.set(id, newDeg);
          if (newDeg === 0) {
            queue.push(id);
            queue.sort();
          }
        }
      }
    }

    if (order.length !== this.nodes.size) {
      // Find one cycle for the error message via DFS
      const cycle = this._findCycle();
      throw new CircularDependencyError(cycle);
    }
    return order;
  }

  /** Returns true if the graph contains at least one cycle. */
  hasCycle(): boolean {
    try {
      this.topologicalOrder();
      return false;
    } catch (e) {
      return e instanceof CircularDependencyError;
    }
  }

  private _findCycle(): string[] {
    const color = new Map<string, 'white' | 'gray' | 'black'>();
    for (const id of this.nodes.keys()) color.set(id, 'white');
    const path: string[] = [];

    const dfs = (id: string): string[] | null => {
      color.set(id, 'gray');
      path.push(id);
      for (const dep of this.nodes.get(id) ?? []) {
        if (color.get(dep) === 'gray') {
          const cycleStart = path.indexOf(dep);
          return [...path.slice(cycleStart), dep];
        }
        if (color.get(dep) === 'white') {
          const result = dfs(dep);
          if (result) return result;
        }
      }
      path.pop();
      color.set(id, 'black');
      return null;
    };

    for (const id of this.nodes.keys()) {
      if (color.get(id) === 'white') {
        const cycle = dfs(id);
        if (cycle) return cycle;
      }
    }
    return [];
  }
}

// ── Factory helper ────────────────────────────────────────────────────────────

function buildGraph(nodes: DeploymentNode[]): DependencyGraph {
  const g = new DependencyGraph();
  for (const { id } of nodes) g.addNode(id);
  for (const { id, dependsOn } of nodes) {
    for (const dep of dependsOn) g.addEdge(id, dep);
  }
  return g;
}

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
