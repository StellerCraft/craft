import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { AssetPairEditor } from './AssetPairEditor';
import { ContractAddressInputs } from './ContractAddressInputs';
import { SorobanRpcInput } from './SorobanRpcInput';
import { StellarConfigPanel } from './StellarConfigPanel';
import { useStellarConfigForm, type StellarConfigFormState, type StellarConfigFormReturn } from './useStellarConfigForm';
import type { AssetPair } from '@craft/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const XLM_PAIR: AssetPair = {
    base: { code: 'XLM', issuer: '', type: 'native' },
    counter: { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', type: 'credit_alphanum4' },
};

const VALID_CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

const INITIAL_STATE: StellarConfigFormState = {
    stellar: {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanRpcUrl: '',
        assetPairs: [],
        contractAddresses: {},
    },
};

function createMockForm(overrides: Partial<StellarConfigFormReturn> = {}): StellarConfigFormReturn {
    return {
        state: INITIAL_STATE,
        errors: new Map(),
        isDirty: false,
        connectivityStatus: 'idle',
        connectivityResult: null,
        sorobanConnectivityStatus: 'idle',
        sorobanConnectivityResult: null,
        setStellar: vi.fn(),
        addAssetPair: vi.fn(),
        removeAssetPair: vi.fn(),
        setContractAddress: vi.fn(),
        removeContractAddress: vi.fn(),
        validate: vi.fn(() => []),
        checkConnectivity: vi.fn(),
        checkSorobanConnectivity: vi.fn(),
        reset: vi.fn(),
        ...overrides,
    };
}

// ── AssetPairEditor ───────────────────────────────────────────────────────────

describe('AssetPairEditor', () => {
    it('renders empty state message when no pairs', () => {
        render(<AssetPairEditor pairs={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.getByText('No asset pairs configured.')).toBeDefined();
    });

    it('renders existing pairs', () => {
        render(<AssetPairEditor pairs={[XLM_PAIR]} onAdd={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.getByText(/XLM.*USDC/)).toBeDefined();
    });

    it('calls onRemove when remove button clicked', () => {
        const onRemove = vi.fn();
        render(<AssetPairEditor pairs={[XLM_PAIR]} onAdd={vi.fn()} onRemove={onRemove} />);
        fireEvent.click(screen.getByRole('button', { name: /Remove pair/i }));
        expect(onRemove).toHaveBeenCalledWith(0);
    });

    it('opens add form when Add pair button clicked', () => {
        render(<AssetPairEditor pairs={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: '+ Add pair' }));
        expect(screen.getByText('Base asset')).toBeDefined();
        expect(screen.getByText('Counter asset')).toBeDefined();
    });

    it('closes add form when Cancel clicked', () => {
        render(<AssetPairEditor pairs={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: '+ Add pair' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByText('Base asset')).toBeNull();
    });

    it('Add pair button is disabled when fields are incomplete', () => {
        render(<AssetPairEditor pairs={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: '+ Add pair' }));
        const addBtn = screen.getByRole('button', { name: 'Add pair' }) as HTMLButtonElement;
        expect(addBtn.disabled).toBe(true);
    });

    it('shows error message when error prop provided', () => {
        render(<AssetPairEditor pairs={[]} onAdd={vi.fn()} onRemove={vi.fn()} error="At least one pair required" />);
        expect(screen.getByRole('alert')).toBeDefined();
        expect(screen.getByText('At least one pair required')).toBeDefined();
    });
});

// ── ContractAddressInputs ─────────────────────────────────────────────────────

describe('ContractAddressInputs', () => {
    it('renders empty state message when no contracts', () => {
        render(<ContractAddressInputs contracts={{}} onSet={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.getByText('No contract addresses configured.')).toBeDefined();
    });

    it('renders existing contracts', () => {
        render(
            <ContractAddressInputs
                contracts={{ amm_pool: VALID_CONTRACT }}
                onSet={vi.fn()}
                onRemove={vi.fn()}
            />,
        );
        expect(screen.getByText('amm_pool')).toBeDefined();
        expect(screen.getByText(VALID_CONTRACT)).toBeDefined();
    });

    it('calls onRemove when remove button clicked', () => {
        const onRemove = vi.fn();
        render(
            <ContractAddressInputs
                contracts={{ amm_pool: VALID_CONTRACT }}
                onSet={vi.fn()}
                onRemove={onRemove}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Remove contract amm_pool/i }));
        expect(onRemove).toHaveBeenCalledWith('amm_pool');
    });

    it('opens add form when Add contract button clicked', () => {
        render(<ContractAddressInputs contracts={{}} onSet={vi.fn()} onRemove={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: '+ Add contract' }));
        expect(screen.getByLabelText('Contract name')).toBeDefined();
        expect(screen.getByLabelText('Contract address')).toBeDefined();
    });

    it('shows validation error for invalid contract address', () => {
        render(<ContractAddressInputs contracts={{}} onSet={vi.fn()} onRemove={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: '+ Add contract' }));
        fireEvent.change(screen.getByLabelText('Contract name'), { target: { value: 'pool' } });
        fireEvent.change(screen.getByLabelText('Contract address'), { target: { value: 'INVALID' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add contract' }));
        expect(screen.getByRole('alert')).toBeDefined();
    });

    it('calls onSet with valid name and address', () => {
        const onSet = vi.fn();
        render(<ContractAddressInputs contracts={{}} onSet={onSet} onRemove={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: '+ Add contract' }));
        fireEvent.change(screen.getByLabelText('Contract name'), { target: { value: 'pool' } });
        fireEvent.change(screen.getByLabelText('Contract address'), { target: { value: VALID_CONTRACT } });
        fireEvent.click(screen.getByRole('button', { name: 'Add contract' }));
        expect(onSet).toHaveBeenCalledWith('pool', VALID_CONTRACT);
    });

    it('shows field-level error from errors map', () => {
        const errors = new Map([['stellar.contractAddresses.amm_pool', 'Invalid address']]);
        render(
            <ContractAddressInputs
                contracts={{ amm_pool: 'BADADDR' }}
                onSet={vi.fn()}
                onRemove={vi.fn()}
                errors={errors}
            />,
        );
        expect(screen.getByText('Invalid address')).toBeDefined();
    });

    it('shows error when duplicate contract name added', () => {
        render(
            <ContractAddressInputs
                contracts={{ pool: VALID_CONTRACT }}
                onSet={vi.fn()}
                onRemove={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: '+ Add contract' }));
        fireEvent.change(screen.getByLabelText('Contract name'), { target: { value: 'pool' } });
        fireEvent.change(screen.getByLabelText('Contract address'), { target: { value: VALID_CONTRACT } });
        fireEvent.click(screen.getByRole('button', { name: 'Add contract' }));
        expect(screen.getByRole('alert')).toBeDefined();
        expect(screen.getByText(/already exists/i)).toBeDefined();
    });
});

// ── SorobanRpcInput ───────────────────────────────────────────────────────────

describe('SorobanRpcInput', () => {
    it('renders label and input', () => {
        render(
            <SorobanRpcInput
                value=""
                onChange={vi.fn()}
                onCheckConnectivity={vi.fn()}
                connectivityStatus="idle"
                connectivityResult={null}
            />,
        );
        expect(screen.getByLabelText(/Soroban RPC URL/i)).toBeDefined();
    });

    it('calls onChange when input changes', () => {
        const onChange = vi.fn();
        render(
            <SorobanRpcInput
                value=""
                onChange={onChange}
                onCheckConnectivity={vi.fn()}
                connectivityStatus="idle"
                connectivityResult={null}
            />,
        );
        fireEvent.change(screen.getByLabelText(/Soroban RPC URL/i), {
            target: { value: 'https://soroban-testnet.stellar.org' },
        });
        expect(onChange).toHaveBeenCalledWith('https://soroban-testnet.stellar.org');
    });

    it('disables Check button when value is empty', () => {
        render(
            <SorobanRpcInput
                value=""
                onChange={vi.fn()}
                onCheckConnectivity={vi.fn()}
                connectivityStatus="idle"
                connectivityResult={null}
            />,
        );
        const btn = screen.getByRole('button', { name: /Check Soroban RPC connectivity/i }) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('calls onCheckConnectivity when Check button clicked', () => {
        const onCheck = vi.fn();
        render(
            <SorobanRpcInput
                value="https://soroban-testnet.stellar.org"
                onChange={vi.fn()}
                onCheckConnectivity={onCheck}
                connectivityStatus="idle"
                connectivityResult={null}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Check Soroban RPC connectivity/i }));
        expect(onCheck).toHaveBeenCalledOnce();
    });

    it('shows reachable status with response time', () => {
        render(
            <SorobanRpcInput
                value="https://soroban-testnet.stellar.org"
                onChange={vi.fn()}
                onCheckConnectivity={vi.fn()}
                connectivityStatus="ok"
                connectivityResult={{ reachable: true, endpoint: 'https://soroban-testnet.stellar.org', responseTime: 123 }}
            />,
        );
        expect(screen.getByText(/Reachable.*123ms/)).toBeDefined();
    });

    it('shows error status message', () => {
        render(
            <SorobanRpcInput
                value="https://bad-url.example.com"
                onChange={vi.fn()}
                onCheckConnectivity={vi.fn()}
                connectivityStatus="error"
                connectivityResult={{ reachable: false, endpoint: 'https://bad-url.example.com', error: 'Timeout after 5000ms' }}
            />,
        );
        expect(screen.getByText('Timeout after 5000ms')).toBeDefined();
    });

    it('shows validation error', () => {
        render(
            <SorobanRpcInput
                value="not-a-url"
                onChange={vi.fn()}
                onCheckConnectivity={vi.fn()}
                connectivityStatus="idle"
                connectivityResult={null}
                error="Soroban RPC URL must be a valid http/https URL"
            />,
        );
        expect(screen.getByRole('alert')).toBeDefined();
        expect(screen.getByText('Soroban RPC URL must be a valid http/https URL')).toBeDefined();
    });
});

// ── StellarConfigPanel ────────────────────────────────────────────────────────

describe('StellarConfigPanel', () => {
    it('renders all sections', () => {
        render(<StellarConfigPanel form={createMockForm()} onSubmit={vi.fn()} />);
        // Section headings may share text with child component labels
        expect(screen.getAllByText('Network').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Endpoints')).toBeDefined();
        expect(screen.getAllByText('Asset Pairs').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Smart Contracts')).toBeDefined();
    });

    it('disables submit and reset when not dirty', () => {
        render(<StellarConfigPanel form={createMockForm()} onSubmit={vi.fn()} />);
        const submit = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
        const reset = screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement;
        expect(submit.disabled).toBe(true);
        expect(reset.disabled).toBe(true);
    });

    it('enables submit and reset when dirty', () => {
        render(<StellarConfigPanel form={createMockForm({ isDirty: true })} onSubmit={vi.fn()} />);
        const submit = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
        expect(submit.disabled).toBe(false);
    });

    it('calls validate then onSubmit when form submitted with no errors', () => {
        const onSubmit = vi.fn();
        const validate = vi.fn(() => []);
        render(
            <StellarConfigPanel
                form={createMockForm({ isDirty: true, validate })}
                onSubmit={onSubmit}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        expect(validate).toHaveBeenCalledOnce();
        expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('does not call onSubmit when validation fails', () => {
        const onSubmit = vi.fn();
        const validate = vi.fn(() => [
            { field: 'stellar.horizonUrl', message: 'Invalid URL', code: 'INVALID_URL' },
        ]);
        render(
            <StellarConfigPanel
                form={createMockForm({ isDirty: true, validate })}
                onSubmit={onSubmit}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('calls reset when Reset button clicked', () => {
        const reset = vi.fn();
        render(
            <StellarConfigPanel
                form={createMockForm({ isDirty: true, reset })}
                onSubmit={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(reset).toHaveBeenCalledOnce();
    });

    it('shows custom submit label', () => {
        render(
            <StellarConfigPanel
                form={createMockForm({ isDirty: true })}
                onSubmit={vi.fn()}
                submitLabel="Deploy"
            />,
        );
        expect(screen.getByRole('button', { name: 'Deploy' })).toBeDefined();
    });

    it('shows submitting state', () => {
        render(
            <StellarConfigPanel
                form={createMockForm({ isDirty: true })}
                onSubmit={vi.fn()}
                isSubmitting
            />,
        );
        expect(screen.getByRole('button', { name: 'Saving…' })).toBeDefined();
    });
});

// ── useStellarConfigForm ──────────────────────────────────────────────────────

describe('useStellarConfigForm', () => {
    it('initializes with given state', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        expect(result.current.state).toEqual(INITIAL_STATE);
        expect(result.current.isDirty).toBe(false);
        expect(result.current.errors.size).toBe(0);
    });

    it('tracks dirty state when network changes', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        act(() => result.current.setStellar('network', 'mainnet'));
        expect(result.current.isDirty).toBe(true);
    });

    it('auto-updates horizonUrl when network changes from default', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        act(() => result.current.setStellar('network', 'mainnet'));
        expect(result.current.state.stellar.horizonUrl).toBe('https://horizon.stellar.org');
    });

    it('does not auto-update horizonUrl when it was customized', () => {
        const custom: StellarConfigFormState = {
            stellar: { ...INITIAL_STATE.stellar, horizonUrl: 'https://custom.horizon.example.com' },
        };
        const { result } = renderHook(() => useStellarConfigForm(custom));
        act(() => result.current.setStellar('network', 'mainnet'));
        expect(result.current.state.stellar.horizonUrl).toBe('https://custom.horizon.example.com');
    });

    it('resets connectivity status when horizonUrl changes', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        act(() => result.current.setStellar('horizonUrl', 'https://new.horizon.example.com'));
        expect(result.current.connectivityStatus).toBe('idle');
        expect(result.current.connectivityResult).toBeNull();
    });

    it('resets soroban connectivity status when sorobanRpcUrl changes', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        act(() => result.current.setStellar('sorobanRpcUrl', 'https://new.soroban.example.com'));
        expect(result.current.sorobanConnectivityStatus).toBe('idle');
        expect(result.current.sorobanConnectivityResult).toBeNull();
    });

    it('adds and removes asset pairs', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        act(() => result.current.addAssetPair(XLM_PAIR));
        expect(result.current.state.stellar.assetPairs).toHaveLength(1);
        act(() => result.current.removeAssetPair(0));
        expect(result.current.state.stellar.assetPairs).toHaveLength(0);
    });

    it('sets and removes contract addresses', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        act(() => result.current.setContractAddress('pool', VALID_CONTRACT));
        expect(result.current.state.stellar.contractAddresses?.pool).toBe(VALID_CONTRACT);
        act(() => result.current.removeContractAddress('pool'));
        expect(result.current.state.stellar.contractAddresses?.pool).toBeUndefined();
    });

    it('validates invalid horizonUrl', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        act(() => result.current.setStellar('horizonUrl', 'not-a-url'));
        let errors: any[];
        act(() => { errors = result.current.validate(); });
        expect(errors!.some((e) => e.field === 'stellar.horizonUrl')).toBe(true);
    });

    it('validates network/horizon mismatch', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        act(() => {
            result.current.setStellar('network', 'mainnet');
            result.current.setStellar('horizonUrl', 'https://horizon-testnet.stellar.org');
        });
        let errors: any[];
        act(() => { errors = result.current.validate(); });
        expect(errors!.some((e) => e.code === 'HORIZON_NETWORK_MISMATCH')).toBe(true);
    });

    it('validates invalid sorobanRpcUrl', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        act(() => result.current.setStellar('sorobanRpcUrl', 'not-a-url'));
        let errors: any[];
        act(() => { errors = result.current.validate(); });
        expect(errors!.some((e) => e.field === 'stellar.sorobanRpcUrl')).toBe(true);
    });

    it('returns no errors for valid state', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        let errors: any[];
        act(() => { errors = result.current.validate(); });
        expect(errors!).toEqual([]);
    });

    it('resets to initial state', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        act(() => result.current.setStellar('network', 'mainnet'));
        act(() => result.current.reset());
        expect(result.current.state).toEqual(INITIAL_STATE);
        expect(result.current.isDirty).toBe(false);
        expect(result.current.errors.size).toBe(0);
    });

    it('clears field error when that field changes', () => {
        const { result } = renderHook(() => useStellarConfigForm(INITIAL_STATE));
        act(() => result.current.setStellar('horizonUrl', 'bad'));
        act(() => { result.current.validate(); });
        expect(result.current.errors.has('stellar.horizonUrl')).toBe(true);
        act(() => result.current.setStellar('horizonUrl', 'https://horizon-testnet.stellar.org'));
        expect(result.current.errors.has('stellar.horizonUrl')).toBe(false);
    });
});
