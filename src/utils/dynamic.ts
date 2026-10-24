declare const __non_webpack_require__: any;

/**
 * Safely loads an optional dependency at runtime without triggering
 * ahead-of-time static analysis in bundlers like Metro, Webpack, or Rollup.
 */
export function safeDynamicRequire(pkgName: string): any {
  try {
    const req =
      typeof __non_webpack_require__ !== 'undefined'
        ? __non_webpack_require__
        : typeof require === 'function'
        ? require
        : undefined;
    return req ? req(pkgName) : undefined;
  } catch {
    return undefined;
  }
}

export async function safeDynamicImport(pkgName: string): Promise<any> {
  try {
    // Metro's AST worker rejects `import(dynamicVariable)` with "Invalid call at line ...: import(...)".
    // Evaluating via new Function bypasses the bundler AST parser entirely while working in Node/browser.
    const dynamicImport = new Function('specifier', 'return import(specifier);');
    return await dynamicImport(pkgName);
  } catch {
    return undefined;
  }
}
