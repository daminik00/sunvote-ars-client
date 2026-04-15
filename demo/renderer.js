'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  stateBadge: $('state-badge'),
  driverInfo: $('driver-info'),
  btnCheckDriver: $('btn-check-driver'),
  btnOpenDriverDownload: $('btn-open-driver-download'),
  btnConnect: $('btn-connect'),
  btnDisconnect: $('btn-disconnect'),
  debugToggle: $('debug-toggle'),
  cfgPort: $('cfg-port'),
  cfgBaseId: $('cfg-baseId'),
  cfgChannel: $('cfg-channel'),
  cfgKeys: $('cfg-keys'),
  btnStartVoting: $('btn-start-voting'),
  btnStopVoting: $('btn-stop-voting'),
  voteOptions: $('vote-options'),
  voteMin: $('vote-min'),
  voteMax: $('vote-max'),
  keypadsTable: $('keypads-table'),
  keypadsTableBody: document.querySelector('#keypads-table tbody'),
  keypadsEmpty: $('keypads-empty'),
  keypadCount: $('keypad-count'),
  log: $('log'),
};

let currentState = 'idle';
const keypadsByid = new Map();

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function makeSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

// -----------------------------------------------------------------------------
// Log helpers
// -----------------------------------------------------------------------------

function log(level, msg) {
  const li = document.createElement('li');
  li.appendChild(makeSpan('ts', new Date().toLocaleTimeString()));
  li.appendChild(makeSpan(`level-${level}`, msg));
  els.log.insertBefore(li, els.log.firstChild);
  while (els.log.children.length > 200) els.log.removeChild(els.log.lastChild);
}

// -----------------------------------------------------------------------------
// State & UI
// -----------------------------------------------------------------------------

function applyState(state) {
  currentState = state;
  els.stateBadge.textContent = state;
  els.stateBadge.className = `badge state-${state}`;

  const connected = state === 'connected' || state === 'voting';
  const voting = state === 'voting';

  els.btnConnect.disabled = connected;
  els.btnDisconnect.disabled = !connected;
  els.btnStartVoting.disabled = !connected || voting;
  els.btnStopVoting.disabled = !voting;
}

function applyConfig(cfg) {
  if (!cfg) {
    els.cfgBaseId.textContent = '—';
    els.cfgChannel.textContent = '—';
    els.cfgKeys.textContent = '—';
    return;
  }
  els.cfgBaseId.textContent = String(cfg.baseId);
  els.cfgChannel.textContent = String(cfg.channel);
  els.cfgKeys.textContent = `${cfg.keyFrom}..${cfg.keyTo} (max ${cfg.keyMax})`;
}

function renderKeypads() {
  const keypads = Array.from(keypadsByid.values()).sort((a, b) => a.keypadId - b.keypadId);
  els.keypadCount.textContent = `(${keypads.length})`;

  els.keypadsTable.setAttribute('data-empty', keypads.length === 0 ? 'true' : 'false');
  els.keypadsEmpty.setAttribute('data-empty', keypads.length === 0 ? 'true' : 'false');

  clearChildren(els.keypadsTableBody);
  for (const k of keypads) {
    const tr = document.createElement('tr');
    tr.dataset.keypadId = String(k.keypadId);

    const idTd = document.createElement('td');
    idTd.textContent = String(k.keypadId);
    tr.appendChild(idTd);

    const btnTd = document.createElement('td');
    btnTd.textContent = k.press ? k.press.buttonLabel : '—';
    tr.appendChild(btnTd);

    const whenTd = document.createElement('td');
    whenTd.textContent = k.press ? new Date(k.press.timestamp).toLocaleTimeString() : '—';
    tr.appendChild(whenTd);

    els.keypadsTableBody.appendChild(tr);
  }
}

// -----------------------------------------------------------------------------
// Driver check
// -----------------------------------------------------------------------------

function renderDriverStatus(status, info) {
  clearChildren(els.driverInfo);
  const icon = status.installed ? '✅' : '⚠️';
  const klass = status.installed ? 'level-success' : 'level-warn';
  els.driverInfo.appendChild(makeSpan(klass, `${icon} ${status.message}`));
  if (info.needed) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = info.instructions;
    els.driverInfo.appendChild(p);
  }
}

async function checkDriver() {
  clearChildren(els.driverInfo);
  els.driverInfo.appendChild(makeSpan('muted', 'Checking…'));
  try {
    const { status, info } = await window.sunvote.checkDriver();
    renderDriverStatus(status, info);
    els.btnOpenDriverDownload.disabled = !status.downloadUrl;
    log(status.installed ? 'success' : 'warn', `Driver: ${status.message}`);
  } catch (err) {
    clearChildren(els.driverInfo);
    els.driverInfo.appendChild(makeSpan('level-error', err.message));
    log('error', `Driver check failed: ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// Wiring
// -----------------------------------------------------------------------------

els.btnCheckDriver.addEventListener('click', checkDriver);

els.btnOpenDriverDownload.addEventListener('click', async () => {
  try {
    const url = await window.sunvote.openDriverDownload();
    log('info', `Opened ${url}`);
  } catch (err) {
    log('error', `Failed to open download page: ${err.message}`);
  }
});

els.btnConnect.addEventListener('click', async () => {
  els.btnConnect.disabled = true;
  try {
    const cfg = await window.sunvote.connect({ debug: els.debugToggle.checked });
    applyConfig(cfg);
    els.cfgPort.textContent = 'auto';
    log('success', `Connected. baseId=${cfg.baseId} channel=${cfg.channel}`);
  } catch (err) {
    log('error', `Connect failed: ${err.message}`);
    els.btnConnect.disabled = false;
  }
});

els.btnDisconnect.addEventListener('click', async () => {
  try {
    await window.sunvote.disconnect();
    applyConfig(null);
    els.cfgPort.textContent = '—';
    keypadsByid.clear();
    renderKeypads();
    log('info', 'Disconnected.');
  } catch (err) {
    log('error', `Disconnect failed: ${err.message}`);
  }
});

els.btnStartVoting.addEventListener('click', async () => {
  try {
    const opts = {
      options: Number(els.voteOptions.value),
      minSelections: Number(els.voteMin.value),
      maxSelections: Number(els.voteMax.value),
    };
    await window.sunvote.startVoting(opts);
    log('success', `Started voting (options=${opts.options}, min=${opts.minSelections}, max=${opts.maxSelections}).`);
  } catch (err) {
    log('error', `Start voting failed: ${err.message}`);
  }
});

els.btnStopVoting.addEventListener('click', async () => {
  try {
    await window.sunvote.stopVoting();
    log('info', 'Stopped voting.');
  } catch (err) {
    log('error', `Stop voting failed: ${err.message}`);
  }
});

// -----------------------------------------------------------------------------
// Events from SDK
// -----------------------------------------------------------------------------

window.sunvote.onStateChange(({ newState, oldState }) => {
  applyState(newState);
  log('info', `State: ${oldState} → ${newState}`);
});

window.sunvote.onBaseConfig((cfg) => {
  applyConfig(cfg);
  log('info', `Base config updated: baseId=${cfg.baseId} channel=${cfg.channel}`);
});

window.sunvote.onKeypadNew((id) => {
  if (!keypadsByid.has(id)) {
    keypadsByid.set(id, { keypadId: id, press: null });
    renderKeypads();
  }
  log('info', `New keypad detected: ${id}`);
});

window.sunvote.onKeypadPress((press) => {
  keypadsByid.set(press.keypadId, { keypadId: press.keypadId, press });
  renderKeypads();
  const row = els.keypadsTableBody.querySelector(`tr[data-keypad-id="${press.keypadId}"]`);
  if (row) {
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }
  log('success', `Keypad ${press.keypadId} pressed ${press.buttonLabel}`);
});

window.sunvote.onError((msg) => log('error', `SDK error: ${msg}`));

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------

(async () => {
  await checkDriver();
  const snap = await window.sunvote.snapshot();
  applyState(snap.state);
  applyConfig(snap.config);
  for (const k of snap.keypads) keypadsByid.set(k.keypadId, k);
  renderKeypads();
})();
