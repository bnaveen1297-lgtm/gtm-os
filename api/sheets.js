const { cors } = require('./_lib');
const https = require('https');

function fetchSheet(sheetId, range) {
  return new Promise((resolve, reject) => {
    const path = `/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY`;
    const req = https.request({
      hostname: 'sheets.googleapis.com',
      path,
      method: 'GET',
      timeout: 10000
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch(e) { resolve({ error: 'Parse failed' }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Sheets timeout')); });
    req.end();
  });
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const action = req.query?.action || 'test';
  const sheetId = req.query?.id;

  if (!sheetId) { res.status(400).json({ error: 'Missing sheet ID' }); return; }

  try {
    if (action === 'test') {
      // Get sheet metadata
      const metaPath = `/v4/spreadsheets/${sheetId}?key=AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY&fields=properties.title`;
      const metaData = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'sheets.googleapis.com',
          path: metaPath,
          timeout: 8000
        }, (res) => {
          const chunks = [];
          res.on('data', d => chunks.push(d));
          res.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
            catch(e) { resolve({}); }
          });
        });
        req.on('error', () => resolve({}));
        req.on('timeout', () => { req.destroy(); resolve({}); });
        req.end();
      });

      if (metaData.error) {
        res.status(400).json({ error: 'Sheet not accessible. Make sure it is shared as "Anyone with link can view"' });
        return;
      }

      res.json({ success: true, title: metaData.properties?.title || 'Your Sheet' });
      return;
    }

    if (action === 'sync') {
      let mapping = {};
      try { mapping = JSON.parse(req.query?.mapping || '{}'); } catch(e) {}

      // Read data from sheet (first 200 rows)
      const data = await fetchSheet(sheetId, 'A1:Z200');
      const rows = data.values || [];

      if (rows.length < 2) {
        res.json({ rows: 0, leads: 0, revenue: '₹0', message: 'Sheet has no data rows' });
        return;
      }

      // Column letter to index
      const colIdx = (col) => {
        if (!col) return -1;
        const c = col.toUpperCase().charCodeAt(0) - 65;
        return c >= 0 ? c : -1;
      };

      const leadsCol = colIdx(mapping.leads || 'B');
      const revenueCol = colIdx(mapping.revenue || 'C');
      const stageCol = colIdx(mapping.stage || 'D');
      const ownerCol = colIdx(mapping.owner || 'E');
      const statusCol = colIdx(mapping.status || 'F');

      // Skip header row, process data
      const dataRows = rows.slice(1).filter(r => r.length > 0);

      let totalLeads = 0;
      let totalRevenue = 0;
      const stageMap = {};
      const ownerMap = {};
      const statusMap = {};

      dataRows.forEach(row => {
        if (leadsCol >= 0 && row[leadsCol]) totalLeads += parseInt(row[leadsCol]) || 1;
        if (revenueCol >= 0 && row[revenueCol]) {
          const val = parseFloat(row[revenueCol].toString().replace(/[₹,]/g, '')) || 0;
          totalRevenue += val;
        }
        if (stageCol >= 0 && row[stageCol]) {
          const s = row[stageCol];
          stageMap[s] = (stageMap[s] || 0) + 1;
        }
        if (ownerCol >= 0 && row[ownerCol]) {
          const o = row[ownerCol];
          ownerMap[o] = (ownerMap[o] || 0) + 1;
        }
        if (statusCol >= 0 && row[statusCol]) {
          const st = row[statusCol];
          statusMap[st] = (statusMap[st] || 0) + 1;
        }
      });

      res.json({
        rows: dataRows.length,
        leads: totalLeads || dataRows.length,
        revenue: totalRevenue > 0 ? '₹' + (totalRevenue/100000).toFixed(1) + 'L' : '₹0',
        revenueRaw: totalRevenue,
        stages: stageMap,
        owners: ownerMap,
        status: statusMap,
        synced: new Date().toISOString()
      });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
