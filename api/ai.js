const { cors, readBody, callClaude } = require('./_lib');
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body = JSON.parse(await readBody(req));
    const result = await callClaude(body);
    try { res.status(result.status).json(JSON.parse(result.body)); }
    catch(e) { res.status(result.status).send(result.body); }
  } catch(e) { res.status(500).json({ error: e.message, content: [{ type: 'text', text: '' }] }); }
};
