/* NOTE: mail mode (form attribute data-send="mail") is the default until the CRM connection has taken one
   real test request; then build with `build-v4.ps1 -FormMode api`. In mail mode the form opens the visitor's own
   mail program (mailto:), calls no server and stores nothing.
   BioFiling page script (v4): two-step request form, cookie-free step counting.
   No cookies, no storage, no third parties. Safe on pages that have no form. */
(function () {
  var lang = document.documentElement.lang || 'en';

  // Paste a payment link here when one exists. It is offered after a successful order request.
  var PAYMENT_LINK = '';

  // Where the visitor came from: read once from the address and the referrer, sent only with a request.
  var qs = new URLSearchParams(location.search);
  var source = {
    utm_source: qs.get('utm_source') || '', utm_medium: qs.get('utm_medium') || '',
    utm_campaign: qs.get('utm_campaign') || '', utm_content: qs.get('utm_content') || '',
    referrer: ''
  };
  try { if (document.referrer) source.referrer = new URL(document.referrer).hostname; } catch (e) {}

  function track(step, where) {
    try {
      var body = JSON.stringify({ step: step, lang: lang, path: location.pathname, where: where || '' });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/e', new Blob([body], { type: 'application/json' }));
    } catch (e) { /* counting must never break the page */ }
  }
  track('view');

  if ('IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var step = en.target.getAttribute('data-step');
        if (en.isIntersecting && !seen[step]) { seen[step] = 1; track(step); }
      });
    }, { threshold: 0.2 });
    document.querySelectorAll('[data-step]').forEach(function (el) { io.observe(el); });
  }

  var form = document.getElementById('order-form');

  document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]').forEach(function (a) {
    a.addEventListener('click', function () { track('mail_click', a.href.slice(0, 3)); });
  });

  // Header and bottom-bar buttons lead to the request form; on pages without the form they simply follow the link.
  if (!form) {
    document.querySelectorAll('[data-intent-link]').forEach(function (a) {
      a.addEventListener('click', function () { track('cta_click', a.getAttribute('data-where') || ''); });
    });
    return;
  }

  // On leaving a sample-count field, write back a valid number.
  function clampField(el) {
    if (!el) return;
    el.addEventListener('blur', function () { el.value = Math.max(1, parseInt(el.value, 10) || 1); });
  }

  var intentInputs = form.querySelectorAll('input[name="intent"]');

  function setIntent(value) {
    intentInputs.forEach(function (r) { r.checked = r.value === value; });
    form.setAttribute('data-intent', value);
    // A field is required only for the purpose it belongs to.
    form.querySelectorAll('[data-req]').forEach(function (el) { el.required = el.getAttribute('data-req') === value; });
  }

  intentInputs.forEach(function (r) { r.addEventListener('change', function () { setIntent(r.value); }); });
  clampField(form.elements.samples);
  setIntent(form.getAttribute('data-intent') || 'report');

  // Buttons that lead to the form choose its purpose.
  document.querySelectorAll('[data-intent-link]').forEach(function (a) {
    a.addEventListener('click', function () {
      setIntent(a.getAttribute('data-intent-link'));
      track('cta_click', a.getAttribute('data-where') || '');
    });
  });

  var started = false;
  form.addEventListener('input', function () { if (!started) { started = true; track('form_start'); } });

  var fail = document.getElementById('order-fail');
  var button = form.querySelector('button[type="submit"]');
  var sentEmail = '';

  function val(f, name) { var el = f.elements[name]; return el ? el.value.trim() : ''; }

  function send(payload) {
    payload.lang = lang;
    Object.keys(source).forEach(function (k) { payload[k] = source[k]; });
    return fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return res.ok && d.ok; }); })
      .catch(function () { return false; });
  }

  function mailtoFallback(intent) {
    var body = 'Type: ' + intent + '\nNumber of samples: ' + val(form, 'samples') + '\nCountry: ' + val(form, 'country') +
      '\nCrops: ' + val(form, 'crop') + '\n\n' + val(form, 'message');
    return 'mailto:my@greenclinicglobal.com?subject=' + encodeURIComponent('BioFiling request') + '&body=' + encodeURIComponent(body);
  }

  // Mail mode: nothing is sent by the site. The request is written into the visitor's own mail program.
  function sendByMail(intent) {
    if (val(form, 'website')) return; // spam trap filled: do nothing
    var lines = [];
    var subject = 'Question about BioFiling';
    if (intent === 'report') subject = 'BioFiling sample report request';
    if (intent === 'order') subject = 'BioFiling order request';
    if (intent === 'order') {
      lines.push('Number of samples: ' + val(form, 'samples'));
      lines.push('Country: ' + val(form, 'country'));
      lines.push('Crop(s): ' + val(form, 'crop'));
    }
    lines.push('Email: ' + val(form, 'email'));
    if (intent === 'question') lines.push('Question: ' + val(form, 'message'));
    var url = 'mailto:my@greenclinicglobal.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
    (window.__bfOpenMail || function (u) { window.location.href = u; })(url);
    fail.hidden = true;
    var note = document.getElementById('order-mail-opened');
    if (note) { note.hidden = false; }
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    var intent = form.getAttribute('data-intent');
    if (form.getAttribute('data-send') === 'mail') { sendByMail(intent); return; }
    track('form_submit', intent);
    button.disabled = true;
    form.classList.add('is-sending');
    fail.hidden = true;

    var payload = {
      intent: intent, stage: 1, email: val(form, 'email'), website: val(form, 'website'),
      consent: form.elements.consent ? form.elements.consent.checked : false,
      samples: intent === 'order' ? val(form, 'samples') : '', country: intent === 'order' ? val(form, 'country') : '',
      crop: intent === 'order' ? val(form, 'crop') : '', message: intent === 'question' ? val(form, 'message') : ''
    };
    send(payload).then(function (ok) {
      button.disabled = false;
      form.classList.remove('is-sending');
      if (!ok && intent === 'report') {
        // The visitor asked to see a report: show the extract whatever the server answered,
        // say plainly that the request did not arrive, and try again quietly while the page is open.
        track('form_fail', intent);
        var box = document.getElementById('done-report');
        document.getElementById('report-mail').href = mailtoFallback(intent);
        box.classList.add('is-unsent');
        form.hidden = true; box.hidden = false;
        box.scrollIntoView({ block: 'center' });
        var tries = 0;
        (function retry() {
          if (++tries > 3) return;
          setTimeout(function () {
            send(payload).then(function (done) {
              if (done) { track('form_ok', 'report-retry'); sentEmail = payload.email; box.classList.remove('is-unsent'); }
              else retry();
            });
          }, tries * 8000);
        })();
        return;
      }
      if (!ok) {
        track('form_fail', intent);
        document.getElementById('order-mail').href = mailtoFallback(intent);
        fail.hidden = false;
        return;
      }
      track('form_ok', intent);
      sentEmail = val(form, 'email');
      form.hidden = true;
      var done = document.getElementById(intent === 'report' ? 'done-report' : 'done-order');
      done.hidden = false;
      if (PAYMENT_LINK && intent === 'order') { var pay = document.getElementById('order-pay'); pay.href = PAYMENT_LINK; pay.hidden = false; }
      done.scrollIntoView({ block: 'center' });
    });
  });

  // Step two, offered after a sample-report request: the details needed for an offer.
  var step2 = document.getElementById('step2-form');
  if (step2) {
    step2.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var b = step2.querySelector('button'); b.disabled = true;
      send({ intent: 'order', stage: 2, email: sentEmail, consent: true,
             samples: val(step2, 'samples'), country: val(step2, 'country'), crop: val(step2, 'crop') })
        .then(function (ok) {
          b.disabled = false;
          if (ok) { track('form_ok', 'step2'); step2.hidden = true; document.getElementById('step2-done').hidden = false; }
          else { track('form_fail', 'step2'); }
        });
    });
  }
})();
