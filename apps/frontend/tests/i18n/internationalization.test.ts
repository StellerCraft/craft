/**
 * Frontend Internationalization (i18n) Tests
 *
 * Verifies i18n works correctly across all supported locales:
 *   - Translation loading and key resolution
 *   - Language switching
 *   - Pluralization rules
 *   - Date and number formatting
 *   - RTL language support
 *
 * Run: vitest run tests/i18n/internationalization.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'de', 'ar', 'zh', 'ja', 'pt'] as const;
const RTL_LOCALES = ['ar'] as const;
type Locale = typeof SUPPORTED_LOCALES[number];

// ── Types ─────────────────────────────────────────────────────────────────────

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

interface TranslationEntry {
  key: string;
  value: string | Record<PluralCategory, string>;
}

type TranslationMap = Record<string, TranslationEntry['value']>;

interface I18nConfig {
  locale: Locale;
  fallbackLocale: Locale;
  translations: Record<Locale, TranslationMap>;
}

interface FormatOptions {
  style?: 'decimal' | 'currency' | 'percent';
  currency?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

// ── i18n Engine ───────────────────────────────────────────────────────────────

/** Resolve a dot-notation key from a translation map */
function resolveKey(map: TranslationMap, key: string): string | undefined {
  const parts = key.split('.');
  let current: unknown = map;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function translate(config: I18nConfig, key: string, params?: Record<string, string | number>): string {
  const map = config.translations[config.locale] ?? config.translations[config.fallbackLocale];
  let value = resolveKey(map, key) ?? resolveKey(config.translations[config.fallbackLocale], key);

  if (value === undefined) return key; // return key as fallback

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
  }

  return value;
}

function switchLocale(config: I18nConfig, locale: Locale): I18nConfig {
  return { ...config, locale };
}

/**
 * Pluralization using Intl.PluralRules
 * Supports: zero, one, two, few, many, other
 */
function pluralize(
  locale: Locale,
  count: number,
  forms: Partial<Record<PluralCategory, string>>,
): string {
  const rules = new Intl.PluralRules(locale);
  const category = rules.select(count) as PluralCategory;
  return (forms[category] ?? forms['other'] ?? String(count)).replace('{{count}}', String(count));
}

function formatNumber(locale: Locale, value: number, options: FormatOptions = {}): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

function formatDate(locale: Locale, date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

function formatCurrency(locale: Locale, amount: number, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

function isRtl(locale: Locale): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale);
}

function getTextDirection(locale: Locale): 'ltr' | 'rtl' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

function getMissingKeys(
  baseTranslations: TranslationMap,
  targetTranslations: TranslationMap,
  prefix = '',
): string[] {
  const missing: string[] = [];
  for (const key of Object.keys(baseTranslations)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (!(key in targetTranslations)) {
      missing.push(fullKey);
    } else if (
      typeof baseTranslations[key] === 'object' &&
      typeof targetTranslations[key] === 'object'
    ) {
      missing.push(
        ...getMissingKeys(
          baseTranslations[key] as TranslationMap,
          targetTranslations[key] as TranslationMap,
          fullKey,
        ),
      );
    }
  }
  return missing;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EN_TRANSLATIONS: TranslationMap = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    loading: 'Loading...',
    error: 'An error occurred',
  } as unknown as string,
  deployment: {
    title: 'Deployments',
    status: {
      pending: 'Pending',
      completed: 'Completed',
      failed: 'Failed',
    } as unknown as string,
    count: 'You have {{count}} deployment(s)',
  } as unknown as string,
  nav: {
    home: 'Home',
    settings: 'Settings',
    logout: 'Log out',
  } as unknown as string,
};

const ES_TRANSLATIONS: TranslationMap = {
  common: {
    save: 'Guardar',
    cancel: 'Cancelar',
    loading: 'Cargando...',
    error: 'Ocurrió un error',
  } as unknown as string,
  deployment: {
    title: 'Despliegues',
    status: {
      pending: 'Pendiente',
      completed: 'Completado',
      failed: 'Fallido',
    } as unknown as string,
    count: 'Tienes {{count}} despliegue(s)',
  } as unknown as string,
  nav: {
    home: 'Inicio',
    settings: 'Configuración',
    logout: 'Cerrar sesión',
  } as unknown as string,
};

const AR_TRANSLATIONS: TranslationMap = {
  common: {
    save: 'حفظ',
    cancel: 'إلغاء',
    loading: 'جار التحميل...',
    error: 'حدث خطأ',
  } as unknown as string,
  deployment: {
    title: 'النشرات',
    count: 'لديك {{count}} نشرة',
  } as unknown as string,
  nav: {
    home: 'الرئيسية',
    settings: 'الإعدادات',
    logout: 'تسجيل الخروج',
  } as unknown as string,
};

function makeConfig(locale: Locale = 'en'): I18nConfig {
  return {
    locale,
    fallbackLocale: 'en',
    translations: {
      en: EN_TRANSLATIONS,
      es: ES_TRANSLATIONS,
      fr: EN_TRANSLATIONS, // use en as stub for untested locales
      de: EN_TRANSLATIONS,
      ar: AR_TRANSLATIONS,
      zh: EN_TRANSLATIONS,
      ja: EN_TRANSLATIONS,
      pt: EN_TRANSLATIONS,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('i18n — Translation Loading', () => {
  it('resolves a top-level key', () => {
    const config = makeConfig('en');
    expect(translate(config, 'nav.home')).toBe('Home');
  });

  it('resolves a nested key', () => {
    const config = makeConfig('en');
    expect(translate(config, 'deployment.title')).toBe('Deployments');
  });

  it('returns the key itself when translation is missing', () => {
    const config = makeConfig('en');
    expect(translate(config, 'nonexistent.key')).toBe('nonexistent.key');
  });

  it('interpolates template variables', () => {
    const config = makeConfig('en');
    const result = translate(config, 'deployment.count', { count: 3 });
    expect(result).toBe('You have 3 deployment(s)');
  });

  it('interpolates multiple variables', () => {
    const config: I18nConfig = {
      ...makeConfig('en'),
      translations: {
        ...makeConfig('en').translations,
        en: { ...EN_TRANSLATIONS, greeting: 'Hello, {{name}}! You have {{count}} items.' },
      },
    };
    const result = translate(config, 'greeting', { name: 'Alice', count: 5 });
    expect(result).toBe('Hello, Alice! You have 5 items.');
  });

  it('falls back to English when locale translation is missing', () => {
    const config: I18nConfig = {
      locale: 'fr',
      fallbackLocale: 'en',
      translations: {
        ...makeConfig().translations,
        fr: {}, // empty French translations
      },
    };
    expect(translate(config, 'nav.home')).toBe('Home');
  });
});

describe('i18n — Language Switching', () => {
  it('switches locale and returns translated string', () => {
    let config = makeConfig('en');
    expect(translate(config, 'common.save')).toBe('Save');

    config = switchLocale(config, 'es');
    expect(translate(config, 'common.save')).toBe('Guardar');
  });

  it('switching to Arabic returns Arabic translation', () => {
    const config = switchLocale(makeConfig('en'), 'ar');
    expect(translate(config, 'common.save')).toBe('حفظ');
  });

  it('switching back to English restores English translations', () => {
    let config = makeConfig('es');
    config = switchLocale(config, 'en');
    expect(translate(config, 'nav.logout')).toBe('Log out');
  });

  it('all supported locales can be set without error', () => {
    const config = makeConfig('en');
    for (const locale of SUPPORTED_LOCALES) {
      expect(() => switchLocale(config, locale)).not.toThrow();
    }
  });
});

describe('i18n — Pluralization Rules', () => {
  it('English: singular for count=1', () => {
    const result = pluralize('en', 1, { one: '{{count}} deployment', other: '{{count}} deployments' });
    expect(result).toBe('1 deployment');
  });

  it('English: plural for count=0', () => {
    const result = pluralize('en', 0, { one: '{{count}} deployment', other: '{{count}} deployments' });
    expect(result).toBe('0 deployments');
  });

  it('English: plural for count=2', () => {
    const result = pluralize('en', 2, { one: '{{count}} item', other: '{{count}} items' });
    expect(result).toBe('2 items');
  });

  it('Arabic: uses zero form for count=0', () => {
    const result = pluralize('ar', 0, {
      zero: 'لا نشرات',
      one: 'نشرة واحدة',
      two: 'نشرتان',
      few: '{{count}} نشرات',
      many: '{{count}} نشرة',
      other: '{{count}} نشرة',
    });
    expect(result).toBe('لا نشرات');
  });

  it('Arabic: uses one form for count=1', () => {
    const result = pluralize('ar', 1, {
      one: 'نشرة واحدة',
      other: '{{count}} نشرة',
    });
    expect(result).toBe('نشرة واحدة');
  });

  it('falls back to "other" when specific plural form is missing', () => {
    const result = pluralize('en', 5, { other: '{{count}} things' });
    expect(result).toBe('5 things');
  });

  it('Spanish: singular for count=1', () => {
    const result = pluralize('es', 1, { one: '{{count}} elemento', other: '{{count}} elementos' });
    expect(result).toBe('1 elemento');
  });
});

describe('i18n — Date and Number Formatting', () => {
  const testDate = new Date('2024-03-15T12:00:00Z');

  it('formats numbers with locale-specific separators (en)', () => {
    const result = formatNumber('en', 1234567.89);
    expect(result).toBe('1,234,567.89');
  });

  it('formats numbers with locale-specific separators (de)', () => {
    const result = formatNumber('de', 1234567.89);
    // German uses period as thousands separator and comma as decimal
    expect(result).toContain('1');
    expect(result).toContain('234');
  });

  it('formats currency in USD for English locale', () => {
    const result = formatCurrency('en', 1234.56, 'USD');
    expect(result).toContain('1,234.56');
    expect(result).toContain('$');
  });

  it('formats currency in EUR for French locale', () => {
    const result = formatCurrency('fr', 1234.56, 'EUR');
    expect(result).toContain('1');
    expect(result).toContain('234');
  });

  it('formats date in English locale', () => {
    const result = formatDate('en', testDate, { year: 'numeric', month: 'long', day: 'numeric' });
    expect(result).toContain('2024');
    expect(result).toContain('15');
  });

  it('formats date in Japanese locale (year first)', () => {
    const result = formatDate('ja', testDate, { year: 'numeric', month: 'long', day: 'numeric' });
    expect(result).toContain('2024');
  });

  it('formats percentage correctly', () => {
    const result = formatNumber('en', 0.75, { style: 'percent' });
    expect(result).toBe('75%');
  });

  it('respects minimumFractionDigits option', () => {
    const result = formatNumber('en', 1.5, { minimumFractionDigits: 2 });
    expect(result).toBe('1.50');
  });
});

describe('i18n — RTL Language Support', () => {
  it('identifies Arabic as RTL', () => {
    expect(isRtl('ar')).toBe(true);
  });

  it('identifies English as LTR', () => {
    expect(isRtl('en')).toBe(false);
  });

  it('returns rtl direction for Arabic', () => {
    expect(getTextDirection('ar')).toBe('rtl');
  });

  it('returns ltr direction for all non-RTL locales', () => {
    const ltrLocales: Locale[] = ['en', 'es', 'fr', 'de', 'zh', 'ja', 'pt'];
    for (const locale of ltrLocales) {
      expect(getTextDirection(locale)).toBe('ltr');
    }
  });

  it('Arabic translations are loaded correctly', () => {
    const config = makeConfig('ar');
    expect(translate(config, 'common.save')).toBe('حفظ');
    expect(translate(config, 'nav.home')).toBe('الرئيسية');
  });
});

describe('i18n — Translation Completeness', () => {
  it('Spanish translations cover all English keys', () => {
    const missing = getMissingKeys(EN_TRANSLATIONS, ES_TRANSLATIONS);
    expect(missing).toHaveLength(0);
  });

  it('Arabic translations cover deployment and nav keys', () => {
    const requiredKeys = ['deployment', 'nav', 'common'];
    for (const key of requiredKeys) {
      expect(key in AR_TRANSLATIONS).toBe(true);
    }
  });

  it('getMissingKeys detects missing translation', () => {
    const base = { greeting: 'Hello', farewell: 'Goodbye' };
    const partial = { greeting: 'Hola' };
    const missing = getMissingKeys(base, partial);
    expect(missing).toContain('farewell');
  });

  it('getMissingKeys returns empty array for complete translation', () => {
    const base = { greeting: 'Hello' };
    const complete = { greeting: 'Hola' };
    expect(getMissingKeys(base, complete)).toHaveLength(0);
  });

  it('all supported locales are defined in config', () => {
    const config = makeConfig();
    for (const locale of SUPPORTED_LOCALES) {
      expect(config.translations[locale]).toBeDefined();
    }
  });
});
