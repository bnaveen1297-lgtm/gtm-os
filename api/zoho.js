const { cors, readBody } = require('./_lib');
const https = require('https');

function zohoGet(path, token, dc) {
  return new Promise((resolve, reject) => {
    const host = `www.zohoapis.${dc}`;
    const req = https.request({
      hostname: host,
      path: `/crm/v6/${path}`,
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch(e) { resolve({ error: 'Parse error' }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Zoho timeout')); });
    req.end();
  });
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const action = req.query?.action || 'test';
  const dc = req.query?.dc || 'in';

  try {
    const body = req.method === 'POST' ? JSON.parse(await readBody(req)) : {};
    const token = body.token || req.query?.token;

    if (!token) { res.status(400).json({ error: 'Missing token' }); return; }

    if (action === 'test') {
      // Test connection by getting org info
      const org = await zohoGet('org', token, dc);
      if (org.org) {
        res.json({ success: true, org: org.org[0]?.company_name || 'Zoho CRM' });
      } else {
        res.status(401).json({ error: 'Invalid token or wrong data center' });
      }
      return;
    }

    if (action === 'sync') {
      // Pull leads count
      const leads = await zohoGet('Leads?fields=id&per_page=1', token, dc);
      const deals = await zohoGet('Deals?fields=id,Amount,Stage&per_page=200', token, dc);

      const totalLeads = leads.info?.count || 0;
      const dealList = deals.data || [];
      const openDeals = dealList.filter(d => !['Closed Won','Closed Lost'].includes(d.Stage)).length;
      const pipelineValue = dealList
        .filter(d => !['Closed Won','Closed Lost'].includes(d.Stage))
        .reduce((sum, d) => sum + (parseFloat(d.Amount) || 0), 0);

      // Stage breakdown
      const stageMap = {};
      dealList.forEach(d => {
        stageMap[d.Stage] = (stageMap[d.Stage] || 0) + 1;
      });

      res.json({
        leads: totalLeads,
        deals: openDeals,
        pipeline: pipelineValue > 0 ? '₹' + (pipelineValue/100000).toFixed(1) + 'L' : '₹0',
        pipelineRaw: pipelineValue,
        stages: stageMap,
        synced: new Date().toISOString()
      });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
