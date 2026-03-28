# CRAFT

** Democratizing DeFi Development on Stellar**

CRAFT is a powerful no-code platform that enables anyone to deploy production-ready, customized DeFi applications on the Stellar blockchain in minutes. Whether you're building a DEX, payment gateway, or asset issuance platform, CRAFT provides the tools, templates, and infrastructure to bring your vision to life without writing a single line of code.

![CRAFT Platform](https://img.shields.io/badge/Status-In%20Development-yellow)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![Stellar](https://img.shields.io/badge/Stellar-Blockchain-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![License](https://img.shields.io/badge/License-Proprietary-red)

---

## Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Getting Started](#-getting-started)
- [Available Templates](#-available-templates)
- [Tech Stack](#-tech-stack)
- [API Documentation](#-api-documentation)
- [Database Schema](#-database-schema)
- [Deployment Guide](#-deployment-guide)
- [Configuration](#-configuration)
- [Security](#-security)
- [Testing](#-testing)
- [Monitoring & Analytics](#-monitoring--analytics)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [Roadmap](#-roadmap)
- [License](#-license)

---

## Overview

CRAFT (Customizable Rapid Application Framework for Trading) is designed to lower the barrier to entry for DeFi development on Stellar. Instead of spending weeks or months building infrastructure, developers and entrepreneurs can:

1. **Choose** from professionally designed, audited templates
2. **Customize** branding, features, and blockchain configurations
3. **Deploy** automatically to production with one click
4. **Monitor** performance with built-in analytics and health checks

### Why CRAFT?

- **Speed**: Deploy in minutes, not months
- **Cost-Effective**: No need to hire a full development team
- **Secure**: Built-in security best practices and RLS policies
- **Scalable**: Powered by Vercel's edge network
- **Flexible**: Full customization without touching code
- **Stellar-Native**: Optimized for Stellar's unique features

---

## Key Features

### Visual Customization Engine

Customize every aspect of your DeFi application through an intuitive interface:

- **Branding**: Logo, colors, typography, and theme
- **Features**: Enable/disable specific functionality
- **Blockchain Config**: Network selection, asset pairs, RPC endpoints
- **UI Components**: Customize layouts and component behavior

### Stellar Blockchain Integration

Native support for Stellar's powerful features:

- **Mainnet & Testnet**: Switch between networks seamlessly
- **Soroban Smart Contracts**: Deploy and interact with Soroban contracts
- **Asset Management**: Create, issue, and manage Stellar assets
- **Payment Channels**: Fast, low-cost transactions
- **Wallet Integration**: Support for Freighter, Albedo, and more

### Automated Deployment Pipeline

One-click deployment with zero DevOps knowledge:

- **GitHub Integration**: Automatic repository creation and management
- **Vercel Deployment**: Edge-optimized hosting with global CDN
- **Environment Management**: Automatic configuration of secrets and variables
- **CI/CD**: Automated testing and deployment on every push
- **Custom Domains**: Easy domain configuration and SSL certificates

### Subscription Management

Monetize your platform with built-in payment processing:

- **Stripe Integration**: Secure payment processing
- **Multiple Tiers**: Free, Starter, Pro, and Enterprise plans
- **Usage Tracking**: Monitor deployment limits and usage
- **Automatic Billing**: Recurring subscriptions with automatic renewal
- **Webhook Handling**: Real-time subscription status updates

### Analytics & Monitoring

Track performance and user engagement:

- **Page View Tracking**: Monitor traffic to your deployments
- **Uptime Monitoring**: Automated health checks every 5 minutes
- **Transaction Analytics**: Track Stellar transaction volume
- **Performance Metrics**: Response times and error rates
- **CSV Export**: Download analytics data for analysis
- **Downtime Alerts**: Automatic notifications when deployments go down

### Enterprise-Grade Security

Built with security as a top priority:

- **Row-Level Security**: Database-level access control
- **Encrypted Secrets**: All API keys and tokens encrypted at rest
- **Authentication**: Supabase Auth with JWT tokens
- **Rate Limiting**: Protect against abuse and DDoS
- **CSRF Protection**: Secure form submissions
- **Input Validation**: Zod schema validation on all inputs

---

## Architecture

CRAFT is built as a modern monorepo using Turborepo, with clear separation of concerns:

```
craft-platform/
├── apps/
│   ├── web/                      # Main Next.js application
│   │   ├── src/
│   │   │   ├── app/             # Next.js 14 App Router
│   │   │   │   ├── api/         # API routes
│   │   │   │   │   ├── auth/    # Authentication endpoints
│   │   │   │   │   ├── payments/ # Stripe integration
│   │   │   │   │   ├── templates/ # Template management
│   │   │   │   │   ├── deployments/ # Deployment & analytics
│   │   │   │   │   ├── webhooks/ # Webhook handlers
│   │   │   │   │   └── cron/    # Scheduled jobs
│   │   │   ├── services/        # Business logic layer
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── payment.service.ts
│   │   │   │   ├── template.service.ts
│   │   │   │   ├── analytics.service.ts
│   │   │   │   └── health-monitor.service.ts
│   │   │   └── lib/             # Utilities and clients
│   │   │       ├── supabase/    # Database client
│   │   │       └── stripe/      # Payment client
│   └── generator/                # Template generation service (coming soon)
│
├── packages/
│   ├── types/                    # Shared TypeScript types
│   │   ├── user.ts              # User and auth types
│   │   ├── template.ts          # Template definitions
│   │   ├── deployment.ts        # Deployment types
│   │   ├── customization.ts     # Customization schemas
│   │   ├── stellar.ts           # Stellar-specific types
│   │   └── payment.ts           # Payment and subscription types
│   ├── ui/                       # Shared UI components (coming soon)
│   ├── stellar/                  # Stellar SDK wrapper
│   └── config/                   # Shared configuration
│       ├── eslint-preset.js     # ESLint configuration
│       └── tsconfig.json        # TypeScript base config
│
├── templates/                    # Base template repositories
│   ├── stellar-dex/             # Decentralized exchange
│   ├── soroban-defi/            # Soroban DeFi platform
│   ├── payment-gateway/         # Payment processing
│   └── asset-issuance/          # Asset management
│
└── supabase/
    ├── migrations/              # Database migrations
    │   ├── 001_initial_schema.sql
    │   ├── 002_row_level_security.sql
    │   └── 003_seed_templates.sql
    └── config.toml              # Supabase configuration
```

### Technology Decisions

**Why Next.js 14?**

- Server Components for optimal performance
- App Router for modern routing patterns
- API Routes for serverless backend
- Built-in optimization and caching

**Why Supabase?**

- PostgreSQL with real-time capabilities
- Built-in authentication
- Row-Level Security for data isolation
- Generous free tier

**Why Turborepo?**

- Fast, incremental builds
- Shared code across packages
- Parallel task execution
- Smart caching

---

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed and configured:

- **Node.js** 18.0 or higher ([Download](https://nodejs.org/))
- **npm** 10.0 or higher (comes with Node.js)
- **Git** for version control
- **Supabase** account ([Sign up](https://supabase.com))
- **Stripe** account ([Sign up](https://stripe.com))
- **GitHub** account ([Sign up](https://github.com))
- **Vercel** account ([Sign up](https://vercel.com))

### Quick Start (5 minutes)

1. **Clone and Install**

   ```bash
   git clone https://github.com/temma02/craft.git
   cd craft
   npm install
   ```

2. **Configure Environment**

   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials
   ```

3. **Set Up Database**

   ```bash
   npx supabase db push
   ```

4. **Start Development**

   ```bash
   npm run dev
   ```

5. **Open Browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

### Detailed Installation

#### Step 1: Clone the Repository

```bash
git clone https://github.com/temma02/craft.git
cd craft
```

#### Step 2: Install Dependencies

This project uses npm workspaces and Turborepo for monorepo management:

```bash
npm install
```

This will install all dependencies for the root project and all packages/apps.

#### Step 3: Set Up Supabase

1. **Create a Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Click "New Project"
   - Choose a name, database password, and region

2. **Get Your Credentials**
   - Go to Project Settings > API
   - Copy the Project URL and anon/public key
   - Copy the service_role key (keep this secret!)

3. **Run Migrations**

   ```bash
   # Install Supabase CLI if you haven't
   npm install -g supabase

   # Link to your project
   npx supabase link --project-ref your-project-ref

   # Run migrations
   npx supabase db push
   ```

#### Step 4: Configure Stripe

1. **Create a Stripe Account**
   - Go to [stripe.com](https://stripe.com)
   - Complete account setup

2. **Get API Keys**
   - Go to Developers > API Keys
   - Copy Publishable key and Secret key
   - For webhooks, use Stripe CLI or create webhook endpoint

3. **Set Up Products**
   - Create subscription products for Free, Starter, Pro, Enterprise tiers
   - Note the Price IDs for each tier

#### Step 5: Configure GitHub

1. **Create Personal Access Token**
   - Go to Settings > Developer settings > Personal access tokens
   - Generate new token with `repo` and `admin:org` scopes
   - Copy the token

2. **Create Organization (Optional)**
   - Create a GitHub organization for template repositories
   - Or use your personal account

#### Step 6: Configure Vercel

1. **Create Vercel Account**
   - Sign up at [vercel.com](https://vercel.com)
   - Connect your GitHub account

2. **Get API Token**
   - Go to Settings > Tokens
   - Create new token
   - Copy the token

3. **Get Team ID (if using teams)**
   - Go to your team settings
   - Copy the Team ID from the URL

#### Step 7: Environment Variables

Create `.env.local` in the root directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# GitHub Configuration
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_APP_INSTALLATION_ID=12345678
GITHUB_API_BASE_URL=https://api.github.com
GITHUB_ORG=your-github-org-or-username

# Vercel Configuration
VERCEL_TOKEN=your-vercel-token
VERCEL_TEAM_ID=your-team-id  # Optional, only if using teams

# Stripe Configuration
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_key
STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Stripe Price IDs (create these in Stripe Dashboard)
STRIPE_PRICE_FREE=price_free_tier_id
STRIPE_PRICE_STARTER=price_starter_tier_id
STRIPE_PRICE_PRO=price_pro_tier_id
STRIPE_PRICE_ENTERPRISE=price_enterprise_tier_id

# Application Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# Stellar Configuration (Optional - for testing)
STELLAR_NETWORK=testnet  # or mainnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
```

GitHub authentication uses a platform-owned GitHub App installation. Installation access tokens are minted on demand and cached in memory until close to expiry.

#### Step 8: Start Development Server

```bash
npm run dev
```

The application will be available at:

- **Web App**: http://localhost:3000
- **API**: http://localhost:3000/api

#### Step 9: Verify Installation

1. Open http://localhost:3000
2. You should see the CRAFT landing page
3. Try signing up for an account
4. Check Supabase dashboard to see the new user

---

## 📦 Available Templates

CRAFT provides four production-ready templates, each optimized for specific DeFi use cases:

### 1. 🔄 Stellar DEX

A fully-featured decentralized exchange for trading Stellar assets.

**Use Cases:**

- Token trading platforms
- Asset exchange services
- Liquidity provision platforms

**Features:**

- **Token Swapping**: Swap between any Stellar assets
- **Real-time Price Feeds**: Live price updates from Stellar DEX
- **Order Book**: View buy/sell orders for asset pairs
- **Transaction History**: Complete history of all trades
- **Wallet Integration**: Connect with Freighter, Albedo, xBull
- **Customizable Pairs**: Configure which asset pairs to display
- **Price Charts**: Interactive charts with historical data
- **Slippage Protection**: Configurable slippage tolerance

**Tech Stack:**

- Next.js 14 with App Router
- Stellar SDK for blockchain interaction
- TailwindCSS for styling
- Real-time WebSocket updates

**Customization Options:**

- Branding (logo, colors, fonts)
- Supported asset pairs
- Fee structure
- UI layout and components
- Network (mainnet/testnet)

### 2. Soroban DeFi

Advanced DeFi platform built on Stellar's Soroban smart contract platform.

**Use Cases:**

- Lending/borrowing platforms
- Yield farming protocols
- Liquidity mining programs
- Automated market makers (AMMs)

**Features:**

- **Smart Contract Interactions**: Deploy and interact with Soroban contracts
- **Liquidity Pools**: Create and manage liquidity pools
- **Yield Farming**: Stake tokens to earn rewards
- **Governance**: Token-based voting mechanisms
- **Flash Loans**: Uncollateralized loans within single transaction
- **Soroban RPC**: Direct integration with Soroban RPC
- **Contract Deployment**: Deploy custom contracts from UI

**Tech Stack:**

- Next.js 14
- Soroban SDK
- Rust smart contracts (pre-compiled)
- Stellar SDK

**Customization Options:**

- Contract parameters
- Pool configurations
- Reward structures
- Governance rules
- Token economics

### 3. 💳 Payment Gateway

Accept Stellar payments with enterprise-grade features.

**Use Cases:**

- E-commerce payment processing
- Subscription billing
- Invoice management
- Cross-border payments

**Features:**

- **Multi-Currency Support**: Accept any Stellar asset
- **Payment Tracking**: Real-time payment status updates
- **Invoice Generation**: Create and send invoices
- **Automatic Conversion**: Convert payments to preferred currency
- **Payment Links**: Generate shareable payment links
- **Webhook Notifications**: Real-time payment notifications
- **Refund Management**: Process refunds easily
- **Transaction History**: Complete payment records

**Tech Stack:**

- Next.js 14
- Stellar SDK
- PostgreSQL for payment records
- Webhook system

**Customization Options:**

- Accepted currencies
- Payment flow UI
- Confirmation requirements
- Webhook endpoints
- Fee structure

### 4. 🏦 Asset Issuance

Create and manage custom Stellar assets with full control.

**Use Cases:**

- Token launches
- Stablecoin issuance
- Loyalty point systems
- Security token offerings

**Features:**

- **Asset Creation**: Issue custom Stellar assets
- **Distribution Management**: Control token distribution
- **Trustline Configuration**: Manage asset trustlines
- **Supply Control**: Mint or burn tokens
- **Authorization Flags**: Control who can hold your asset
- **Clawback**: Retrieve tokens if needed (optional)
- **Asset Analytics**: Track holders and distribution
- **Compliance Tools**: KYC/AML integration ready

**Tech Stack:**

- Next.js 14
- Stellar SDK
- Asset management dashboard
- Analytics engine

**Customization Options:**

- Asset properties (name, code, supply)
- Authorization requirements
- Distribution rules
- Compliance settings
- Dashboard layout

---

## 🛠️ Tech Stack

### Frontend Technologies

| Technology      | Version | Purpose                                                 |
| --------------- | ------- | ------------------------------------------------------- |
| **Next.js**     | 14.x    | React framework with App Router and Server Components   |
| **React**       | 18.x    | UI library for building interactive interfaces          |
| **TypeScript**  | 5.3.x   | Type-safe JavaScript with enhanced developer experience |
| **TailwindCSS** | 3.x     | Utility-first CSS framework for rapid UI development    |
| **Shadcn/ui**   | Latest  | Accessible component library (coming soon)              |

### Backend Technologies

| Technology             | Version | Purpose                                        |
| ---------------------- | ------- | ---------------------------------------------- |
| **Next.js API Routes** | 14.x    | Serverless API endpoints                       |
| **Supabase**           | Latest  | PostgreSQL database with real-time and auth    |
| **Zod**                | 3.x     | TypeScript-first schema validation             |
| **Stripe**             | Latest  | Payment processing and subscription management |

### Blockchain Technologies

| Technology      | Version | Purpose                                    |
| --------------- | ------- | ------------------------------------------ |
| **Stellar SDK** | 11.x    | Interact with Stellar blockchain           |
| **Soroban SDK** | Latest  | Smart contract development and interaction |
| **Freighter**   | Latest  | Browser wallet integration                 |

### Infrastructure & DevOps

| Technology         | Version | Purpose                               |
| ------------------ | ------- | ------------------------------------- |
| **Turborepo**      | Latest  | Monorepo build system with caching    |
| **Vercel**         | Latest  | Deployment platform with edge network |
| **GitHub Actions** | Latest  | CI/CD automation (coming soon)        |
| **Docker**         | Latest  | Containerization (optional)           |

### Development Tools

| Technology   | Version | Purpose                         |
| ------------ | ------- | ------------------------------- |
| **Vitest**   | Latest  | Fast unit testing framework     |
| **ESLint**   | 8.x     | Code linting and quality checks |
| **Prettier** | 3.x     | Code formatting                 |
| **Husky**    | Latest  | Git hooks (coming soon)         |

---

## API Documentation

### Authentication Endpoints

#### POST `/api/auth/signup`

Create a new user account.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "fullName": "John Doe"
}
```

**Response (201):**

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "John Doe"
  },
  "session": {
    "access_token": "jwt_token",
    "refresh_token": "refresh_token"
  }
}
```

**Errors:**

- `400` - Invalid input data
- `409` - Email already exists

#### POST `/api/auth/signin`

Sign in an existing user.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200):**

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "session": {
    "access_token": "jwt_token",
    "refresh_token": "refresh_token"
  }
}
```

**Errors:**

- `400` - Invalid credentials
- `401` - Unauthorized

#### POST `/api/auth/signout`

Sign out the current user.

**Headers:**

```
Authorization: Bearer {access_token}
```

**Response (200):**

```json
{
  "message": "Signed out successfully"
}
```

#### GET `/api/auth/user`

Get current authenticated user.

**Headers:**

```
Authorization: Bearer {access_token}
```

**Response (200):**

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "fullName": "John Doe",
  "subscriptionTier": "pro",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

#### PATCH `/api/auth/profile`

Update user profile.

**Headers:**

```
Authorization: Bearer {access_token}
```

**Request Body:**

```json
{
  "fullName": "Jane Doe",
  "avatarUrl": "https://example.com/avatar.jpg"
}
```

**Response (200):**

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "fullName": "Jane Doe",
  "avatarUrl": "https://example.com/avatar.jpg"
}
```

### Template Endpoints

#### GET `/api/templates`

List all available templates with optional filtering.

**Query Parameters:**

- `category` - Filter by category (dex, defi, payment, asset)
- `search` - Search by name or description
- `limit` - Number of results (default: 10)
- `offset` - Pagination offset (default: 0)

**Example:**

```
GET /api/templates?category=dex&limit=5
```

**Response (200):**

```json
{
  "templates": [
    {
      "id": "uuid",
      "name": "Stellar DEX",
      "description": "Decentralized exchange for Stellar assets",
      "category": "dex",
      "version": "1.0.0",
      "features": ["swapping", "charts", "history"],
      "previewUrl": "https://example.com/preview",
      "thumbnailUrl": "https://example.com/thumb.jpg"
    }
  ],
  "total": 4,
  "limit": 5,
  "offset": 0
}
```

#### GET `/api/templates/[id]`

Get detailed information about a specific template.

**Response (200):**

```json
{
  "id": "uuid",
  "name": "Stellar DEX",
  "description": "Full description...",
  "category": "dex",
  "version": "1.0.0",
  "features": ["swapping", "charts", "history"],
  "customizationSchema": {
    "branding": {
      "logo": "string",
      "primaryColor": "string",
      "secondaryColor": "string"
    },
    "features": {
      "enableCharts": "boolean",
      "enableHistory": "boolean"
    }
  },
  "requiredEnvVars": ["STELLAR_NETWORK", "HORIZON_URL"],
  "documentation": "https://docs.example.com"
}
```

#### GET `/api/templates/[id]/metadata`

Get template metadata and configuration schema.

**Response (200):**

```json
{
  "id": "uuid",
  "name": "Stellar DEX",
  "version": "1.0.0",
  "customizationSchema": {
    /* JSON Schema */
  },
  "defaultConfig": {
    /* Default values */
  }
}
```

### Payment Endpoints

#### POST `/api/payments/checkout`

Create a Stripe checkout session for subscription.

**Headers:**

```
Authorization: Bearer {access_token}
```

**Request Body:**

```json
{
  "priceId": "price_starter_monthly",
  "successUrl": "https://app.example.com/success",
  "cancelUrl": "https://app.example.com/cancel"
}
```

**Response (200):**

```json
{
  "sessionId": "cs_test_...",
  "url": "https://checkout.stripe.com/..."
}
```

#### GET `/api/payments/subscription`

Get current subscription status.

**Headers:**

```
Authorization: Bearer {access_token}
```

**Response (200):**

```json
{
  "subscriptionId": "sub_...",
  "status": "active",
  "tier": "pro",
  "currentPeriodEnd": "2024-02-01T00:00:00Z",
  "cancelAtPeriodEnd": false
}
```

#### POST `/api/payments/cancel`

Cancel subscription at period end.

**Headers:**

```
Authorization: Bearer {access_token}
```

**Response (200):**

```json
{
  "subscriptionId": "sub_...",
  "status": "active",
  "cancelAtPeriodEnd": true,
  "currentPeriodEnd": "2024-02-01T00:00:00Z"
}
```

### Deployment Endpoints

#### GET `/api/deployments/[id]/analytics`

Get analytics data for a deployment.

**Headers:**

```
Authorization: Bearer {access_token}
```

**Query Parameters:**

- `metricType` - Filter by metric type (page_view, uptime_check, transaction_count)
- `startDate` - Start date (ISO 8601)
- `endDate` - End date (ISO 8601)

**Response (200):**

```json
{
  "analytics": [
    {
      "id": "uuid",
      "metricType": "page_view",
      "metricValue": 150,
      "recordedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "summary": {
    "totalPageViews": 1500,
    "uptimePercentage": 99.9,
    "totalTransactions": 250,
    "lastChecked": "2024-01-15T12:00:00Z"
  }
}
```

#### GET `/api/deployments/[id]/analytics/export`

Export analytics data as CSV.

**Headers:**

```
Authorization: Bearer {access_token}
```

**Query Parameters:**

- `startDate` - Start date (ISO 8601)
- `endDate` - End date (ISO 8601)

**Response (200):**

```csv
Metric Type,Value,Recorded At
page_view,150,2024-01-15T10:30:00Z
uptime_check,1,2024-01-15T10:35:00Z
```

#### GET `/api/deployments/[id]/health`

Check deployment health status.

**Headers:**

```
Authorization: Bearer {access_token}
```

**Response (200):**

```json
{
  "isHealthy": true,
  "responseTime": 245,
  "statusCode": 200,
  "error": null,
  "lastChecked": "2024-01-15T12:00:00Z"
}
```

#### POST `/api/deployments/[id]/repository`

Create a private GitHub repository for a deployment under the configured account or installation.

**Headers:**

```
Authorization: Bearer {access_token}
```

**Request Body:**

```json
{
  "private": true,
  "description": "Production repository for My DEX",
  "homepage": "https://craft.app/deployments/dep-123",
  "topics": ["stellar", "dex", "generated"]
}
```

**Response (201):**

```json
{
  "repositoryId": 12345,
  "repositoryUrl": "https://github.com/acme/my-dex",
  "cloneUrl": "https://github.com/acme/my-dex.git",
  "sshUrl": "git@github.com:acme/my-dex.git",
  "fullName": "acme/my-dex",
  "defaultBranch": "main",
  "resolvedName": "my-dex"
}
```

**Errors:**

- `400` - Invalid JSON or invalid request body
- `401` - Unauthorized
- `403` - Deployment does not belong to the current user
- `404` - Deployment not found
- `409` - Repository name collision after all retries
- `429` - GitHub API rate limit exceeded

### Webhook Endpoints

#### POST `/api/webhooks/stripe`

Handle Stripe webhook events.

**Headers:**

```
stripe-signature: {signature}
```

**Supported Events:**

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

### Cron Endpoints

#### GET `/api/cron/health-check`

Automated health check for all active deployments (called by Vercel Cron).

**Headers:**

```
Authorization: Bearer {CRON_SECRET}
```

**Response (200):**

```json
{
  "checked": 15,
  "healthy": 14,
  "unhealthy": 1,
  "results": [
    {
      "deploymentId": "uuid",
      "isHealthy": true,
      "responseTime": 245
    }
  ]
}
```

---

## 🗄️ Database Schema

### Tables Overview

CRAFT uses PostgreSQL via Supabase with the following schema:

#### `profiles`

User profiles with subscription information.

| Column                   | Type      | Description                                           |
| ------------------------ | --------- | ----------------------------------------------------- |
| `id`                     | UUID      | Primary key (references auth.users)                   |
| `email`                  | TEXT      | User email address                                    |
| `full_name`              | TEXT      | User's full name                                      |
| `avatar_url`             | TEXT      | Profile picture URL                                   |
| `subscription_tier`      | TEXT      | Current subscription (free, starter, pro, enterprise) |
| `stripe_customer_id`     | TEXT      | Stripe customer ID                                    |
| `stripe_subscription_id` | TEXT      | Stripe subscription ID                                |
| `created_at`             | TIMESTAMP | Account creation date                                 |
| `updated_at`             | TIMESTAMP | Last update date                                      |

**Indexes:**

- `profiles_email_idx` on `email`
- `profiles_stripe_customer_id_idx` on `stripe_customer_id`

**RLS Policies:**

- Users can read their own profile
- Users can update their own profile
- Service role can read/write all profiles

#### `templates`

Available DeFi application templates.

| Column                 | Type      | Description                          |
| ---------------------- | --------- | ------------------------------------ |
| `id`                   | UUID      | Primary key                          |
| `name`                 | TEXT      | Template name                        |
| `description`          | TEXT      | Detailed description                 |
| `category`             | TEXT      | Category (dex, defi, payment, asset) |
| `version`              | TEXT      | Template version                     |
| `repository_url`       | TEXT      | GitHub repository URL                |
| `preview_url`          | TEXT      | Live preview URL                     |
| `thumbnail_url`        | TEXT      | Thumbnail image URL                  |
| `features`             | JSONB     | Array of feature names               |
| `customization_schema` | JSONB     | JSON Schema for customization        |
| `required_env_vars`    | TEXT[]    | Required environment variables       |
| `is_active`            | BOOLEAN   | Whether template is available        |
| `created_at`           | TIMESTAMP | Creation date                        |
| `updated_at`           | TIMESTAMP | Last update date                     |

**Indexes:**

- `templates_category_idx` on `category`
- `templates_is_active_idx` on `is_active`

**RLS Policies:**

- All authenticated users can read active templates
- Only service role can write templates

#### `deployments`

User deployments of templates.

| Column                  | Type      | Description                                   |
| ----------------------- | --------- | --------------------------------------------- |
| `id`                    | UUID      | Primary key                                   |
| `user_id`               | UUID      | Foreign key to profiles                       |
| `template_id`           | UUID      | Foreign key to templates                      |
| `name`                  | TEXT      | Deployment name                               |
| `description`           | TEXT      | Deployment description                        |
| `status`                | TEXT      | Status (pending, building, completed, failed) |
| `deployment_url`        | TEXT      | Live deployment URL                           |
| `repository_url`        | TEXT      | GitHub repository URL                         |
| `customization_config`  | JSONB     | Applied customization                         |
| `environment_variables` | JSONB     | Environment variables (encrypted)             |
| `vercel_project_id`     | TEXT      | Vercel project ID                             |
| `github_repo_id`        | TEXT      | GitHub repository ID                          |
| `is_active`             | BOOLEAN   | Whether deployment is active                  |
| `last_deployed_at`      | TIMESTAMP | Last deployment date                          |
| `created_at`            | TIMESTAMP | Creation date                                 |
| `updated_at`            | TIMESTAMP | Last update date                              |

**Indexes:**

- `deployments_user_id_idx` on `user_id`
- `deployments_template_id_idx` on `template_id`
- `deployments_status_idx` on `status`
- `deployments_is_active_idx` on `is_active`

**RLS Policies:**

- Users can read their own deployments
- Users can create deployments (with subscription check)
- Users can update their own deployments
- Users can delete their own deployments

#### `deployment_logs`

Logs for deployment processes.

| Column          | Type      | Description                  |
| --------------- | --------- | ---------------------------- |
| `id`            | UUID      | Primary key                  |
| `deployment_id` | UUID      | Foreign key to deployments   |
| `log_level`     | TEXT      | Level (info, warning, error) |
| `message`       | TEXT      | Log message                  |
| `metadata`      | JSONB     | Additional context           |
| `created_at`    | TIMESTAMP | Log timestamp                |

**Indexes:**

- `deployment_logs_deployment_id_idx` on `deployment_id`
- `deployment_logs_created_at_idx` on `created_at`

**RLS Policies:**

- Users can read logs for their own deployments
- Service role can write logs

#### `customization_drafts`

Saved customization configurations.

| Column                 | Type      | Description              |
| ---------------------- | --------- | ------------------------ |
| `id`                   | UUID      | Primary key              |
| `user_id`              | UUID      | Foreign key to profiles  |
| `template_id`          | UUID      | Foreign key to templates |
| `name`                 | TEXT      | Draft name               |
| `customization_config` | JSONB     | Customization data       |
| `created_at`           | TIMESTAMP | Creation date            |
| `updated_at`           | TIMESTAMP | Last update date         |

**Indexes:**

- `customization_drafts_user_id_idx` on `user_id`
- `customization_drafts_template_id_idx` on `template_id`

**RLS Policies:**

- Users can read their own drafts
- Users can create/update/delete their own drafts

#### `deployment_analytics`

Analytics and metrics for deployments.

| Column          | Type      | Description                                       |
| --------------- | --------- | ------------------------------------------------- |
| `id`            | UUID      | Primary key                                       |
| `deployment_id` | UUID      | Foreign key to deployments                        |
| `metric_type`   | TEXT      | Type (page_view, uptime_check, transaction_count) |
| `metric_value`  | NUMERIC   | Metric value                                      |
| `metadata`      | JSONB     | Additional data                                   |
| `recorded_at`   | TIMESTAMP | Metric timestamp                                  |

**Indexes:**

- `deployment_analytics_deployment_id_idx` on `deployment_id`
- `deployment_analytics_metric_type_idx` on `metric_type`
- `deployment_analytics_recorded_at_idx` on `recorded_at`

**RLS Policies:**

- Users can read analytics for their own deployments
- Service role can write analytics

### Database Migrations

Migrations are located in `supabase/migrations/`:

1. **001_initial_schema.sql** - Creates all tables and basic indexes
2. **002_row_level_security.sql** - Implements RLS policies
3. **003_seed_templates.sql** - Seeds initial template data

To run migrations:

```bash
npx supabase db push
```

To create a new migration:

```bash
npx supabase migration new migration_name
```

---

## 🚢 Deployment Guide

### Deploying to Vercel

#### Option 1: Deploy via Vercel Dashboard

1. **Push to GitHub**

   ```bash
   git push origin main
   ```

2. **Import to Vercel**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repository
   - Select the `apps/web` directory as root

3. **Configure Environment Variables**
   Add all variables from `.env.local` to Vercel:
   - Go to Project Settings > Environment Variables
   - Add each variable
   - Deploy

#### Option 2: Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
cd apps/web
vercel --prod
```

#### Configure Custom Domain

1. Go to Project Settings > Domains
2. Add your custom domain
3. Configure DNS records as instructed
4. Wait for SSL certificate provisioning

### Deploying Supabase

#### Option 1: Use Supabase Cloud

Already done if you followed the setup guide!

#### Option 2: Self-Host Supabase

```bash
# Clone Supabase
git clone https://github.com/supabase/supabase
cd supabase/docker

# Start services
docker-compose up -d

# Run migrations
npx supabase db push --db-url postgresql://postgres:postgres@localhost:5432/postgres
```

### Environment-Specific Configuration

#### Development

```env
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
STELLAR_NETWORK=testnet
```

#### Staging

```env
NODE_ENV=staging
NEXT_PUBLIC_APP_URL=https://staging.craft.app
STELLAR_NETWORK=testnet
```

#### Production

```env
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://craft.app
STELLAR_NETWORK=mainnet
```

### Vercel Cron Jobs

CRAFT uses Vercel Cron for scheduled tasks. Configuration in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/health-check",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

This runs health checks every 5 minutes for all active deployments.

---

## ⚙️ Configuration

### Subscription Tiers

Configure subscription limits in your code:

```typescript
// apps/web/src/lib/subscription-limits.ts
export const SUBSCRIPTION_LIMITS = {
  free: {
    maxDeployments: 1,
    maxCustomDomains: 0,
    analytics: false,
    support: 'community',
  },
  starter: {
    maxDeployments: 3,
    maxCustomDomains: 1,
    analytics: true,
    support: 'email',
  },
  pro: {
    maxDeployments: 10,
    maxCustomDomains: 5,
    analytics: true,
    support: 'priority',
  },
  enterprise: {
    maxDeployments: -1, // unlimited
    maxCustomDomains: -1,
    analytics: true,
    support: 'dedicated',
  },
};
```

### Stellar Network Configuration

Switch between testnet and mainnet:

```typescript
// packages/stellar/src/index.ts
export const STELLAR_CONFIG = {
  network: process.env.STELLAR_NETWORK || 'testnet',
  horizonUrl:
    process.env.STELLAR_NETWORK === 'mainnet'
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org',
  networkPassphrase:
    process.env.STELLAR_NETWORK === 'mainnet'
      ? Networks.PUBLIC
      : Networks.TESTNET,
};
```

### Rate Limiting

Configure API rate limits:

```typescript
// apps/web/src/middleware.ts
export const RATE_LIMITS = {
  anonymous: {
    requests: 10,
    window: '1m',
  },
  authenticated: {
    requests: 100,
    window: '1m',
  },
  premium: {
    requests: 1000,
    window: '1m',
  },
};
```

---

## 🔐 Security

### Security Best Practices

CRAFT implements multiple layers of security:

#### 1. Authentication & Authorization

- **JWT Tokens**: Secure, stateless authentication
- **Row-Level Security**: Database-level access control
- **Session Management**: Automatic token refresh
- **Password Hashing**: bcrypt with salt rounds

#### 2. Data Protection

- **Encryption at Rest**: All sensitive data encrypted
- **Encryption in Transit**: HTTPS/TLS everywhere
- **Secret Management**: Environment variables for secrets
- **API Key Rotation**: Regular rotation recommended

#### 3. Input Validation

- **Zod Schemas**: Type-safe validation
- **SQL Injection Prevention**: Parameterized queries
- **XSS Protection**: Input sanitization
- **CSRF Protection**: Token-based protection

#### 4. Rate Limiting

- **API Rate Limits**: Prevent abuse
- **DDoS Protection**: Vercel's built-in protection
- **Webhook Verification**: Stripe signature verification

### Security Checklist

Before going to production:

- [ ] Change all default passwords
- [ ] Rotate all API keys and secrets
- [ ] Enable 2FA on all service accounts
- [ ] Configure CORS properly
- [ ] Set up monitoring and alerts
- [ ] Review RLS policies
- [ ] Enable Vercel's security headers
- [ ] Set up backup strategy
- [ ] Configure rate limiting
- [ ] Review and test webhook security

### Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** open a public issue
2. Email security@craft.app (if available)
3. Include detailed description and steps to reproduce
4. Allow reasonable time for fix before disclosure

---

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run tests for specific package
npm run test -- packages/types
```

### Test Structure

```
apps/web/
├── src/
│   ├── services/
│   │   ├── auth.service.ts
│   │   └── auth.service.test.ts
│   └── lib/
│       ├── utils.ts
│       └── utils.test.ts
```

### Writing Tests

Example test file:

```typescript
import { describe, it, expect } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  it('should sign up a new user', async () => {
    const authService = new AuthService();
    const result = await authService.signUp({
      email: 'test@example.com',
      password: 'password123',
    });

    expect(result.user).toBeDefined();
    expect(result.user.email).toBe('test@example.com');
  });
});
```

### Test Coverage Goals

- **Unit Tests**: 80%+ coverage
- **Integration Tests**: Critical paths covered
- **E2E Tests**: Main user flows (coming soon)

---

## 📊 Monitoring & Analytics

### Built-in Analytics

CRAFT includes comprehensive analytics for all deployments:

#### Metrics Tracked

1. **Page Views**
   - Total page views per deployment
   - Unique visitors (coming soon)
   - Geographic distribution (coming soon)

2. **Uptime Monitoring**
   - Health checks every 5 minutes
   - Response time tracking
   - Uptime percentage calculation
   - Downtime alerts

3. **Transaction Analytics**
   - Stellar transaction count
   - Transaction volume
   - Failed transaction tracking

4. **Performance Metrics**
   - API response times
   - Error rates
   - Resource usage

#### Accessing Analytics

Via API:

```bash
curl -H "Authorization: Bearer {token}" \
  https://craft.app/api/deployments/{id}/analytics
```

Via Dashboard (coming soon):

- Real-time metrics
- Historical charts
- Export to CSV
- Custom date ranges

#### Exporting Data

```bash
curl -H "Authorization: Bearer {token}" \
  "https://craft.app/api/deployments/{id}/analytics/export?startDate=2024-01-01&endDate=2024-01-31" \
  > analytics.csv
```

### External Monitoring

Recommended tools for additional monitoring:

- **Vercel Analytics**: Built-in performance monitoring
- **Sentry**: Error tracking and monitoring
- **LogRocket**: Session replay and debugging
- **Datadog**: Infrastructure monitoring
- **PagerDuty**: Incident management

---

## 🔧 Troubleshooting

### Common Issues

#### Issue: "Supabase connection failed"

**Symptoms:**

- Database queries fail
- Authentication doesn't work
- Error: "Failed to connect to database"

**Solutions:**

1. Check environment variables:
   ```bash
   echo $NEXT_PUBLIC_SUPABASE_URL
   echo $NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```
2. Verify Supabase project is running
3. Check network connectivity
4. Verify API keys are correct

#### Issue: "Stripe webhook not working"

**Symptoms:**

- Subscription status not updating
- Payments not reflected in database
- Webhook endpoint returns 400/500

**Solutions:**

1. Verify webhook secret:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
2. Check webhook signature validation
3. Verify endpoint is publicly accessible
4. Check Stripe dashboard for failed webhooks

#### Issue: "Deployment fails on Vercel"

**Symptoms:**

- Build fails
- Deployment times out
- Runtime errors

**Solutions:**

1. Check build logs in Vercel dashboard
2. Verify all environment variables are set
3. Test build locally:
   ```bash
   npm run build
   ```
4. Check for missing dependencies
5. Verify Node.js version compatibility

#### Issue: "Template customization not applying"

**Symptoms:**

- Changes don't appear in preview
- Customization config not saved
- Default values used instead

**Solutions:**

1. Verify customization schema matches template
2. Check for validation errors
3. Clear browser cache
4. Verify database write permissions

#### Issue: "Stellar transactions failing"

**Symptoms:**

- Transactions not submitting
- "Insufficient balance" errors
- Network timeout errors

**Solutions:**

1. Check Stellar network status
2. Verify account has sufficient XLM
3. Check Horizon URL configuration
4. Verify network (testnet vs mainnet)
5. Check transaction fee settings

### Debug Mode

Enable debug logging:

```env
# .env.local
DEBUG=craft:*
LOG_LEVEL=debug
```

View logs:

```bash
# Development
npm run dev

# Production (Vercel)
vercel logs
```

### Getting Help

1. **Documentation**: Check this README first
2. **GitHub Issues**: Search existing issues
3. **Community**: Join our Discord (coming soon)
4. **Support**: Email support@craft.app (for paid plans)

---

## 🤝 Contributing

We welcome contributions from the community! Here's how you can help:

### Ways to Contribute

- 🐛 **Report Bugs**: Open an issue with detailed reproduction steps
- 💡 **Suggest Features**: Share your ideas for improvements
- 📝 **Improve Documentation**: Fix typos, add examples, clarify instructions
- 🔧 **Submit Code**: Fix bugs or implement new features
- 🎨 **Design**: Improve UI/UX
- 🧪 **Testing**: Write tests, report edge cases

### Development Workflow

1. **Fork the Repository**

   ```bash
   # Click "Fork" on GitHub, then:
   git clone https://github.com/YOUR_USERNAME/craft.git
   cd craft
   ```

2. **Create a Branch**

   ```bash
   git checkout -b feature/amazing-feature
   # or
   git checkout -b fix/bug-description
   ```

3. **Make Changes**
   - Write clean, documented code
   - Follow existing code style
   - Add tests for new features
   - Update documentation

4. **Test Your Changes**

   ```bash
   npm run test
   npm run lint
   npm run build
   ```

5. **Commit Changes**

   ```bash
   git add .
   git commit -m "Add amazing feature"
   ```

   Commit message format:
   - `feat: Add new feature`
   - `fix: Fix bug description`
   - `docs: Update documentation`
   - `test: Add tests`
   - `refactor: Refactor code`

6. **Push and Create PR**
   ```bash
   git push origin feature/amazing-feature
   ```
   Then open a Pull Request on GitHub

### Code Style Guidelines

- **TypeScript**: Use strict mode, avoid `any`
- **Naming**: camelCase for variables, PascalCase for components
- **Comments**: Document complex logic
- **Formatting**: Prettier handles this automatically
- **Imports**: Group by external, internal, relative

### Pull Request Checklist

Before submitting a PR:

- [ ] Code follows project style guidelines
- [ ] Tests pass (`npm run test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Documentation updated (if needed)
- [ ] Commit messages are clear
- [ ] PR description explains changes
- [ ] Screenshots included (for UI changes)

### Review Process

1. Automated checks run (tests, linting, build)
2. Maintainer reviews code
3. Feedback addressed
4. PR approved and merged

---

## 🗺️ Roadmap

### Phase 1: Core Platform (Current)

- [x] Project setup and infrastructure
- [x] Database schema and authentication
- [x] Shared type definitions
- [x] Stripe payment integration
- [x] Template management system
- [x] Analytics and monitoring
- [ ] Customization system
- [ ] Template generator
- [ ] Deployment engine

### Phase 2: Enhanced Features (Q2 2024)

- [ ] Visual customization editor
- [ ] Real-time preview
- [ ] Advanced analytics dashboard
- [ ] Team collaboration features
- [ ] Template marketplace
- [ ] Custom domain management
- [ ] Email notifications
- [ ] Webhook management

### Phase 3: Advanced Capabilities (Q3 2024)

- [ ] AI-powered template suggestions
- [ ] Automated testing for deployments
- [ ] Multi-chain support (beyond Stellar)
- [ ] Advanced monitoring and alerting
- [ ] White-label solutions
- [ ] API for programmatic access
- [ ] Mobile app (iOS/Android)

### Phase 4: Enterprise Features (Q4 2024)

- [ ] SSO integration
- [ ] Advanced security features
- [ ] Compliance tools (KYC/AML)
- [ ] Dedicated support
- [ ] SLA guarantees
- [ ] Custom contract development
- [ ] Audit logging

### Community Requests

Vote on features you'd like to see:

- GitHub Discussions (coming soon)
- Discord polls (coming soon)

---

## 📄 License

This project is **private and proprietary**. All rights reserved.

### Usage Terms

- ✅ Use for personal projects
- ✅ Use for commercial projects (with subscription)
- ❌ Redistribute or resell the platform
- ❌ Remove branding (without Enterprise plan)
- ❌ Reverse engineer or copy

For licensing inquiries: licensing@craft.app

---

## 🙏 Acknowledgments

CRAFT wouldn't be possible without these amazing projects and communities:

### Core Technologies

- **[Stellar Development Foundation](https://stellar.org)** - For building an incredible blockchain platform
- **[Vercel](https://vercel.com)** - For the best deployment experience
- **[Supabase](https://supabase.com)** - For making backend development a breeze
- **[Stripe](https://stripe.com)** - For reliable payment processing

### Open Source Projects

- **[Next.js](https://nextjs.org)** - The React framework for production
- **[TailwindCSS](https://tailwindcss.com)** - For beautiful, utility-first styling
- **[TypeScript](https://typescriptlang.org)** - For type safety and better DX
- **[Turborepo](https://turbo.build)** - For monorepo management

### Community

- All contributors who have helped improve CRAFT
- The Stellar community for feedback and support
- Beta testers who helped identify issues

---

## 📧 Contact & Support

### General Inquiries

- **Email**: hello@craft.app
- **Website**: https://craft.app
- **Twitter**: @craft_platform

### Support

- **Documentation**: https://docs.craft.app
- **Community Discord**: https://discord.gg/craft (coming soon)
- **GitHub Issues**: https://github.com/temma02/craft/issues

### Business

- **Partnerships**: partnerships@craft.app
- **Enterprise Sales**: enterprise@craft.app
- **Press**: press@craft.app

---

## 📊 Project Stats

![GitHub stars](https://img.shields.io/github/stars/temma02/craft?style=social)
![GitHub forks](https://img.shields.io/github/forks/temma02/craft?style=social)
![GitHub issues](https://img.shields.io/github/issues/temma02/craft)
![GitHub pull requests](https://img.shields.io/github/issues-pr/temma02/craft)

---

<div align="center">

**Built with ❤️ for the Stellar ecosystem**

[Website](https://craft.app) • [Documentation](https://docs.craft.app) • [Discord](https://discord.gg/craft) • [Twitter](https://twitter.com/craft_platform)

</div>

## Automated PR Test
This change is added by GitHub Copilot exercise.
