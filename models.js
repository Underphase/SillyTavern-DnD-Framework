/** Model discovery is a read-only request; searching never calls an LLM. */
export function modelsEndpoint(address) {
    const url = new URL(address.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Укажи адрес HTTP(S) API без логина и пароля в URL');
    }
    let path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/models$/, '');
    if (url.hostname === 'openrouter.ai' && (!path || path === '/api')) path = '/api/v1';
    url.pathname = `${path}/models`;
    url.search = '';
    url.hash = '';
    return url.href;
}

export function normalizeModels(payload) {
    const entries = Array.isArray(payload) ? payload : payload?.data;
    if (!Array.isArray(entries)) throw new Error('API не вернул список моделей в поле data');
    const models = new Map();
    for (const entry of entries) {
        if (typeof entry?.id !== 'string' || !entry.id.trim()) continue;
        const id = entry.id.trim();
        models.set(id, { id, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id });
    }
    return [...models.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function filterModels(models, query) {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return models.filter(model => terms.every(term => `${model.id} ${model.name}`.toLocaleLowerCase().includes(term)));
}

export async function listModels(address, key, { signal } = {}) {
    const response = await fetch(modelsEndpoint(address), {
        method: 'GET', signal: signal ?? AbortSignal.timeout(20000),
        headers: { Accept: 'application/json', ...(key.trim() ? { Authorization: `Bearer ${key.trim()}` } : {}) },
    });
    if (!response.ok) {
        throw new Error(`Список моделей: HTTP ${response.status}. ${response.status === 401 || response.status === 403 ? 'Проверь ключ ИИ и доступ к провайдеру.' : 'Проверь адрес API и поддержку GET /models.'}`);
    }
    return normalizeModels(await response.json());
}
