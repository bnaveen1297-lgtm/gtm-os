const { cors, readBody } = require('./_lib');
const https = require('https');

function zohoReq(method, path, token, dc, body) {
  return new Promise((resolve, reject) => {
    const host = `www.zohoapis.${dc}`;
    const buf = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      hostname: host,
      path: `/crm/v6/${path}`,
      method,
      headers: {
        'Authorization': `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
        ...(buf ? { 'Content-Length': buf.length } : {})
      },
      timeout: 20000
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch(e) { resolve({ status: res.statusCode, data: {} }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (buf) req.write(buf);
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

    // ── TEST: verify token works ──────────────────────────────────────────
    if (action === 'test') {
      const org = await zohoReq('GET', 'org', token, dc);
      if (org.data?.org) {
        res.json({ success: true, org: org.data.org[0]?.company_name || 'Zoho CRM' });
      } else {
        res.status(401).json({ error: 'Invalid token or wrong data center. Try .com or .in' });
      }
      return;
    }

    // ── DISCOVER: find all modules and their record counts ────────────────
    if (action === 'discover') {
      // Get all available modules
      const modsRes = await zohoReq('GET', 'settings/modules', token, dc);
      const modules = modsRes.data?.modules || [];

      const coreModules = modules.filter(m =>
        m.api_supported &&
        !['Activities','Tasks','Calls','Meetings','Notes','Attachments','Social','Projects'].includes(m.module_name)
      ).slice(0, 15); // cap at 15 modules

      // Get record count + 5 sample records for each module
      const discovery = [];
      for (const mod of coreModules) {
        try {
          const sample = await zohoReq('GET',
            `${mod.api_name}?per_page=5&page=1&fields=id`,
            token, dc
          );
          const count = sample.data?.info?.count || sample.data?.data?.length || 0;
          const totalRes = await zohoReq('GET',
            `${mod.api_name}?per_page=1&page=1`,
            token, dc
          );
          discovery.push({
            name: mod.module_name,
            apiName: mod.api_name,
            singularLabel: mod.singular_label,
            pluralLabel: mod.plural_label,
            totalRecords: totalRes.data?.info?.count || count,
            hasRecords: count > 0,
            fields: [] // will be populated in schema call
          });
        } catch(e) {
          discovery.push({ name: mod.module_name, apiName: mod.api_name, totalRecords: 0, hasRecords: false, error: e.message });
        }
      }

      res.json({ success: true, modules: discovery, totalModules: discovery.length });
      return;
    }

    // ── SCHEMA: get field names for a module ──────────────────────────────
    if (action === 'schema') {
      const moduleName = req.query?.module || 'Leads';
      const fieldsRes = await zohoReq('GET', `settings/fields?module=${moduleName}`, token, dc);
      const fields = (fieldsRes.data?.fields || []).map(f => ({
        name: f.field_label,
        apiName: f.api_name,
        dataType: f.data_type,
        required: f.system_mandatory
      }));
      res.json({ success: true, module: moduleName, fields });
      return;
    }

    // ── SAMPLE: pull 10-20 real records from a module ────────────────────
    if (action === 'sample') {
      const moduleName = req.query?.module || 'Leads';
      const count = parseInt(req.query?.count || '10');

      // First get the fields for this module
      const fieldsRes = await zohoReq('GET', `settings/fields?module=${moduleName}`, token, dc);
      const allFields = fieldsRes.data?.fields || [];

      // Pick the most useful fields (name, email, phone, stage, amount, owner, created date)
      const keyFields = allFields
        .filter(f => ['text','email','phone','picklist','currency','date','datetime','ownerlookup','lookup'].includes(f.data_type))
        .slice(0, 20)
        .map(f => f.api_name)
        .join(',');

      const sampleRes = await zohoReq('GET',
        `${moduleName}?per_page=${count}&page=1&fields=${keyFields}`,
        token, dc
      );

      const records = sampleRes.data?.data || [];
      const totalCount = sampleRes.data?.info?.count || 0;

      // Map field labels for display
      const fieldMap = {};
      allFields.forEach(f => { fieldMap[f.api_name] = f.field_label; });

      res.json({
        success: true,
        module: moduleName,
        totalRecords: totalCount,
        sampleCount: records.length,
        fieldMap,
        records,
        fields: allFields.slice(0, 30).map(f => ({
          label: f.field_label,
          apiName: f.api_name,
          type: f.data_type
        }))
      });
      return;
    }

    // ── PULL ALL: fetch all records from a module (paginated) ─────────────
    if (action === 'pullall') {
      const moduleName = req.query?.module || 'Leads';
      const maxRecords = parseInt(req.query?.max || '500'); // safety cap

      // Get fields
      const fieldsRes = await zohoReq('GET', `settings/fields?module=${moduleName}`, token, dc);
      const allFields = fieldsRes.data?.fields || [];
      const keyFields = allFields
        .filter(f => ['text','email','phone','picklist','currency','date','datetime','ownerlookup'].includes(f.data_type))
        .slice(0, 15)
        .map(f => f.api_name)
        .join(',');

      const allRecords = [];
      let page = 1;
      let hasMore = true;

      while (hasMore && allRecords.length < maxRecords) {
        const pageRes = await zohoReq('GET',
          `${moduleName}?per_page=200&page=${page}&fields=${keyFields}`,
          token, dc
        );
        const records = pageRes.data?.data || [];
        allRecords.push(...records);
        hasMore = pageRes.data?.info?.more_records || false;
        page++;
        if (records.length === 0) break;
      }

      // Build analytics from the records
      const analytics = buildAnalytics(moduleName, allRecords, allFields);

      const fieldMap = {};
      allFields.forEach(f => { fieldMap[f.api_name] = f.field_label; });

      res.json({
        success: true,
        module: moduleName,
        totalPulled: allRecords.length,
        analytics,
        fieldMap,
        // Return record list (limited for response size)
        records: allRecords.slice(0, 100)
      });
      return;
    }

    // ── SYNC: pull key modules and compute dashboard metrics ──────────────
    if (action === 'sync') {
      const [leadsRes, dealsRes, contactsRes] = await Promise.all([
        zohoReq('GET', 'Leads?per_page=200&page=1', token, dc),
        zohoReq('GET', 'Deals?per_page=200&page=1&fields=id,Deal_Name,Stage,Amount,Closing_Date,Account_Name,Owner,Lead_Source,Created_Time', token, dc),
        zohoReq('GET', 'Contacts?per_page=200&page=1', token, dc)
      ]);

      const leads = leadsRes.data?.data || [];
      const deals = dealsRes.data?.data || [];
      const contacts = contactsRes.data?.data || [];

      // Stage breakdown
      const stageMap = {};
      deals.forEach(d => { const s = d.Stage || 'Unknown'; stageMap[s] = (stageMap[s]||0)+1; });

      // Owner breakdown
      const ownerMap = {};
      deals.forEach(d => { const o = d.Owner?.name || 'Unknown'; ownerMap[o] = (ownerMap[o]||0)+1; });

      // Pipeline value
      const openDeals = deals.filter(d => !['Closed Won','Closed Lost'].includes(d.Stage));
      const pipelineValue = openDeals.reduce((s,d) => s+(parseFloat(d.Amount)||0), 0);
      const wonDeals = deals.filter(d => d.Stage === 'Closed Won');
      const wonValue = wonDeals.reduce((s,d) => s+(parseFloat(d.Amount)||0), 0);

      // Win rate
      const closedDeals = deals.filter(d => ['Closed Won','Closed Lost'].includes(d.Stage));
      const winRate = closedDeals.length ? Math.round((wonDeals.length/closedDeals.length)*100) : 0;

      // Lead source breakdown
      const sourceMap = {};
      leads.forEach(l => { const s = l.Lead_Source || 'Unknown'; sourceMap[s] = (sourceMap[s]||0)+1; });

      res.json({
        leads: leadsRes.data?.info?.count || leads.length,
        deals: openDeals.length,
        contacts: contactsRes.data?.info?.count || contacts.length,
        pipeline: pipelineValue > 0 ? '₹' + (pipelineValue/100000).toFixed(1) + 'L' : '₹0',
        pipelineRaw: pipelineValue,
        wonRevenue: wonValue > 0 ? '₹' + (wonValue/100000).toFixed(1) + 'L' : '₹0',
        winRate: winRate + '%',
        stages: stageMap,
        owners: ownerMap,
        leadSources: sourceMap,
        synced: new Date().toISOString()
      });
      return;
    }

    res.status(400).json({ error: 'Unknown action: ' + action });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};

function buildAnalytics(module, records, fields) {
  if (!records.length) return { summary: 'No records found' };

  // Find picklist fields (stage, status, etc.)
  const picklistFields = fields.filter(f => f.data_type === 'picklist');
  const currencyFields = fields.filter(f => f.data_type === 'currency');
  const ownerFields = fields.filter(f => f.data_type === 'ownerlookup');

  const analytics = { totalRecords: records.length, breakdowns: {}, topOwners: {} };

  // Breakdown by each picklist field
  picklistFields.slice(0, 5).forEach(f => {
    const counts = {};
    records.forEach(r => {
      const val = r[f.api_name] || 'Not set';
      counts[val] = (counts[val]||0) + 1;
    });
    analytics.breakdowns[f.field_label] = counts;
  });

  // Owner distribution
  ownerFields.slice(0,1).forEach(f => {
    const counts = {};
    records.forEach(r => {
      const val = r[f.api_name]?.name || 'Unknown';
      counts[val] = (counts[val]||0) + 1;
    });
    analytics.topOwners = counts;
  });

  // Total value if currency field exists
  if (currencyFields.length) {
    const f = currencyFields[0];
    const total = records.reduce((s,r) => s+(parseFloat(r[f.api_name])||0), 0);
    analytics.totalValue = total;
    analytics.totalValueField = f.field_label;
    analytics.avgValue = records.length ? Math.round(total/records.length) : 0;
  }

  return analytics;
}
