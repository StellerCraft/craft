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
