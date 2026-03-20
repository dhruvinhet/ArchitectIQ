import * as fs from 'fs/promises';
import * as path from 'path';
import { FileGraph, FileInfo } from './WorkspaceScanner';
import { DependencyMapper, DependencyMap } from './DependencyMapper';
import { DetectedStack } from './LanguageDetector';

export interface RIGNode {
  kind: 'module' | 'class' | 'function' | 'component' | 'schema' | 'test';
  name: string;
  properties: {
    role: 'component' | 'service' | 'model' | 'api-route' | 'hook' | 'store' | 'test' | 'util' | 'config';
    language: 'typescript' | 'javascript' | 'python' | 'css';
    exports: string[];
    classes: string[];
    functions: string[];
    isEntry: boolean;
  };
  id: string;
}

export interface RIGEdge {
  source: string;
  target: string;
  relation: 'imports' | 'tested_by' | 'depends_on' | 'calls';
  properties: {
    confidence: 'high' | 'medium' | 'low';
  };
}

export interface RIGData {
  nodes: RIGNode[];
  edges: RIGEdge[];
  metadata: {
    generated_at: string;
    workspace_root: string;
    node_count: number;
    edge_count: number;
    stack: string;
  };
}

export class GraphBuilder {
  private _lastDepMap: DependencyMap | null = null;

  public generateId(relativePath: string): string {
    let h = 0;
    for (let i = 0; i < relativePath.length; i++) {
      h = (h * 31 + relativePath.charCodeAt(i)) & 0xFFFFFFFF;
    }
    return `module:${(h >>> 0).toString(16).padStart(16, '0').slice(0, 16)}`;
  }

  public async build(graph: FileGraph, stack: DetectedStack, workspaceRoot: string): Promise<RIGData> {
    const depMap = DependencyMapper.build(graph);
    this._lastDepMap = depMap;

    const idByPath = new Map<string, string>();
    const nodes: RIGNode[] = [];

    for (const [relativePath, info] of graph) {
      const id = this.generateId(relativePath);
      idByPath.set(relativePath, id);

      nodes.push({
        kind: this._mapKind(info),
        name: relativePath,
        properties: {
          role: this._mapRole(info.role),
          language: this._mapLanguage(info.language),
          exports: info.exports,
          classes: info.classes,
          functions: info.functions,
          isEntry: this._isEntryFile(relativePath, info),
        },
        id,
      });
    }

    const edges: RIGEdge[] = [];

    for (const [sourcePath, deps] of depMap.dependencies.entries()) {
      const sourceId = idByPath.get(sourcePath);
      if (!sourceId) continue;

      for (const depPath of deps) {
        const targetId = idByPath.get(depPath);
        if (!targetId) continue;
        edges.push({
          source: sourceId,
          target: targetId,
          relation: 'imports',
          properties: { confidence: 'high' },
        });
      }
    }

    for (const [relativePath, info] of graph) {
      if (!info.hasTest || !info.testFilePath) continue;
      const sourceId = idByPath.get(relativePath);
      const targetId = idByPath.get(info.testFilePath);
      if (!sourceId || !targetId) continue;
      edges.push({
        source: sourceId,
        target: targetId,
        relation: 'tested_by',
        properties: { confidence: 'high' },
      });
    }

    return {
      nodes,
      edges,
      metadata: {
        generated_at: new Date().toISOString(),
        workspace_root: workspaceRoot,
        node_count: nodes.length,
        edge_count: edges.length,
        stack: stack.summary,
      },
    };
  }

  public async saveToWorkspace(rigData: RIGData, workspaceRoot: string): Promise<void> {
    const outDir = path.join(workspaceRoot, '.architectiq');
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, 'rig.json'), JSON.stringify(rigData, null, 2), 'utf8');
    await fs.writeFile(path.join(outDir, 'rig-view.html'), this.generateViewer(rigData), 'utf8');
    const depMap = this._lastDepMap ?? { dependencies: new Map(), dependents: new Map(), clusters: [] };
    await fs.writeFile(path.join(outDir, 'summary.md'), this.generateSummary(rigData, depMap), 'utf8');
  }

  public generateViewer(rigData: RIGData): string {
    const dataJson = JSON.stringify(rigData);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ArchitectIQ RIG Viewer</title>
  <script src="https://unpkg.com/vis-network@9.1.9/dist/vis-network.min.js"></script>
  <style>
    :root {
      --bg: #11111b;
      --panel: #181825;
      --muted: #a6adc8;
      --text: #cdd6f4;
      --border: #313244;
      --accent: #89b4fa;
    }
    body { margin: 0; font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); }
    .layout { display: grid; grid-template-columns: 320px 1fr; height: 100vh; }
    .side { border-right: 1px solid var(--border); background: var(--panel); padding: 12px; overflow: auto; }
    .main { display: flex; flex-direction: column; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px; border-bottom: 1px solid var(--border); background: var(--panel); }
    .badge { font-size: 12px; background: #1e1e2e; border: 1px solid var(--border); padding: 4px 8px; border-radius: 999px; }
    #network { flex: 1; }
    input { width: 100%; box-sizing: border-box; margin-bottom: 10px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: #1e1e2e; color: var(--text); }
    .filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .filters button { background: #1e1e2e; border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 12px; }
    .filters button.active { border-color: var(--accent); color: var(--accent); }
    .info { font-size: 12px; line-height: 1.5; color: var(--muted); white-space: pre-wrap; }
    h2 { margin: 0 0 10px; font-size: 14px; }
    h3 { margin: 14px 0 8px; font-size: 13px; }
    .help { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 10px; font-size: 12px; color: var(--muted); }
  </style>
</head>
<body>
  <div class="layout">
    <div class="side">
      <h2>Repository Intelligence Graph</h2>
      <input id="search" placeholder="Search files..." />
      <div class="filters" id="filters"></div>
      <h3>Selected Node</h3>
      <div class="info" id="info">Click a node to inspect details.</div>
      <div class="help">
        <strong>How was this generated?</strong><br/>
        This graph was built by ArchitectIQ by scanning files, resolving import relationships, and adding test associations.
      </div>
    </div>
    <div class="main">
      <div class="toolbar">
        <span class="badge">Nodes: ${rigData.metadata.node_count}</span>
        <span class="badge">Edges: ${rigData.metadata.edge_count}</span>
        <span class="badge">Stack: ${this._escapeHtml(rigData.metadata.stack)}</span>
      </div>
      <div id="network"></div>
    </div>
  </div>

  <script>
    const rigData = ${dataJson};
    const roleColors = {
      component: '#89b4fa',
      service: '#a6e3a1',
      model: '#fab387',
      'api-route': '#f38ba8',
      hook: '#cba6f7',
      store: '#f9e2af',
      test: '#6c7086',
      util: '#74c7ec',
      config: '#585b70',
      schema: '#fab387'
    };

    const importsByNode = new Map();
    const dependentsByNode = new Map();
    rigData.edges.forEach((e) => {
      importsByNode.set(e.source, (importsByNode.get(e.source) || 0) + 1);
      dependentsByNode.set(e.target, (dependentsByNode.get(e.target) || 0) + 1);
    });

    const roleSet = new Set(rigData.nodes.map(n => n.properties.role));
    const filtersEl = document.getElementById('filters');
    const activeRoles = new Set(roleSet);

    Array.from(roleSet).sort().forEach((role) => {
      const btn = document.createElement('button');
      btn.textContent = role;
      btn.className = 'active';
      btn.onclick = () => {
        if (activeRoles.has(role)) {
          activeRoles.delete(role);
          btn.classList.remove('active');
        } else {
          activeRoles.add(role);
          btn.classList.add('active');
        }
        applyFilters();
      };
      filtersEl.appendChild(btn);
    });

    function fileLabel(name) {
      const parts = name.split('/');
      return parts[parts.length - 1] || name;
    }

    const nodes = new vis.DataSet(rigData.nodes.map((n) => ({
      id: n.id,
      label: fileLabel(n.name),
      title: n.name,
      color: roleColors[n.properties.role] || '#89b4fa',
      font: { color: '#11111b' },
      shape: 'dot',
      size: 14,
      role: n.properties.role,
      data: n,
      hidden: false,
    })));

    const edges = new vis.DataSet(rigData.edges.map((e, idx) => ({
      id: idx + ':' + e.source + '->' + e.target,
      from: e.source,
      to: e.target,
      arrows: 'to',
      color: { color: '#6c7086' },
      width: e.relation === 'tested_by' ? 1 : 2,
      dashes: e.relation === 'tested_by',
      relation: e.relation,
      hidden: false,
    })));

    const network = new vis.Network(document.getElementById('network'), { nodes, edges }, {
      physics: { stabilization: false, barnesHut: { springLength: 140 } },
      interaction: { hover: true },
      nodes: { borderWidth: 0 },
      edges: { smooth: { type: 'dynamic' } },
    });

    function applyFilters() {
      const searchValue = (document.getElementById('search').value || '').toLowerCase();
      const visibleNodeIds = new Set();

      nodes.forEach((n) => {
        const textOk = !searchValue || n.data.name.toLowerCase().includes(searchValue) || n.label.toLowerCase().includes(searchValue);
        const roleOk = activeRoles.has(n.role);
        const visible = textOk && roleOk;
        nodes.update({ id: n.id, hidden: !visible });
        if (visible) visibleNodeIds.add(n.id);
      });

      edges.forEach((e) => {
        const visible = visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to);
        edges.update({ id: e.id, hidden: !visible });
      });
    }

    document.getElementById('search').addEventListener('input', applyFilters);

    network.on('click', (params) => {
      const info = document.getElementById('info');
      if (!params.nodes.length) {
        info.textContent = 'Click a node to inspect details.';
        return;
      }
      const node = nodes.get(params.nodes[0]);
      const n = node.data;
      const importsCount = importsByNode.get(n.id) || 0;
      const dependentsCount = dependentsByNode.get(n.id) || 0;
      info.textContent = [
        'Path: ' + n.name,
        'Role: ' + n.properties.role,
        'Exports: ' + (n.properties.exports.length ? n.properties.exports.join(', ') : 'none'),
        'Imports count: ' + importsCount,
        'Dependents count: ' + dependentsCount
      ].join('\n');
    });

    applyFilters();
  </script>
</body>
</html>`;
  }

  public generateSummary(rigData: RIGData, depMap: DependencyMap): string {
    const lines: string[] = [];
    lines.push('# ArchitectIQ Graph Summary');
    lines.push('');
    lines.push(`- Total files: ${rigData.metadata.node_count}`);
    lines.push(`- Stack: ${rigData.metadata.stack}`);
    lines.push(`- Last generated timestamp: ${rigData.metadata.generated_at}`);
    lines.push('');

    lines.push('## Top 10 Most Imported Files');
    const central = rigData.nodes
      .map((n) => ({ path: n.name, count: depMap.dependents.get(n.name)?.length ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    if (central.length === 0) {
      lines.push('- None');
    } else {
      central.forEach((item) => lines.push(`- ${item.path} (${item.count} dependents)`));
    }
    lines.push('');

    lines.push('## Files With No Tests');
    const noTests = rigData.nodes
      .filter((n) => n.properties.role !== 'test' && n.properties.role !== 'config' && !this._isTestCovered(n.name, rigData))
      .map((n) => n.name)
      .slice(0, 200);

    if (noTests.length === 0) {
      lines.push('- None');
    } else {
      noTests.forEach((p) => lines.push(`- ${p}`));
    }
    lines.push('');

    lines.push('## Detected Entry Points');
    const entries = rigData.nodes.filter((n) => n.properties.isEntry).map((n) => n.name);
    if (entries.length === 0) {
      lines.push('- None');
    } else {
      entries.forEach((p) => lines.push(`- ${p}`));
    }
    lines.push('');

    return lines.join('\n');
  }

  private _mapKind(info: FileInfo): RIGNode['kind'] {
    if (info.role === 'test') return 'test';
    if (info.role === 'component') return 'component';
    if (info.role === 'schema') return 'schema';
    if (info.classes.length > 0) return 'class';
    if (info.functions.length > 0) return 'function';
    return 'module';
  }

  private _mapRole(role: FileInfo['role']): RIGNode['properties']['role'] {
    if (role === 'component' || role === 'service' || role === 'model' || role === 'api-route' || role === 'hook' || role === 'store' || role === 'test' || role === 'util' || role === 'config') {
      return role;
    }
    if (role === 'schema' || role === 'migration' || role === 'type' || role === 'serializer' || role === 'view' || role === 'controller' || role === 'middleware') {
      return 'service';
    }
    return 'util';
  }

  private _mapLanguage(language: FileInfo['language']): RIGNode['properties']['language'] {
    if (language === 'typescript' || language === 'tsx') return 'typescript';
    if (language === 'javascript' || language === 'jsx' || language === 'json') return 'javascript';
    if (language === 'python') return 'python';
    return 'css';
  }

  private _isEntryFile(relativePath: string, info: FileInfo): boolean {
    const p = relativePath.toLowerCase();
    return info.role === 'api-route' || info.role === 'page' || p === 'src/main.ts' || p === 'src/index.ts' || p === 'app.py' || p === 'main.py';
  }

  private _isTestCovered(filePath: string, rigData: RIGData): boolean {
    const sourceNode = rigData.nodes.find((n) => n.name === filePath);
    if (!sourceNode) return false;
    return rigData.edges.some((e) => e.source === sourceNode.id && e.relation === 'tested_by');
  }

  private _escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
