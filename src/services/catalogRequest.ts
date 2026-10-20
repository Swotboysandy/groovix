/** Catalog-only GET: deadline covers headers AND JSON, with one transient retry. */
export async function catalogRequest(url: string, timeoutMs = 6000): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        let retryable = true;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let onAbort: (() => void) | undefined;
        try {
            const timedOut = new Promise<never>((_, reject) => {
                onAbort = () => reject(new Error('Catalog request timed out'));
                controller.signal.addEventListener('abort', onAbort, { once: true });
            });
            return await Promise.race([
                (async () => {
                    const response = await fetch(url, { signal: controller.signal });
                    if (!response.ok) {
                        retryable = [502, 503, 504].includes(response.status);
                        throw new Error(`Catalog unavailable (${response.status})`);
                    }
                    return await response.json();
                })(),
                timedOut,
            ]);
        } catch (error) {
            // Authentication/rate-limit failures need provider action; retrying
            // those immediately adds load and never repairs permissions.
            if (!retryable || attempt === 1 || controller.signal.aborted) throw error;
        } finally {
            clearTimeout(timer);
            if (onAbort) controller.signal.removeEventListener('abort', onAbort);
        }
        await new Promise<void>(resolve => setTimeout(resolve, 300));
    }
    throw new Error('Catalog unavailable');
}

export function objectRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
