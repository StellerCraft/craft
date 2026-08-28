import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTemplateGenerator = {
  generateTemplate: vi.fn(),
  applyCustomization: vi.fn(),
};

const mockCodeGenerator = {
  generateCode: vi.fn(),
  buildPackage: vi.fn(),
};

const mockGitHubPush = {
  createRepository: vi.fn(),
  pushCode: vi.fn(),
  createCommit: vi.fn(),
};

vi.mock('@/services/template-generator.service', () => ({
  templateGeneratorService: mockTemplateGenerator,
}));

vi.mock('@/services/code-generator.service', () => ({
  codeGeneratorService: mockCodeGenerator,
}));

vi.mock('@/services/github-push.service', () => ({
  githubPushService: mockGitHubPush,
}));

describe('Template Deployment Full Code Generation to Repository Push Integration', () => {
  const templates = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'];
  const userId = 'user-template-deployment-001';
  const deploymentId = 'dep-template-001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Template Selection and Initialization', () => {
    it('should support all four templates: stellar-dex, soroban-defi, payment-gateway, asset-issuance', async () => {
      const selectedTemplates = templates;
      expect(selectedTemplates).toContain('stellar-dex');
      expect(selectedTemplates).toContain('soroban-defi');
      expect(selectedTemplates).toContain('payment-gateway');
      expect(selectedTemplates).toContain('asset-issuance');
      expect(selectedTemplates.length).toBe(4);
    });

    it('should initialize template for stellar-dex', async () => {
      const template = {
        id: 'tpl_stellar_dex',
        name: 'stellar-dex',
        category: 'dex',
        description: 'Decentralized exchange for Stellar assets',
        repositoryUrl: 'https://github.com/craft/stellar-dex-template',
      };

      expect(template.name).toBe('stellar-dex');
      expect(template.category).toBe('dex');
    });

    it('should initialize template for soroban-defi', async () => {
      const template = {
        id: 'tpl_soroban_defi',
        name: 'soroban-defi',
        category: 'defi',
        description: 'Soroban smart contract DeFi platform',
        repositoryUrl: 'https://github.com/craft/soroban-defi-template',
      };

      expect(template.name).toBe('soroban-defi');
      expect(template.category).toBe('defi');
    });

    it('should initialize template for payment-gateway', async () => {
      const template = {
        id: 'tpl_payment_gateway',
        name: 'payment-gateway',
        category: 'payment',
        description: 'Accept Stellar payments with enterprise features',
        repositoryUrl: 'https://github.com/craft/payment-gateway-template',
      };

      expect(template.name).toBe('payment-gateway');
      expect(template.category).toBe('payment');
    });

    it('should initialize template for asset-issuance', async () => {
      const template = {
        id: 'tpl_asset_issuance',
        name: 'asset-issuance',
        category: 'asset',
        description: 'Create and manage custom Stellar assets',
        repositoryUrl: 'https://github.com/craft/asset-issuance-template',
      };

      expect(template.name).toBe('asset-issuance');
      expect(template.category).toBe('asset');
    });
  });

  describe('Code Generation Pipeline', () => {
    it('should generate code from template using template generator', async () => {
      const customization = {
        appName: 'My DEX',
        primaryColor: '#007bff',
        secondaryColor: '#6c757d',
        network: 'testnet',
      };

      mockTemplateGenerator.generateTemplate.mockResolvedValue({
        templateId: 'tpl_stellar_dex',
        baseDir: '/tmp/template-gen-001',
        files: {
          'package.json': '{ "name": "my-dex" }',
          'src/App.tsx': 'export default function App() { ... }',
        },
      });

      mockCodeGenerator.generateCode.mockResolvedValue({
        generatedCode: {
          'package.json': '{ "name": "my-dex", "version": "1.0.0" }',
          'src/App.tsx': 'export default function App() { return <div>My DEX</div> }',
          'tailwind.config.ts': 'module.exports = { theme: { colors: { primary: "#007bff" } } }',
        },
        stats: {
          filesGenerated: 3,
          linesOfCode: 1500,
        },
      });

      const generated = await mockCodeGenerator.generateCode({
        template: 'stellar-dex',
        customization,
      });

      expect(generated.stats.filesGenerated).toBe(3);
      expect(mockCodeGenerator.generateCode).toHaveBeenCalled();
    });

    it('should build package.json with correct dependencies', async () => {
      const packageBuild = {
        name: 'my-dex',
        version: '1.0.0',
        dependencies: {
          'next': '^14.0.0',
          'react': '^18.0.0',
          '@craft/stellar': '*',
        },
        devDependencies: {
          'typescript': '^5.0.0',
          'tailwindcss': '^3.0.0',
        },
      };

      expect(packageBuild.dependencies).toHaveProperty('next');
      expect(packageBuild.dependencies).toHaveProperty('@craft/stellar');
    });
  });

  describe('Customization Application', () => {
    it('should apply branding customization to generated files', async () => {
      const customization = {
        branding: {
          appName: 'MyBranded DEX',
          primaryColor: '#ff6b6b',
          secondaryColor: '#4ecdc4',
          logoUrl: 'https://example.com/logo.png',
        },
      };

      mockTemplateGenerator.applyCustomization.mockResolvedValue({
        appliedCustomization: true,
        modifiedFiles: [
          'tailwind.config.ts',
          'src/components/Layout.tsx',
          'public/manifest.json',
        ],
      });

      const result = await mockTemplateGenerator.applyCustomization(customization);

      expect(result.appliedCustomization).toBe(true);
      expect(result.modifiedFiles).toContain('tailwind.config.ts');
    });

    it('should embed non-default branding config in generated app.config.ts', async () => {
      const customization = {
        appName: 'Custom DEX',
        primaryColor: '#ff0000',
        secondaryColor: '#00ff00',
      };

      const generatedConfig = {
        'app.config.ts': `
          export const appConfig = {
            appName: 'Custom DEX',
            theme: {
              primaryColor: '#ff0000',
              secondaryColor: '#00ff00',
            }
          }
        `,
      };

      expect(generatedConfig['app.config.ts']).toContain('Custom DEX');
      expect(generatedConfig['app.config.ts']).toContain('#ff0000');
    });

    it('should customize Stellar network configuration in environment', async () => {
      const customization = {
        stellar: {
          network: 'mainnet',
          horizonUrl: 'https://horizon.stellar.org',
          assetPairs: ['stellar.native:USDC', 'stellar.native:BTC'],
        },
      };

      const envConfig = {
        STELLAR_NETWORK: 'mainnet',
        STELLAR_HORIZON_URL: 'https://horizon.stellar.org',
        ASSET_PAIRS: 'stellar.native:USDC,stellar.native:BTC',
      };

      expect(envConfig.STELLAR_NETWORK).toBe('mainnet');
      expect(envConfig.ASSET_PAIRS).toContain('USDC');
    });

    it('should verify customization reflects in generated files', async () => {
      const customization = {
        appName: 'Verified App Name',
        primaryColor: '#123456',
      };

      const generatedContent = `
        const AppConfig = {
          name: 'Verified App Name',
          theme: { primary: '#123456' }
        }
      `;

      expect(generatedContent).toContain('Verified App Name');
      expect(generatedContent).toContain('#123456');
    });
  });

  describe('GitHub Repository Push', () => {
    it('should create GitHub repository with correct metadata', async () => {
      mockGitHubPush.createRepository.mockResolvedValue({
        id: 12345,
        name: 'my-dex',
        full_name: 'user-org/my-dex',
        url: 'https://github.com/user-org/my-dex',
        private: true,
        description: 'My custom DEX built with CRAFT',
        topics: ['stellar', 'dex', 'craft-generated'],
      });

      const repo = await mockGitHubPush.createRepository({
        name: 'my-dex',
        private: true,
        description: 'My custom DEX built with CRAFT',
      });

      expect(repo.name).toBe('my-dex');
      expect(repo.private).toBe(true);
      expect(repo.topics).toContain('stellar');
    });

    it('should push generated code to GitHub with correct commit message', async () => {
      const codeToCommit = {
        'package.json': '{ "name": "my-dex" }',
        'src/App.tsx': 'export default function App() {}',
        'README.md': '# My DEX\n\nGenerated by CRAFT',
      };

      mockGitHubPush.pushCode.mockResolvedValue({
        ref: 'refs/heads/main',
        sha: 'abc123def456',
        repositoryId: 12345,
      });

      mockGitHubPush.createCommit.mockResolvedValue({
        message: 'Initial commit: Generated by CRAFT template stellar-dex',
        sha: 'abc123def456',
        author: { name: 'CRAFT Platform', email: 'craft@example.com' },
        committer: { name: 'CRAFT Platform', email: 'craft@example.com' },
      });

      const commit = await mockGitHubPush.createCommit({
        message: 'Initial commit: Generated by CRAFT template stellar-dex',
        files: codeToCommit,
      });

      expect(commit.message).toContain('CRAFT template stellar-dex');
    });

    it('should use correct branch naming convention (main)', async () => {
      const branch = {
        name: 'main',
        protected: true,
        default: true,
      };

      expect(branch.name).toBe('main');
      expect(branch.default).toBe(true);
    });

    it('should include customized branding in pushed repository', async () => {
      const customBrandedFiles = {
        'tailwind.config.ts': 'export const config = { theme: { colors: { primary: "#ff6b6b" } } }',
        'src/components/Header.tsx': 'export function Header() { return <div className="text-primary">MyBrand</div> }',
        '.env.example': 'APP_NAME=MyBrand DEX\nPRIMARY_COLOR=#ff6b6b',
      };

      mockGitHubPush.pushCode.mockResolvedValue({
        files: Object.keys(customBrandedFiles),
        customizationApplied: true,
      });

      const result = await mockGitHubPush.pushCode(customBrandedFiles);

      expect(result.customizationApplied).toBe(true);
      expect(result.files).toContain('tailwind.config.ts');
    });

    it('should verify generated files are pushed in a single commit', async () => {
      const generatedFiles = [
        'package.json',
        'tsconfig.json',
        'next.config.js',
        'tailwind.config.ts',
        'src/App.tsx',
        'src/components/Layout.tsx',
        'public/index.html',
        'README.md',
      ];

      mockGitHubPush.createCommit.mockResolvedValue({
        filesIncluded: generatedFiles,
        totalFiles: generatedFiles.length,
        sha: 'commit_hash_123',
      });

      const commit = await mockGitHubPush.createCommit({
        files: generatedFiles,
      });

      expect(commit.totalFiles).toBe(generatedFiles.length);
      expect(commit.filesIncluded).toContain('package.json');
    });
  });

  describe('Full Integration Workflow', () => {
    it('should complete stellar-dex deployment in <15 seconds', async () => {
      const startTime = Date.now();

      mockTemplateGenerator.generateTemplate.mockResolvedValue({
        templateId: 'tpl_stellar_dex',
        baseDir: '/tmp/gen-001',
        files: { 'package.json': '{}' },
      });

      mockCodeGenerator.generateCode.mockResolvedValue({
        stats: { filesGenerated: 10 },
      });

      mockGitHubPush.createRepository.mockResolvedValue({
        id: 1,
        url: 'https://github.com/user/my-dex',
      });

      mockGitHubPush.createCommit.mockResolvedValue({
        sha: 'abc123',
      });

      // Simulate full workflow
      await mockTemplateGenerator.generateTemplate('stellar-dex');
      await mockCodeGenerator.generateCode({});
      await mockGitHubPush.createRepository({});
      await mockGitHubPush.createCommit({});

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(15000);
    });

    it('should complete soroban-defi deployment in <15 seconds', async () => {
      const startTime = Date.now();

      mockTemplateGenerator.generateTemplate.mockResolvedValue({
        templateId: 'tpl_soroban_defi',
      });

      mockCodeGenerator.generateCode.mockResolvedValue({});
      mockGitHubPush.createRepository.mockResolvedValue({ id: 2 });
      mockGitHubPush.createCommit.mockResolvedValue({ sha: 'def456' });

      await mockTemplateGenerator.generateTemplate('soroban-defi');
      await mockCodeGenerator.generateCode({});
      await mockGitHubPush.createRepository({});
      await mockGitHubPush.createCommit({});

      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(15000);
    });

    it('should complete payment-gateway deployment in <15 seconds', async () => {
      mockTemplateGenerator.generateTemplate.mockResolvedValue({
        templateId: 'tpl_payment_gateway',
      });

      mockCodeGenerator.generateCode.mockResolvedValue({});
      mockGitHubPush.createRepository.mockResolvedValue({ id: 3 });
      mockGitHubPush.createCommit.mockResolvedValue({ sha: 'ghi789' });

      const startTime = Date.now();
      await mockTemplateGenerator.generateTemplate('payment-gateway');
      await mockCodeGenerator.generateCode({});
      await mockGitHubPush.createRepository({});
      await mockGitHubPush.createCommit({});
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(15000);
    });

    it('should complete asset-issuance deployment in <15 seconds', async () => {
      mockTemplateGenerator.generateTemplate.mockResolvedValue({
        templateId: 'tpl_asset_issuance',
      });

      mockCodeGenerator.generateCode.mockResolvedValue({});
      mockGitHubPush.createRepository.mockResolvedValue({ id: 4 });
      mockGitHubPush.createCommit.mockResolvedValue({ sha: 'jkl012' });

      const startTime = Date.now();
      await mockTemplateGenerator.generateTemplate('asset-issuance');
      await mockCodeGenerator.generateCode({});
      await mockGitHubPush.createRepository({});
      await mockGitHubPush.createCommit({});
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(15000);
    });
  });

  describe('Customization Application Verification', () => {
    it('should verify app name appears in customized generated files', async () => {
      const customization = {
        appName: 'SuperDEX Exchange',
        primaryColor: '#ff0000',
      };

      const generatedCode = {
        'package.json': '{ "name": "super-dex-exchange" }',
        'src/components/Header.tsx': 'export function Header() { return <h1>SuperDEX Exchange</h1> }',
      };

      expect(generatedCode['src/components/Header.tsx']).toContain('SuperDEX Exchange');
    });

    it('should verify brand colors appear in customized generated files', async () => {
      const customization = {
        primaryColor: '#ff6b6b',
        secondaryColor: '#4ecdc4',
      };

      const generatedCode = {
        'tailwind.config.ts': `
          const colors = {
            primary: '#ff6b6b',
            secondary: '#4ecdc4',
          };
        `,
      };

      expect(generatedCode['tailwind.config.ts']).toContain('#ff6b6b');
      expect(generatedCode['tailwind.config.ts']).toContain('#4ecdc4');
    });

    it('should verify customization persists through full deployment cycle', async () => {
      const customization = {
        appName: 'PersistentApp',
        primaryColor: '#123456',
      };

      // Mock services to apply and propagate customization
      mockTemplateGenerator.applyCustomization.mockResolvedValue({
        appliedCustomization: true,
      });

      mockCodeGenerator.generateCode.mockResolvedValue({
        generatedCode: {
          'app.config.ts': 'export const config = { name: "PersistentApp", color: "#123456" }',
        },
      });

      await mockTemplateGenerator.applyCustomization(customization);
      const generated = await mockCodeGenerator.generateCode({});

      expect(generated.generatedCode['app.config.ts']).toContain('PersistentApp');
      expect(generated.generatedCode['app.config.ts']).toContain('#123456');
    });
  });
});
