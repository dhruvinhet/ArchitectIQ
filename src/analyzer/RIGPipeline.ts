import * as fs from 'fs';
import * as crypto from 'crypto';
import { GraphStore, RIGData } from './GraphStore';
import { FileGraph } from './WorkspaceScanner';
import { DetectedStack } from './LanguageDetector';
import { SourceExtractor } from './extractors/SourceExtractor';
import { TestExtractor } from './extractors/TestExtractor';
import { ApiRouteExtractor } from './extractors/ApiRouteExtractor';

/**
 * RIGPipeline: orchestrates all extractors and produces RIGData.
 */
export class RIGPipeline {
  async build(
    fileGraph: FileGraph,
    stack: DetectedStack,
    workspaceRoot: string
  ): Promise<RIGData> {
    const store = new GraphStore();
    const fileHash = this._computeFileHash(fileGraph);

    const sourceExtractor = new SourceExtractor();
    sourceExtractor.run(store, fileGraph, workspaceRoot);

    const testExtractor = new TestExtractor();
    testExtractor.run(store, fileGraph);

    const apiExtractor = new ApiRouteExtractor();
    apiExtractor.run(store, fileGraph);

    const allFilePaths = new Set(fileGraph.keys());
    sourceExtractor.resolvePythonImports(store, allFilePaths);

    return store.toDict(workspaceRoot, stack.summary, fileHash);
  }

  private _computeFileHash(fileGraph: FileGraph): string {
    const entries = [...fileGraph.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([filePath, info]) => {
        const contentSig = info.contentFull.slice(0, 200).replace(/\s+/g, '');
        return `${filePath}:${info.contentFull.length}:${contentSig}`;
      });
    const payload = entries.join('|');
    return crypto.createHash('sha1').update(payload).digest('hex').slice(0, 16);
  }

  isCacheValid(rigJsonPath: string, fileGraph: FileGraph): boolean {
    if (!fs.existsSync(rigJsonPath)) return false;
    try {
      const existing = JSON.parse(fs.readFileSync(rigJsonPath, 'utf-8')) as RIGData;
      const currentHash = this._computeFileHash(fileGraph);
      return existing.metadata?.file_hash === currentHash;
    } catch {
      return false;
    }
  }
}
