/* ── State ──────────────────────────────────────────────────────────────────── */
let articleData = { headline: '', body: '' };

/* ── Demo pills ─────────────────────────────────────────────────────────────── */
function setDemo(el) {
  document.getElementById('ideaInput').value = el.textContent.trim();
}

/* ── Toast ──────────────────────────────────────────────────────────────────── */
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    background: '#27ae60', color: '#fff', padding: '10px 20px', borderRadius: '6px',
    fontSize: '0.85rem', fontFamily: 'var(--font-mono)', zIndex: '9999',
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

/* ── Badge helpers ──────────────────────────────────────────────────────────── */
function setBadge(agent, state) {
  const b = document.getElementById('badge-' + agent);
  if (!b) return;
  b.className = 'agent-badge ' + state;
  b.textContent = state.toUpperCase();
}
function setCardState(agent, state) {
  const c = document.getElementById('card-' + agent);
  if (!c) return;
  c.className = 'agent-card ' + state;
}

/* ── Token bar ──────────────────────────────────────────────────────────────── */
function updateTokenBar(used) {
  const pct   = Math.min(used / 11000 * 100, 100);
  const color = pct < 70 ? '#27ae60' : pct < 90 ? '#e67e22' : '#c0392b';
  document.getElementById('tokenCount').textContent          = used.toLocaleString();
  document.getElementById('tokenPct').textContent            = pct.toFixed(0) + '%';
  document.getElementById('tokenBarFill').style.width      = pct + '%';
  document.getElementById('tokenBarFill').style.background = color;
}

/* ── Output toggle ──────────────────────────────────────────────────────────── */
function toggleOutput(agent) {
  const pre = document.getElementById('raw-' + agent);
  const btn = document.querySelector('#output-' + agent + ' .toggle-output');
  if (!pre) return;
  if (pre.style.display === 'none' || !pre.style.display) {
    pre.style.display = 'block';
    if (btn) btn.textContent = '▾ Hide output';
  } else {
    pre.style.display = 'none';
    if (btn) btn.textContent = '▸ View raw output';
  }
}

/* ── Markdown-lite renderer ─────────────────────────────────────────────────── */
function renderBody(text) {
  if (!text) return '';
  return text.split('\n').map(function(line) {
    if (line.startsWith('### ')) return '<h3>' + line.slice(4) + '</h3>';
    if (line.startsWith('## '))  return '<h3>' + line.slice(3) + '</h3>';
    if (line.startsWith('# '))   return '<h3>' + line.slice(2) + '</h3>';
    const bold = line.trim();
    if (bold.startsWith('**') && bold.endsWith('**') && bold.length > 4)
      return '<h3>' + bold.slice(2, -2) + '</h3>';
    if (line.trim() === '') return '';
    return '<p>' + line + '</p>';
  }).join('');
}

/* ── Confidence color ───────────────────────────────────────────────────────── */
function confColor(c) { return c >= 75 ? '#27ae60' : c >= 50 ? '#e67e22' : '#c0392b'; }

/* ── Reset ──────────────────────────────────────────────────────────────────── */
function resetPage() {
  document.getElementById('pipelineSection').style.display    = 'none';
  document.getElementById('publicationSection').style.display = 'none';
  document.getElementById('heroSection').scrollIntoView({ behavior: 'smooth' });
  ['news', 'research', 'writing', 'factcheck', 'editorial', 'image'].forEach(function(a) {
    setBadge(a, 'idle');
    setCardState(a, '');
    const statusEl = document.getElementById('status-' + a);
    if (statusEl) statusEl.textContent = 'Waiting…';
    const outWrap = document.getElementById('output-' + a);
    if (outWrap) outWrap.style.display = 'none';
    const rawEl = document.getElementById('raw-' + a);
    if (rawEl) rawEl.textContent = '';
  });
  document.getElementById('confidence-meter').style.display = 'none';
  updateTokenBar(0);
  const runBtn = document.getElementById('runBtn');
  runBtn.disabled = false;
  runBtn.classList.remove('loading');
  runBtn.querySelector('.btn-text').textContent = 'Run Newsroom Pipeline';
}

/* ── Download ───────────────────────────────────────────────────────────────── */
function downloadArticle() {
  const content = articleData.headline + '\n\n' + articleData.body;
  const blob    = new Blob([content], { type: 'text/plain' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = 'article.txt'; a.click();
  URL.revokeObjectURL(url);
}

/* ── Main pipeline runner ───────────────────────────────────────────────────── */
function runPipeline() {
  const idea   = document.getElementById('ideaInput').value.trim();

  if (!idea) { showToast('Please enter a news idea first.'); return; }

  const runBtn = document.getElementById('runBtn');
  runBtn.disabled = true;
  runBtn.classList.add('loading');
  runBtn.querySelector('.btn-text').textContent = 'Running Pipeline…';

  document.getElementById('publicationSection').style.display = 'none';
  document.getElementById('pipelineSection').style.display    = 'block';
  document.getElementById('pipelineSection').scrollIntoView({ behavior: 'smooth' });

  ['news', 'research', 'writing', 'factcheck', 'editorial', 'image'].forEach(function(a) {
    setBadge(a, 'idle'); setCardState(a, '');
    const s = document.getElementById('status-' + a);
    if (s) s.textContent = 'Waiting…';
    const ow = document.getElementById('output-' + a);
    if (ow) ow.style.display = 'none';
    const r = document.getElementById('raw-' + a);
    if (r) r.textContent = '';
  });
  document.getElementById('confidence-meter').style.display = 'none';
  document.getElementById('successBanner').style.display    = 'none';
  updateTokenBar(0);

  const params = new URLSearchParams({ idea: idea });
  const es     = new EventSource('/run?' + params.toString());

  es.onmessage = function(e) {
    var msg;
    try { msg = JSON.parse(e.data); } catch(err) { return; }
    if (msg.event === 'step')   handleStep(msg);
    if (msg.event === 'result') { es.close(); handleResult(msg); }
    if (msg.event === 'error')  {
      es.close();
      runBtn.disabled = false;
      runBtn.classList.remove('loading');
      runBtn.querySelector('.btn-text').textContent = 'Run Newsroom Pipeline';
      showToast('Error: ' + msg.message);
    }
  };

  es.onerror = function() {
    es.close();
    runBtn.disabled = false;
    runBtn.classList.remove('loading');
    runBtn.querySelector('.btn-text').textContent = 'Run Newsroom Pipeline';
  };
}

function handleStep(msg) {
  var agent      = msg.agent;
  var status     = msg.status;
  var label      = msg.label;
  var output     = msg.output;
  var confidence = msg.confidence;
  var tokens     = msg.tokens;

  setBadge(agent, status);
  setCardState(agent, status);

  var statusEl = document.getElementById('status-' + agent);
  if (statusEl) statusEl.textContent = label;

  if (tokens !== undefined) updateTokenBar(tokens);

  if (output) {
    var outWrap = document.getElementById('output-' + agent);
    var rawEl   = document.getElementById('raw-' + agent);
    if (outWrap) outWrap.style.display = 'block';
    if (rawEl)   rawEl.textContent     = output;
  }

  if (agent === 'factcheck' && confidence !== undefined) {
    var meter = document.getElementById('confidence-meter');
    meter.style.display = 'block';
    var fill  = document.getElementById('confBarFill');
    var val   = document.getElementById('confValue');
    fill.style.width      = confidence + '%';
    fill.style.background = confColor(confidence);
    val.textContent       = confidence + '%';
    val.style.color       = confColor(confidence);
  }
}

function handleResult(msg) {
  var headline      = msg.headline;
  var body          = msg.body;
  var tags          = msg.tags || [];
  var confidence    = msg.confidence;
  var total_tokens  = msg.total_tokens || 0;
  var image_keyword = msg.image_keyword;
  var photo         = msg.photo;

  articleData = { headline: headline, body: body };

  document.getElementById('publicationSection').style.display = 'block';

  // Tags
  var tagsEl = document.getElementById('pubTags');
  tagsEl.innerHTML = tags.map(function(t) { return '<span class="tag-pill">' + t + '</span>'; }).join('');

  // Headline & meta
  document.getElementById('pubHeadline').textContent = headline;
  document.getElementById('pubMeta').textContent =
    'AI Newsroom · Confidence: ' + confidence + '% · Tokens: ' + total_tokens.toLocaleString() + ' / 11,000';

  // Keyword badge
  document.getElementById('keywordBadge').textContent = '🔍 Unsplash keyword: ' + image_keyword;

  // Image
  var imgWrap = document.getElementById('pubImageWrap');
  if (photo) {
    imgWrap.innerHTML =
      '<img src="' + photo.url + '" alt="' + headline + '" loading="lazy">' +
      '<div class="photo-credit">📷 <a href="' + photo.profile + '?utm_source=ai_newsroom" target="_blank">' + photo.photographer + '</a> on <a href="https://unsplash.com/?utm_source=ai_newsroom" target="_blank">Unsplash</a></div>';
  } else {
    imgWrap.innerHTML = '<div class="no-image-placeholder">Add your Unsplash Access Key in API settings to display a relevant photo here.</div>';
  }

  // Article body
  document.getElementById('pubBody').innerHTML = renderBody(body);

  // Summary
  document.getElementById('summaryTopic').textContent = document.getElementById('ideaInput').value.trim().slice(0, 80);

  var tokColor = total_tokens < 7700 ? '#27ae60' : total_tokens < 9900 ? '#e67e22' : '#c0392b';
  var tokNumEl = document.getElementById('summaryTokens');
  tokNumEl.textContent  = total_tokens.toLocaleString();
  tokNumEl.style.color  = tokColor;

  var tokPct = Math.min(total_tokens / 11000 * 100, 100);
  document.getElementById('summaryBarFill').style.width      = tokPct + '%';
  document.getElementById('summaryBarFill').style.background = tokColor;

  var confEl = document.getElementById('summaryConf');
  confEl.textContent = confidence + '%';
  confEl.style.color = confColor(confidence);
  document.getElementById('summaryConfFill').style.width      = confidence + '%';
  document.getElementById('summaryConfFill').style.background = confColor(confidence);

  document.getElementById('summaryKeyword').textContent = image_keyword;

  if (photo) {
    document.getElementById('summaryThumb').innerHTML =
      '<img src="' + photo.thumb + '" alt="' + image_keyword + '">' +
      '<div class="summary-thumb-caption">📷 ' + photo.photographer + '</div>';
  }

  // Banner
  var banner = document.getElementById('successBanner');
  document.getElementById('bannerTokens').textContent = total_tokens.toLocaleString();
  banner.style.display = 'block';

  document.getElementById('publicationSection').scrollIntoView({ behavior: 'smooth' });

  var runBtn = document.getElementById('runBtn');
  runBtn.disabled = false;
  runBtn.classList.remove('loading');
  runBtn.querySelector('.btn-text').textContent = 'Run Newsroom Pipeline';
}

/* ── Init ───────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function() {
  loadKeys();
  document.getElementById('ideaInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runPipeline();
  });
});
