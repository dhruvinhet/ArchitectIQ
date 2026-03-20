import * as fs from 'fs';
import * as path from 'path';
import { TypeScriptParser } from './parsers/TypeScriptParser';
import { PythonParser } from './parsers/PythonParser';
import { StyleParser } from './parsers/StyleParser';

export interface FileInfo {
  /** Absolute path to the file */
  absolutePath: string;
  /** Path relative to workspace root */
  relativePath: string;
  /** Detected language */
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx' | 'python' | 'css' | 'json' | 'other';
  /** Imported module paths (as written in source, not resolved) */
  imports: string[];
  /** Names of exported symbols */
  exports: string[];
  /** Names of functions/methods defined */
  functions: string[];
  /** Names of classes defined */
  classes: string[];
  /** Whether this file has a corresponding test file */
  hasTest: boolean;
  /** Path of the test file, if found */
  testFilePath?: string;
  /** Special role inferred from path/content */
  role: FileRole;
  /** Raw file content used for scoring */
  contentFull: string;
  /** Raw file content (first 1500 chars) */
  contentPreview: string;
}

export type FileRole =
  | 'component'        // React component
  | 'page'             // Next.js page or app route
  | 'api-route'        // Next.js API route or Express route
  | 'controller'       // MVC controller
  | 'service'          // Business logic service
  | 'model'            // Data model
  | 'middleware'       // Express/Next middleware
  | 'hook'             // React hook (starts with "use")
  | 'util'             // Utility/helper
  | 'config'           // Configuration file
  | 'test'             // Test file
  | 'style'            // CSS/SCSS/module.css
  | 'type'             // TypeScript types/interfaces
  | 'context'          // React context
  | 'store'            // State management (zustand, redux, etc.)
  | 'schema'           // Database schema (Prisma, Mongoose, etc.)
  | 'migration'        // Database migration
  | 'view'             // Django/Flask view
  | 'serializer'       // DRF serializer
  | 'unknown';

export type FileGraph = Map<string, FileInfo>;

/** File extensions to scan */
const INCLUDED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.css', '.scss',
  '.module.css', '.module.scss', '.json',
]);

export class WorkspaceScanner {
  private static readonly ALWAYS_EXCLUDE = new Set([
    'node_modules', '.git', '.svn', '__pycache__', '.pytest_cache',
    'venv', '.venv', 'env', '.turbo', '.cache', '.architectiq',
    'coverage', '.nyc_output', '.next', '.nuxt',
    'dist', 'build', 'out',
  ]);

  private static readonly DEPTH_ZERO_EXCLUDE = new Set([
    'public', 'static', 'assets', 'media', 'uploads', 'tmp', 'temp',
  ]);

  private readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  public async scan(): Promise<FileGraph> {
    const graph: FileGraph = new Map();
    const files = this._getAllFiles(this.rootPath);

    for (const absolutePath of files) {
      try {
        const info = this._parseFile(absolutePath);
        if (info) {
          graph.set(info.relativePath, info);
        }
      } catch {
        // Skip files that can't be read
      }
    }

    // Second pass: resolve test file associations
    for (const [, info] of graph) {
      const testPath = this._findTestFile(info.relativePath, graph);
      if (testPath) {
        info.hasTest = true;
        info.testFilePath = testPath;
      }
    }

    return graph;
  }

  private _getAllFiles(dir: string, depth: number = 0): string[] {
    const results: string[] = [];
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        if (WorkspaceScanner.ALWAYS_EXCLUDE.has(entry.name)) continue;
        if (depth === 0 && WorkspaceScanner.DEPTH_ZERO_EXCLUDE.has(entry.name)) continue;
        results.push(...this._getAllFiles(path.join(dir, entry.name), depth + 1));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (INCLUDED_EXTENSIONS.has(ext)) {
          results.push(path.join(dir, entry.name));
        }
      }
    }

    return results;
  }

  private _parseFile(absolutePath: string): FileInfo | null {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const stat = fs.statSync(absolutePath);
    const contentFull = stat.size > 200 * 1024 ? content.slice(0, 100000) : content;
    const contentPreview = content.slice(0, 1500);
    const relativePath = path.relative(this.rootPath, absolutePath).replace(/\\/g, '/');
    const ext = path.extname(absolutePath).toLowerCase();

    let language: FileInfo['language'];
    let imports: string[] = [];
    let exports: string[] = [];
    let functions: string[] = [];
    let classes: string[] = [];

    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      language = ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : ext === '.ts' ? 'typescript' : 'javascript';
      const parsed = TypeScriptParser.parse(content);
      imports = parsed.imports;
      exports = parsed.exports;
      functions = parsed.functions;
      classes = parsed.classes;
    } else if (ext === '.py') {
      language = 'python';
      const parsed = PythonParser.parse(content);
      imports = parsed.imports;
      exports = parsed.exports;
      functions = parsed.functions;
      classes = parsed.classes;
    } else if (ext === '.css' || ext === '.scss' || ext === '.module.css' || ext === '.module.scss') {
      language = 'css';
      const parsed = StyleParser.parse(content, relativePath);
      exports = parsed.classNames;
    } else if (ext === '.json') {
      language = 'json';
    } else {
      language = 'other';
    }

    return {
      absolutePath,
      relativePath,
      language,
      imports,
      exports,
      functions,
      classes,
      role: this._inferRole(relativePath, contentFull, exports, functions, classes, language),
      contentFull,
      hasTest: false,
      contentPreview,
    };
  }

  private _inferRole(
    relativePath: string,
    content: string,
    exports: string[],
    functions: string[],
    classes: string[],
    language: FileInfo['language']
  ): FileRole {
    const lower = relativePath.toLowerCase();
    const fileName = lower.split('/').pop() || '';

    // STEP 1: Universal rules
    if (
      lower.includes('.test.') || lower.includes('.spec.') ||
      lower.includes('/__tests__/') || lower.includes('/tests/') ||
      fileName.startsWith('test_') || fileName.endsWith('_test.py')
    ) return 'test';

    if (
      lower.endsWith('.css') || lower.endsWith('.scss') ||
      lower.endsWith('.module.css') || lower.endsWith('.module.scss')
    ) return 'style';

    const CONFIG_NAMES = new Set([
      'package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js',
      'webpack.config.js', 'next.config.js', 'next.config.ts', 'jest.config.js', 'jest.config.ts',
      'tailwind.config.js', 'tailwind.config.ts', 'eslintrc', 'prettierrc', 'babel.config.js',
      'setup.cfg', 'pyproject.toml', 'setup.py', 'requirements.txt', 'pytest.ini', 'manage.py',
    ]);
    if (CONFIG_NAMES.has(fileName)) return 'config';

    // STEP 2: Python-specific roles
    if (language === 'python') {
      if (content.includes('BaseModel') && !content.includes('class Config')) return 'model';
      if (content.includes('declarative_base') || content.includes('Column(') || content.includes('db.Model')) return 'model';
      if (content.includes('Document(') || content.includes('mongoengine')) return 'model';
      if (content.includes('class') && content.includes('BaseModel') && content.includes('class Config')) return 'schema';

      if (content.includes('@router.') || content.includes('@app.') || lower.includes('/routes/') || lower.includes('/routers/')) return 'api-route';
      if (content.includes('def setUp') || content.includes('class Test') || content.includes('pytest') || content.includes('unittest')) return 'test';
      if (content.includes('Serializer') || lower.includes('serializer')) return 'serializer';
      if (lower.includes('/migrations/')) return 'migration';
      if (lower.includes('/middleware/') || content.includes('def process_request')) return 'middleware';
      if (lower.includes('/views/') || fileName === 'views.py') return 'view';
      if (lower.includes('/services/') || lower.includes('service.py')) return 'service';
      if (lower.includes('/models/') || fileName === 'models.py' || fileName.endsWith('_model.py')) return 'model';
      if (lower.includes('/schemas/') || fileName === 'schemas.py') return 'schema';
      if (lower.includes('/utils/') || lower.includes('/helpers/') || lower.includes('/lib/')) return 'util';
      return 'service';
    }

    // STEP 3: TypeScript/JavaScript roles
    if (language === 'typescript' || language === 'javascript' || language === 'tsx' || language === 'jsx') {
      if (lower.includes('/migrations/')) return 'migration';

      // API routes - check before pages so /pages/api/ resolves correctly
      if (lower.includes('/pages/api/') || lower.includes('/app/api/') ||
        lower.includes('/routes/') || lower.includes('/api/')) return 'api-route';

      // Framework page files
      if ((lower.includes('/pages/') || lower.includes('/app/')) &&
        (fileName === 'page.tsx' || fileName === 'page.ts' ||
         fileName.endsWith('.page.tsx') || fileName.endsWith('.page.ts'))) return 'page';

      // React hooks - identified by function name prefix
      if (functions.some((f) => /^use[A-Z]/.test(f)) ||
        (fileName.startsWith('use') && /^use[A-Z]/.test(
          (fileName.replace(/\.[^.]+$/, ''))
        ))) return 'hook';

      // State stores
      if (lower.includes('/store/') || lower.includes('/stores/') ||
        lower.includes('store.ts') || lower.includes('store.tsx') ||
        (content.includes('create(') && content.includes('zustand')) ||
        content.includes('configureStore') ||
        content.includes('createSlice')) return 'store';

      // React context
      if (lower.includes('/context/') || lower.includes('context.ts') || lower.includes('context.tsx') || content.includes('createContext')) return 'context';

      // PATH-BASED CHECKS - must be BEFORE the PascalCase export check.
      // Without this order, any file with a PascalCase export in types/,
      // services/, models/, utils/, or lib/ incorrectly gets role 'component'.
      if (lower.includes('/types/') || lower.includes('/interfaces/') ||
        lower.endsWith('.d.ts') || lower.endsWith('types.ts') ||
        lower.endsWith('types.tsx')) return 'type';

      if (lower.includes('/middleware/')) return 'middleware';

      if (lower.includes('/services/') || lower.endsWith('service.ts') ||
        lower.endsWith('service.tsx')) return 'service';

      if (lower.includes('/models/') || lower.endsWith('model.ts') ||
        lower.endsWith('model.tsx')) return 'model';

      if (lower.includes('/utils/') || lower.includes('/helpers/') ||
        lower.includes('/lib/') || lower.endsWith('util.ts') ||
        lower.endsWith('utils.ts')) return 'util';

      // PascalCase export or JSX/TSX file - component is the fallback
      // only after all structural path checks have been exhausted
      if (exports.some((e) => /^[A-Z]/.test(e)) ||
        language === 'tsx' || language === 'jsx') return 'component';

      // Non-JSX files in a pages directory
      if (lower.includes('/pages/')) return 'page';

      return 'component';
    }

    return 'unknown';
  }

  private _findTestFile(relativePath: string, graph: FileGraph): string | undefined {
    const withoutExt = relativePath.replace(/\.[^.]+$/, '');
    const base = path.basename(withoutExt);
    const dir = path.dirname(withoutExt);

    const candidates = [
      `${withoutExt}.test.ts`,
      `${withoutExt}.test.tsx`,
      `${withoutExt}.test.js`,
      `${withoutExt}.spec.ts`,
      `${withoutExt}.spec.tsx`,
      `${withoutExt}.spec.js`,
      `${dir}/__tests__/${base}.test.ts`,
      `${dir}/__tests__/${base}.test.js`,
      `tests/${base}.test.ts`,
      `tests/${base}.test.py`,
      `test_${base}.py`,
    ];

    for (const candidate of candidates) {
      if (graph.has(candidate)) return candidate;
    }

    return undefined;
  }
}
