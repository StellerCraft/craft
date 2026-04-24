import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Branding Customization Tests
 * 
 * Verifies branding customizations are correctly applied to generated templates.
 */

interface BrandingConfig {
  logo?: string;
  appName: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  favicon?: string;
}

interface BrandingValidation {
  isValid: boolean;
  errors: string[];
}

interface GeneratedTemplate {
  html: string;
  css: string;
  config: BrandingConfig;
  appliedAt: number;
}

class BrandingCustomizer {
  private templates: Map<string, GeneratedTemplate> = new Map();
  private colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  private urlRegex = /^https?:\/\/.+/;

  validateBranding(config: BrandingConfig): BrandingValidation {
    const errors: string[] = [];

    if (!config.appName || config.appName.trim().length === 0) {
      errors.push('App name is required');
    }

    if (!this.colorRegex.test(config.primaryColor)) {
      errors.push('Primary color must be valid hex color');
    }

    if (!this.colorRegex.test(config.secondaryColor)) {
      errors.push('Secondary color must be valid hex color');
    }

    if (!config.fontFamily || config.fontFamily.trim().length === 0) {
      errors.push('Font family is required');
    }

    if (config.logo && !this.urlRegex.test(config.logo)) {
      errors.push('Logo must be valid URL');
    }

    if (config.favicon && !this.urlRegex.test(config.favicon)) {
      errors.push('Favicon must be valid URL');
    }

    // Check color contrast
    if (!this.hasGoodContrast(config.primaryColor, config.secondaryColor)) {
      errors.push('Primary and secondary colors have insufficient contrast');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private hasGoodContrast(color1: string, color2: string): boolean {
    const lum1 = this.getLuminance(color1);
    const lum2 = this.getLuminance(color2);
    const contrast = (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
    return contrast >= 4.5; // WCAG AA standard
  }

  private getLuminance(hex: string): number {
    const rgb = parseInt(hex.slice(1), 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = (rgb >> 0) & 0xff;

    const [rs, gs, bs] = [r, g, b].map((x) => {
      x = x / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  applyBranding(templateId: string, branding: BrandingConfig): GeneratedTemplate {
    const validation = this.validateBranding(branding);

    if (!validation.isValid) {
      throw new Error(`Branding validation failed: ${validation.errors.join(', ')}`);
    }

    const html = this.generateHTML(branding);
    const css = this.generateCSS(branding);

    const template: GeneratedTemplate = {
      html,
      css,
      config: branding,
      appliedAt: Date.now(),
    };

    this.templates.set(templateId, template);
    return template;
  }

  private generateHTML(branding: BrandingConfig): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>${branding.appName}</title>
          ${branding.favicon ? `<link rel="icon" href="${branding.favicon}">` : ''}
          <style>${this.generateCSS(branding)}</style>
        </head>
        <body>
          <header class="branding-header">
            ${branding.logo ? `<img src="${branding.logo}" alt="${branding.appName} logo" class="logo">` : ''}
            <h1>${branding.appName}</h1>
          </header>
          <main class="content">
            <p>Welcome to ${branding.appName}</p>
          </main>
        </body>
      </html>
    `;
  }

  private generateCSS(branding: BrandingConfig): string {
    return `
      :root {
        --primary-color: ${branding.primaryColor};
        --secondary-color: ${branding.secondaryColor};
        --font-family: ${branding.fontFamily};
      }
      
      * {
        font-family: var(--font-family);
      }
      
      body {
        margin: 0;
        padding: 0;
        background-color: var(--secondary-color);
        color: var(--primary-color);
      }
      
      .branding-header {
        background-color: var(--primary-color);
        color: var(--secondary-color);
        padding: 20px;
      }
      
      .logo {
        max-width: 100px;
        height: auto;
      }
      
      h1 {
        margin: 10px 0;
        font-size: 2em;
      }
      
      .content {
        padding: 20px;
      }
    `;
  }

  getTemplate(templateId: string): GeneratedTemplate | undefined {
    return this.templates.get(templateId);
  }

  verifyBrandingInTemplate(templateId: string, branding: BrandingConfig): boolean {
    const template = this.templates.get(templateId);

    if (!template) {
      return false;
    }

    const htmlContainsAppName = template.html.includes(branding.appName);
    const cssContainsPrimaryColor = template.css.includes(branding.primaryColor);
    const cssContainsFontFamily = template.css.includes(branding.fontFamily);

    return htmlContainsAppName && cssContainsPrimaryColor && cssContainsFontFamily;
  }

  clearTemplates(): void {
    this.templates.clear();
  }
}

describe('Branding Customization', () => {
  let customizer: BrandingCustomizer;

  beforeEach(() => {
    customizer = new BrandingCustomizer();
  });

  describe('Logo Upload and Processing', () => {
    it('should accept valid logo URL', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        logo: 'https://example.com/logo.png',
      };

      const validation = customizer.validateBranding(branding);

      expect(validation.isValid).toBe(true);
    });

    it('should reject invalid logo URL', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        logo: 'not-a-url',
      };

      const validation = customizer.validateBranding(branding);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Logo'))).toBe(true);
    });

    it('should include logo in generated HTML', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        logo: 'https://example.com/logo.png',
      };

      const template = customizer.applyBranding('test-1', branding);

      expect(template.html).toContain('https://example.com/logo.png');
      expect(template.html).toContain('alt="My App logo"');
    });

    it('should handle missing logo gracefully', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      const template = customizer.applyBranding('test-2', branding);

      expect(template.html).toBeDefined();
      expect(template.html).toContain('My App');
    });
  });

  describe('Color Scheme Application', () => {
    it('should apply primary color to CSS', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#3b82f6',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      const template = customizer.applyBranding('test-3', branding);

      expect(template.css).toContain('--primary-color: #3b82f6');
    });

    it('should apply secondary color to CSS', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#f3f4f6',
        fontFamily: 'Arial, sans-serif',
      };

      const template = customizer.applyBranding('test-4', branding);

      expect(template.css).toContain('--secondary-color: #f3f4f6');
    });

    it('should reject invalid hex colors', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: 'not-a-color',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      const validation = customizer.validateBranding(branding);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Primary color'))).toBe(true);
    });

    it('should accept 3-digit hex colors', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000',
        secondaryColor: '#fff',
        fontFamily: 'Arial, sans-serif',
      };

      const validation = customizer.validateBranding(branding);

      expect(validation.isValid).toBe(true);
    });
  });

  describe('Font Customization', () => {
    it('should apply custom font family', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Georgia, serif',
      };

      const template = customizer.applyBranding('test-5', branding);

      expect(template.css).toContain('--font-family: Georgia, serif');
    });

    it('should require font family', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: '',
      };

      const validation = customizer.validateBranding(branding);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Font family'))).toBe(true);
    });

    it('should support multiple font families', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      };

      const template = customizer.applyBranding('test-6', branding);

      expect(template.css).toContain('"Helvetica Neue", Helvetica, Arial, sans-serif');
    });
  });

  describe('Branding Preview Accuracy', () => {
    it('should verify branding is applied in template', () => {
      const branding: BrandingConfig = {
        appName: 'Test App',
        primaryColor: '#3b82f6',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      customizer.applyBranding('test-7', branding);
      const isApplied = customizer.verifyBrandingInTemplate('test-7', branding);

      expect(isApplied).toBe(true);
    });

    it('should detect missing branding', () => {
      const branding: BrandingConfig = {
        appName: 'Test App',
        primaryColor: '#3b82f6',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      const differentBranding: BrandingConfig = {
        appName: 'Different App',
        primaryColor: '#ef4444',
        secondaryColor: '#ffffff',
        fontFamily: 'Georgia, serif',
      };

      customizer.applyBranding('test-8', branding);
      const isApplied = customizer.verifyBrandingInTemplate('test-8', differentBranding);

      expect(isApplied).toBe(false);
    });
  });

  describe('Branding Persistence', () => {
    it('should persist branding configuration', () => {
      const branding: BrandingConfig = {
        appName: 'Persistent App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      customizer.applyBranding('test-9', branding);
      const template = customizer.getTemplate('test-9');

      expect(template).toBeDefined();
      expect(template!.config.appName).toBe('Persistent App');
    });

    it('should track application timestamp', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      const before = Date.now();
      customizer.applyBranding('test-10', branding);
      const after = Date.now();

      const template = customizer.getTemplate('test-10');

      expect(template!.appliedAt).toBeGreaterThanOrEqual(before);
      expect(template!.appliedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('Color Contrast Requirements', () => {
    it('should enforce WCAG AA contrast ratio', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#ffffff',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      const validation = customizer.validateBranding(branding);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes('contrast'))).toBe(true);
    });

    it('should accept colors with good contrast', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      const validation = customizer.validateBranding(branding);

      expect(validation.isValid).toBe(true);
    });
  });

  describe('Favicon Handling', () => {
    it('should accept valid favicon URL', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        favicon: 'https://example.com/favicon.ico',
      };

      const validation = customizer.validateBranding(branding);

      expect(validation.isValid).toBe(true);
    });

    it('should include favicon in HTML head', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        favicon: 'https://example.com/favicon.ico',
      };

      const template = customizer.applyBranding('test-11', branding);

      expect(template.html).toContain('https://example.com/favicon.ico');
      expect(template.html).toContain('rel="icon"');
    });

    it('should handle missing favicon gracefully', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      const template = customizer.applyBranding('test-12', branding);

      expect(template.html).toBeDefined();
      expect(template.html).not.toContain('rel="icon"');
    });
  });

  describe('Branding Validation Rules', () => {
    it('should require app name', () => {
      const branding: BrandingConfig = {
        appName: '',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      const validation = customizer.validateBranding(branding);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes('App name'))).toBe(true);
    });

    it('should validate all required fields', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: 'invalid',
        secondaryColor: 'invalid',
        fontFamily: '',
      };

      const validation = customizer.validateBranding(branding);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(1);
    });

    it('should clear templates without errors', () => {
      const branding: BrandingConfig = {
        appName: 'My App',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      };

      customizer.applyBranding('test-13', branding);
      expect(() => customizer.clearTemplates()).not.toThrow();
      expect(customizer.getTemplate('test-13')).toBeUndefined();
    });
  });
});
