type Waiter = { resolve: (value: never) => void; reject: (error: unknown) => void };

export function createPartBatcher<S extends Record<string, unknown>>(
    load: (parts: Array<keyof S & string>) => Promise<Partial<S>>,
) {
    let pending: Map<keyof S & string, Waiter[]> | null = null;

    const flush = () => {
        const batch = pending;
        pending = null;
        if (!batch) return;
        load(Array.from(batch.keys())).then(
            (result) => batch.forEach((waiters, part) => waiters.forEach((waiter) => waiter.resolve(result[part] as never))),
            (error) => batch.forEach((waiters) => waiters.forEach((waiter) => waiter.reject(error))),
        );
    };

    return function readPart<P extends keyof S & string>(part: P): Promise<S[P]> {
        return new Promise<S[P]>((resolve, reject) => {
            if (!pending) {
                pending = new Map();
                setTimeout(flush, 0);
            }
            const waiters = pending.get(part) ?? [];
            waiters.push({ resolve: resolve as (value: never) => void, reject });
            pending.set(part, waiters);
        });
    };
}
