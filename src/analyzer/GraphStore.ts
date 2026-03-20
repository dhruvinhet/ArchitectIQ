import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface RIGNode {
  kind: 'module' | 'class' | 'function' | 'component' | 'schema' | 'test';
  name: string;
  properties: {
    role: string;
    language: string;
    exports: string[];
    classes: string[];
    functions: string[];
    isEntry: boolean;
    [key: string]: unknown;
  };
  evidence: string[];
  id: string;
}

export interface RIGEdge {
  source: string;
  target: string;
  relation: 'imports' | 'tested_by' | 'depends_on' | 'calls' | 'contains';
  properties: {
    confidence: 'high' | 'medium' | 'low';
    evidence_type?: string;
  };
  evidence: string[];
}

export interface RIGMetadata {
  generated_at: string;
  workspace_root: string;
  node_count: number;
  edge_count: number;
  stack: string;
  file_hash: string;
  confidence_counts: { high: number; medium: number; low: number };
}

export interface RIGData {
  nodes: RIGNode[];
  edges: RIGEdge[];
  metadata: RIGMetadata;
}

export class GraphStore {
  private nodes: Map<string, RIGNode> = new Map();
  private edges: RIGEdge[] = [];

  static makeId(kind: string, name: string): string {
    const hash = crypto.createHash('sha1').update(name).digest('hex');
    return `${kind}:${hash.slice(0, 16)}`;
  }

  addNode(node: Omit<RIGNode, 'id'> & { id?: string }): string {
    const id = node.id || GraphStore.makeId(node.kind, node.name);
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { ...node, id } as RIGNode);
    }
    return id;
  }

  addEdge(edge: RIGEdge): void {
    const exists = this.edges.some(
      (e) => e.source === edge.source && e.target === edge.target && e.relation === edge.relation
    );
    if (!exists) {
      this.edges.push(edge);
    }
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  getNode(id: string): RIGNode | undefined {
    return this.nodes.get(id);
  }

  nodeEntries(): IterableIterator<[string, RIGNode]> {
    return this.nodes.entries();
  }

  redirectEdgeTarget(oldTargetId: string, newTargetId: string): void {
    for (const edge of this.edges) {
      if (edge.target === oldTargetId) {
        edge.target = newTargetId;
      }
    }
  }

  toDict(workspaceRoot: string, stack: string, fileHash: string): RIGData {
    const nodeList = [...this.nodes.values()];
    const confidenceCounts = { high: 0, medium: 0, low: 0 };
    this.edges.forEach((e) => {
      const c = e.properties.confidence;
      if (c in confidenceCounts) confidenceCounts[c as keyof typeof confidenceCounts]++;
    });

    return {
      nodes: nodeList,
      edges: this.edges,
      metadata: {
        generated_at: new Date().toISOString(),
        workspace_root: workspaceRoot,
        node_count: nodeList.length,
        edge_count: this.edges.length,
        stack,
        file_hash: fileHash,
        confidence_counts: confidenceCounts,
      },
    };
  }

  writeJson(outputPath: string, workspaceRoot: string, stack: string, fileHash: string): void {
    const data = this.toDict(workspaceRoot, stack, fileHash);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
