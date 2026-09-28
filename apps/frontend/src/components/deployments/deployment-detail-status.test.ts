/**
 * Runtime exhaustiveness and value-lock coverage for the deployment detail
 * status presentation map (issue #1334).
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import type { DeploymentDetailStatus } from '@/types/deployment';
import {
  getDeploymentDetailStatusPresentation,
  type DeploymentDetailStatusPresentation,
} from './deployment-detail-status';
import { DeploymentDetailStatusBadge } from './DeploymentDetailStatusBadge';

// Keyed by status so TypeScript fails compilation if a DeploymentDetailStatus
// is added without being listed here.
const ALL_STATUSES_MAP: Record<DeploymentDetailStatus, true> = {
  pending: true,
  generating: true,
  creating_repo: true,
  pushing_code: true,
  deploying: true,
  completed: true,
  failed: true,
};
const ALL_STATUSES = Object.keys(ALL_STATUSES_MAP) as DeploymentDetailStatus[];

const CLASS_FIELDS = ['dotClass', 'bgClass', 'textClass', 'trackClass', 'fillClass'] as const;

const TAILWIND_CLASS_PATTERN: Record<(typeof CLASS_FIELDS)[number], RegExp> = {
  dotClass: /^bg-[a-z]+-\d{2,3}$/,
  bgClass: /^bg-[a-z]+-\d{2,3}$/,
  textClass: /^text-[a-z]+-\d{2,3}$/,
  trackClass: /^bg-[a-z]+-\d{2,3}$/,
  fillClass: /^bg-[a-z]+-\d{2,3}$/,
};

describe('deployment detail status presentation map', () => {
  it.each(ALL_STATUSES)('has a complete presentation entry for "%s"', (status) => {
    const presentation = getDeploymentDetailStatusPresentation(status);

    expect(presentation).toBeDefined();
    expect(presentation.label.trim()).not.toBe('');
    expect(presentation.description.trim()).not.toBe('');
    // Descriptions are shown as a tooltip sentence.
    expect(presentation.description).toMatch(/\.$/);

    for (const field of CLASS_FIELDS) {
      expect(presentation[field], `${status}.${field}`).toMatch(TAILWIND_CLASS_PATTERN[field]);
    }
  });

  it('uses a single colour family per status', () => {
    for (const status of ALL_STATUSES) {
      const presentation = getDeploymentDetailStatusPresentation(status);
      const families = new Set(
        CLASS_FIELDS.map((field) => presentation[field].split('-')[1]),
      );
      expect(families.size, `${status} mixes colour families`).toBe(1);
    }
  });

  it('gives every status a distinct label', () => {
    const labels = ALL_STATUSES.map((s) => getDeploymentDetailStatusPresentation(s).label);
    expect(new Set(labels).size).toBe(ALL_STATUSES.length);
  });

  it('locks the current presentation values', () => {
    // Deliberately explicit: any edit to the map must be reflected here and
    // reviewed alongside it.
    const expected: Record<DeploymentDetailStatus, DeploymentDetailStatusPresentation> = {
      pending: {
        label: 'Pending',
        description: 'Deployment is queued and waiting to start.',
        dotClass: 'bg-amber-500',
        bgClass: 'bg-amber-50',
        textClass: 'text-amber-700',
        trackClass: 'bg-amber-100',
        fillClass: 'bg-amber-500',
      },
      generating: {
        label: 'Generating',
        description: 'Generating deployment configuration.',
        dotClass: 'bg-blue-500',
        bgClass: 'bg-blue-50',
        textClass: 'text-blue-700',
        trackClass: 'bg-blue-100',
        fillClass: 'bg-blue-500',
      },
      creating_repo: {
        label: 'Creating Repository',
        description: 'Creating a repository for generated code.',
        dotClass: 'bg-indigo-500',
        bgClass: 'bg-indigo-50',
        textClass: 'text-indigo-700',
        trackClass: 'bg-indigo-100',
        fillClass: 'bg-indigo-500',
      },
      pushing_code: {
        label: 'Pushing Code',
        description: 'Uploading files and commit history.',
        dotClass: 'bg-cyan-500',
        bgClass: 'bg-cyan-50',
        textClass: 'text-cyan-700',
        trackClass: 'bg-cyan-100',
        fillClass: 'bg-cyan-500',
      },
      deploying: {
        label: 'Deploying',
        description: 'Publishing the project to hosting infrastructure.',
        dotClass: 'bg-violet-500',
        bgClass: 'bg-violet-50',
        textClass: 'text-violet-700',
        trackClass: 'bg-violet-100',
        fillClass: 'bg-violet-500',
      },
      completed: {
        label: 'Completed',
        description: 'Deployment completed successfully.',
        dotClass: 'bg-green-500',
        bgClass: 'bg-green-50',
        textClass: 'text-green-700',
        trackClass: 'bg-green-100',
        fillClass: 'bg-green-500',
      },
      failed: {
        label: 'Failed',
        description: 'Deployment failed and needs attention.',
        dotClass: 'bg-red-500',
        bgClass: 'bg-red-50',
        textClass: 'text-red-700',
        trackClass: 'bg-red-100',
        fillClass: 'bg-red-500',
      },
    };

    const actual = Object.fromEntries(
      ALL_STATUSES.map((s) => [s, getDeploymentDetailStatusPresentation(s)]),
    );
    expect(actual).toEqual(expected);
  });
});

describe('DeploymentDetailStatusBadge consuming the presentation map', () => {
  it('renders the map classes, label and description end-to-end for "failed"', () => {
    const presentation = getDeploymentDetailStatusPresentation('failed');
    const { container } = render(createElement(DeploymentDetailStatusBadge, { status: 'failed' }));

    const badge = container.firstElementChild as HTMLElement;
    expect(badge.classList.contains(presentation.bgClass)).toBe(true);
    expect(badge.classList.contains(presentation.textClass)).toBe(true);
    expect(badge.getAttribute('title')).toBe(presentation.description);
    expect(badge.textContent).toBe(presentation.label);

    const dot = badge.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(dot.classList.contains(presentation.dotClass)).toBe(true);
    expect(dot.classList.contains('animate-pulse')).toBe(false);
  });
});
