// Cloudflare Pages Function: POST /api/e
// Cookie-free step counter. Stores only the step name, page language and path; no IP, no id, no cookie.
// Counting starts once an Analytics Engine dataset is bound to the Pages project under the name STEPS.
// Without the binding the call is accepted and nothing is stored.

const STEPS = ['view', 'sample_view', 'compare_view', 'price_view', 'cta_click', 'form_start', 'form_submit', 'form_ok', 'form_fail', 'mail_click'];

export async function onRequestPost({ request, env }) {
  try {
    const d = await request.json();
    const step = STEPS.indexOf(d.step) >= 0 ? d.step : '';
    if (step && env.STEPS) {
      env.STEPS.writeDataPoint({
        blobs: [step, String(d.lang || '').slice(0, 5), String(d.path || '').slice(0, 40), String(d.where || '').slice(0, 20)],
        doubles: [1],
        indexes: [step],
      });
    }
  } catch (e) { /* ignore malformed beacons */ }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
