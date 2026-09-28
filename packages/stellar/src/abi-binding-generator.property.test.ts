import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { xdr } from 'stellar-sdk';
import * as ts from 'typescript';
import { generateBinding } from './abi-binding-generator';

const RESERVED_WORDS = [
  'abstract', 'any', 'as', 'asserts', 'await', 'bigint', 'boolean', 'break',
  'case',
  'catch', 'class', 'const', 'continue', 'debugger', 'declare', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'implements', 'import', 'in', 'infer',
  'instanceof', 'interface', 'is', 'keyof', 'let', 'module', 'namespace',
  'never', 'new', 'null', 'number', 'object', 'package', 'private',
  'protected', 'public', 'readonly', 'return', 'static', 'string', 'super',
  'switch', 'symbol', 'this', 'throw', 'true', 'try', 'type', 'typeof',
  'undefined', 'unique', 'unknown', 'var', 'void', 'while', 'with', 'yield',
];

const IDENTIFIER_CHARACTERS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$éΩ漢';

const arbHostileIdentifier = fc.oneof(
  fc.constantFrom(...RESERVED_WORDS),
  fc.integer({ min: 0, max: 9999 }).map((value) => `${value}Contract`),
  fc
    .array(fc.constantFrom(...IDENTIFIER_CHARACTERS), {
      minLength: 1,
      maxLength: 24,
    })
    .map((characters) => characters.join('')),
);

const arbCollisionStem = fc
  .array(
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'),
    {
      minLength: 1,
      maxLength: 16,
    },
  )
  .map((characters) => characters.join(''));

function buildEntries(name: string): xdr.ScSpecEntry[] {
  const struct = xdr.ScSpecEntry.scSpecEntryUdtStructV0(
    new xdr.ScSpecUdtStructV0({
      doc: '',
      lib: '',
      name,
      fields: [
        new xdr.ScSpecUdtStructFieldV0({
          doc: '',
          name,
          type: xdr.ScSpecTypeDef.scSpecTypeString(),
        }),
      ],
    }),
  );
  const fn = xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: '',
      name,
      inputs: [
        new xdr.ScSpecFunctionInputV0({
          doc: '',
          name,
          type: xdr.ScSpecTypeDef.scSpecTypeString(),
        }),
      ],
      outputs: [xdr.ScSpecTypeDef.scSpecTypeVoid()],
    }),
  );

  return [struct, fn];
}

function expectParseableTypeScript(source: string): void {
  const parsed = ts.createSourceFile(
    'generated-binding.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  expect(parsed.parseDiagnostics).toHaveLength(0);
}

describe('generateBinding identifier sanitization properties', () => {
  it('emits parseable TypeScript for hostile ABI identifiers', () => {
    fc.assert(
      fc.property(arbHostileIdentifier, (name) => {
        const source = generateBinding(buildEntries(name), name);
        expectParseableTypeScript(source);
      }),
      { numRuns: 200 },
    );
  });

  it('generates deterministic bindings for every ABI identifier', () => {
    fc.assert(
      fc.property(arbHostileIdentifier, (name) => {
        const entries = buildEntries(name);
        expect(generateBinding(entries, name)).toBe(
          generateBinding(entries, name),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('detects collisions across generated mixed-case ABI names', () => {
    fc.assert(
      fc.property(arbCollisionStem, (stem) => {
        const firstFunction = buildEntries(`${stem}-value`)[1];
        const secondFunction = buildEntries(`${stem}_value`)[1];
        expect(() => generateBinding([firstFunction, secondFunction])).toThrow(
          /identifier collision/i,
        );
      }),
      { numRuns: 200 },
    );
  });
});
