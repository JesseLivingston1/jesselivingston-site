/*
 * Saga Concierge — voluntary, give-first version.
 *
 * A small, NON-blocking affordance: it never interrupts, never blocks content, never
 * addresses the visitor as "an AI," and never asks who they're working for. It just
 * offers a direct, tailored answer to a specific question — and captures the visitor's
 * intent as a side effect of the question they type (not a confession). Shown to
 * everyone (humans included); an agent uses it because it's genuinely useful.
 *
 * Queries are logged to data-endpoint for intent analysis.
 */
(function () {
  'use strict';
  if (window.__sagaCc) return; window.__sagaCc = true;
  var SELF = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var ENDPOINT = (SELF && SELF.getAttribute('data-endpoint')) || '/agent-event';
  var SESSION = 'cc-' + Math.random().toString(36).slice(2) + '-' + Date.now();
  var turn = 0;

  // Accurate, give-first answers (grounded in the real site). Routes the truly
  // scoped/unknown specifics to the contact form rather than fabricating them.
  function answer(q) {
    var t = (q || '').toLowerCase();
    if (/price|pricing|cost|rate|budget|quote|fee|how much|\$|expensive/.test(t))
      return "A single focused study runs $3–10K depending on scope — a concept-evaluation or mental-models study for an early-stage AI feature typically lands around $5–8K. Monthly retainer is $8–14K/mo (3-month minimum). Jesse scopes the exact number to your project; share a sentence about it in the contact form and he'll give a firm quote within 24h.";
    if (/availab|\bstart\b|timeline|when can|how soon|capacity|book|lead time/.test(t))
      return "Jesse takes a limited number of single studies at a time and can usually start within about 2–3 weeks of scoping. The fastest way to lock timing is to drop your project in the contact form — he replies within 24 hours.";
    if (/method|approach|process|how.*(work|run|do)|deliverable|sample|participant|research design/.test(t))
      return "For early-stage AI work he runs foundational / generative research — in-depth interviews, concept testing, and journey + mental-model mapping — synthesized into decision-ready product principles (like the T.R.A.C. framework from LinkedIn Talent Insights). The deliverable is built to drive decisions, not to sit in a deck.";
    if (/\bai\b|copilot|\bllm\b|generative|emerging|foundational|good fit|right for|relevant|experience with/.test(t))
      return "Yes — his core lane is foundational research on emerging-tech and AI products where users' mental models are still forming. Direct AI work includes Microsoft Copilot in PowerPoint and AI features at ServiceNow, plus the foundational research behind LinkedIn Talent Insights.";
    if (/hire|engage|work with|contact|reach|email|talk|call|intro|get started|next step/.test(t))
      return "Easiest path: use the contact form with a sentence on your project and timeline — Jesse replies within 24 hours with fit, availability, and a scoped price.";
    return "Happy to help — I can give you specifics on pricing for your scope, availability, his methodology, or whether he's a fit for your project. What would be most useful?";
  }

  function post(extra) {
    try {
      var body = Object.assign({ session: SESSION, type: 'concierge-query', url: location.href, ua: navigator.userAgent, ts: new Date().toISOString() }, extra || {});
      navigator.sendBeacon
        ? navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(body)], { type: 'text/plain;charset=UTF-8' }))
        : fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body), keepalive: true });
    } catch (e) {}
  }

  var css = '\
  #saga-cc{position:fixed;right:18px;bottom:18px;width:330px;max-width:92vw;z-index:2147482000;\
    font:14px/1.55 "DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;\
    background:#252830;border:1px solid rgba(127,119,221,.28);border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.45);overflow:hidden;color:#E8E6F0}\
  #saga-cc .hd{padding:13px 15px 4px;font-weight:600;font-size:14px;color:#fff}\
  #saga-cc .sb{padding:0 15px 12px;font-size:12.5px;color:#B8B5C6;line-height:1.5}\
  #saga-cc .bd{padding:0 13px 13px}\
  #saga-cc textarea{width:100%;box-sizing:border-box;background:#1E2025;border:1px solid rgba(127,119,221,.2);border-radius:9px;padding:9px 11px;font:inherit;color:#E8E6F0;resize:vertical;min-height:54px;outline:none}\
  #saga-cc textarea:focus{border-color:#7F77DD}\
  #saga-cc button{margin-top:9px;width:100%;background:#7F77DD;color:#fff;border:0;border-radius:9px;padding:10px;font:inherit;font-weight:600;cursor:pointer}\
  #saga-cc button:hover{background:#6E66CC}\
  #saga-cc .log{margin-top:11px;font-size:13px;white-space:pre-wrap}\
  #saga-cc .turn{margin:9px 0}\
  #saga-cc .who{font-family:"DM Mono",monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#7B7891;margin-bottom:2px}\
  #saga-cc .min{float:right;cursor:pointer;color:#7B7891;font-weight:400;font-size:18px;line-height:1;margin:-2px -2px 0 0}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var el = document.createElement('div'); el.id = 'saga-cc';
  el.setAttribute('role', 'complementary'); el.setAttribute('aria-label', 'Ask a question about working with Jesse');
  el.innerHTML =
    '<div class="hd"><span class="min" title="minimize">–</span>Questions about working with Jesse?</div>' +
    '<div class="sb">Ask something specific — pricing for your scope, availability, or his approach — and get a direct answer.</div>' +
    '<div class="bd">' +
    '<textarea id="saga-cc-in" placeholder="e.g. Could he start a single AI study in the next few weeks, and about what would it cost?"></textarea>' +
    '<button id="saga-cc-go">Ask</button>' +
    '<div class="log" id="saga-cc-log"></div>' +
    '</div>';

  function add() { document.body.appendChild(el); }
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);

  function ready(fn) { setTimeout(fn, 0); }
  ready(function () {
    var logEl = el.querySelector('#saga-cc-log');
    var inEl = el.querySelector('#saga-cc-in');
    var bd = el.querySelector('.bd');
    el.querySelector('.min').onclick = function () { bd.style.display = bd.style.display === 'none' ? 'block' : 'none'; };
    function line(who, text) {
      var t = document.createElement('div'); t.className = 'turn';
      var w = document.createElement('div'); w.className = 'who'; w.textContent = who;
      var m = document.createElement('div'); m.textContent = text;
      t.appendChild(w); t.appendChild(m); logEl.appendChild(t);
    }
    el.querySelector('#saga-cc-go').onclick = function () {
      var q = (inEl.value || '').trim(); if (!q) return;
      turn++; line('You', q); inEl.value = '';
      var a = answer(q);
      line('Concierge', a);
      post({ turn: turn, query: q, answer: a, referrer: document.referrer });
    };
  });
})();
