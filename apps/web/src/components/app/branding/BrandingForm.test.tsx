import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrandingForm } from './BrandingForm';
import type { BrandingFormReturn, BrandingFormState } from './useBrandingForm';

const INITIAL_STATE: BrandingFormState = {
    branding: {
        appName: 'My App',
        primaryColor: '#000519',
        secondaryColor: '#545f73',
        fontFamily: 'Inter',
    },
    features: {
        enableCharts: true,
        enableTransactionHistory: false,
        enableAnalytics: false,
        enableNotifications: false,
    },
};

function createMockForm(overrides: Partial<BrandingFormReturn> = {}): BrandingFormReturn {
    return {
        state: INITIAL_STATE,
        errors: new Map(),
        isDirty: false,
        setBranding: vi.fn(),
        setFeatures: vi.fn(),
        validate: vi.fn(() => []),
        reset: vi.fn(),
        ...overrides,
    };
}

describe('BrandingForm', () => {
    it('renders branding and features sections', () => {
        render(<BrandingForm form={createMockForm()} onSubmit={vi.fn()} />);
        expect(screen.getByText('Branding')).toBeDefined();
        expect(screen.getByText('Features')).toBeDefined();
    });

    it('renders app name, color, and font inputs', () => {
        render(<BrandingForm form={createMockForm()} onSubmit={vi.fn()} />);
        expect(screen.getByLabelText('App name')).toBeDefined();
        expect(screen.getByLabelText('Primary color')).toBeDefined();
        expect(screen.getByLabelText('Secondary color')).toBeDefined();
        expect(screen.getByLabelText('Font family')).toBeDefined();
    });

    it('renders feature toggles', () => {
        render(<BrandingForm form={createMockForm()} onSubmit={vi.fn()} />);
        expect(screen.getByText('Charts')).toBeDefined();
        expect(screen.getByText('Transaction history')).toBeDefined();
        expect(screen.getByText('Analytics')).toBeDefined();
        expect(screen.getByText('Notifications')).toBeDefined();
    });

    it('disables submit and reset when not dirty', () => {
        render(<BrandingForm form={createMockForm()} onSubmit={vi.fn()} />);
        const submit = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
        const reset = screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement;
        expect(submit.disabled).toBe(true);
        expect(reset.disabled).toBe(true);
    });

    it('enables submit and reset when dirty', () => {
        render(
            <BrandingForm form={createMockForm({ isDirty: true })} onSubmit={vi.fn()} />,
        );
        const submit = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
        const reset = screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement;
        expect(submit.disabled).toBe(false);
        expect(reset.disabled).toBe(false);
    });

    it('calls validate then onSubmit when form is submitted with no errors', () => {
        const onSubmit = vi.fn();
        const validate = vi.fn(() => []);
        render(
            <BrandingForm
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
            { field: 'branding.appName', message: 'Required', code: 'TOO_SMALL' },
        ]);
        render(
            <BrandingForm
                form={createMockForm({ isDirty: true, validate })}
                onSubmit={onSubmit}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        expect(validate).toHaveBeenCalledOnce();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('calls reset when Reset button is clicked', () => {
        const reset = vi.fn();
        render(
            <BrandingForm
                form={createMockForm({ isDirty: true, reset })}
                onSubmit={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(reset).toHaveBeenCalledOnce();
    });

    it('shows custom submit label', () => {
        render(
            <BrandingForm
                form={createMockForm({ isDirty: true })}
                onSubmit={vi.fn()}
                submitLabel="Deploy now"
            />,
        );
        expect(screen.getByRole('button', { name: 'Deploy now' })).toBeDefined();
    });

    it('shows submitting state', () => {
        render(
            <BrandingForm
                form={createMockForm({ isDirty: true })}
                onSubmit={vi.fn()}
                isSubmitting
            />,
        );
        expect(screen.getByRole('button', { name: 'Saving…' })).toBeDefined();
    });

    it('displays validation errors on inputs', () => {
        const errors = new Map([['branding.appName', 'App name is required']]);
        render(
            <BrandingForm form={createMockForm({ errors })} onSubmit={vi.fn()} />,
        );
        expect(screen.getByText('App name is required')).toBeDefined();
        expect(screen.getByLabelText('App name').getAttribute('aria-invalid')).toBe('true');
    });

    it('renders feature toggles with correct aria-checked state', () => {
        render(<BrandingForm form={createMockForm()} onSubmit={vi.fn()} />);
        const chartsToggle = screen.getByRole('switch', { name: /Charts/ });
        expect(chartsToggle.getAttribute('aria-checked')).toBe('true');
        const analyticsToggle = screen.getByRole('switch', { name: /Analytics/ });
        expect(analyticsToggle.getAttribute('aria-checked')).toBe('false');
    });
});
