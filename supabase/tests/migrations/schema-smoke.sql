DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'migration sequence did not create public.profiles';
  END IF;

  IF to_regclass('public.templates') IS NULL THEN
    RAISE EXCEPTION 'migration sequence did not create public.templates';
  END IF;

  IF to_regclass('public.deployments') IS NULL THEN
    RAISE EXCEPTION 'migration sequence did not create public.deployments';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'subscription_tier'
  ) THEN
    RAISE EXCEPTION 'migration sequence did not create profiles.subscription_tier';
  END IF;
END;
$$;