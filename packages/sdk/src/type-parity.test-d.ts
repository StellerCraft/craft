import { expectTypeOf } from 'vitest';
import type {
  DeploymentStatusType as SharedDeploymentStatusType,
  SubscriptionTier as SharedSubscriptionTier,
  Template as SharedTemplate,
  User as SharedUser,
} from '../../types/src';
import type {
  DeploymentStatusType,
  SubscriptionTier,
  Template,
  UserProfile,
} from './client';

expectTypeOf<DeploymentStatusType>().toEqualTypeOf<SharedDeploymentStatusType>();
expectTypeOf<SubscriptionTier>().toEqualTypeOf<SharedSubscriptionTier>();

expectTypeOf<UserProfile['id']>().toEqualTypeOf<SharedUser['id']>();
expectTypeOf<UserProfile['email']>().toEqualTypeOf<SharedUser['email']>();
expectTypeOf<UserProfile['createdAt']>().toEqualTypeOf<SharedUser['createdAt']>();
expectTypeOf<UserProfile['subscriptionTier']>().toEqualTypeOf<SharedUser['subscriptionTier']>();
expectTypeOf<UserProfile['githubConnected']>().toEqualTypeOf<SharedUser['githubConnected']>();
expectTypeOf<UserProfile['githubUsername']>().toEqualTypeOf<SharedUser['githubUsername']>();

expectTypeOf<Template['id']>().toEqualTypeOf<SharedTemplate['id']>();
expectTypeOf<Template['name']>().toEqualTypeOf<SharedTemplate['name']>();
expectTypeOf<Template['description']>().toEqualTypeOf<SharedTemplate['description']>();

export const intentionalTypeDivergences = {
  UserProfile: 'The SDK API profile includes fullName, which shared User omits.',
  Template: 'The SDK API response omits shared template persistence and customization fields.',
} as const;