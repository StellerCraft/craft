import { xdr, ContractSpec } from 'stellar-sdk';

// ---------------------------------------------------------------------------
// Parsed ABI types
// ---------------------------------------------------------------------------

export interface AbiParameter {
  name: string;
  doc: string;
  type: string;
}

export interface AbiFunction {
  name: string;
  doc: string;
  params: AbiParameter[];
  returnType: string;
}

export interface AbiUdt {
  kind: 'struct' | 'union' | 'enum' | 'errorEnum';
  name: string;
  doc: string;
  fields?: { name: string; doc: string; type: string }[];
  cases?: { name: string; doc: string; value?: number; type?: string }[];
}

export interface ParsedContractAbi {
  contractName: string;
  functions: AbiFunction[];
  udts: AbiUdt[];
}

// ---------------------------------------------------------------------------
// XDR type → TypeScript type mapping
// ---------------------------------------------------------------------------

const PRIMITIVE_MAP: Record<string, string> = {
  scSpecTypeVal: 'xdr.ScVal',
  scSpecTypeBool: 'boolean',
  scSpecTypeVoid: 'void',
  scSpecTypeError: 'Error',
  scSpecTypeU32: 'number',
  scSpecTypeI32: 'number',
  scSpecTypeU64: 'bigint',
  scSpecTypeI64: 'bigint',
  scSpecTypeU128: 'bigint',
  scSpecTypeI128: 'bigint',
  scSpecTypeU256: 'bigint',
  scSpecTypeI256: 'bigint',
  scSpecTypeTimepoint: 'bigint',
  scSpecTypeDuration: 'bigint',
  scSpecTypeBytes: 'Buffer',
  scSpecTypeBytesN: 'Buffer',
  scSpecTypeString: 'string',
  scSpecTypeSymbol: 'string',
  scSpecTypeAddress: 'string',
};

/**
 * Resolve a (possibly-UDT) type name to its TypeScript representation.
 * If `udtName` is in the `udts` set, use the UDT name directly (it will be
 * emitted as a standalone interface/enum).  Otherwise return a fallback.
 */
function resolveUdtTypeName(
  rawName: string,
  udtNames: ReadonlySet<string>,
): string {
  if (udtNames.has(rawName)) return rawName;
  if (rawName.startsWith('ErrorEnum(')) return 'Error';
  return rawName;
}

/**
 * Recursively convert an XDR ScSpecTypeDef into a TypeScript type string.
 *
 * @param typeDef - The XDR type definition
 * @param udtNames - Set of known UDT names in the contract (for cross-refs)
 * @param depth - Recursion depth guard
 */
export function xdrTypeToTypeScript(
  typeDef: xdr.ScSpecTypeDef,
  udtNames: ReadonlySet<string> = new Set(),
  depth: number = 0,
): string {
  if (depth >= 10) return 'unknown';

  const arm = typeDef.switch().name;

  // Primitive types
  const mapped = PRIMITIVE_MAP[arm];
  if (mapped) return mapped;

  switch (arm) {
    case 'scSpecTypeOption': {
      const optVal = typeDef.value() as xdr.ScSpecTypeOption;
      const inner = optVal.valueType();
      return `${xdrTypeToTypeScript(inner, udtNames, depth + 1)} | undefined`;
    }

    case 'scSpecTypeResult': {
      const resVal = typeDef.value() as xdr.ScSpecTypeResult;
      const okInner = resVal.okType();
      return `Result<${xdrTypeToTypeScript(okInner, udtNames, depth + 1)}, Error>`;
    }

    case 'scSpecTypeVec': {
      const vecVal = typeDef.value() as xdr.ScSpecTypeVec;
      const inner = vecVal.elementType();
      return `${xdrTypeToTypeScript(inner, udtNames, depth + 1)}[]`;
    }

    case 'scSpecTypeMap': {
      const mapVal = typeDef.value() as xdr.ScSpecTypeMap;
      const inner = mapVal.valueType();
      return `Record<string, ${xdrTypeToTypeScript(inner, udtNames, depth + 1)}>`;
    }

    case 'scSpecTypeTuple': {
      const tupleVal = typeDef.value() as xdr.ScSpecTypeTuple;
      const innerArr = tupleVal.valueTypes();
      const elements = innerArr
        ? Array.from(innerArr).map((t: xdr.ScSpecTypeDef) =>
            xdrTypeToTypeScript(t, udtNames, depth + 1),
          )
        : [];
      return elements.length > 0 ? `[${elements.join(', ')}]` : 'unknown[]';
    }

    case 'scSpecTypeUdt': {
      const udtVal = typeDef.value() as xdr.ScSpecTypeUdt;
      const rawName = udtVal.name().toString();
      return resolveUdtTypeName(rawName, udtNames);
    }

    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Spec entry parsing
// ---------------------------------------------------------------------------

/**
 * Parse ScSpecEntry[] into a `ParsedContractAbi` that can be consumed by the
 * code generators.
 */
export function parseAbi(
  entries: (xdr.ScSpecEntry | string)[],
  contractName?: string,
): ParsedContractAbi {
  const spec = new ContractSpec(entries as any);

  const functions: AbiFunction[] = [];
  const udts: AbiUdt[] = [];
  const udtNames = new Set<string>();

  // First pass: collect all UDT names so we can resolve cross-references.
  for (const entry of spec.entries) {
    const kind = entry.switch().name;
    if (kind === 'scSpecEntryUdtStructV0') {
      const s = entry.value() as xdr.ScSpecUdtStructV0;
      udtNames.add(s.name().toString());
    } else if (kind === 'scSpecEntryUdtUnionV0') {
      const u = entry.value() as xdr.ScSpecUdtUnionV0;
      udtNames.add(u.name().toString());
    } else if (kind === 'scSpecEntryUdtEnumV0') {
      const e = entry.value() as xdr.ScSpecUdtEnumV0;
      udtNames.add(e.name().toString());
    } else if (kind === 'scSpecEntryUdtErrorEnumV0') {
      const e = entry.value() as xdr.ScSpecUdtErrorEnumV0;
      udtNames.add(`ErrorEnum(${e.name().toString()})`);
    }
  }

  // Second pass: build structured representations.
  for (const entry of spec.entries) {
    const kind = entry.switch().name;

    if (kind === 'scSpecEntryFunctionV0') {
      const fn = entry.value() as xdr.ScSpecFunctionV0;
      const inputs = fn.inputs() as xdr.ScSpecFunctionInputV0[];
      const outputs = fn.outputs() as xdr.ScSpecTypeDef[];

      functions.push({
        name: fn.name().toString(),
        doc: fn.doc().toString(),
        params: Array.from(inputs).map((i) => ({
          name: i.name().toString(),
          doc: i.doc().toString(),
          type: xdrTypeToTypeScript(i.type(), udtNames),
        })),
        returnType:
          outputs.length > 0
            ? outputs
                .map((o) => xdrTypeToTypeScript(o, udtNames))
                .join(' | ')
            : 'void',
      });
    } else if (kind === 'scSpecEntryUdtStructV0') {
      const s = entry.value() as xdr.ScSpecUdtStructV0;
      udts.push({
        kind: 'struct',
        name: s.name().toString(),
        doc: s.doc().toString(),
        fields: Array.from(s.fields() as xdr.ScSpecUdtStructFieldV0[]).map(
          (f) => ({
            name: f.name().toString(),
            doc: f.doc().toString(),
            type: xdrTypeToTypeScript(f.type(), udtNames),
          }),
        ),
      });
    } else if (kind === 'scSpecEntryUdtUnionV0') {
      const u = entry.value() as xdr.ScSpecUdtUnionV0;
      udts.push({
        kind: 'union',
        name: u.name().toString(),
        doc: u.doc().toString(),
        cases: Array.from(u.cases() as xdr.ScSpecUdtUnionCaseV0[]).map(
          (c, idx) => {
            const caseType = c.type();
            return {
              name: c.name().toString(),
              doc: c.doc().toString(),
              value: idx,
              type: caseType
                ? xdrTypeToTypeScript(caseType, udtNames)
                : undefined,
            };
          },
        ),
      });
    } else if (kind === 'scSpecEntryUdtEnumV0') {
      const e = entry.value() as xdr.ScSpecUdtEnumV0;
      udts.push({
        kind: 'enum',
        name: e.name().toString(),
        doc: e.doc().toString(),
        cases: Array.from(e.cases() as xdr.ScSpecUdtEnumCaseV0[]).map(
          (c) => ({
            name: c.name().toString(),
            doc: c.doc().toString(),
            value: c.value(),
          }),
        ),
      });
    } else if (kind === 'scSpecEntryUdtErrorEnumV0') {
      const e = entry.value() as xdr.ScSpecUdtErrorEnumV0;
      udts.push({
        kind: 'errorEnum',
        name: e.name().toString(),
        doc: e.doc().toString(),
        cases: Array.from(e.cases() as xdr.ScSpecUdtErrorEnumCaseV0[]).map(
          (c) => ({
            name: c.name().toString(),
            doc: c.doc().toString(),
            value: c.value(),
          }),
        ),
      });
    }
  }

  return {
    contractName: contractName ?? 'Contract',
    functions,
    udts,
  };
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/**
 * Escape a string for use as a TypeScript/JS doc comment.
 */
function escapeDoc(doc: string, indent: string = ''): string {
  if (!doc) return '';
  const lines = doc.split('\n').map((l) => `${indent} * ${l}`);
  return [`${indent}/**`, ...lines, `${indent} */`].join('\n');
}

/**
 * Sanitise a name so it can be used as a TypeScript identifier.
 */
function safeIdent(name: string): string {
  return name.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^(\d)/, '_$1');
}

/**
 * Generate TypeScript interface definitions for all UDTs.
 */
function generateTypeDefs(parsed: ParsedContractAbi): string {
  const lines: string[] = [];

  for (const udt of parsed.udts) {
    if (udt.doc) {
      lines.push(escapeDoc(udt.doc));
    }

    if (udt.kind === 'struct') {
      lines.push(`export interface ${safeIdent(udt.name)} {`);
      for (const f of udt.fields ?? []) {
        if (f.doc) lines.push(`  ${escapeDoc(f.doc, '  ')}`);
        lines.push(`  ${safeIdent(f.name)}: ${f.type};`);
      }
      lines.push('}');
    } else if (udt.kind === 'enum' || udt.kind === 'errorEnum') {
      lines.push(`export enum ${safeIdent(udt.name)} {`);
      for (const c of udt.cases ?? []) {
        if (c.doc) lines.push(`  ${escapeDoc(c.doc, '  ')}`);
        lines.push(`  ${safeIdent(c.name)} = ${c.value},`);
      }
      lines.push('}');
    } else if (udt.kind === 'union') {
      // Union → discriminated union interface with literal tag type
      const caseNames = (udt.cases ?? []).map((c) => `'${c.name}'`).join(' | ');
      lines.push(
        `export interface ${safeIdent(udt.name)}<T = undefined> {`,
      );
      lines.push(`  tag: ${caseNames};`);
      lines.push('  values?: T;');
      lines.push('}');
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate TypeScript type-safe wrapper functions for each contract entry
 * point.  The wrappers use `ContractSpec` for native ↔ ScVal conversion and
 * accept an `invoke` callback for the actual RPC call.
 */
function generateWrappers(
  parsed: ParsedContractAbi,
  specBase64: string[],
): string {
  const { contractName, functions } = parsed;
  const lines: string[] = [];

  // Import
  lines.push("import { ContractSpec, xdr } from 'stellar-sdk';");
  lines.push('');

  // Spec XDR constant
  lines.push(
    `const _SPEC_ENTRIES: string[] = ${JSON.stringify(specBase64, null, 2)};`,
  );
  lines.push('');

  // Lazy spec instance
  lines.push('let _spec: ContractSpec | null = null;');
  lines.push('function _getSpec(): ContractSpec {');
  lines.push('  if (!_spec) _spec = new ContractSpec(_SPEC_ENTRIES);');
  lines.push('  return _spec;');
  lines.push('}');
  lines.push('');

  // Type for the invoke callback
  lines.push(
    `export type InvokeCallback = (method: string, scArgs: xdr.ScVal[]) => Promise<xdr.ScVal>;`,
  );
  lines.push('');

  // Argument interfaces for each function
  for (const fn of functions) {
    if (fn.params.length === 0) continue;
    const ifaceName = `${safeIdent(fn.name)}Args`;

    if (fn.doc) lines.push(escapeDoc(fn.doc));
    lines.push(`export interface ${ifaceName} {`);
    for (const p of fn.params) {
      if (p.doc) lines.push(`  ${escapeDoc(p.doc, '  ')}`);
      lines.push(`  ${safeIdent(p.name)}: ${p.type};`);
    }
    lines.push('}');
    lines.push('');
  }

  // Factory function
  const firstFnDoc = functions[0]?.doc;
  if (firstFnDoc) lines.push(escapeDoc(firstFnDoc));
  lines.push(
    `export function create${safeIdent(contractName)}(contractId: string) {`,
  );
  lines.push('  const spec = _getSpec();');
  lines.push('  return {');

  for (const fn of functions) {
    const hasArgs = fn.params.length > 0;
    const argsIface = `${safeIdent(fn.name)}Args`;

    if (fn.doc) {
      for (const docLine of fn.doc.split('\n')) {
        lines.push(`    /** ${docLine} */`);
      }
    }

    lines.push(`    async ${safeIdent(fn.name)}(`);
    lines.push(`      ${hasArgs ? `args: ${argsIface},` : ''}`);
    lines.push(`      source: string,`);
    lines.push(
      `      invoke: InvokeCallback,`,
    );
    lines.push(`    ): Promise<${fn.returnType}> {`);

    if (fn.params.length > 0) {
      lines.push(
        `      const scArgs = spec.funcArgsToScVals('${fn.name}', args as unknown as Record<string, unknown>);`,
      );
    } else {
      lines.push(
        `      const scArgs: xdr.ScVal[] = [];`,
      );
    }

    lines.push(
      `      const raw = await invoke('${fn.name}', scArgs);`,
    );

    if (fn.returnType === 'void') {
      lines.push('    },');
    } else {
      lines.push(
        `      return spec.funcResToNative('${fn.name}', raw) as ${fn.returnType};`,
      );
    }
    lines.push('    },');
  }

  lines.push('  };');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

/**
 * Serialise an array of ScSpecEntry XDR objects to an array of base64
 * strings so they can be embedded in the generated source.
 */
function specEntriesToBase64(entries: xdr.ScSpecEntry[]): string[] {
  return entries.map((e) => e.toXDR('base64'));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect whether any two distinct raw names in `names` sanitize to the same
 * `safeIdent` output.  Throws a descriptive error if a collision is found.
 *
 * @param names - Array of raw names to check (e.g. function names or UDT names)
 * @param context - A human-readable label used in the error message (e.g. 'function', 'UDT')
 */
function assertNoIdentifierCollisions(names: string[], context: string): void {
  const seen = new Map<string, string>(); // safeIdent → first raw name
  for (const raw of names) {
    const safe = safeIdent(raw);
    const existing = seen.get(safe);
    if (existing !== undefined && existing !== raw) {
      throw new Error(
        `Identifier collision detected in ${context} names: ` +
        `"${existing}" and "${raw}" both sanitize to "${safe}". ` +
        `Rename one of these in the contract before generating bindings.`,
      );
    }
    seen.set(safe, raw);
  }
}

/**
 * Generate a complete TypeScript source file that provides type-safe
 * bindings for a Soroban contract from its XDR spec entries.
 *
 * @param specEntries - Array of ScSpecEntry objects or base64-encoded
 *   ScSpecEntry XDR strings
 * @param contractName - Optional contract name used in the factory
 *   function (defaults to `'Contract'`)
 * @returns A TypeScript source string suitable for writing to a .ts file.
 *
 * The generated code:
 * - Defines TypeScript interfaces/enums for all user-defined types (UDTs)
 * - Defines argument interfaces for each contract function
 * - Exports an `InvokeCallback` type alias (for the RPC call abstraction)
 * - Exports a factory function (`createContractName`) that returns an
 *   object with type-safe async methods for each entry point
 * - Uses `ContractSpec` from stellar-sdk for native ↔ ScVal conversion
 * - Is strict-mode compatible
 *
 * @example
 * ```ts
 * const { entries } = new ContractSpec(specXdrStrings);
 * const source = generateBinding(entries, 'Token');
 * fs.writeFileSync('token-binding.ts', source);
 * ```
 */
export function generateBinding(
  specEntries: (xdr.ScSpecEntry | string)[],
  contractName?: string,
): string {
  const parsed = parseAbi(specEntries, contractName);

  // ── Collision detection ───────────────────────────────────────────────────
  // Detect any two distinct function names that map to the same safe identifier.
  assertNoIdentifierCollisions(
    parsed.functions.map((f) => f.name),
    'function',
  );
  // Detect any two distinct UDT names that map to the same safe identifier.
  assertNoIdentifierCollisions(
    parsed.udts.map((u) => u.name),
    'UDT',
  );
  // ─────────────────────────────────────────────────────────────────────────

  let base64: string[];
  if (typeof specEntries[0] === 'string') {
    base64 = specEntries as string[];
  } else {
    base64 = specEntriesToBase64(specEntries as xdr.ScSpecEntry[]);
  }

  const header = `\
// ============================================================
// Auto-generated by abi-binding-generator
// Contract: ${parsed.contractName}
// Functions: ${parsed.functions.length}
// UDTs: ${parsed.udts.length}
// ============================================================
`;

  const typeDefs = generateTypeDefs(parsed);
  const wrappers = generateWrappers(parsed, base64);

  return [header, typeDefs, wrappers].join('\n');
}

/**
 * Convenience: parse spec entries and return only the structured
 * representation without generating code.  Useful for tooling that
 * needs to inspect the ABI.
 */
export function parseContractAbi(
  entries: (xdr.ScSpecEntry | string)[],
  contractName?: string,
): ParsedContractAbi {
  return parseAbi(entries, contractName);
}
