import { GraphStore, RIGNode } from '../GraphStore';
import { FileGraph } from '../WorkspaceScanner';

/**
 * Extractor 1: Source files (TypeScript, JavaScript, Python)
 * Reads the FileGraph already built by WorkspaceScanner and adds nodes + import edges.
 * Plugins do NOT write files. They only enrich the graph store.
 */
export class SourceExtractor {
  run(store: GraphStore, fileGraph: FileGraph, _workspaceRoot: string): void {
    for (const [relativePath, info] of fileGraph) {
      store.addNode({
        kind: this._kindFromRole(info.role),
        name: relativePath,
        properties: {
          role: info.role,
          language: info.language,
          exports: info.exports,
          classes: info.classes,
          functions: info.functions,
          isEntry: info.role === 'page' || info.role === 'api-route',
          path: relativePath,
          external: false,
          contentPreview: info.contentPreview,
        },
        evidence: [relativePath],
      });
    }

    for (const [relativePath, info] of fileGraph) {
      const sourceId = GraphStore.makeId(this._kindFromRole(info.role), relativePath);
      if (!store.hasNode(sourceId)) continue;

      for (const importPath of info.imports) {
        let resolved: string | null = null;

        if (importPath.startsWith('.')) {
          resolved = this._resolveImport(relativePath, importPath, fileGraph);
        } else if (info.language === 'python') {
          resolved = this._resolvePythonImport(relativePath, importPath, fileGraph);
        } else {
          continue;
        }

        if (!resolved) {
          if (info.language === 'python' && !importPath.includes('-')) {
            const externalId = GraphStore.makeId('module', importPath);
            store.addNode({
              id: externalId,
              kind: 'module',
              name: importPath,
              properties: {
                role: 'external',
                language: 'python',
                exports: [],
                classes: [],
                functions: [],
                isEntry: false,
                path: importPath,
                external: true,
              },
              evidence: [relativePath],
            });
            store.addEdge({
              source: sourceId,
              target: externalId,
              relation: 'imports',
              properties: { confidence: 'low', evidence_type: 'import-string' },
              evidence: [relativePath],
            });
          }
          continue;
        }

        const resolvedInfo = fileGraph.get(resolved);
        if (!resolvedInfo) continue;

        const targetId = GraphStore.makeId(this._kindFromRole(resolvedInfo.role), resolved);
        if (!store.hasNode(targetId)) continue;

        store.addEdge({
          source: sourceId,
          target: targetId,
          relation: 'imports',
          properties: { confidence: 'high', evidence_type: 'ast' },
          evidence: [relativePath],
        });
      }
    }
  }

  resolvePythonImports(store: GraphStore, allFilePaths: Set<string>): void {
    void allFilePaths;
    const pathToNodeId = new Map<string, string>();
    for (const [nodeId, nodeData] of store.nodeEntries()) {
      if (nodeData.kind === 'module' || nodeData.kind === 'schema' || nodeData.kind === 'component') {
        const p = typeof nodeData.properties?.path === 'string' ? String(nodeData.properties.path) : nodeData.name;
        if (p) pathToNodeId.set(p, nodeId);
      }
    }

    for (const [nodeId, nodeData] of store.nodeEntries()) {
      if (nodeData.kind !== 'module') continue;
      if (!nodeData.properties?.external) continue;

      const importName = nodeData.name;
      if (!importName || importName.includes('-')) continue;

      const importPath = importName.replace(/\./g, '/');
      const candidates = [
        importPath + '.py',
        importPath + '/__init__.py',
      ];

      let resolvedNodeId: string | null = null;
      for (const candidate of candidates) {
        for (const [realPath, realId] of pathToNodeId) {
          if (realPath.endsWith('/' + candidate) || realPath === candidate) {
            resolvedNodeId = realId;
            break;
          }
        }
        if (resolvedNodeId) break;
      }

      if (resolvedNodeId) {
        store.redirectEdgeTarget(nodeId, resolvedNodeId);
        nodeData.properties.resolvedTo = resolvedNodeId;
      }
    }
  }

  private _kindFromRole(role: string): RIGNode['kind'] {
    if (role === 'component' || role === 'page') return 'component';
    if (role === 'model' || role === 'schema') return 'schema';
    if (role === 'test') return 'test';
    return 'module';
  }

  private _resolveImport(fromPath: string, importPath: string, graph: FileGraph): string | null {
    const fromDir = fromPath.split('/').slice(0, -1).join('/');
    const segments = importPath.split('/');
    const parts = fromDir ? fromDir.split('/') : [];

    for (const seg of segments) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }

    const normalized = parts.join('/');
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', ''];
    const suffixes = ['', '/index.ts', '/index.tsx', '/index.js', '/index.py'];

    for (const ext of extensions) {
      for (const suffix of suffixes) {
        const candidate = normalized + ext + suffix;
        if (graph.has(candidate)) return candidate;
      }
    }
    return null;
  }

  private _resolvePythonImport(fromPath: string, importPath: string, graph: FileGraph): string | null {
    const cleanImport = importPath.trim();
    if (!cleanImport) return null;

    if (cleanImport.startsWith('.')) {
      return this._resolveImport(fromPath, cleanImport, graph);
    }

    const importAsPath = cleanImport.replace(/\./g, '/');
    const candidates = [
      `${importAsPath}.py`,
      `${importAsPath}/__init__.py`,
    ];

    for (const candidate of candidates) {
      for (const filePath of graph.keys()) {
        if (filePath === candidate || filePath.endsWith('/' + candidate)) {
          return filePath;
        }
      }
    }

    return null;
  }
}
