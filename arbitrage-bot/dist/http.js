export async function fetchJson(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok)
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return (await res.json());
    }
    finally {
        clearTimeout(timer);
    }
}
