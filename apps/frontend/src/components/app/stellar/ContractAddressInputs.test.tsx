import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContractAddressInputs } from './ContractAddressInputs';
import { validateContractAddress } from '@/lib/stellar/contract-validation';

const VALID_ADDRESS =
  'CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7FFWVGNQST';

function openAddForm(): void {
  fireEvent.click(screen.getByRole('button', { name: '+ Add contract' }));
}

describe('ContractAddressInputs', () => {
  it('shows the required-name error when an address is entered without a name', () => {
    render(
      <ContractAddressInputs
        contracts={{}}
        onSet={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    openAddForm();
    fireEvent.change(screen.getByLabelText('Contract address'), {
      target: { value: VALID_ADDRESS },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add contract' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Contract name is required',
    );
  });

  it('rejects a duplicate contract name with its specific error', () => {
    render(
      <ContractAddressInputs
        contracts={{ liquidityPool: VALID_ADDRESS }}
        onSet={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    openAddForm();
    fireEvent.change(screen.getByLabelText('Contract name'), {
      target: { value: 'liquidityPool' },
    });
    fireEvent.change(screen.getByLabelText('Contract address'), {
      target: { value: VALID_ADDRESS },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add contract' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A contract named "liquidityPool" already exists',
    );
  });

  it('shows the address validator reason for an invalid address', () => {
    const invalidAddress = 'not-an-address';
    const validation = validateContractAddress(invalidAddress);
    if (validation.valid) {
      throw new Error('Expected an invalid address fixture');
    }

    render(
      <ContractAddressInputs
        contracts={{}}
        onSet={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    openAddForm();
    fireEvent.change(screen.getByLabelText('Contract name'), {
      target: { value: 'liquidityPool' },
    });
    fireEvent.change(screen.getByLabelText('Contract address'), {
      target: { value: invalidAddress },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add contract' }));

    expect(screen.getByRole('alert')).toHaveTextContent(validation.reason);
  });

  it('adds a contract, clears the form, and removes entries by name', () => {
    const onSet = vi.fn();
    const onRemove = vi.fn();
    const { rerender } = render(
      <ContractAddressInputs
        contracts={{}}
        onSet={onSet}
        onRemove={onRemove}
      />,
    );
    openAddForm();
    fireEvent.change(screen.getByLabelText('Contract name'), {
      target: { value: 'liquidityPool' },
    });
    fireEvent.change(screen.getByLabelText('Contract address'), {
      target: { value: VALID_ADDRESS },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add contract' }));

    expect(onSet).toHaveBeenCalledWith('liquidityPool', VALID_ADDRESS);
    openAddForm();
    expect(screen.getByLabelText('Contract name')).toHaveValue('');
    expect(screen.getByLabelText('Contract address')).toHaveValue('');

    rerender(
      <ContractAddressInputs
        contracts={{ liquidityPool: VALID_ADDRESS }}
        onSet={onSet}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove contract liquidityPool' }),
    );

    expect(onRemove).toHaveBeenCalledWith('liquidityPool');
  });
});
