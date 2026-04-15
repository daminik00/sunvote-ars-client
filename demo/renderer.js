'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  stateBadge: $('state-badge'),
  driverInfo: $('driver-info'),
  btnCheckDriver: $('btn-check-driver'),
  btnOpenDriverDownload: $('btn-open-driver-download'),
  portSelect: $('port-select'),
  btnRefreshPorts: $('btn-refresh-ports'),
  btnConnect: $('btn-connect'),
  btnDisconnect: $('btn-disconnect'),
  debugToggle: $('debug-toggle'),
  cfgPort: $('cfg-port'),
  cfgBaseId: $('cfg-baseId'),
  cfgChannel: $('cfg-channel'),
  cfgKeys: $('cfg-keys'),
  writeBaseId: $('write-base-id'),
  writeKeyFrom: $('write-key-from'),
  writeKeyTo: $('write-key-to'),
  writeChannel: $('write-channel'),
  btnWriteConfig: $('btn-write-config'),
  btnReadKeypadId: $('btn-read-keypad-id'),
  readKeypadIdResult: $('read-keypad-id-result'),
  writeKeypadId: $('write-keypad-id'),
  btnWriteKeypadId: $('btn-write-keypad-id'),
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
  clickTableBody: document.querySelector('#click-table tbody'),
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
  // Config write and keypad programming require connected (not voting) state.
  els.btnWriteConfig.disabled = !connected || voting;
  els.btnReadKeypadId.disabled = !connected;
  els.btnWriteKeypadId.disabled = !connected;
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
  // Pre-fill the write-config inputs with the current values so the user can
  // edit a single field without re-typing everything.
  els.writeBaseId.value = String(cfg.baseId);
  els.writeKeyFrom.value = String(cfg.keyFrom);
  els.writeKeyTo.value = String(cfg.keyTo);
  els.writeChannel.value = String(cfg.channel);
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

async function refreshPorts() {
  try {
    const ports = await window.sunvote.listPorts();
    clearChildren(els.portSelect);
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'auto-detect';
    els.portSelect.appendChild(auto);
    for (const p of ports) {
      const opt = document.createElement('option');
      opt.value = p.path;
      const vendor = p.manufacturer || (p.vendorId ? `VID:${p.vendorId}` : 'unknown');
      opt.textContent = `${p.path}  —  ${vendor}`;
      els.portSelect.appendChild(opt);
    }
    log('info', `Found ${ports.length} serial port(s).`);
  } catch (err) {
    log('error', `Port list failed: ${err.message}`);
  }
}

els.btnRefreshPorts.addEventListener('click', refreshPorts);

els.btnConnect.addEventListener('click', async () => {
  els.btnConnect.disabled = true;
  try {
    const path = els.portSelect.value || null;
    const cfg = await window.sunvote.connect({ debug: els.debugToggle.checked, path });
    applyConfig(cfg);
    els.cfgPort.textContent = path || 'auto';
    log('success', `Connected. baseId=${cfg.baseId} channel=${cfg.channel}`);
  } catch (err) {
    log('error', `Connect failed: ${err.message}`);
    els.btnConnect.disabled = false;
  }
});

els.btnWriteConfig.addEventListener('click', async () => {
  try {
    const config = {
      baseId: Number(els.writeBaseId.value),
      keyFrom: Number(els.writeKeyFrom.value),
      keyTo: Number(els.writeKeyTo.value),
      keyMax: Number(els.writeKeyTo.value) - Number(els.writeKeyFrom.value) + 1,
      channel: Number(els.writeChannel.value),
    };
    await window.sunvote.writeConfig(config);
    log('success', `Wrote config: baseId=${config.baseId} channel=${config.channel} keys=${config.keyFrom}..${config.keyTo}`);
  } catch (err) {
    log('error', `Write config failed: ${err.message}`);
  }
});

els.btnReadKeypadId.addEventListener('click', async () => {
  els.readKeypadIdResult.textContent = 'Reading…';
  try {
    const id = await window.sunvote.readKeypadId();
    if (id === null) {
      els.readKeypadIdResult.textContent = 'No keypad responded (is it in programming mode?)';
      log('warn', 'Read keypad ID: no response.');
    } else {
      els.readKeypadIdResult.textContent = `ID = ${id}`;
      log('success', `Read keypad ID: ${id}`);
    }
  } catch (err) {
    els.readKeypadIdResult.textContent = `Error: ${err.message}`;
    log('error', `Read keypad ID failed: ${err.message}`);
  }
});

els.btnWriteKeypadId.addEventListener('click', async () => {
  const id = Number(els.writeKeypadId.value);
  try {
    await window.sunvote.writeKeypadId(id);
    log('success', `Wrote keypad ID ${id}. (Keypad must be in programming mode.)`);
  } catch (err) {
    log('error', `Write keypad ID failed: ${err.message}`);
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

window.sunvote.onKeypadClick((press) => {
  const tr = document.createElement('tr');
  const time = document.createElement('td');
  time.textContent = new Date(press.timestamp).toLocaleTimeString();
  const kp = document.createElement('td');
  kp.textContent = String(press.keypadId);
  const btn = document.createElement('td');
  btn.textContent = press.buttonLabel;
  const counter = document.createElement('td');
  counter.textContent = press.counter !== undefined
    ? `0x${press.counter.toString(16).padStart(2, '0')}`
    : '—';
  tr.appendChild(time);
  tr.appendChild(kp);
  tr.appendChild(btn);
  tr.appendChild(counter);
  els.clickTableBody.insertBefore(tr, els.clickTableBody.firstChild);
  // Cap at 100 rows.
  while (els.clickTableBody.children.length > 100) {
    els.clickTableBody.removeChild(els.clickTableBody.lastChild);
  }
});

window.sunvote.onError((msg) => log('error', `SDK error: ${msg}`));

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------

(async () => {
  await checkDriver();
  await refreshPorts();
  const snap = await window.sunvote.snapshot();
  applyState(snap.state);
  applyConfig(snap.config);
  for (const k of snap.keypads) keypadsByid.set(k.keypadId, k);
  renderKeypads();
})();
