/* Questlog sync: keeps goals and entries in a private GitHub Gist that every device merges into.
   Works the same in the Windows app and in the phone web app. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.Sync = factory(root.Core);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const API = 'https://api.github.com';
  const FILE = 'questlog-sync.json';

  class SyncError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

  /* opts: fetch, getState(), getCfg() -> {token,gistId,...}, saveCfg(), applyMerged(doc), onStatus({state,message}) */
  function create(opts) {
    const f = opts.fetch;
    let busy = false, again = false, timer = null;
    let status = { state: 'off', message: '' };
    const setStatus = (state, message) => { status = { state, message: message || '' }; if (opts.onStatus) opts.onStatus(status); };

    async function gh(method, path, body) {
      const cfg = opts.getCfg();
      let res;
      try {
        res = await f(path.startsWith('http') ? path : API + path, {
          method, cache: 'no-store',
          headers: Object.assign({ Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' }, body ? { 'Content-Type': 'application/json' } : {}),
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) { throw new SyncError('No connection. Will retry.', 'offline'); }
      if (res.status === 401) throw new SyncError('GitHub rejected the token. Check that it was copied in full and has not expired.', 'auth');
      if (res.status === 403 || res.status === 429) throw new SyncError('GitHub refused the request. The token needs the "gist" permission, or the rate limit was hit.', 'forbidden');
      if (res.status === 404) throw new SyncError('The sync file was not found on GitHub.', 'notfound');
      if (!res.ok) throw new SyncError('GitHub answered with error ' + res.status + '.', 'http');
      return res;
    }

    async function findOrCreate() {
      for (let page = 1; page <= 5; page++) {
        const list = await (await gh('GET', `/gists?per_page=100&page=${page}`)).json();
        const hit = list.find((g) => g.files && g.files[FILE]);
        if (hit) return hit.id;
        if (list.length < 100) break;
      }
      const made = await (await gh('POST', '/gists', { description: 'Questlog sync data (private)', public: false, files: { [FILE]: { content: '{}' } } })).json();
      return made.id;
    }

    async function readRemote(id) {
      const g = await (await gh('GET', '/gists/' + id)).json();
      const file = g.files && g.files[FILE];
      if (!file) return null;
      let text = file.content;
      if (file.truncated && file.raw_url) {
        try { text = await (await f(file.raw_url, { cache: 'no-store' })).text(); }
        catch (e) { throw new SyncError('Could not download the sync file.', 'offline'); }
      }
      let doc = null; try { doc = JSON.parse(text); } catch (e) { doc = null; }
      return C.validDoc(doc) ? doc : null;
    }
    const writeRemote = (id, doc) => gh('PATCH', '/gists/' + id, { files: { [FILE]: { content: JSON.stringify(doc) } } });

    async function run() {
      const cfg = opts.getCfg();
      if (!cfg || !cfg.token) { setStatus('off'); return false; }
      if (busy) { again = true; return false; }
      busy = true; setStatus('syncing');
      try {
        if (!cfg.gistId) { cfg.gistId = await findOrCreate(); opts.saveCfg(); }
        let remote;
        try { remote = await readRemote(cfg.gistId); }
        catch (e) {
          if (e.code !== 'notfound') throw e;
          cfg.gistId = await findOrCreate(); opts.saveCfg(); remote = await readRemote(cfg.gistId);
        }
        const state = opts.getState(); const local = C.syncDoc(state);
        let merged;
        if (!remote) merged = local;
        else if (C.isPristine(state)) merged = remote; // a fresh device takes over what is already there
        else merged = C.mergeDocs(local, remote);
        const key = C.docKey(merged);
        // Never upload the untouched example goals: another device may already hold real data.
        if ((!remote || key !== C.docKey(remote)) && !(!remote && C.isPristine(state))) await writeRemote(cfg.gistId, merged);
        if (key !== C.docKey(C.syncDoc(opts.getState()))) {
          // the user may have logged something while we were talking to GitHub: merge once more before applying
          const now = C.syncDoc(opts.getState());
          const fin = C.docKey(now) === C.docKey(local) ? merged : C.mergeDocs(now, merged);
          opts.applyMerged(fin);
          if (C.docKey(fin) !== key) again = true;
        }
        cfg.lastSync = Date.now(); opts.saveCfg();
        setStatus('ok');
        return true;
      } catch (e) {
        setStatus(e.code === 'offline' ? 'offline' : 'error', e instanceof SyncError ? e.message : 'Sync failed: ' + (e && e.message || e));
        return false;
      } finally {
        busy = false;
        if (again) { again = false; schedule(1500); }
      }
    }

    function schedule(ms) { clearTimeout(timer); timer = setTimeout(run, ms == null ? 2500 : ms); }
    async function whoAmI() { try { return (await (await gh('GET', '/user')).json()).login || null; } catch (e) { return null; } }

    return { run, schedule, whoAmI, status: () => status };
  }

  // Link passed from one device to another (as a QR code): token + gist id in the URL fragment.
  const b64u = {
    enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
  };
  const makeLink = (base, cfg) => base.replace(/#.*$/, '') + '#link=' + b64u.enc(JSON.stringify({ t: cfg.token, g: cfg.gistId || '' }));
  function parseLink(hash) {
    const m = /[#&]link=([A-Za-z0-9_-]+)/.exec(hash || ''); if (!m) return null;
    try { const o = JSON.parse(b64u.dec(m[1])); return o && o.t ? { token: String(o.t), gistId: String(o.g || '') } : null; } catch (e) { return null; }
  }

  return { create, makeLink, parseLink, FILE };
});
