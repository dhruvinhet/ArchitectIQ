export interface StyleParseResult {
  classNames: string[];
  variables: string[];
  isModule: boolean;
}

export class StyleParser {
  public static parse(content: string, filePath: string): StyleParseResult {
    return {
      classNames: this._extractClassNames(content),
      variables: this._extractCSSVariables(content),
      isModule: filePath.includes('.module.'),
    };
  }

  private static _extractClassNames(content: string): string[] {
    const names: string[] = [];
    let match;
    // CSS class selectors: .className {
    const classRegex = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)\s*[{,]/g;
    while ((match = classRegex.exec(content)) !== null) {
      names.push(match[1]);
    }
    return [...new Set(names)];
  }

  private static _extractCSSVariables(content: string): string[] {
    const vars: string[] = [];
    let match;
    const varRegex = /--([\w-]+)\s*:/g;
    while ((match = varRegex.exec(content)) !== null) {
      vars.push(`--${match[1]}`);
    }
    return [...new Set(vars)];
  }
}
