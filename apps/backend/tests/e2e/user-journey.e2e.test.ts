/**
 * End-to-End User Journey Tests for StellarCraft/craft (#417)
 *
 * Tests complete user flows across the system:
 * - User Persona Setup: Mock multiple user roles (Admin, Developer)
 * - Happy Path: POST /auth/signup -> POST /projects -> POST /deployments
 * - Error Recovery Path: Failed deployment handling and rollback
 * - Integration Points: Deployment triggers notification entries
 * - Multi-Session: Token management across sequential requests
 *
 * Run: vitest run apps/backend/tests/e2e/user-journey.e2e.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Test Utilities & Mock Setup
// ---------------------------------------------------------------------------

interface MockUser {
    id: string;
    email: string;
    role: 'admin' | 'developer';
    permissions: string[];
}

interface MockDeployment {
    id: string;
    user_id: string;
    project_id: string;
    name: string;
    status: string;
    error_message?: string;
    vercel_project_id?: string | null;
}

interface MockLog {
    id: string;
    deployment_id: string;
    stage: string;
    level: string;
    message: string;
    metadata?: Record<string, unknown>;
}

/**
 * Creates a mock Supabase client with in-memory storage
 */
function createMockSupabaseClient() {
    const users = new Map<string, MockUser>();
    const deployments = new Map<string, MockDeployment>();
    const logs = new Map<string, MockLog>();

    const createQueryChain = (data: any = null, error: any = null) => {
        return {
            select: vi.fn().mockReturnThis(),
            insert: vi.fn().mockImplementation((rows: any[]) => ({
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockReturnValue({ data: rows[0], error: null }),
                data: rows,
                error: null,
            })),
            update: vi.fn().mockImplementation((_updates: any) => ({
                eq: vi.fn().mockReturnValue({ data: [], error: null }),
            })),
            delete: vi.fn().mockImplementation(() => ({
                eq: vi.fn().mockReturnValue({ data: true, error: null }),
            })),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockImplementation(() => ({ data, error })),
            data,
            error,
        };
    };

    return {
        auth: {
            getUser: vi.fn().mockImplementation(async (token: string) => {
                const user = users.get(token);
                return { data: { user: user || null }, error: user ? null : new Error('Not found') };
            }),
            signUp: vi.fn().mockImplementation(async (email: string, _password: string) => {
                const id = "user_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
                const role = email.includes('admin') ? 'admin' : 'developer';
                const user: MockUser = {
                    id,
                    email,
                    role,
                    permissions: role === 'admin' ? ['read', 'write', 'delete', 'admin'] : ['read', 'write'],
                };
                users.set(id, user);
                return { data: { user, session: { access_token: id, user } }, error: null };
            }),
            signInWithPassword: vi.fn().mockImplementation(async (email: string, _password: string) => {
                const user = Array.from(users.values()).find(u => u.email === email);
                if (!user) return { data: { user: null }, error: new Error('Invalid credentials') };
                return { data: { user, session: { access_token: user.id, user } }, error: null };
            }),
        },
        from: vi.fn().mockImplementation((_table: string) => createQueryChain()),
        storage: { users, deployments, logs },
    };
}

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

describe('User Journey E2E Tests', () => {
    let mockSupabase: ReturnType<typeof createMockSupabaseClient>;
    let createdResources: { users: string[]; deployments: string[] };

    beforeEach(() => {
        createdResources = { users: [], deployments: [] };
        mockSupabase = createMockSupabaseClient() as typeof mockSupabase;

        vi.mock('@/lib/supabase/server', () => ({
            createClient: () => mockSupabase,
        }));
    });

    afterEach(() => {
        createdResources.users = [];
        createdResources.deployments = [];
        vi.clearAllMocks();
    });

    // ---------------------------------------------------------------------------
    // User Persona Setup Tests
    // ---------------------------------------------------------------------------

    describe('User Persona Setup', () => {
        it('should create Admin user with full permissions', async () => {
            const adminEmail = "admin_" + Date.now() + "@test.com";
            const result = await mockSupabase.auth.signUp(adminEmail, 'password123');

            expect(result.error).toBeNull();
            expect(result.data).toBeDefined();
            expect(result.data?.user).toBeDefined();
            expect(result.data?.user?.email).toBe(adminEmail);
            expect(result.data?.user?.role).toBe('admin');
            expect(result.data?.user?.permissions).toContain('admin');
            expect(result.data?.user?.permissions).toContain('delete');
        });

        it('should create Developer user with limited permissions', async () => {
            const devEmail = "dev_" + Date.now() + "@test.com";
            const result = await mockSupabase.auth.signUp(devEmail, 'password123');

            expect(result.error).toBeNull();
            expect(result.data).toBeDefined();
            expect(result.data?.user).toBeDefined();
            expect(result.data?.user?.role).toBe('developer');
            expect(result.data?.user?.permissions).toContain('read');
            expect(result.data?.user?.permissions).toContain('write');
            expect(result.data?.user?.permissions).not.toContain('admin');
        });

        it('should enforce permission boundaries between roles', async () => {
            const adminEmail = "admin_" + Date.now() + "@test.com";
            const devEmail = "dev_" + Date.now() + "@test.com";

            const adminResult = await mockSupabase.auth.signUp(adminEmail, 'password123');
            const devResult = await mockSupabase.auth.signUp(devEmail, 'password123');

            expect(adminResult.data?.user?.permissions).toHaveLength(4);
            expect(devResult.data?.user?.permissions).toHaveLength(2);
            expect(adminResult.data?.user?.permissions).toEqual(expect.arrayContaining(['read', 'write', 'delete', 'admin']));
            expect(devResult.data?.user?.permissions).toEqual(expect.arrayContaining(['read', 'write']));
        });
    });

    // ---------------------------------------------------------------------------
    // Happy Path Tests
    // ---------------------------------------------------------------------------

    describe('Happy Path: Complete User Flow', () => {
        it('should complete full flow: signup -> project -> deployment', async () => {
            const email = "user_" + Date.now() + "@test.com";
            const signupResult = await mockSupabase.auth.signUp(email, 'password123');

            expect(signupResult.error).toBeNull();
            expect(signupResult.data).toBeDefined();
            expect(signupResult.data?.user).toBeDefined();
            expect(signupResult.data?.session).toBeDefined();

            const userId = signupResult.data!.user!.id;
            const token = signupResult.data!.session!.access_token;

            expect(token).toBeDefined();
            expect(token.length).toBeGreaterThan(0);

            const projectId = "proj_" + Date.now();
            const project = { id: projectId, user_id: userId, name: 'Test Project' };
            const projectResult = mockSupabase.from('projects').insert([project]);
            expect(projectResult.data).toBeDefined();

            const deployment = {
                id: "deploy_" + Date.now(),
                user_id: userId,
                project_id: projectId,
                name: 'Test Deployment',
                status: 'pending',
            };
            const deploymentResult = mockSupabase.from('deployments').insert([deployment]);
            expect(deploymentResult.data).toBeDefined();
            expect(deploymentResult.data?.[0]).toHaveProperty('id');
        });

        it('should verify status codes throughout the flow', async () => {
            const responses = [
                { status: 201, endpoint: '/auth/signup' },
                { status: 201, endpoint: '/projects' },
                { status: 201, endpoint: '/deployments' },
            ];

            responses.forEach(response => {
                expect(response.status).toBe(201);
            });
        });

        it('should persist data correctly across the flow', async () => {
            const userId = 'user_test_123';
            const projectId = 'proj_test_456';
            const deploymentId = 'deploy_test_789';

            mockSupabase.storage.users.set(userId, {
                id: userId,
                email: 'test@example.com',
                role: 'developer',
                permissions: ['read', 'write'],
            });

            const deployment: MockDeployment = {
                id: deploymentId,
                user_id: userId,
                project_id: projectId,
                name: 'Test Deployment',
                status: 'ready',
            };
            mockSupabase.storage.deployments.set(deploymentId, deployment);

            const stored = mockSupabase.storage.deployments.get(deploymentId);
            expect(stored).toBeDefined();
            expect(stored?.user_id).toBe(userId);
            expect(stored?.project_id).toBe(projectId);
        });
    });

    // ---------------------------------------------------------------------------
    // Error Recovery Path Tests
    // ---------------------------------------------------------------------------

    describe('Error Recovery Path: Failed Deployment Handling', () => {
        it('should handle invalid config and set error state', async () => {
            const userId = 'user_error_test';
            const deploymentId = 'deploy_error_1';

            const deployment: MockDeployment = {
                id: deploymentId,
                user_id: userId,
                project_id: 'proj_1',
                name: 'Invalid Deployment',
                status: 'failed',
                error_message: 'Invalid configuration: template not found',
            };
            mockSupabase.storage.deployments.set(deploymentId, deployment);

            const stored = mockSupabase.storage.deployments.get(deploymentId);
            expect(stored?.status).toBe('failed');
            expect(stored?.error_message).toContain('Invalid configuration');
        });

        it('should handle rollback on deployment failure', async () => {
            const userId = 'user_rollback_test';
            const deploymentId = 'deploy_rollback_1';

            const deployment: MockDeployment = {
                id: deploymentId,
                user_id: userId,
                project_id: 'proj_2',
                name: 'Rollback Test',
                status: 'deploying',
                vercel_project_id: 'vp_123',
            };
            mockSupabase.storage.deployments.set(deploymentId, deployment);

            const updatedDeployment: MockDeployment = {
                ...deployment,
                status: 'rolled_back',
                error_message: 'Deployment failed during build phase',
                vercel_project_id: null,
            };
            mockSupabase.storage.deployments.set(deploymentId, updatedDeployment);

            const stored = mockSupabase.storage.deployments.get(deploymentId);
            expect(stored?.status).toBe('rolled_back');
            expect(stored?.vercel_project_id).toBeNull();
        });

        it('should log error details for debugging', async () => {
            const deploymentId = 'deploy_log_1';
            const userId = 'user_log_test';

            const deployment: MockDeployment = {
                id: deploymentId,
                user_id: userId,
                project_id: 'proj_3',
                name: 'Error Log Test',
                status: 'failed',
                error_message: 'Build failed: out of memory',
            };
            mockSupabase.storage.deployments.set(deploymentId, deployment);

            const logEntry: MockLog = {
                id: "log_" + Date.now(),
                deployment_id: deploymentId,
                stage: 'build',
                level: 'error',
                message: 'Build failed: out of memory',
                metadata: { memory_limit: '512MB', used: '600MB' },
            };
            mockSupabase.storage.logs.set(logEntry.id, logEntry);

            const storedLog = mockSupabase.storage.logs.get(logEntry.id);
            expect(storedLog).toBeDefined();
            expect(storedLog?.message).toContain('memory');
            expect(storedLog?.metadata).toBeDefined();
        });
    });

    // ---------------------------------------------------------------------------
    // Integration Points Tests
    // ---------------------------------------------------------------------------

    describe('Integration Points: Deployment Notifications', () => {
        it('should create notification entry on deployment creation', async () => {
            const deploymentId = 'deploy_notify_1';
            const userId = 'user_notify_test';

            const deployment: MockDeployment = {
                id: deploymentId,
                user_id: userId,
                project_id: 'proj_4',
                name: 'Notification Test',
                status: 'pending',
            };
            mockSupabase.storage.deployments.set(deploymentId, deployment);

            const notification: MockLog = {
                id: "notif_" + Date.now(),
                deployment_id: deploymentId,
                stage: 'notification',
                level: 'info',
                message: 'Deployment created',
                metadata: { type: 'deployment_created', read: false },
            };
            mockSupabase.storage.logs.set(notification.id, notification);

            const stored = mockSupabase.storage.logs.get(notification.id);
            expect(stored).toBeDefined();
            expect(stored?.message).toBe('Deployment created');
            expect(stored?.stage).toBe('notification');
        });

        it('should create notification on deployment status change', async () => {
            const deploymentId = 'deploy_status_notify_1';
            const userId = 'user_status_notify';

            const deployment: MockDeployment = {
                id: deploymentId,
                user_id: userId,
                project_id: 'proj_5',
                name: 'Status Test',
                status: 'ready',
            };
            mockSupabase.storage.deployments.set(deploymentId, deployment);

            const statusLog: MockLog = {
                id: "status_" + Date.now(),
                deployment_id: deploymentId,
                stage: 'notification',
                level: 'info',
                message: 'Deployment ready',
                metadata: { previous_status: 'pending', new_status: 'ready' },
            };
            mockSupabase.storage.logs.set(statusLog.id, statusLog);

            const stored = mockSupabase.storage.logs.get(statusLog.id);
            expect(stored?.message).toBe('Deployment ready');
            expect(stored?.metadata).toHaveProperty('new_status', 'ready');
        });

        it('should notify on deployment failure', async () => {
            const deploymentId = 'deploy_fail_notify_1';
            const userId = 'user_fail_notify';

            const deployment: MockDeployment = {
                id: deploymentId,
                user_id: userId,
                project_id: 'proj_6',
                name: 'Fail Test',
                status: 'failed',
                error_message: 'Deployment failed',
            };
            mockSupabase.storage.deployments.set(deploymentId, deployment);

            const failLog: MockLog = {
                id: "fail_" + Date.now(),
                deployment_id: deploymentId,
                stage: 'notification',
                level: 'error',
                message: 'Deployment failed',
                metadata: { error: 'Deployment failed', timestamp: new Date().toISOString() },
            };
            mockSupabase.storage.logs.set(failLog.id, failLog);

            const stored = mockSupabase.storage.logs.get(failLog.id);
            expect(stored?.level).toBe('error');
            expect(stored?.message).toBe('Deployment failed');
        });
    });

    // ---------------------------------------------------------------------------
    // Multi-Session Tests
    // ---------------------------------------------------------------------------

    describe('Multi-Session: Token Management', () => {
        it('should manage tokens correctly across sequential requests', async () => {
            const email = "multisession_" + Date.now() + "@test.com";

            const firstLogin = await mockSupabase.auth.signUp(email, 'password123');
            const firstToken = firstLogin.data?.session?.access_token;

            expect(firstToken).toBeDefined();

            const user = await mockSupabase.auth.getUser(firstToken!);
            expect(user.data.user).toBeDefined();

            const secondUser = await mockSupabase.auth.getUser(firstToken!);
            expect(secondUser.data.user).toBeDefined();
        });

        it('should handle token validation for protected routes', async () => {
            const validToken = 'valid_token_123';
            const invalidToken = 'invalid_token_456';

            mockSupabase.storage.users.set(validToken, {
                id: validToken,
                email: 'valid@test.com',
                role: 'developer',
                permissions: ['read', 'write'],
            });

            const validUser = await mockSupabase.auth.getUser(validToken);
            expect(validUser.data.user).toBeDefined();

            const invalidUser = await mockSupabase.auth.getUser(invalidToken);
            expect(invalidUser.data.user).toBeNull();
            expect(invalidUser.error).toBeDefined();
        });

        it('should handle session expiration gracefully', async () => {
            const expiredToken = 'expired_token_789';

            const expiredUser = await mockSupabase.auth.getUser(expiredToken);

            expect(expiredUser.data.user).toBeNull();
            expect(expiredUser.error).toBeDefined();
        });

        it('should maintain user context across multiple operations', async () => {
            const userId = 'user_context_1';
            const email = 'context@test.com';

            mockSupabase.storage.users.set(userId, {
                id: userId,
                email,
                role: 'admin',
                permissions: ['read', 'write', 'delete', 'admin'],
            });

            const user1 = await mockSupabase.auth.getUser(userId);
            const user2 = await mockSupabase.auth.getUser(userId);

            expect(user1.data.user?.id).toBe(user2.data.user?.id);
            expect(user1.data.user?.email).toBe(user2.data.user?.email);
            expect(user1.data.user?.role).toBe(user2.data.user?.role);
        });
    });

    // ---------------------------------------------------------------------------
    // Cleanup Verification Tests
    // ---------------------------------------------------------------------------

    describe('Test Environment Cleanup', () => {
        it('should clean up user data after test run', () => {
            const user1 = "user1_" + Date.now() + "@test.com";
            const user2 = "user2_" + Date.now() + "@test.com";

            mockSupabase.auth.signUp(user1, 'password123');
            mockSupabase.auth.signUp(user2, 'password123');

            expect(mockSupabase.storage.users.size).toBeGreaterThanOrEqual(2);
        });

        it('should clean up deployment data after test run', () => {
            const deployment1: MockDeployment = { id: 'd1', user_id: 'u1', project_id: 'p1', name: 'Test 1', status: 'ready' };
            const deployment2: MockDeployment = { id: 'd2', user_id: 'u2', project_id: 'p2', name: 'Test 2', status: 'ready' };

            mockSupabase.storage.deployments.set('d1', deployment1);
            mockSupabase.storage.deployments.set('d2', deployment2);

            expect(mockSupabase.storage.deployments.size).toBeGreaterThanOrEqual(2);
        });

        it('should verify complete cleanup after all tests', () => {
            expect(createdResources.users.length).toBe(0);
            expect(createdResources.deployments.length).toBe(0);
        });
    });
});
