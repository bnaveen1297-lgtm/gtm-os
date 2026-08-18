const https = require('https');

// Supports both GPT (OPENAI_KEY) and Claude (CLAUDE_KEY)
// Whichever key is set in Vercel env vars will be used
// If both are set, GPT takes priority
const OPENAI_KEY = process.env.OPENAI_KEY || '';
const CLAUDE_KEY = process.env.CLAUDE_KEY || '';
const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const c = [];
    req.on('data', d => c.push(d));
    req.on('end', () => resolve(Buffer.concat(c).toString()));
    req.on('error', reject);
  });
}

function httpsPost(hostname, path, headers, payload) {
  return new Promise((resolve, reject) => {
    const buf = typeof payload === 'string' ? Buffer.from(payload) : payload;
    const req = https.request({
      hostname, path, method: 'POST', agent,
      headers: { ...headers, 'Content-Length': buf.length },
      timeout: 58000
    }, (res) => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout after 58s')); });
    req.write(buf);
    req.end();
  });
}

async function callGPT(body) {
  const msgs = (body.messages || []).map(m => ({
    role: m.role === 'system' ? 'user' : m.role,
    content: typeof m.content === 'string' ? m.content :
      (m.content || []).map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('\n')
  }));

  const payload = JSON.stringify({
    model: 'gpt-4o-mini',  // Fast and cheap — good for structured JSON
    max_tokens: body.max_tokens || 1800,
    temperature: 0.3,      // Lower temp = more consistent JSON
    response_format: { type: 'json_object' }, // Force JSON output
    messages: [
      { role: 'system', content: 'You are a GTM strategy expert. Always respond with valid JSON only. No markdown, no explanation, no backticks.' },
      ...msgs
    ]
  });

  try {
    const r = await httpsPost('api.openai.com', '/v1/chat/completions', {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`
    }, payload);

    const parsed = JSON.parse(r.body);

    if (parsed.error) {
      return {
        status: r.status,
        body: JSON.stringify({
          error: { message: parsed.error.message || JSON.stringify(parsed.error) },
          content: [{ type: 'text', text: '' }]
        })
      };
    }

    const text = parsed.choices?.[0]?.message?.content || '{}';
    return {
      status: 200,
      body: JSON.stringify({ content: [{ type: 'text', text }] })
    };
  } catch (e) {
    return {
      status: 500,
      body: JSON.stringify({ error: { message: e.message }, content: [{ type: 'text', text: '' }] })
    };
  }
}

async function callClaude(body) {
  const msgs = (body.messages || []).map(m => ({
    role: m.role === 'system' ? 'user' : m.role,
    content: typeof m.content === 'string' ? m.content :
      (m.content || []).map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('\n')
  }));

  const payload = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: body.max_tokens || 1800,
    messages: msgs
  });

  try {
    const r = await httpsPost('api.anthropic.com', '/v1/messages', {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01'
    }, payload);

    const parsed = JSON.parse(r.body);
    if (parsed.content?.[0]?.text) {
      return { status: r.status, body: JSON.stringify({ content: parsed.content }) };
    }
    if (parsed.error) {
      return { status: r.status, body: JSON.stringify({ error: parsed.error, content: [{ type: 'text', text: '' }] }) };
    }
    return r;
  } catch (e) {
    return { status: 500, body: JSON.stringify({ error: { message: e.message }, content: [{ type: 'text', text: '' }] }) };
  }
}

// Main caller — uses GPT if OPENAI_KEY set, else Claude
async function callAI(body) {
  if (OPENAI_KEY) {
    return callGPT(body);
  } else if (CLAUDE_KEY) {
    return callClaude(body);
  } else {
    return {
      status: 500,
      body: JSON.stringify({
        error: { message: 'No API key found. Add OPENAI_KEY or CLAUDE_KEY in Vercel → Settings → Environment Variables' },
        content: [{ type: 'text', text: '' }]
      })
    };
  }
}

module.exports = { cors, readBody, httpsPost, callClaude: callAI, CLAUDE_KEY, OPENAI_KEY };
