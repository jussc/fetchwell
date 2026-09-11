// Vercel Serverless Function: GET /api/products
// Fetches product rows from Airtable server-side, so the Airtable token
// never reaches the browser. Reads config from environment variables set
// in the Vercel dashboard (Project Settings > Environment Variables):
//
//   AIRTABLE_API_KEY    - a Personal Access Token, scoped read-only to this base
//   AIRTABLE_BASE_ID     - starts with "app..."
//   AIRTABLE_TABLE_NAME  - e.g. "Products" (optional, defaults to "Products")

export default async function handler(req, res) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME || 'Products';

  if (!apiKey || !baseId) {
    res.status(500).json({
      error: 'Airtable is not configured yet. Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in Vercel project settings.'
    });
    return;
  }

  try {
    var records = [];
    var offset;

    do {
      var url = new URL('https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(tableName));
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      var airtableRes = await fetch(url, {
        headers: { Authorization: 'Bearer ' + apiKey }
      });

      if (!airtableRes.ok) {
        var errText = await airtableRes.text();
        throw new Error('Airtable responded ' + airtableRes.status + ': ' + errText);
      }

      var data = await airtableRes.json();
      records = records.concat(data.records || []);
      offset = data.offset;
    } while (offset);

    // Handles both Airtable "multiple select" fields (already arrays)
    // and plain text fields using semicolon-separated values.
    function toArray(val) {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        return val.split(';').map(function (s) { return s.trim(); }).filter(Boolean);
      }
      return [];
    }

    var products = records
      .map(function (r) {
        var f = r.fields || {};
        return {
          id: r.id,
          name: f.name || 'Untitled product',
          pet: (f.pet || '').toString().toLowerCase().trim(),
          stages: toArray(f.stages).map(function (s) { return s.toLowerCase(); }),
          concerns: toArray(f.concerns).map(function (s) { return s.toLowerCase(); }),
          budget: toArray(f.budget).map(function (s) { return s.toLowerCase(); }),
          price: f.price != null ? '$' + Number(f.price).toFixed(2) : '',
          rating: (f.rating != null && f.review_count != null)
            ? f.rating + ' · ' + Number(f.review_count).toLocaleString() + ' reviews'
            : '',
          retailer: f.retailer || '',
          affiliateUrl: f.affiliate_url || '#',
          why: f.why || '',
          imageUrl: f.image_url || ''
        };
      })
      // Drop rows that are missing the fields matching depends on.
      .filter(function (p) { return p.name && p.pet && p.stages.length && p.concerns.length; });

    // Cache at the edge for 5 minutes so repeat visits are fast,
    // but still pick up new/edited products reasonably quickly.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ products: products });
  } catch (err) {
    res.status(500).json({ error: 'Could not load products from Airtable.', detail: err.message });
  }
}