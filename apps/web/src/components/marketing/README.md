# Marketing Components

Reusable, accessible marketing primitives built with Next.js and Tailwind CSS following the "Precision Transparency" design system.

## Components

### Navbar
Responsive navigation bar with mobile menu support.

```tsx
<Navbar
  links={[
    { label: 'Products', href: '#products' },
    { label: 'Features', href: '#features' },
    { label: 'Pricing', href: '#pricing' },
  ]}
  onLoginClick={() => console.log('Login')}
  onCtaClick={() => console.log('CTA')}
/>
```

Features:
- Responsive design with mobile hamburger menu
- Clean, minimal styling matching the design system
- Accessible keyboard navigation
- Smooth transitions and hover states

### Hero
Full-width hero section with asymmetrical layout for a crafted feel.

```tsx
<Hero
  title="Build & Deploy DeFi"
  subtitle="Launch production-ready applications"
  ctaPrimary="Start Building"
  ctaSecondary="View Demo"
  onPrimaryClick={() => {}}
  image={<YourImage />}
/>
```

### FeatureGrid
Responsive grid layout for showcasing features with icons.

```tsx
<FeatureGrid
  title="Features"
  subtitle="What we offer"
  columns={3}
  features={[
    {
      icon: <Icon />,
      title: "Feature Name",
      description: "Feature description"
    }
  ]}
/>
```

### SecuritySection
Dark-themed section for highlighting security features.

```tsx
<SecuritySection
  title="Enterprise Security"
  features={[
    {
      title: "Feature",
      description: "Description"
    }
  ]}
  image={<SecurityVisual />}
/>
```

### TemplateShowcase
Card-based showcase for templates or products.

```tsx
<TemplateShowcase
  title="Templates"
  templates={[
    {
      title: "Template Name",
      description: "Description",
      tag: "POPULAR",
      image: <Thumbnail />
    }
  ]}
/>
```

### PricingSection
Three-tier pricing display with feature lists.

```tsx
<PricingSection
  title="Pricing"
  tiers={[
    {
      name: "Pro",
      price: "$99",
      period: "per month",
      description: "For professionals",
      features: ["Feature 1", "Feature 2"],
      isPrimary: true,
      ctaText: "Get Started"
    }
  ]}
/>
```

### CTABand
Full-width call-to-action banner.

```tsx
<CTABand
  title="Ready to start?"
  description="Join us today"
  ctaText="Get Started"
  variant="dark"
/>
```

### Footer
Multi-column footer with links.

```tsx
<Footer
  sections={[
    {
      title: "Product",
      links: [
        { label: "Features", href: "/features" }
      ]
    }
  ]}
/>
```

### Button
Versatile button component with variants.

```tsx
<Button variant="primary" size="lg">
  Click Me
</Button>
```

## Design System Principles

### No-Line Rule
Boundaries are defined through background shifts, not borders. Use surface hierarchy:
- `surface` → `surface-container-low` → `surface-container-lowest`

### Typography
- Display text: Manrope (headlines)
- Body text: Inter (content)
- High contrast sizing for editorial feel

### Colors
- Primary: Deep blues (#000519, #001b4f)
- Tertiary: Cyan accents (#00daf3)
- Surface hierarchy for depth

### Elevation
- Tonal layering instead of heavy shadows
- Ambient shadows: `ambient-shadow` utility class
- Glass effects: `glass` utility class

## Accessibility

All components follow WCAG guidelines:
- Semantic HTML structure
- Keyboard navigation support
- Focus states with visible indicators
- Sufficient color contrast ratios
- Screen reader friendly

## Testing

Run tests with:
```bash
npm test
```

Components include unit tests for:
- Rendering
- User interactions
- Variant styles
- Accessibility features
