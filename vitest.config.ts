import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    esbuild: {
        // Skip tsconfig extends resolution issues in the monorepo
        tsconfigRaw: {
            compilerOptions: {
                target: 'ES2020',
                module: 'ESNext',
                moduleResolution: 'bundler',
                resolveJsonModule: true,
                allowJs: true,
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                jsx: 'preserve',
                paths: {
                    '@/*': ['./apps/web/src/*'],
                    '@craft/types': ['./packages/types/src'],
                },
            },
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'apps/web/src'),
            '@craft/types': resolve(__dirname, 'packages/types/src'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
        },
    },
});
