import { FileGraph } from './WorkspaceScanner';
import * as path from 'path';

export interface DependencyMap {
  dependencies: Map<string, string[]>;
  dependents: Map<string, string[]>;
  clusters: FileCluster[];
}

export interface FileCluster {
  name: string;
  files: string[];
  role: string;
}

export class DependencyMapper {
  public static build(graph: FileGraph): DependencyMap {
    const dependencies = new Map<string, string[]>();
    const dependents = new Map<string, string[]>();

    // Build alias map once by reading tsconfig/jsconfig from the project
    const aliases = this._buildAliasMap(graph);

    for (const relativePath of graph.keys()) {
      dependencies.set(relativePath, []);
      dependents.set(relativePath, []);
    }

    for (const [relativePath, info] of graph) {
      const resolvedDeps = this._resolveImports(relativePath, info.imports, graph, aliases);
      dependencies.set(relativePath, resolvedDeps);

      for (const dep of resolvedDeps) {
        const existing = dependents.get(dep) || [];
        existing.push(relativePath);
        dependents.set(dep, existing);
      }
    }

    const clusters = this._buildClusters(graph);
    return { dependencies, dependents, clusters };
  }

  /**
   * Reads tsconfig.json or jsconfig.json from the scanned project to extract
   * path alias mappings. Falls back to common defaults (@/ -> src, ~/ -> src).
   * This makes import resolution work on Next.js, Vite, Vue, CRA, and any
   * project using TypeScript path aliases.
   */
  private static _buildAliasMap(graph: FileGraph): Map<string, string> {
    const aliases = new Map<string, string>();

    for (const [filePath, info] of graph) {
      const base = filePath.split('/').pop() || '';
      if (base !== 'tsconfig.json' && base !== 'jsconfig.json') continue;

      try {
        // Strip single-line and multi-line comments before JSON.parse
        // tsconfig allows comments; JSON.parse does not
        const cleaned = info.contentFull
          .replace(/\/\/[^\n]*/g, '')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        const config = JSON.parse(cleaned);
        const compilerOptions = config.compilerOptions || {};
        const pathsConfig: Record<string, string[]> = compilerOptions.paths || {};
        const baseUrl: string = (compilerOptions.baseUrl || '.').replace(/^\.\//, '');

        // Extract the directory containing this tsconfig
        const tsconfigDir = filePath.includes('/')
          ? filePath.split('/').slice(0, -1).join('/')
          : '';

        for (const [alias, targets] of Object.entries(pathsConfig)) {
          if (!targets || targets.length === 0) continue;
          // "@/components/*" -> cleanAlias = "@/"  target = "src/components"
          const cleanAlias = alias.replace(/\/?\*$/, '');
          const rawTarget = targets[0].replace(/\/?\*$/, '').replace(/^\.\//, '');
          const resolvedTarget = tsconfigDir
            ? (tsconfigDir + '/' + rawTarget).replace(/\/\.\//g, '/').replace(/^\//, '')
            : rawTarget;
          aliases.set(cleanAlias, resolvedTarget.replace(/\/$/, ''));
        }

        // baseUrl lets you import "components/Button" without a prefix
        if (baseUrl && baseUrl !== '.') {
          const resolvedBase = tsconfigDir
            ? (tsconfigDir + '/' + baseUrl).replace(/^\//, '')
            : baseUrl;
          aliases.set('__baseUrl__', resolvedBase.replace(/\/$/, ''));
        }

        break; // Use the first tsconfig found
      } catch {
        // Ignore malformed tsconfig
      }
    }

    // Universal defaults - applied even when tsconfig is absent
    // @/ is standard in Vite + Next.js; ~/ is common in Vue/Nuxt
    if (!aliases.has('@') && !aliases.has('@/')) {
      aliases.set('@', 'src');
    }
    if (!aliases.has('~') && !aliases.has('~/')) {
      aliases.set('~', 'src');
    }

    return aliases;
  }

  private static _resolveImports(
    fromPath: string,
    imports: string[],
    graph: FileGraph,
    aliases: Map<string, string>
  ): string[] {
    const resolved: string[] = [];
    const fromDir = path.dirname(fromPath);

    for (const importPath of imports) {
      let basePath: string | null = null;

      if (importPath.startsWith('.')) {
        // Relative import - resolve against the importing file's directory
        basePath = path.normalize(path.join(fromDir, importPath)).replace(/\\/g, '/');
      } else {
        // Non-relative - try alias resolution
        basePath = this._resolveAlias(importPath, aliases);
      }

      if (!basePath) continue;

      // Try with common extensions and index file fallbacks
      const candidates = [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.jsx`,
        `${basePath}.py`,
        `${basePath}/index.ts`,
        `${basePath}/index.tsx`,
        `${basePath}/index.js`,
        `${basePath}/__init__.py`,
      ];

      for (const candidate of candidates) {
        const normalized = candidate.replace(/\\/g, '/').replace(/\/+/g, '/');
        if (graph.has(normalized)) {
          resolved.push(normalized);
          break;
        }
      }
    }

    return resolved;
  }

  /**
   * Converts a non-relative import string to a file path using the alias map.
   * Handles:
   *   @/components/Button     -> src/components/Button
   *   ~/hooks/useAuth         -> src/hooks/useAuth
   *   components/Button       -> src/components/Button  (when baseUrl is "src")
   *   app.pricing             -> app/pricing            (Python dotted imports)
   *   app.routes.bookings     -> app/routes/bookings    (Python)
   */
  private static _resolveAlias(
    importPath: string,
    aliases: Map<string, string>
  ): string | null {
    // Sort aliases by length descending so longer prefixes match first
    const sorted = [...aliases.entries()]
      .filter(([k]) => k !== '__baseUrl__')
      .sort((a, b) => b[0].length - a[0].length);

    for (const [alias, target] of sorted) {
      if (!alias) continue;
      const prefix = alias.endsWith('/') ? alias : alias + '/';

      if (importPath.startsWith(prefix)) {
        const rest = importPath.slice(prefix.length);
        return (target.replace(/\/$/, '') + '/' + rest).replace(/\/+/g, '/');
      }
      if (importPath === alias) {
        return target;
      }
    }

    // baseUrl resolution: "components/Button" in a project with baseUrl: "src"
    const baseUrl = aliases.get('__baseUrl__');
    if (
      baseUrl &&
      !importPath.includes(':') &&
      !importPath.startsWith('@') &&
      !importPath.startsWith('~') &&
      importPath.includes('/')
    ) {
      return (baseUrl + '/' + importPath).replace(/\/+/g, '/');
    }

    // Python dotted imports: "app.pricing" -> "app/pricing"
    // Must look like a module path: starts with letter, contains dots, no spaces
    if (/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(importPath)) {
      return importPath.replace(/\./g, '/');
    }

    return null;
  }

  private static _buildClusters(graph: FileGraph): FileCluster[] {
    const clusters = new Map<string, string[]>();
    for (const [relativePath, info] of graph) {
      const topDir = relativePath.split('/')[0];
      const key = `${topDir}/${info.role}`;
      const existing = clusters.get(key) || [];
      existing.push(relativePath);
      clusters.set(key, existing);
    }
    return [...clusters.entries()]
      .map(([key, files]) => {
        const [dir, role] = key.split('/');
        return { name: dir, files, role };
      })
      .filter((c) => c.files.length > 1);
  }
}
