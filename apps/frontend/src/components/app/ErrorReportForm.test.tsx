import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ErrorReportForm, MAX_DESCRIPTION_LENGTH } from './ErrorReportForm';

const ERROR_CONTEXT = { status: 500, message: 'Internal Server Error' };

describe('ErrorReportForm', () => {
    it('renders the form with title and textarea', () => {
        render(<ErrorReportForm errorContext={ERROR_CONTEXT} onClose={vi.fn()} />);
        expect(screen.getByRole('dialog')).toBeDefined();
        expect(screen.getByLabelText('What were you doing?')).toBeDefined();
    });

    it('shows correlation ID when provided', () => {
        render(
            <ErrorReportForm
                errorContext={ERROR_CONTEXT}
                correlationId="ERR_001"
                onClose={vi.fn()}
            />
        );
        expect(screen.getByText(/ERR_001/)).toBeDefined();
    });

    it('calls onClose when Cancel is clicked', () => {
        const onClose = vi.fn();
        render(<ErrorReportForm errorContext={ERROR_CONTEXT} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when close (✕) button is clicked', () => {
        const onClose = vi.fn();
        render(<ErrorReportForm errorContext={ERROR_CONTEXT} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('submit button is disabled when description is empty', () => {
        render(<ErrorReportForm errorContext={ERROR_CONTEXT} onClose={vi.fn()} />);
        const btn = screen.getByRole('button', { name: 'Submit report' }) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('enables submit button when description is filled', () => {
        render(<ErrorReportForm errorContext={ERROR_CONTEXT} onClose={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('What were you doing?'), {
            target: { value: 'I clicked deploy' },
        });
        const btn = screen.getByRole('button', { name: 'Submit report' }) as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it('calls onSubmit with correct payload on submit', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(
            <ErrorReportForm
                errorContext={ERROR_CONTEXT}
                correlationId="ERR_001"
                onClose={vi.fn()}
                onSubmit={onSubmit}
            />
        );

        fireEvent.change(screen.getByLabelText('What were you doing?'), {
            target: { value: 'I clicked deploy' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledWith({
                correlationId: 'ERR_001',
                description: 'I clicked deploy',
                errorContext: ERROR_CONTEXT,
            });
        });
    });

    it('shows success state after successful submission', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(
            <ErrorReportForm errorContext={ERROR_CONTEXT} onClose={vi.fn()} onSubmit={onSubmit} />
        );

        fireEvent.change(screen.getByLabelText('What were you doing?'), {
            target: { value: 'I clicked deploy' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

        await waitFor(() => {
            expect(screen.getByText('Report submitted')).toBeDefined();
        });
    });

    it('shows error message when submission fails', async () => {
        const onSubmit = vi.fn().mockRejectedValue(new Error('Network error'));
        render(
            <ErrorReportForm errorContext={ERROR_CONTEXT} onClose={vi.fn()} onSubmit={onSubmit} />
        );

        fireEvent.change(screen.getByLabelText('What were you doing?'), {
            target: { value: 'I clicked deploy' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeDefined();
            expect(screen.getByText('Network error')).toBeDefined();
        });
    });

    it('trims whitespace-only descriptions before submit', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(
            <ErrorReportForm errorContext={ERROR_CONTEXT} onClose={vi.fn()} onSubmit={onSubmit} />
        );

        fireEvent.change(screen.getByLabelText('What were you doing?'), {
            target: { value: '   ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

        // onSubmit should not be called for whitespace-only input
        await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
    });

    it('calls onClose from success state Done button', async () => {
        const onClose = vi.fn();
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(
            <ErrorReportForm errorContext={ERROR_CONTEXT} onClose={onClose} onSubmit={onSubmit} />
        );

        fireEvent.change(screen.getByLabelText('What were you doing?'), {
            target: { value: 'I clicked deploy' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

        await waitFor(() => screen.getByText('Report submitted'));
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    describe('description length cap', () => {
        it('shows a live character counter', () => {
            render(<ErrorReportForm errorContext={ERROR_CONTEXT} onClose={vi.fn()} />);
            expect(screen.getByTestId('error-description-counter').textContent).toBe(
                `0 / ${MAX_DESCRIPTION_LENGTH}`
            );

            fireEvent.change(screen.getByLabelText('What were you doing?'), {
                target: { value: 'hello' },
            });
            expect(screen.getByTestId('error-description-counter').textContent).toBe(
                `5 / ${MAX_DESCRIPTION_LENGTH}`
            );
        });

        it('allows submission at exactly the limit', async () => {
            const onSubmit = vi.fn().mockResolvedValue(undefined);
            render(
                <ErrorReportForm errorContext={ERROR_CONTEXT} onClose={vi.fn()} onSubmit={onSubmit} />
            );
            const atLimit = 'a'.repeat(MAX_DESCRIPTION_LENGTH);

            fireEvent.change(screen.getByLabelText('What were you doing?'), {
                target: { value: atLimit },
            });

            expect(screen.getByTestId('error-description-counter').textContent).toBe(
                `${MAX_DESCRIPTION_LENGTH} / ${MAX_DESCRIPTION_LENGTH}`
            );
            expect(screen.queryByTestId('error-description-limit')).toBeNull();
            const btn = screen.getByRole('button', { name: 'Submit report' }) as HTMLButtonElement;
            expect(btn.disabled).toBe(false);

            fireEvent.click(btn);
            await waitFor(() =>
                expect(onSubmit).toHaveBeenCalledWith(
                    expect.objectContaining({ description: atLimit })
                )
            );
        });

        it('blocks submission and shows an inline warning past the limit', async () => {
            const onSubmit = vi.fn().mockResolvedValue(undefined);
            render(
                <ErrorReportForm errorContext={ERROR_CONTEXT} onClose={vi.fn()} onSubmit={onSubmit} />
            );
            const textarea = screen.getByLabelText('What were you doing?');

            fireEvent.change(textarea, {
                target: { value: 'a'.repeat(MAX_DESCRIPTION_LENGTH + 5) },
            });

            expect(screen.getByTestId('error-description-counter').textContent).toBe(
                `${MAX_DESCRIPTION_LENGTH + 5} / ${MAX_DESCRIPTION_LENGTH}`
            );
            expect(screen.getByTestId('error-description-limit').textContent).toContain(
                '5 characters over'
            );
            expect(textarea.getAttribute('aria-invalid')).toBe('true');

            const btn = screen.getByRole('button', { name: 'Submit report' }) as HTMLButtonElement;
            expect(btn.disabled).toBe(true);

            fireEvent.submit(btn.closest('form')!);
            await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
        });
    });
});
