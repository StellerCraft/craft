'use client';

import React from 'react';
import { AppNameInput } from './AppNameInput';
import { ColorInput } from './ColorInput';
import { FontSelector } from './FontSelector';
import { FeatureToggles } from './FeatureToggles';
import type { BrandingFormReturn } from './useBrandingForm';

interface BrandingFormProps {
    form: BrandingFormReturn;
    onSubmit: () => void;
    submitLabel?: string;
    isSubmitting?: boolean;
}

export function BrandingForm({
    form,
    onSubmit,
    submitLabel = 'Save changes',
    isSubmitting = false,
}: BrandingFormProps) {
    const { state, errors, isDirty, setBranding, setFeatures, validate, reset } = form;

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const validationErrors = validate();
        if (validationErrors.length === 0) {
            onSubmit();
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-8" noValidate>
            <BrandingSection title="Branding">
                <AppNameInput
                    value={state.branding.appName}
                    onChange={(v) => setBranding('appName', v)}
                    error={errors.get('branding.appName')}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <ColorInput
                        id="branding-primary-color"
                        label="Primary color"
                        value={state.branding.primaryColor}
                        onChange={(v) => setBranding('primaryColor', v)}
                        error={errors.get('branding.primaryColor')}
                    />
                    <ColorInput
                        id="branding-secondary-color"
                        label="Secondary color"
                        value={state.branding.secondaryColor}
                        onChange={(v) => setBranding('secondaryColor', v)}
                        error={errors.get('branding.secondaryColor')}
                    />
                </div>
                <FontSelector
                    value={state.branding.fontFamily}
                    onChange={(v) => setBranding('fontFamily', v)}
                    error={errors.get('branding.fontFamily')}
                />
            </BrandingSection>

            <BrandingSection title="Features">
                <FeatureToggles value={state.features} onChange={setFeatures} />
            </BrandingSection>

            <div className="flex gap-3 justify-end border-t border-outline-variant/20 pt-6">
                <button
                    type="button"
                    onClick={reset}
                    disabled={!isDirty || isSubmitting}
                    className="px-4 py-2.5 rounded-lg text-sm font-semibold text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container-low transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Reset
                </button>
                <button
                    type="submit"
                    disabled={!isDirty || isSubmitting}
                    className="primary-gradient text-on-primary px-5 py-2.5 rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                    {isSubmitting ? 'Saving…' : submitLabel}
                </button>
            </div>
        </form>
    );
}

function BrandingSection({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="flex flex-col gap-5">
            <h3 className="text-lg font-bold font-headline text-on-surface">
                {title}
            </h3>
            <div className="flex flex-col gap-4">{children}</div>
        </section>
    );
}
