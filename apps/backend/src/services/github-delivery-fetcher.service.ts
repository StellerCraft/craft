/**
 * GitHub Delivery Fetcher Service
 *
 * Fetches webhook delivery logs from GitHub API and detects missed deliveries
 * by comparing GitHub's delivery log against our database records.
 *
 * Responsibilities:
 *   - Fetch delivery log from GitHub API for a specific webhook
 *   - Compare GitHub's deliveries against our database
 *   - Detect and record missed deliveries
 *   - Provide delivery metadata for replay
 *
 * GitHub API Reference:
 *   - List deliveries: GET /app/hooks/{hook_id}/deliveries
 *   - Get delivery: GET /app/hooks/{hook_id}/deliveries/{delivery_id}
 *
 * Authentication:
 *   - Uses GitHub App JWT authentication via GitHubAppAuthClient
 */

import { createClient } from '@/lib/supabase/server';
import { getGitHubAppAuthClient } from '@/lib/github/app-auth';
import { createLogger } from '@/lib/api/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GitHubDelivery {
    id: number;
    guid: string;
    deliveredAt: string;
    redelivery: boolean;
    duration: number;
    status: string;
    statusCode: number;
    event: string;
    action: string | null;
    installationId: number | null;
    repositoryId: number | null;
}

export interface GitHubDeliveryDetail {
    id: number;
    guid: string;
    deliveredAt: string;
    redelivery: boolean;
    duration: number;
    status: string;
    statusCode: number;
    event: string;
    action: string | null;
    installationId: number | null;
    repositoryId: number | null;
    request: {
        headers: Record<string, string>;
        payload: Record<string, unknown>;
    };
    response: {
        headers: Record<string, string>;
        payload: string;
    };
}

export interface FetchDeliveryLogResult {
    success: boolean;
    deliveries?: GitHubDelivery[];
    error?: string;
}

export interface DetectMissedDeliveriesResult {
    success: boolean;
    missedCount?: number;
    error?: string;
}

export interface RecordMissedDeliveryResult {
    success: boolean;
    error?: string;
}

export interface GetDeliveryDetailResult {
    success: boolean;
    delivery?: GitHubDeliveryDetail;
    error?: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class GitHubDeliveryFetcherService {
    private readonly log = createLogger({
        correlationId: 'github-delivery-fetcher',
        service: 'github-delivery-fetcher',
    });

    private readonly authClient = getGitHubAppAuthClient();
    private readonly MAX_PAGES = 10;

    /**
     * Fetches webhook delivery log from GitHub API with pagination.
     *
     * Retrieves all deliveries within the requested window by following
     * GitHub's Link header pagination (rel="next") until exhausted or
     * safety limit is reached.
     *
     * @param hookId - GitHub webhook ID (from GitHub App settings)
     * @param since - Optional ISO 8601 timestamp to fetch deliveries after this time
     * @returns Result with list of deliveries from all pages
     */
    async fetchDeliveryLog(
        hookId: number,
        since?: string
    ): Promise<FetchDeliveryLogResult> {
        /**
         * GitHub's deliveries endpoint is cursor-paginated (newest-first).
         * We follow the Link: rel="next" header across pages until:
         *   a) a delivery older than `since` is encountered, or
         *   b) MAX_PAGES pages have been fetched (safety cap).
         */
        const MAX_PAGES = 10;

        try {
            const sinceDate = since ? new Date(since) : null;
            const accumulated: GitHubDelivery[] = [];
            let reachedSinceBoundary = false;

            // Initial URL — per_page=100 is the maximum GitHub allows per request.
            let nextUrl: string | null =
                `/app/hooks/${hookId}/deliveries?per_page=100`;

            this.log.info('Fetching delivery log from GitHub', { hookId, since });

            for (let page = 0; page < MAX_PAGES && nextUrl !== null; page++) {
                const response = await this.authClient.requestWithInstallationAuth(
                    nextUrl,
                    { method: 'GET' },
                );

                if (!response.ok) {
                    const errorText = await response.text();
                    this.log.error('Failed to fetch delivery log from GitHub', undefined, {
                        status: response.status,
                        error: errorText,
                        page,
                    });
                    return {
                        success: false,
                        error: `GitHub API error: ${response.status} ${errorText}`,
                    };
                }

                const data = await response.json();
                const pageItems: GitHubDelivery[] = (data || []).map((d: any) => ({
                    id: d.id,
                    guid: d.guid,
                    deliveredAt: d.delivered_at,
                    redelivery: d.redelivery || false,
                    duration: d.duration || 0,
                    status: d.status || 'unknown',
                    statusCode: d.status_code || 0,
                    event: d.event || 'unknown',
                    action: d.action || null,
                    installationId: d.installation_id || null,
                    repositoryId: d.repository_id || null,
                }));

                // Deliveries arrive newest-first. Stop as soon as we cross the
                // since boundary — everything after this will be even older.
                if (sinceDate) {
                    for (const delivery of pageItems) {
                        if (new Date(delivery.deliveredAt) <= sinceDate) {
                            reachedSinceBoundary = true;
                            break;
                        }
                        accumulated.push(delivery);
                    }
                } else {
                    accumulated.push(...pageItems);
                }

                if (reachedSinceBoundary) {
                    break;
                }

                // Follow the cursor from the Link: <url>; rel="next" header.
                nextUrl = this.parseLinkNext(response.headers.get('link'));
            }

            this.log.info('Fetched delivery log from GitHub', {
                hookId,
                count: accumulated.length,
                pages: Math.min(MAX_PAGES, accumulated.length > 0 ? MAX_PAGES : 1),
            });

            return { success: true, deliveries: accumulated };
        } catch (error: any) {
            this.log.error('Unexpected error fetching delivery log', error);
            return { success: false, error: error.message || 'Unknown error' };
        }
    }

    /**
     * Parses the `Link` response header and returns the URL for rel="next",
     * or null if there is no next page.
     *
     * GitHub format: `<https://api.github.com/...?cursor=xxx>; rel="next", <...>; rel="last"`
     */
    private parseLinkNext(linkHeader: string | null): string | null {
        if (!linkHeader) return null;

        for (const part of linkHeader.split(',')) {
            const [urlPart, relPart] = part.split(';').map((s) => s.trim());
            if (relPart === 'rel="next"') {
                // Strip surrounding angle brackets: <url> → url
                const match = urlPart.match(/^<(.+)>$/);
                if (match) return match[1];
            }
        }

        return null;
    }

    /**
     * Fetches detailed information about a specific delivery from GitHub API.
     *
     * This includes the full request payload and headers, which are needed for replay.
     *
     * @param hookId - GitHub webhook ID
     * @param deliveryId - GitHub delivery ID (numeric ID, not GUID)
     * @returns Result with delivery details
     */
    async getDeliveryDetail(
        hookId: number,
        deliveryId: number
    ): Promise<GetDeliveryDetailResult> {
        try {
            const url = `/app/hooks/${hookId}/deliveries/${deliveryId}`;

            this.log.info('Fetching delivery detail from GitHub', { hookId, deliveryId });

            const response = await this.authClient.requestWithInstallationAuth(url, {
                method: 'GET',
            });

            if (!response.ok) {
                const errorText = await response.text();
                this.log.error('Failed to fetch delivery detail from GitHub', undefined, {
                    status: response.status,
                    error: errorText,
                });
                return {
                    success: false,
                    error: `GitHub API error: ${response.status} ${errorText}`,
                };
            }

            const data = await response.json();

            const delivery: GitHubDeliveryDetail = {
                id: data.id,
                guid: data.guid,
                deliveredAt: data.delivered_at,
                redelivery: data.redelivery || false,
                duration: data.duration || 0,
                status: data.status || 'unknown',
                statusCode: data.status_code || 0,
                event: data.event || 'unknown',
                action: data.action || null,
                installationId: data.installation_id || null,
                repositoryId: data.repository_id || null,
                request: {
                    headers: data.request?.headers || {},
                    payload: data.request?.payload || {},
                },
                response: {
                    headers: data.response?.headers || {},
                    payload: data.response?.payload || '',
                },
            };

            this.log.info('Fetched delivery detail from GitHub', {
                hookId,
                deliveryId,
                event: delivery.event,
            });

            return { success: true, delivery };
        } catch (error: any) {
            this.log.error('Unexpected error fetching delivery detail', error);
            return { success: false, error: error.message || 'Unknown error' };
        }
    }

    /**
     * Detects missed deliveries by comparing GitHub's delivery log against our database.
     *
     * Process:
     *   1. Fetch recent deliveries from GitHub API
     *   2. Query our database for received deliveries in the same time range
     *   3. Identify deliveries in GitHub's log that are not in our database
     *   4. Record missed deliveries in the database
     *
     * @param hookId - GitHub webhook ID
     * @param lookbackHours - How many hours back to check (default: 24)
     * @returns Result with count of missed deliveries detected
     */
    async detectMissedDeliveries(
        hookId: number,
        lookbackHours: number = 24
    ): Promise<DetectMissedDeliveriesResult> {
        try {
            const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

            this.log.info('Detecting missed deliveries', { hookId, since, lookbackHours });

            // Fetch deliveries from GitHub
            const fetchResult = await this.fetchDeliveryLog(hookId, since);

            if (!fetchResult.success || !fetchResult.deliveries) {
                return {
                    success: false,
                    error: fetchResult.error || 'Failed to fetch delivery log',
                };
            }

            const githubDeliveries = fetchResult.deliveries;

            // Get our recorded deliveries in the same time range
            const supabase = createClient();

            const { data: recordedDeliveries, error: dbError } = await supabase
                .from('github_webhook_deliveries')
                .select('delivery_id')
                .gte('created_at', since);

            if (dbError) {
                this.log.error('Failed to query recorded deliveries', dbError);
                return { success: false, error: dbError.message };
            }

            const recordedDeliveryIds = new Set(
                (recordedDeliveries || []).map((d: any) => d.delivery_id)
            );

            // Find deliveries in GitHub's log that we don't have
            const missedDeliveries = githubDeliveries.filter(
                (d) => !recordedDeliveryIds.has(d.guid)
            );

            this.log.info('Missed deliveries detected', {
                githubCount: githubDeliveries.length,
                recordedCount: recordedDeliveryIds.size,
                missedCount: missedDeliveries.length,
            });

            // Record each missed delivery
            let recordedCount = 0;
            for (const missed of missedDeliveries) {
                const result = await this.recordMissedDelivery(
                    missed.guid,
                    missed.event,
                    missed.deliveredAt
                );
                if (result.success) {
                    recordedCount++;
                }
            }

            this.log.info('Recorded missed deliveries', { recordedCount });

            return { success: true, missedCount: recordedCount };
        } catch (error: any) {
            this.log.error('Unexpected error detecting missed deliveries', error);
            return { success: false, error: error.message || 'Unknown error' };
        }
    }

    /**
     * Records a missed delivery in the database.
     *
     * @param githubDeliveryId - GitHub delivery GUID
     * @param eventType - Event type (push, installation, etc.)
     * @param deliveredAt - When GitHub delivered the webhook
     * @returns Result indicating success
     */
    async recordMissedDelivery(
        githubDeliveryId: string,
        eventType: string,
        deliveredAt: string
    ): Promise<RecordMissedDeliveryResult> {
        try {
            const supabase = createClient();

            const { error } = await supabase.from('github_webhook_missed_deliveries').insert({
                github_delivery_id: githubDeliveryId,
                event_type: eventType,
                delivered_at: deliveredAt,
                detected_at: new Date().toISOString(),
                replayed: false,
            });

            if (error) {
                // Ignore duplicate key errors (delivery already recorded as missed)
                if (error.code === '23505') {
                    this.log.info('Missed delivery already recorded', { githubDeliveryId });
                    return { success: true };
                }

                this.log.error('Failed to record missed delivery', error, { githubDeliveryId });
                return { success: false, error: error.message };
            }

            this.log.info('Missed delivery recorded', { githubDeliveryId, eventType });
            return { success: true };
        } catch (error: any) {
            this.log.error('Unexpected error recording missed delivery', error);
            return { success: false, error: error.message || 'Unknown error' };
        }
    }

    /**
     * Marks a missed delivery as replayed.
     *
     * @param githubDeliveryId - GitHub delivery GUID
     * @param replayDeliveryId - New delivery ID created for the replay
     * @returns Result indicating success
     */
    async markMissedDeliveryReplayed(
        githubDeliveryId: string,
        replayDeliveryId: string
    ): Promise<RecordMissedDeliveryResult> {
        try {
            const supabase = createClient();

            const { error } = await supabase
                .from('github_webhook_missed_deliveries')
                .update({
                    replayed: true,
                    replay_delivery_id: replayDeliveryId,
                })
                .eq('github_delivery_id', githubDeliveryId);

            if (error) {
                this.log.error('Failed to mark missed delivery as replayed', error, {
                    githubDeliveryId,
                });
                return { success: false, error: error.message };
            }

            this.log.info('Missed delivery marked as replayed', {
                githubDeliveryId,
                replayDeliveryId,
            });
            return { success: true };
        } catch (error: any) {
            this.log.error('Unexpected error marking missed delivery as replayed', error);
            return { success: false, error: error.message || 'Unknown error' };
        }
    }
}

export const githubDeliveryFetcherService = new GitHubDeliveryFetcherService();
