// Cloudflare Pages Function: POST /api/order
// Receives the request form and records it in OnePageCRM as a contact, a note and a next action.
// Needs two secrets set on the Pages project (Settings > Variables and Secrets):
//   OPCRM_USER_ID   OnePageCRM user id
//   OPCRM_API_KEY   OnePageCRM API key
// Without them it answers 503 and the page falls back to email. No data is stored anywhere else.

const API = 'https://app.onepagecrm.com/api/v3';
const INTENTS = { order: 'Order', report: 'Sample report request', question: 'Question' };

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

function slug(value) {
  return clean(value, 40).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function crm(env, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Basic ' + btoa(env.OPCRM_USER_ID + ':' + env.OPCRM_API_KEY),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* throttle answers are plain text */ }
  if (!res.ok) throw new Error('CRM ' + method + ' ' + path.split('?')[0] + ' -> ' + res.status);
  return data;
}

export async function onRequestPost({ request, env }) {
  let input;
  try { input = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_request' }, 400); }

  // Honeypot: real visitors never fill the hidden "website" field.
  if (clean(input.website, 200)) return json({ ok: true }, 200);

  const intent = INTENTS[input.intent] ? input.intent : 'report';
  const stage = input.stage === 2 ? 2 : 1;
  const email = clean(input.email, 160).toLowerCase();
  const country = clean(input.country, 80);
  const crop = clean(input.crop, 200);
  const message = clean(input.message, 1500);
  const lang = clean(input.lang, 5);
  const samples = Math.max(0, Math.min(100000, parseInt(input.samples, 10) || 0));
  const utmSource = slug(input.utm_source);
  const origin = [
    ['utm_source', input.utm_source], ['utm_medium', input.utm_medium],
    ['utm_campaign', input.utm_campaign], ['utm_content', input.utm_content], ['referrer', input.referrer],
  ].map(([k, v]) => [k, clean(v, 80)]).filter(([, v]) => v).map(([k, v]) => k + '=' + v).join(', ');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || input.consent !== true) {
    return json({ ok: false, error: 'invalid' }, 422);
  }
  if (!env.OPCRM_USER_ID || !env.OPCRM_API_KEY) {
    return json({ ok: false, error: 'not_configured' }, 503);
  }

  const unit = samples <= 3 ? 189 : samples <= 5 ? 179 : 169;
  const summary =
    'biofiling.eu form, ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC\n' +
    'Type: ' + INTENTS[intent] + (stage === 2 ? ' (details added after a sample-report request)' : '') + '\n' +
    'Samples: ' + (samples || 'not stated') + '\n' +
    'Price shown on the page: ' + (intent !== 'order' || !samples ? 'not applicable'
      : 'EUR ' + unit + ' per sample, EUR ' + samples * unit + ' (VAT included where it applies; shipping extra)') + '\n' +
    'Country: ' + (country || 'not stated') + '\n' +
    'Crops: ' + (crop || 'not stated') + '\n' +
    'Page language: ' + (lang || 'not stated') + '\n' +
    'Came from: ' + (origin || 'not known') + '\n' +
    'Message: ' + (message || 'none') + '\n' +
    'Consent to be contacted about this request: yes';

  try {
    // Reuse the contact if this email is already in the CRM.
    const found = await crm(env, 'GET', '/contacts?email=' + encodeURIComponent(email));
    const existing = found && found.data && found.data.contacts && found.data.contacts[0];
    let contactId = existing && existing.contact && existing.contact.id;

    if (!contactId) {
      const tags = ['BioFiling', 'biofiling.eu'];
      if (utmSource) tags.push('src-' + utmSource);
      const created = await crm(env, 'POST', '/contacts', {
        // The form asks for the email only; the name is filled in by hand after the first reply.
        last_name: email.split('@')[0],
        emails: [{ type: 'work', value: email }],
        tags,
        background: 'Came through the biofiling.eu request form.' + (origin ? ' Source: ' + origin + '.' : ''),
      });
      contactId = created && created.data && created.data.contact && created.data.contact.id;
    }
    if (!contactId) throw new Error('CRM returned no contact id');

    await crm(env, 'POST', '/notes', { contact_id: contactId, text: summary });
    const actionText = (intent === 'order'
      ? 'Reply to BioFiling order request' + (samples ? ' (' + samples + ' samples)' : '')
      : intent === 'report' ? 'Send BioFiling sample report' : 'Answer BioFiling question').slice(0, 140);
    await crm(env, 'POST', '/actions', { contact_id: contactId, text: actionText, status: 'asap' });

    return json({ ok: true }, 200);
  } catch (err) {
    console.log('order failed: ' + err.message);
    return json({ ok: false, error: 'crm_failed' }, 502);
  }
}
