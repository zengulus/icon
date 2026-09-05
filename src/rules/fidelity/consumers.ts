/**
 * fidelity/consumers.ts — makes consumer registrations RESOLVABLE.
 *
 * A registration must name a real implementation file and, when a symbol is
 * declared, an actual export of that file. "src/foo.ts — someFunction" prose
 * alone proves nothing: missing modules, deleted exports, and stale
 * registrations are hard integrity failures because they mean the evidence
 * graph claims coverage of code that does not exist.
 *
 * Resolution uses TypeScript's module/export symbols, without importing or
 * executing implementation code. Named aliases must reach a runtime value;
 * comments, strings, erased types and ambient declarations are not consumers.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import type { ConsumerRegistration, FidelityIntegrityViolation } from './types.js';

export interface ConsumerResolutionDeps {
  root: string;
  exists?(path: string): boolean;
  readFile?(path: string): string;
}

/** Resolves every registration against the repository tree. */
export function resolveConsumerRegistrations(
  consumers: readonly ConsumerRegistration[],
  deps: ConsumerResolutionDeps,
): FidelityIntegrityViolation[] {
  const violations: FidelityIntegrityViolation[] = [];
  const exists = deps.exists ?? ((path: string) => existsSync(path));
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  // One compiler graph per audit, with no default libraries or ambient @types.
  // All reads (including alias targets) use the same injectable filesystem.
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    types: [],
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  host.fileExists = exists;
  host.readFile = (path) => {
    try { return readFile(path); } catch { return undefined; }
  };
  // Do not consult the host machine's directory layout for virtual fixtures.
  // Module resolution still checks each candidate through fileExists.
  host.directoryExists = undefined;
  host.realpath = undefined;
  host.getSourceFile = (path, languageVersion) => {
    const source = host.readFile(path);
    return source === undefined ? undefined : ts.createSourceFile(path, source, languageVersion, true);
  };
  const program = ts.createProgram(consumers.map(({ file }) => resolve(deps.root, file)), options, host);
  const checker = program.getTypeChecker();

  function explicitExport(module: ts.Symbol, name: string): ts.Symbol | undefined {
    const source = module.getDeclarations()?.find(ts.isSourceFile);
    if (!source || program.getSyntacticDiagnostics(source).length > 0) return undefined;
    const exported = checker.getExportsOfModule(module).find((symbol) => symbol.name === name);
    // Wildcard barrels do not explicitly bind an implementation identity.
    // Register the defining module or a named re-export instead. Apply this
    // at EVERY module edge, including `export type *` behind a named alias.
    return exported?.getDeclarations()?.some((node) => node.getSourceFile() === source) ? exported : undefined;
  }

  function hasRuntimeImplementation(symbol: ts.Symbol, seen = new Set<ts.Symbol>()): boolean {
    if (seen.has(symbol)) return false;
    seen.add(symbol);
    const declarations = symbol.getDeclarations() ?? [];
    if (declarations.length === 0 || declarations.some((node) =>
      ts.isTypeOnlyImportOrExportDeclaration(node)
      || node.getSourceFile().isDeclarationFile
      || program.getSyntacticDiagnostics(node.getSourceFile()).length > 0)) return false;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      for (const node of declarations) {
        let moduleSpecifier: ts.Expression | undefined;
        let importedName: string | undefined;
        if (ts.isExportSpecifier(node)) {
          moduleSpecifier = node.parent.parent.moduleSpecifier;
          importedName = (node.propertyName ?? node.name).text;
        } else if (ts.isImportSpecifier(node)) {
          moduleSpecifier = node.parent.parent.parent.moduleSpecifier;
          importedName = (node.propertyName ?? node.name).text;
        } else if (ts.isImportClause(node)) {
          moduleSpecifier = node.parent.moduleSpecifier;
          importedName = 'default';
        }
        if (moduleSpecifier && importedName !== undefined) {
          const module = checker.getSymbolAtLocation(moduleSpecifier);
          const target = module && explicitExport(module, importedName);
          return target !== undefined && hasRuntimeImplementation(target, seen);
        }
      }
      const target = checker.getImmediateAliasedSymbol(symbol);
      return target !== undefined && hasRuntimeImplementation(target, seen);
    }
    if (!(symbol.flags & ts.SymbolFlags.Value)) return false;
    return declarations.some((node) => {
      // `declare` can live on the containing statement/namespace, not only
      // the variable declaration itself. Neither emits an implementation.
      for (let current: ts.Node | undefined = node; current; current = current.parent) {
        if (ts.canHaveModifiers(current) && ts.getModifiers(current)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return false;
      }
      if (ts.isFunctionDeclaration(node)) return node.body !== undefined;
      if (ts.isEnumDeclaration(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ConstKeyword)) return false;
      return ts.isVariableDeclaration(node) || ts.isBindingElement(node)
        || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)
        || ts.isExportAssignment(node);
    });
  }

  for (const consumer of consumers) {
    const absolute = resolve(deps.root, consumer.file);
    if (!exists(absolute)) {
      violations.push({ check: 'consumer-file-missing', detail: `consumer ${consumer.id}: implementation file ${consumer.file} does not exist` });
      continue;
    }
    const source = program.getSourceFile(absolute);
    if (!source) {
      violations.push({ check: 'consumer-file-missing', detail: `consumer ${consumer.id}: implementation file ${consumer.file} could not be read` });
      continue;
    }
    if (consumer.symbol === undefined) continue;
    const module = checker.getSymbolAtLocation(source);
    const exported = module && explicitExport(module, consumer.symbol);
    if (!exported || !hasRuntimeImplementation(exported)) {
      violations.push({
        check: 'consumer-symbol-missing',
        detail: `consumer ${consumer.id}: symbol "${consumer.symbol}" does not resolve to an explicit runtime export from ${consumer.file} (stale or non-executable registration)`,
      });
    }
  }
  return violations;
}
