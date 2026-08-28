import { describe, it, expect } from 'vitest';
import {
  GitHubWorkflowValidator,
  workflowValidator,
  WorkflowValidationResult,
} from './github-workflow-validator.service';

const VALID_WORKFLOW_YAML = `
name: CI/CD Pipeline
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: npm run build

  test:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - name: Run Tests
        run: npm test

  deploy:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        run: npm run deploy
`;

const VALID_WORKFLOW_WITH_EXTRA_JOBS_AND_MIXED_CASE = `
name: Enterprise Build & Release
on:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint
  BUILD:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
  Test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  DEPLOY:
    runs-on: ubuntu-latest
    steps:
      - run: npm run deploy
  notify:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deployment complete"
`;

const WORKFLOW_WITH_TABS = `name: Tab Indented Workflow
jobs:
\tbuild:
\t\truns-on: ubuntu-latest
`;

const WORKFLOW_NO_JOBS_KEY = `
name: Workflow Without Jobs
on: [push]
# Missing jobs definition
`;

const WORKFLOW_EMPTY_JOBS = `
name: Empty Jobs
on: [push]
jobs:
# No jobs indented below
env:
  NODE_ENV: production
`;

const WORKFLOW_MISSING_DEPLOY = `
name: Build and Test Only
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
  test:
    runs-on: ubuntu-latest
`;

const WORKFLOW_MISSING_TEST = `
name: Build and Deploy Only
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
  deploy:
    runs-on: ubuntu-latest
`;

const WORKFLOW_MISSING_BUILD = `
name: Test and Deploy Only
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
  deploy:
    runs-on: ubuntu-latest
`;

const WORKFLOW_MISSING_ALL_REQUIRED_STEPS = `
name: Lint Only
on: [push]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint
  audit:
    runs-on: ubuntu-latest
    steps:
      - run: npm audit
`;

describe('GitHubWorkflowValidator', () => {
  const validator = new GitHubWorkflowValidator();

  describe('valid workflows', () => {
    it('validates a complete standard workflow containing build, test, and deploy jobs', () => {
      const result: WorkflowValidationResult = validator.validate(VALID_WORKFLOW_YAML);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts job names case-insensitively with additional workflow jobs', () => {
      const result = validator.validate(VALID_WORKFLOW_WITH_EXTRA_JOBS_AND_MIXED_CASE);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('empty and whitespace inputs', () => {
    it('returns EMPTY_CONTENT error for an empty string', () => {
      const result = validator.validate('');

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        {
          code: 'EMPTY_CONTENT',
          message: 'Workflow YAML is empty',
        },
      ]);
    });

    it('returns EMPTY_CONTENT error for whitespace-only strings', () => {
      const result = validator.validate('   \n\t  \n   ');

      // Whitespace with tabs is checked for empty first after trimming
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        {
          code: 'EMPTY_CONTENT',
          message: 'Workflow YAML is empty',
        },
      ]);
    });
  });

  describe('malformed YAML syntax and structural errors', () => {
    it('returns INVALID_YAML error with clear message when tab indentation is used', () => {
      const result = validator.validate(WORKFLOW_WITH_TABS);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        {
          code: 'INVALID_YAML',
          message: 'YAML syntax error: tab indentation not allowed',
        },
      ]);
    });

    it('returns INVALID_YAML error when no jobs section exists', () => {
      const result = validator.validate(WORKFLOW_NO_JOBS_KEY);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        {
          code: 'INVALID_YAML',
          message: 'Workflow YAML is invalid or has no jobs defined',
        },
      ]);
    });

    it('returns INVALID_YAML error when jobs section is empty', () => {
      const result = validator.validate(WORKFLOW_EMPTY_JOBS);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        {
          code: 'INVALID_YAML',
          message: 'Workflow YAML is invalid or has no jobs defined',
        },
      ]);
    });
  });

  describe('missing required steps', () => {
    it('returns MISSING_STEP error when deploy job is missing', () => {
      const result = validator.validate(WORKFLOW_MISSING_DEPLOY);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        code: 'MISSING_STEP',
        message: 'Workflow missing required step: deploy',
        step: 'deploy',
      });
    });

    it('returns MISSING_STEP error when test job is missing', () => {
      const result = validator.validate(WORKFLOW_MISSING_TEST);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        code: 'MISSING_STEP',
        message: 'Workflow missing required step: test',
        step: 'test',
      });
    });

    it('returns MISSING_STEP error when build job is missing', () => {
      const result = validator.validate(WORKFLOW_MISSING_BUILD);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        code: 'MISSING_STEP',
        message: 'Workflow missing required step: build',
        step: 'build',
      });
    });

    it('returns multiple MISSING_STEP errors when all required jobs are missing', () => {
      const result = validator.validate(WORKFLOW_MISSING_ALL_REQUIRED_STEPS);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
      expect(result.errors).toEqual([
        {
          code: 'MISSING_STEP',
          message: 'Workflow missing required step: build',
          step: 'build',
        },
        {
          code: 'MISSING_STEP',
          message: 'Workflow missing required step: test',
          step: 'test',
        },
        {
          code: 'MISSING_STEP',
          message: 'Workflow missing required step: deploy',
          step: 'deploy',
        },
      ]);
    });
  });

  describe('singleton export', () => {
    it('workflowValidator singleton validates workflow properly', () => {
      expect(workflowValidator).toBeInstanceOf(GitHubWorkflowValidator);
      const result = workflowValidator.validate(VALID_WORKFLOW_YAML);
      expect(result.valid).toBe(true);
    });
  });
});
