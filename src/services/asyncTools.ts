/** Bounded workers and ordered output; catch per-item errors inside work when appropriate. */
export async function mapConcurrent<T, R>(items: T[], concurrency: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const result = new Array<R>(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            result[index] = await work(items[index], index);
        }
    }));
    return result;
}

/** Serialize read-modify-write storage operations without poisoning the next write. */
export function createSerialTaskQueue() {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(work: () => Promise<T>): Promise<T> => {
        const result = tail.then(work);
        tail = result.catch(() => undefined);
        return result;
    };
}
