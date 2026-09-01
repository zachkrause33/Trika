const JSONBIN_BASE = 'https://api.jsonbin.io/v3';

const BINS = {
  'numbers:alltime':   '6a18407cddf5aa59f76ff039',
  'blitz1:alltime':    '6a3ec94df5f4af5e2935b2f9',
  'blitz5:alltime':    '6a622a85f5f4af5e29b69b1e',
  'precision:alltime': '6a3ec97fda38895dfe042a5c',
  'survival:alltime':  '6a3ec94dda38895dfe042967',
};

const VALID_GAMES = new Set(['numbers', 'blitz1', 'blitz5', 'precision', 'survival']);
const VALID_BOARDS = new Set(['alltime']);

const MAX_SCORES = {
  numbers:   10_000_000,
  blitz1:     5_000_000,
  blitz5:    10_000_000,
  precision:  5_000_000,
  survival:   5_000_000,
};

function key() { return process.env.JSONBIN_KEY; }

async function jbGet(id) {
  const r = await fetch(`${JSONBIN_BASE}/b/${id}/latest`, {
    headers: { 'X-Master-Key': key(), 'X-Bin-Meta': 'false' },
  });
  if (!r.ok) throw new Error('JSONBin read failed');
  return r.json();
}

async function jbPut(id, data) {
  const r = await fetch(`${JSONBIN_BASE}/b/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': key() },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('JSONBin write failed');
}

async function jbCreate(name, data) {
  const r = await fetch(`${JSONBIN_BASE}/b`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': key(),
      'X-Bin-Name': name,
      'X-Bin-Private': 'false',
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('JSONBin create failed');
  const d = await r.json();
  return d.metadata.id;
}

function validateEntry(game, entry) {
  if (!entry || typeof entry !== 'object') return 'missing entry';
  const { name, score } = entry;
  if (typeof name !== 'string' || name.length === 0 || name.length > 20) return 'invalid name';
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return 'invalid score';
  if (score > MAX_SCORES[game]) return 'score exceeds maximum';

  switch (game) {
    case 'numbers':
      if (typeof entry.found !== 'number' || entry.found < 0) return 'invalid found';
      if (typeof entry.level !== 'number' || entry.level < 0) return 'invalid level';
      break;
    case 'blitz1':
    case 'blitz5':
      if (typeof entry.found !== 'number' || entry.found < 0) return 'invalid found';
      break;
    case 'precision':
      if (typeof entry.found !== 'number' || entry.found < 0) return 'invalid found';
      break;
    case 'survival':
      if (typeof entry.eqCount !== 'number' || entry.eqCount < 0) return 'invalid eqCount';
      if (typeof entry.elapsed !== 'number' || entry.elapsed < 0) return 'invalid elapsed';
      break;
  }
  return null;
}

function mergeEntry(scores, entry) {
  const idx = scores.findIndex(s => s.name === entry.name);
  if (idx >= 0) {
    if (entry.score > scores[idx].score) scores[idx] = entry;
  } else {
    scores.push(entry);
  }
}

function pacificDayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

function isValidBinId(id) {
  return typeof id === 'string' && /^[a-f0-9]{24}$/.test(id);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { action, game, board, entry, binId, code, name: groupName, tab } = req.body || {};

  try {
    switch (action) {

      case 'get': {
        if (!VALID_GAMES.has(game)) return res.status(400).json({ error: 'invalid game' });
        if (!VALID_BOARDS.has(board)) return res.status(400).json({ error: 'invalid board' });
        const id = BINS[`${game}:${board}`];
        if (!id) return res.status(400).json({ error: 'unknown bin' });
        const data = await jbGet(id);
        return res.status(200).json(data);
      }

      case 'submit': {
        if (!VALID_GAMES.has(game)) return res.status(400).json({ error: 'invalid game' });
        if (!VALID_BOARDS.has(board)) return res.status(400).json({ error: 'invalid board' });
        const err = validateEntry(game, entry);
        if (err) return res.status(400).json({ error: err });
        const id = BINS[`${game}:${board}`];
        if (!id) return res.status(400).json({ error: 'unknown bin' });
        const data = await jbGet(id);
        if (!data.scores) data.scores = [];
        mergeEntry(data.scores, entry);
        await jbPut(id, data);
        return res.status(200).json({ ok: true });
      }

      case 'group_create': {
        if (typeof groupName !== 'string' || groupName.length === 0 || groupName.length > 40)
          return res.status(400).json({ error: 'invalid group name' });
        if (typeof code !== 'string' || !/^[A-Z0-9]{4,8}$/.test(code))
          return res.status(400).json({ error: 'invalid code' });
        const newId = await jbCreate(`trika-group-${code}`, { name: groupName, code, freeplay: {}, alltime: [] });
        return res.status(200).json({ binId: newId });
      }

      case 'group_get': {
        if (!isValidBinId(binId)) return res.status(400).json({ error: 'invalid binId' });
        const data = await jbGet(binId);
        return res.status(200).json(data);
      }

      case 'group_submit': {
        if (!isValidBinId(binId)) return res.status(400).json({ error: 'invalid binId' });
        const err = validateEntry('numbers', entry);
        if (err) return res.status(400).json({ error: err });
        const data = await jbGet(binId);
        const today = pacificDayKey();
        if (!data.freeplay) data.freeplay = {};
        if (!data.freeplay[today]) data.freeplay[today] = [];
        mergeEntry(data.freeplay[today], entry);
        if (!data.alltime) data.alltime = [];
        mergeEntry(data.alltime, entry);
        await jbPut(binId, data);
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'invalid action' });
    }
  } catch (e) {
    return res.status(502).json({ error: 'upstream error' });
  }
};
