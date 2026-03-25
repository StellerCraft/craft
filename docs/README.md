# CRAFT Documentation

Comprehensive documentation for the CRAFT platform.

## Table of Contents

### Architecture
- [App Shell Navigation](./architecture/app-shell-navigation.md) - Information architecture and navigation patterns
- [Navigation States](./architecture/navigation-states.md) - Visual reference for all navigation states

### Components
- [App Shell Components](./components/app-shell-components.md) - Technical specifications for shell components

### Getting Started
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Contributing Guidelines](#contributing-guidelines)

---

## Development Setup

### Prerequisites
- Node.js 18+
- npm 9+
- Git

### Installation
```bash
# Clone the repository
git clone <repository-url>

# Install dependencies
npm install

# Start development server
npm run dev
```

### Environment Variables
```bash
# Copy example env file
cp .env.example .env

# Required variables
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key
STRIPE_SECRET_KEY=your_stripe_key
STRIPE_WEBHOOK_SECRET=your_webhook_secret
```

---

## Project Structure

```
craft/
├── apps/
│   └── web/                    # Next.js web application
│       ├── src/
│       │   ├── app/           # App router pages
│       │   ├── components/    # React components
│       │   ├── lib/          # Utility libraries
│       │   └── services/     # Business logic
│       └── public/           # Static assets
├── packages/
│   ├── types/                # Shared TypeScript types
│   └── stellar/              # Stellar SDK wrapper
├── templates/                # Template projects
├── docs/                     # Documentation
└── Design/                   # Design files
```

---

## Contributing Guidelines

### Branch Naming
```
feature/issue-XXX-short-description
bugfix/issue-XXX-short-description
docs/issue-XXX-short-description
```

### Commit Messages
Follow conventional commits:
```
feat: add user authentication
fix: resolve navigation bug
docs: update API documentation
test: add unit tests for auth service
chore: update dependencies
```

### Pull Request Process
1. Create branch from `main`
2. Implement changes with tests
3. Update documentation
4. Submit PR with description
5. Address review feedback
6. Merge after approval

### Code Style
- Use TypeScript for all new code
- Follow ESLint configuration
- Write tests for new features
- Document complex logic
- Keep functions small and focused

---

## Architecture Overview

### Navigation System

The application uses a dual-navigation system:

1. **Marketing Navigation** (Unauthenticated)
   - Fixed top navbar
   - Responsive mobile menu
   - CTA-focused design

2. **App Shell** (Authenticated)
   - Persistent sidebar navigation
   - Top bar with breadcrumbs
   - Mobile drawer for small screens

See [App Shell Navigation](./architecture/app-shell-navigation.md) for details.

### State Management

- **Server State**: React Query for API data
- **Client State**: React Context for UI state
- **Form State**: React Hook Form
- **URL State**: Next.js router for navigation

### Authentication Flow

```
┌─────────┐     ┌──────────┐     ┌─────────┐
│ Landing │ ──► │  Login   │ ──► │   App   │
└─────────┘     └──────────┘     └─────────┘
                     │                 │
                     │                 ▼
                     │            ┌─────────┐
                     └────────────│ Logout  │
                                  └─────────┘
```

### Data Flow

```
Component ──► Service ──► API ──► Database
    │                              │
    └──────── Cache ◄──────────────┘
```

---

## Testing Strategy

### Unit Tests
- Component rendering
- Business logic
- Utility functions
- 80%+ coverage target

### Integration Tests
- User flows
- API interactions
- Navigation paths

### E2E Tests (Future)
- Critical user journeys
- Payment flows
- Deployment process

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test -- path/to/test.ts

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

---

## Design System

### Colors
The platform uses a comprehensive color system based on Material Design 3:
- Primary: Deep blues (#000519, #001b4f)
- Secondary: Muted grays
- Tertiary: Cyan accents (#00daf3)
- Surface hierarchy for depth

### Typography
- **Headlines**: Manrope (400-800)
- **Body**: Inter (400-700)
- Scale: 12px - 72px

### Spacing
- Base unit: 4px
- Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96

### Components
All components follow the design system specifications in `Design/DESIGN.md`.

---

## API Documentation

### Authentication Endpoints
```
POST /api/auth/signin      - Sign in user
POST /api/auth/signup      - Create new user
POST /api/auth/signout     - Sign out user
GET  /api/auth/user        - Get current user
GET  /api/auth/profile     - Get user profile
```

### Template Endpoints
```
GET    /api/templates           - List templates
GET    /api/templates/:id       - Get template
POST   /api/templates           - Create template
PUT    /api/templates/:id       - Update template
DELETE /api/templates/:id       - Delete template
```

### Deployment Endpoints
```
GET    /api/deployments         - List deployments
GET    /api/deployments/:id     - Get deployment
POST   /api/deployments         - Create deployment
GET    /api/deployments/:id/health - Health check
```

### Payment Endpoints
```
POST /api/payments/checkout     - Create checkout session
GET  /api/payments/subscription - Get subscription status
POST /api/payments/cancel       - Cancel subscription
POST /api/webhooks/stripe       - Stripe webhook handler
```

---

## Deployment

### Production Build
```bash
# Build application
npm run build

# Start production server
npm start
```

### Environment Configuration
- Development: `.env.local`
- Staging: `.env.staging`
- Production: `.env.production`

### Deployment Checklist
- [ ] Run tests
- [ ] Build succeeds
- [ ] Environment variables set
- [ ] Database migrations applied
- [ ] API keys configured
- [ ] Monitoring enabled

---

## Troubleshooting

### Common Issues

**Build Fails**
```bash
# Clear cache and reinstall
rm -rf node_modules .next
npm install
npm run build
```

**Tests Fail**
```bash
# Update snapshots
npm test -- -u

# Clear test cache
npm test -- --clearCache
```

**Type Errors**
```bash
# Regenerate types
npm run generate:types
```

---

## Resources

### External Documentation
- [Next.js Docs](https://nextjs.org/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Supabase](https://supabase.com/docs)
- [Stripe](https://stripe.com/docs)
- [Stellar](https://developers.stellar.org/)

### Internal Links
- [Design System](../Design/DESIGN.md)
- [API Routes](./api/README.md)
- [Component Library](./components/README.md)

---

## Support

### Getting Help
- Check documentation first
- Search existing issues
- Ask in team chat
- Create new issue if needed

### Reporting Bugs
Include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots if applicable
- Environment details

---

## License

[License information]

---

## Changelog

See [CHANGELOG.md](../CHANGELOG.md) for version history.
