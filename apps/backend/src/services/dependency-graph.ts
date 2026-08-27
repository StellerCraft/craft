/**
 * Deployment Dependency Graph
 *
 * Provides logic for building and validating directed acyclic graphs (DAGs)
 * representing deployment dependencies. Supports topological ordering
 * and circular dependency detection.
 */

export interface DeploymentNode {
  id: string;
  /** IDs of deployments that must complete before this one starts. */
  dependsOn: string[];
}

export class CircularDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' → ')}`);
    this.name = 'CircularDependencyError';
  }
}

export class DependencyGraph {
  private nodes = new Map<string, Set<string>>();
  private dependents = new Map<string, Set<string>>();

  /** Add a node (idempotent). */
  addNode(id: string): void {
    if (!this.nodes.has(id)) this.nodes.set(id, new Set());
    if (!this.dependents.has(id)) this.dependents.set(id, new Set());
  }

  /** Add a directed edge: `from` depends on `to`. */
  addEdge(from: string, to: string): void {
    this.addNode(from);
    this.addNode(to);
    if (this.nodes.get(from)!.add(to)) {
      this.dependents.get(to)!.add(from);
    }
  }

  /** Remove a directed edge. */
  removeEdge(from: string, to: string): void {
    if (this.nodes.get(from)?.delete(to)) {
      this.dependents.get(to)?.delete(from);
    }
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
      // Reduce in-degree only for nodes that list `node` as a dependency.
      for (const id of this.dependents.get(node) ?? []) {
        const newDeg = (inDegree.get(id) ?? 0) - 1;
        inDegree.set(id, newDeg);
        if (newDeg === 0) {
          queue.push(id);
          queue.sort();
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

  /**
   * Groups nodes into execution levels. Nodes within a level have no
   * dependencies on each other and may run concurrently. Throws
   * CircularDependencyError if a cycle is detected.
   */
  executionLevels(): string[][] {
    const inDegree = new Map<string, number>();
    for (const [id, deps] of this.nodes) {
      inDegree.set(id, deps.size);
    }

    const levels: string[][] = [];
    const processed = new Set<string>();

    while (processed.size < this.nodes.size) {
      const ready = [...inDegree.entries()]
        .filter(([id, degree]) => degree === 0 && !processed.has(id))
        .map(([id]) => id)
        .sort();

      if (ready.length === 0) {
        throw new CircularDependencyError(this._findCycle());
      }

      levels.push(ready);

      for (const node of ready) {
        processed.add(node);
        for (const id of this.dependents.get(node) ?? []) {
          if (!processed.has(id)) {
            inDegree.set(id, (inDegree.get(id) ?? 0) - 1);
          }
        }
      }
    }

    return levels;
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

export interface AsyncExecutionResult<TResult> {
  /** Results keyed by node id. */
  results: Map<string, TResult>;
  /** Stage IDs grouped by parallel execution level. */
  levels: string[][];
}

/**
 * Executes async stage handlers in dependency order, running each level's
 * nodes concurrently. Cycle detection runs at graph construction time via
 * {@link DependencyGraph.executionLevels}.
 *
 * Each executor receives only its node id — callers must close over immutable
 * context so concurrent stages do not share mutable state.
 */
export async function executeAsync<TResult>(
  graph: DependencyGraph,
  executors: ReadonlyMap<string, () => Promise<TResult>>,
): Promise<AsyncExecutionResult<TResult>> {
  for (const id of graph.nodeIds()) {
    if (!executors.has(id)) {
      throw new Error(`Missing executor for pipeline stage "${id}"`);
    }
  }

  const levels = graph.executionLevels();
  const results = new Map<string, TResult>();

  for (const level of levels) {
    const levelResults = await Promise.all(
      level.map(async (id) => {
        const value = await executors.get(id)!();
        return [id, value] as const;
      }),
    );
    for (const [id, value] of levelResults) {
      results.set(id, value);
    }
  }

  return { results, levels };
}

/** Factory helper to build a graph from a list of nodes. Throws if a node is missing. */
export function buildGraph(nodes: DeploymentNode[]): DependencyGraph {
  const g = new DependencyGraph();
  const nodeIds = new Set(nodes.map((n) => n.id));

  for (const { id } of nodes) g.addNode(id);
  for (const { id, dependsOn } of nodes) {
    for (const dep of dependsOn) {
      if (!nodeIds.has(dep)) {
        throw new Error(`Dependency graph error: node "${id}" depends on missing node "${dep}"`);
      }
      g.addEdge(id, dep);
    }
  }
  return g;
}
