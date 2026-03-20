import * as path from 'path';
import { execSync } from 'child_process';
import { FileGraph } from '../analyzer/WorkspaceScanner';

export class ChangeCouplingAnalyzer {
  private readonly trackedFiles: Set<string>;
  private readonly repositoryRoot: string;
  private readonly coChangeCounts = new Map<string, Map<string, number>>();
  private maxPairCount = 1;
  private initialized = false;

  constructor(graph: FileGraph) {
    this.trackedFiles = new Set<string>(graph.keys());
    this.repositoryRoot = this._inferRepositoryRoot(graph);
  }

  public getCoChangeScore(filePath: string, seedPaths: string[]): number {
    this._ensureInitialized();
    if (seedPaths.length === 0) return 0;

    const uniqueSeeds = [...new Set(seedPaths)].filter((s) => s !== filePath);
    if (uniqueSeeds.length === 0) return 0;

    const row = this.coChangeCounts.get(filePath);
    if (!row) return 0;

    let sum = 0;
    let count = 0;
    for (const seed of uniqueSeeds) {
      const pairCount = row.get(seed) || 0;
      const normalized = this.maxPairCount > 0 ? pairCount / this.maxPairCount : 0;
      sum += Math.max(0, Math.min(1, normalized));
      count++;
    }

    if (count === 0) return 0;
    return Math.max(0, Math.min(1, sum / count));
  }

  private _ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const out = execSync('git log --name-only --pretty=format:COMMIT', {
        cwd: this.repositoryRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      this._buildFromGitLog(out);
    } catch {
      // Keep empty coupling map when git history is unavailable.
      this.coChangeCounts.clear();
      this.maxPairCount = 1;
    }
  }

  private _buildFromGitLog(logText: string): void {
    const commits: string[][] = [];
    let current = new Set<string>();

    const lines = logText.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (line === 'COMMIT') {
        if (current.size > 0) commits.push([...current]);
        current = new Set<string>();
        continue;
      }

      const normalized = this._normalizePath(line);
      if (!normalized) continue;
      if (!this.trackedFiles.has(normalized)) continue;
      current.add(normalized);
    }

    if (current.size > 0) commits.push([...current]);

    for (const files of commits) {
      if (files.length < 2) continue;
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          this._incrementPair(files[i], files[j]);
          this._incrementPair(files[j], files[i]);
        }
      }
    }
  }

  private _incrementPair(a: string, b: string): void {
    if (!this.coChangeCounts.has(a)) this.coChangeCounts.set(a, new Map<string, number>());
    const row = this.coChangeCounts.get(a)!;
    const next = (row.get(b) || 0) + 1;
    row.set(b, next);
    if (next > this.maxPairCount) this.maxPairCount = next;
  }

  private _normalizePath(rawPath: string): string {
    const normalizedSlashes = rawPath.replace(/\\/g, '/');
    return normalizedSlashes.replace(/^\.\//, '');
  }

  private _inferRepositoryRoot(graph: FileGraph): string {
    for (const [relPath, info] of graph) {
      const relNative = relPath.split('/').join(path.sep);
      const abs = info.absolutePath;
      if (abs.toLowerCase().endsWith(relNative.toLowerCase())) {
        return abs.slice(0, abs.length - relNative.length).replace(/[\\/]+$/, '');
      }
    }
    return process.cwd();
  }
}
