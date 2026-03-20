export interface PythonParseResult {
  imports: string[];
  exports: string[];
  functions: string[];
  classes: string[];
  decorators: string[];
  frameworks: string[];
}

export class PythonParser {
  public static parse(content: string): PythonParseResult {
    return {
      imports: this._extractImports(content),
      exports: this._extractPublicSymbols(content),
      functions: this._extractFunctions(content),
      classes: this._extractClasses(content),
      decorators: this._extractDecorators(content),
      frameworks: this._detectFrameworks(content),
    };
  }

  private static _extractImports(content: string): string[] {
    const imports: string[] = [];
    let match;

    // from X import Y
    const fromImportRegex = /^from\s+([\w.]+)\s+import\s+/gm;
    while ((match = fromImportRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // import X (possibly comma-separated)
    const importRegex = /^import\s+([\w.,\s]+)$/gm;
    while ((match = importRegex.exec(content)) !== null) {
      const modules = match[1].split(',').map(m => m.trim().split(/\s+as\s+/)[0].trim());
      imports.push(...modules);
    }

    return [...new Set(imports)];
  }

  private static _extractPublicSymbols(content: string): string[] {
    // __all__ = ['X', 'Y']
    const allRegex = /__all__\s*=\s*\[([^\]]+)\]/;
    const match = allRegex.exec(content);
    if (match) {
      return match[1].match(/['"][\w]+['"]/g)?.map(s => s.replace(/['"]/g, '')) ?? [];
    }

    // All public functions and classes (not starting with _)
    const symbols: string[] = [];
    let m;
    const funcRegex = /^(?:async\s+)?def\s+([a-zA-Z][a-zA-Z0-9_]*)\s*\(/gm;
    while ((m = funcRegex.exec(content)) !== null) {
      if (!m[1].startsWith('_')) symbols.push(m[1]);
    }
    const classRegex = /^class\s+([a-zA-Z][a-zA-Z0-9_]*)/gm;
    while ((m = classRegex.exec(content)) !== null) {
      if (!m[1].startsWith('_')) symbols.push(m[1]);
    }

    return symbols;
  }

  private static _extractFunctions(content: string): string[] {
    const functions: string[] = [];
    let match;
    const funcRegex = /^(?:[ \t]*)(?:async\s+)?def\s+([\w]+)\s*\(/gm;
    while ((match = funcRegex.exec(content)) !== null) {
      functions.push(match[1]);
    }
    return [...new Set(functions)];
  }

  private static _extractClasses(content: string): string[] {
    const classes: string[] = [];
    let match;
    const classRegex = /^class\s+([\w]+)(?:\([^)]*\))?:/gm;
    while ((match = classRegex.exec(content)) !== null) {
      classes.push(match[1]);
    }
    return [...new Set(classes)];
  }

  private static _extractDecorators(content: string): string[] {
    const decorators: string[] = [];
    let match;
    const decoratorRegex = /^@([\w.]+)(?:\([^)]*\))?/gm;
    while ((match = decoratorRegex.exec(content)) !== null) {
      decorators.push(match[1]);
    }
    return [...new Set(decorators)];
  }

  private static _detectFrameworks(content: string): string[] {
    const frameworks: string[] = [];
    if (/from\s+django/.test(content) || /import\s+django/.test(content)) frameworks.push('django');
    if (/from\s+flask/.test(content) || /import\s+flask/.test(content)) frameworks.push('flask');
    if (/from\s+fastapi/.test(content) || /import\s+fastapi/.test(content)) frameworks.push('fastapi');
    if (/from\s+rest_framework/.test(content)) frameworks.push('django-rest-framework');
    if (/import\s+sqlalchemy/.test(content) || /from\s+sqlalchemy/.test(content)) frameworks.push('sqlalchemy');
    return frameworks;
  }
}
