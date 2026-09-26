import { describe, expect, it } from 'vitest';
import {
  NoHealthyRegionsError,
  orderHealthyEndpoints,
  type RegionEndpoint,
} from './routing-policy.ts';

const endpoints: RegionEndpoint[] = [
  { region: 'us-east-1', baseUrl: 'https://us.example.com', priority: 1 },
  { region: 'eu-west-1', baseUrl: 'https://eu.example.com', priority: 1 },
];

describe('regional routing policy', () => {
  it('fails with an actionable error when every region is unhealthy', () => {
    expect(() =>
      orderHealthyEndpoints(
        endpoints,
        new Map([
          ['us-east-1', false],
          ['eu-west-1', false],
        ]),
        'us-east-1',
      ),
    ).toThrow(NoHealthyRegionsError);
  });

  it('prefers the detected region among healthy regions', () => {
    expect(
      orderHealthyEndpoints(
        endpoints,
        new Map([
          ['us-east-1', true],
          ['eu-west-1', true],
        ]),
        'eu-west-1',
      )[0].region,
    ).toBe('eu-west-1');
  });
});