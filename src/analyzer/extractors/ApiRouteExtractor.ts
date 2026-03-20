import { GraphStore } from '../GraphStore';
import { FileGraph } from '../WorkspaceScanner';

/**
 * Extractor 3: API route wiring (cross-stack bridge)
 * Finds frontend API calls (fetch/axios) and matches them to backend route definitions.
 */
export class ApiRouteExtractor {
  run(store: GraphStore, fileGraph: FileGraph): void {
    const backendRoutes: Array<{ pattern: string; path: string; id: string }> = [];

    for (const [filePath, info] of fileGraph) {
      if (info.language !== 'python') continue;

      const patterns = this._extractPythonRoutes(info.contentPreview);
      for (const pattern of patterns) {
        const id = GraphStore.makeId('module', filePath);
        if (store.hasNode(id)) {
          backendRoutes.push({ pattern, path: filePath, id });
        }
      }
    }

    for (const [filePath, info] of fileGraph) {
      if (info.language === 'python') continue;

      const apiCalls = this._extractApiCalls(info.contentPreview);
      if (apiCalls.length === 0) continue;

      const sourceId = GraphStore.makeId(
        info.role === 'component' ? 'component' : 'module',
        filePath
      );
      if (!store.hasNode(sourceId)) continue;

      for (const call of apiCalls) {
        for (const route of backendRoutes) {
          if (this._pathsOverlap(call, route.pattern)) {
            store.addEdge({
              source: sourceId,
              target: route.id,
              relation: 'depends_on',
              properties: { confidence: 'medium', evidence_type: 'api-call' },
              evidence: [filePath],
            });
          }
        }
      }
    }
  }

  private _extractApiCalls(content: string): string[] {
    const results: string[] = [];
    let m: RegExpExecArray | null;
    const re1 = /(?:fetch|axios\.[a-z]+|api\.[a-z]+|http\.[a-z]+)\s*\(\s*['"`]([^'"`\s]+)['"`]/g;
    while ((m = re1.exec(content)) !== null) results.push(m[1].toLowerCase());
    const re2 = /['"`](\/(?:api|v\d+)\/[a-zA-Z0-9\-_\/]+)['"`]/g;
    while ((m = re2.exec(content)) !== null) results.push(m[1].toLowerCase());
    return [...new Set(results)];
  }

  private _extractPythonRoutes(content: string): string[] {
    const results: string[] = [];
    let m: RegExpExecArray | null;
    const re = /@(?:router|app)\.(?:get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    while ((m = re.exec(content)) !== null) results.push(m[1].toLowerCase());
    return results;
  }

  private _pathsOverlap(callPath: string, routePattern: string): boolean {
    const callSegs = callPath.split('/').filter((s) => s && s !== 'api' && !s.match(/^v\d+$/));
    const routeSegs = routePattern.replace(/\{[^}]+\}/g, '*').split('/').filter(Boolean);
    const overlap = routeSegs.filter((s) => s !== '*' && callSegs.includes(s));
    return overlap.length >= 1;
  }
}
