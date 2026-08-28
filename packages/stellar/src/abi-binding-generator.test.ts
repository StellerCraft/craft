import { describe, it, expect } from 'vitest';
import { xdr, ContractSpec } from 'stellar-sdk';
import {
  xdrTypeToTypeScript,
  parseContractAbi,
  generateBinding,
} from './abi-binding-generator';

// ---------------------------------------------------------------------------
// Helpers: build minimal spec entries
// ---------------------------------------------------------------------------

function buildSpecEntries(
  overrides?: Partial<{
    functions: {
      doc?: string;
      name: string;
      inputs: { doc?: string; name: string; type: xdr.ScSpecTypeDef }[];
      outputs: xdr.ScSpecTypeDef[];
    }[];
  }>,
): xdr.ScSpecEntry[] {
  const entries: xdr.ScSpecEntry[] = [];
  for (const fn of overrides?.functions ?? []) {
    entries.push(
      xdr.ScSpecEntry.scSpecEntryFunctionV0(
        new xdr.ScSpecFunctionV0({
          doc: fn.doc ?? '',
          name: fn.name,
          inputs: fn.inputs.map(
            (i) =>
              new xdr.ScSpecFunctionInputV0({
                doc: i.doc ?? '',
                name: i.name,
                type: i.type,
              }),
          ),
          outputs: fn.outputs,
        }),
      ),
    );
  }
  return entries;
}

function buildStructUdt(
  name: string,
  fields: { doc?: string; name: string; type: xdr.ScSpecTypeDef }[],
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtStructV0(
    new xdr.ScSpecUdtStructV0({
      doc: '',
      lib: '',
      name,
      fields: fields.map(
        (f) =>
          new xdr.ScSpecUdtStructFieldV0({
            doc: f.doc ?? '',
            name: f.name,
            type: f.type,
          }),
      ),
    }),
  );
}

function buildUnionUdt(
  name: string,
  cases: { doc?: string; name: string; type?: xdr.ScSpecTypeDef }[],
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtUnionV0(
    new xdr.ScSpecUdtUnionV0({
      doc: '',
      lib: '',
      name,
      cases: cases.map(
        (c) =>
          new xdr.ScSpecUdtUnionCaseV0({
            doc: c.doc ?? '',
            name: c.name,
            type: c.type,
          }),
      ),
    }),
  );
}

function buildCompoundType(
  arm: string,
  inner: xdr.ScSpecTypeDef,
): xdr.ScSpecTypeDef {
  switch (arm) {
    case 'option':
      return xdr.ScSpecTypeDef.scSpecTypeOption(
        new xdr.ScSpecTypeOption({ valueType: inner }),
      );
    case 'vec':
      return xdr.ScSpecTypeDef.scSpecTypeVec(
        new xdr.ScSpecTypeVec({ elementType: inner }),
      );
    case 'result':
      return xdr.ScSpecTypeDef.scSpecTypeResult(
        new xdr.ScSpecTypeResult({ okType: inner, errorType: xdr.ScSpecTypeDef.scSpecTypeError() }),
      );
    default:
      return inner;
  }
}

function buildEnumUdt(
  name: string,
  cases: { doc?: string; name: string; value: number }[],
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtEnumV0(
    new xdr.ScSpecUdtEnumV0({
      doc: '',
      lib: '',
      name,
      cases: cases.map(
        (c) =>
          new xdr.ScSpecUdtEnumCaseV0({
            doc: c.doc ?? '',
            name: c.name,
            discriminant: new xdr.ScVal.scvU32(new xdr.Uint32(c.value)),
          }),
      ),
    }),
  );
}

function buildErrorEnumUdt(
  name: string,
  cases: { doc?: string; name: string; value: number }[],
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtErrorEnumV0(
    new xdr.ScSpecUdtErrorEnumV0({
      doc: '',
      lib: '',
      name,
      cases: cases.map(
        (c) =>
          new xdr.ScSpecUdtErrorEnumCaseV0({
            doc: c.doc ?? '',
            name: c.name,
            discriminant: new xdr.ScVal.scvU32(new xdr.Uint32(c.value)),
          }),
      ),
    }),
  );
}

// ---------------------------------------------------------------------------
// xdrTypeToTypeScript — pure type mapping
// ---------------------------------------------------------------------------

describe('xdrTypeToTypeScript', () => {
  const emptyUdtNames = new Set<string>();

  const primitives: [string, string, string][] = [
    ['bool', 'scSpecTypeBool', 'boolean'],
    ['void', 'scSpecTypeVoid', 'void'],
    ['u32', 'scSpecTypeU32', 'number'],
    ['i32', 'scSpecTypeI32', 'number'],
    ['u64', 'scSpecTypeU64', 'bigint'],
    ['i64', 'scSpecTypeI64', 'bigint'],
    ['u128', 'scSpecTypeU128', 'bigint'],
    ['i128', 'scSpecTypeI128', 'bigint'],
    ['u256', 'scSpecTypeU256', 'bigint'],
    ['i256', 'scSpecTypeI256', 'bigint'],
    ['timepoint', 'scSpecTypeTimepoint', 'bigint'],
    ['duration', 'scSpecTypeDuration', 'bigint'],
    ['address', 'scSpecTypeAddress', 'string'],
    ['string', 'scSpecTypeString', 'string'],
    ['symbol', 'scSpecTypeSymbol', 'string'],
    ['bytes', 'scSpecTypeBytes', 'Buffer'],
    ['val', 'scSpecTypeVal', 'xdr.ScVal'],
    ['error', 'scSpecTypeError', 'Error'],
  ];

  for (const [label, arm, expected] of primitives) {
    it(`maps ${label}`, () => {
      const td = (xdr.ScSpecTypeDef as any)[arm]();
      expect(xdrTypeToTypeScript(td, emptyUdtNames)).toBe(expected);
    });
  }

  it('maps bytesN', () => {
    const td = xdr.ScSpecTypeDef.scSpecTypeBytesN(
      new xdr.ScSpecTypeBytesN({ n: 32 }),
    );
    expect(xdrTypeToTypeScript(td, emptyUdtNames)).toBe('Buffer');
  });

  it('maps option type', () => {
    const opt = buildCompoundType('option', xdr.ScSpecTypeDef.scSpecTypeAddress());
    expect(xdrTypeToTypeScript(opt, emptyUdtNames)).toBe('string | undefined');
  });

  it('maps vec type', () => {
    const vec = buildCompoundType('vec', xdr.ScSpecTypeDef.scSpecTypeBool());
    expect(xdrTypeToTypeScript(vec, emptyUdtNames)).toBe('boolean[]');
  });

  it('maps result type', () => {
    const res = buildCompoundType('result', xdr.ScSpecTypeDef.scSpecTypeI32());
    expect(xdrTypeToTypeScript(res, emptyUdtNames)).toBe('Result<number, Error>');
  });

  it('maps tuple type', () => {
    const tuple = xdr.ScSpecTypeDef.scSpecTypeTuple(
      new xdr.ScSpecTypeTuple({ valueTypes: [
        xdr.ScSpecTypeDef.scSpecTypeAddress(),
        xdr.ScSpecTypeDef.scSpecTypeI128(),
      ]}),
    );
    expect(xdrTypeToTypeScript(tuple, emptyUdtNames)).toBe('[string, bigint]');
  });

  it('maps map type', () => {
    const map = xdr.ScSpecTypeDef.scSpecTypeMap(
      new xdr.ScSpecTypeMap({ keyType: xdr.ScSpecTypeDef.scSpecTypeSymbol(), valueType: xdr.ScSpecTypeDef.scSpecTypeString() }),
    );
    expect(xdrTypeToTypeScript(map, emptyUdtNames)).toBe('Record<string, string>');
  });

  it('maps udt type when name is in set', () => {
    const udt = xdr.ScSpecTypeDef.scSpecTypeUdt(
      new xdr.ScSpecTypeUdt({ name: 'AllowanceData' }),
    );
    const names = new Set(['AllowanceData']);
    expect(xdrTypeToTypeScript(udt, names)).toBe('AllowanceData');
  });

  it('enforces recursion depth limit', () => {
    let deep = xdr.ScSpecTypeDef.scSpecTypeBool();
    for (let i = 0; i < 12; i++) {
      deep = buildCompoundType('option', deep);
    }
    const result = xdrTypeToTypeScript(deep, emptyUdtNames);
    expect(result).toContain('unknown');
    expect(result.split('|').length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// parseContractAbi
// ---------------------------------------------------------------------------

describe('parseContractAbi', () => {
  it('parses a simple function spec', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'hello',
          inputs: [
            { name: 'who', type: xdr.ScSpecTypeDef.scSpecTypeSymbol() },
          ],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeString()],
        },
      ],
    });

    const parsed = parseContractAbi(entries, 'Greeter');
    expect(parsed.contractName).toBe('Greeter');
    expect(parsed.functions).toHaveLength(1);
    expect(parsed.functions[0].name).toBe('hello');
    expect(parsed.functions[0].params).toHaveLength(1);
    expect(parsed.functions[0].params[0].name).toBe('who');
    expect(parsed.functions[0].params[0].type).toBe('string');
    expect(parsed.functions[0].returnType).toBe('string');
  });

  it('parses functions with no inputs', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'status',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeString()],
        },
      ],
    });

    const parsed = parseContractAbi(entries);
    expect(parsed.functions[0].params).toHaveLength(0);
    expect(parsed.functions[0].returnType).toBe('string');
  });

  it('parses functions with void return', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'init',
          inputs: [
            { name: 'admin', type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
          ],
          outputs: [],
        },
      ],
    });

    const parsed = parseContractAbi(entries);
    expect(parsed.functions[0].returnType).toBe('void');
  });

  it('resolves UDT references from function return types', () => {
    const entries = [
      buildStructUdt('AllowanceData', [
        { name: 'spender', type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
        { name: 'amount', type: xdr.ScSpecTypeDef.scSpecTypeI128() },
      ]),
      ...buildSpecEntries({
        functions: [
          {
            name: 'query_allowance',
            inputs: [
              { name: 'from', type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
              { name: 'spender', type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
            ],
            outputs: [
              xdr.ScSpecTypeDef.scSpecTypeUdt(
                new xdr.ScSpecTypeUdt({ name: 'AllowanceData' }),
              ),
            ],
          },
        ],
      }),
    ];

    const parsed = parseContractAbi(entries);
    expect(parsed.functions[0].returnType).toBe('AllowanceData');
  });

  it('parses contract spec from base64 strings', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'greet',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeString()],
        },
      ],
    });
    const spec = new ContractSpec(entries);
    const base64 = spec.entries.map((e: xdr.ScSpecEntry) => e.toXDR('base64'));

    const parsed = parseContractAbi(base64);
    expect(parsed.functions).toHaveLength(1);
    expect(parsed.functions[0].name).toBe('greet');
  });
});

// ---------------------------------------------------------------------------
// generateBinding
// ---------------------------------------------------------------------------

describe('generateBinding', () => {
  it('produces a string with header', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'hello',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeString()],
        },
      ],
    });

    const source = generateBinding(entries, 'Greeter');
    expect(source).toContain('Auto-generated by abi-binding-generator');
    expect(source).toContain('Contract: Greeter');
  });

  it('includes TypeScript interfaces for struct UDTs', () => {
    const entries = [
      buildStructUdt('AllowanceData', [
        { name: 'spender', type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
        { name: 'amount', type: xdr.ScSpecTypeDef.scSpecTypeI128() },
      ]),
      ...buildSpecEntries({
        functions: [
          {
            name: 'allowance',
            inputs: [],
            outputs: [xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: 'AllowanceData' }))],
          },
        ],
      }),
    ];

    const source = generateBinding(entries);
    expect(source).toContain('export interface AllowanceData');
    expect(source).toContain('spender: string');
    expect(source).toContain('amount: bigint');
  });

  it('includes argument interfaces for functions', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'transfer',
          inputs: [
            { name: 'to', type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
            { name: 'amount', type: xdr.ScSpecTypeDef.scSpecTypeI128() },
          ],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeBool()],
        },
      ],
    });

    const source = generateBinding(entries);
    expect(source).toContain('export interface transferArgs');
    expect(source).toContain('to: string');
    expect(source).toContain('amount: bigint');
  });

  it('skips argument interface for functions with no params', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'status',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeString()],
        },
      ],
    });

    const source = generateBinding(entries);
    expect(source).not.toContain('export interface StatusArgs');
  });

  it('includes factory function', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'hello',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeString()],
        },
      ],
    });

    const source = generateBinding(entries, 'Greeter');
    expect(source).toContain('export function createGreeter');
    expect(source).toContain('InvokeCallback');
    expect(source).toContain('contractId: string');
  });

  it('generated factory includes async methods for each function', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'balance',
          inputs: [
            { name: 'id', type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
          ],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeI128()],
        },
        {
          name: 'decimals',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeU32()],
        },
      ],
    });

    const source = generateBinding(entries, 'Token');
    expect(source).toContain('async balance(');
    expect(source).toContain('async decimals(');
  });

  it('includes lazy spec singleton', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'hello',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeString()],
        },
      ],
    });

    const source = generateBinding(entries);
    expect(source).toContain('let _spec: ContractSpec | null = null');
    expect(source).toContain('function _getSpec()');
  });

  it('passes function name to invoke callback', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'foo',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeVoid()],
        },
      ],
    });

    const source = generateBinding(entries);
    expect(source).toContain("invoke('foo'");
  });

  it('includes InvokeCallback type', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'ping',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeBool()],
        },
      ],
    });

    const source = generateBinding(entries, 'Ping');
    expect(source).toContain('export type InvokeCallback');
    expect(source).toContain('invoke: InvokeCallback');
  });

  it('generates discriminated union types for union UDTs', () => {
    const entries = [
      buildUnionUdt('Action', [
        { name: 'Transfer', type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
        { name: 'Approve', type: xdr.ScSpecTypeDef.scSpecTypeI128() },
        { name: 'Burn' },
      ]),
      ...buildSpecEntries({
        functions: [
          {
            name: 'execute',
            inputs: [
              { name: 'action', type: xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: 'Action' })) },
            ],
            outputs: [xdr.ScSpecTypeDef.scSpecTypeBool()],
          },
        ],
      }),
    ];

    const source = generateBinding(entries);
    expect(source).toContain("export interface Action<T = undefined>");
    expect(source).toContain("tag: 'Transfer' | 'Approve' | 'Burn';");
    expect(source).toContain('values?: T;');
  });

  it('compiles to valid TypeScript with all primitive types', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'all_types',
          inputs: [
            { name: 'b', type: xdr.ScSpecTypeDef.scSpecTypeBool() },
            { name: 'u', type: xdr.ScSpecTypeDef.scSpecTypeU32() },
            { name: 'i', type: xdr.ScSpecTypeDef.scSpecTypeI32() },
            { name: 'l', type: xdr.ScSpecTypeDef.scSpecTypeI128() },
            { name: 's', type: xdr.ScSpecTypeDef.scSpecTypeString() },
            { name: 'a', type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
            { name: 'opt', type: buildCompoundType('option', xdr.ScSpecTypeDef.scSpecTypeBool()) },
          ],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeI128()],
        },
      ],
    });

    const source = generateBinding(entries, 'AllTypes');
    expect(source).toContain('b: boolean');
    expect(source).toContain('u: number');
    expect(source).toContain('i: number');
    expect(source).toContain('l: bigint');
    expect(source).toContain('s: string');
    expect(source).toContain('a: string');
    expect(source).toContain('opt: boolean | undefined');
    expect(source).toContain('async all_types(');
    expect(source).toContain('Promise<bigint>');
  });

  it('preserves non-sequential enum discriminant values', () => {
    const entries = [
      buildEnumUdt('Status', [
        { name: 'Idle', value: 0 },
        { name: 'Running', value: 2 },
        { name: 'Done', value: 5 },
      ]),
      ...buildSpecEntries({
        functions: [
          {
            name: 'get_status',
            inputs: [],
            outputs: [xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: 'Status' }))],
          },
        ],
      }),
    ];

    const source = generateBinding(entries);
    expect(source).toContain('export enum Status');
    expect(source).toContain('Idle = 0');
    expect(source).toContain('Running = 2');
    expect(source).toContain('Done = 5');
  });

  it('preserves non-sequential error enum discriminant values', () => {
    const entries = [
      buildErrorEnumUdt('ContractError', [
        { name: 'InvalidAmount', value: 1 },
        { name: 'InsufficientBalance', value: 3 },
        { name: 'Unauthorized', value: 7 },
      ]),
      ...buildSpecEntries({
        functions: [
          {
            name: 'transfer',
            inputs: [
              { name: 'to', type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
              { name: 'amount', type: xdr.ScSpecTypeDef.scSpecTypeI128() },
            ],
            outputs: [xdr.ScSpecTypeDef.scSpecTypeBool()],
          },
        ],
      }),
    ];

    const source = generateBinding(entries);
    expect(source).toContain('export enum ContractError');
    expect(source).toContain('InvalidAmount = 1');
    expect(source).toContain('InsufficientBalance = 3');
    expect(source).toContain('Unauthorized = 7');
  });
});

// ---------------------------------------------------------------------------
// Regression #1105 – sanitized-identifier collision detection
// ---------------------------------------------------------------------------

describe('generateBinding – identifier collision detection (regression #1105)', () => {
  it('throws a descriptive error when two function names sanitize to the same identifier', () => {
    // "transfer-from" and "transfer_from" both become "transfer_from" after safeIdent
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'transfer-from',
          inputs: [{ name: 'amount', type: xdr.ScSpecTypeDef.scSpecTypeU64() }],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeBool()],
        },
        {
          name: 'transfer_from',
          inputs: [{ name: 'amount', type: xdr.ScSpecTypeDef.scSpecTypeU64() }],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeBool()],
        },
      ],
    });

    expect(() => generateBinding(entries)).toThrow(/collision/i);
    expect(() => generateBinding(entries)).toThrow(/transfer.from/);
  });

  it('includes both colliding raw names in the error message', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'my.method',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeVoid()],
        },
        {
          name: 'my_method',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeVoid()],
        },
      ],
    });

    let err: Error | undefined;
    try {
      generateBinding(entries);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toContain('my.method');
    expect(err!.message).toContain('my_method');
  });

  it('does NOT throw when all function names produce distinct safe identifiers', () => {
    const entries = buildSpecEntries({
      functions: [
        {
          name: 'transfer',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeVoid()],
        },
        {
          name: 'approve',
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeVoid()],
        },
      ],
    });

    expect(() => generateBinding(entries)).not.toThrow();
  });

  it('throws when two UDT names sanitize to the same identifier', () => {
    // "My-Type" and "My_Type" both become "My_Type"
    const myType1 = buildStructUdt('My-Type', [
      { name: 'value', type: xdr.ScSpecTypeDef.scSpecTypeU32() },
    ]);
    const myType2 = buildStructUdt('My_Type', [
      { name: 'value', type: xdr.ScSpecTypeDef.scSpecTypeU32() },
    ]);
    const fnEntries = buildSpecEntries({
      functions: [
        { name: 'noop', inputs: [], outputs: [xdr.ScSpecTypeDef.scSpecTypeVoid()] },
      ],
    });

    expect(() => generateBinding([myType1, myType2, ...fnEntries])).toThrow(/collision/i);
  });
});
// ---------------------------------------------------------------------------
// End regression #1105
// ---------------------------------------------------------------------------
