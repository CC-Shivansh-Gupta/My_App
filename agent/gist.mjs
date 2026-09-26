// Reads and writes the Daybook sync gist, the same one the app syncs through.
// The app's data lives in daybook-data.json; the agent keeps its own state
// (its push keys) in daybook-agent.json, which the app never reads.

export const DATA_FILE = 'daybook-data.json';
export const AGENT_FILE = 'daybook-agent.json';
const API = 'https://api.github.com';

export function client(token, fetchImpl = fetch) {
  async function api(path, opts = {}) {
    const res = await fetchImpl(API + path, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${opts.method || 'GET'} ${path.replace(/[0-9a-f]{20,}/g, '…')}: ${res.status}`);
    return res.json();
  }

  async function content(file) {
    if (!file) return null;
    let text = file.content;
    if (file.truncated) {
      const res = await fetchImpl(file.raw_url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Could not download the full gist file: ${res.status}`);
      text = await res.text();
    }
    try { return JSON.parse(text); } catch { return null; }
  }

  return {
    // Find the sync gist the app created on this account.
    async find() {
      for (let page = 1; page <= 10; page++) {
        const gists = await api(`/gists?per_page=100&page=${page}`);
        const hit = gists.find((g) => g.files && g.files[DATA_FILE]);
        if (hit) return hit.id;
        if (gists.length < 100) break;
      }
      throw new Error('No Daybook sync gist on this account. Turn on sync in the app first (Settings → Sync), with the same token.');
    },

    async read(id) {
      const gist = await api(`/gists/${id}`);
      const data = await content(gist.files[DATA_FILE]);
      if (!data || !data.data) throw new Error('The sync gist has no Daybook data yet.');
      return { data: data.data, agent: (await content(gist.files[AGENT_FILE])) || {} };
    },

    // Only the files passed are changed; the others in the gist stay as they are.
    async write(id, { data, agent }) {
      const files = {};
      if (data) files[DATA_FILE] = { content: JSON.stringify({ app: 'daybook', version: 1, savedAt: new Date().toISOString(), data }) };
      if (agent) files[AGENT_FILE] = { content: JSON.stringify(agent) };
      await api(`/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files }) });
    },
  };
}
