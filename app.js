const TARGET_SCORE = 200;
const STORAGE_KEY = 'flip7-rechner-state-v1';

// Runtime-only app state (no persistence across page reloads).
const state = {
  players: [],
  rounds: [
    {
      id: crypto.randomUUID(),
      scores: {},
    },
  ],
  wins: {},
};

let scoreChart;
let prevGameOver = false;

const el = {
  playerForm: document.getElementById('playerForm'),
  playerNameInput: document.getElementById('playerNameInput'),
  playersDetails: document.getElementById('playersDetails'),
  playersList: document.getElementById('playersList'),
  roundsActions: document.getElementById('roundsActions'),
  roundsThead: document.getElementById('roundsThead'),
  roundsTbody: document.getElementById('roundsTbody'),
  roundsTfoot: document.getElementById('roundsTfoot'),
  rankingList: document.getElementById('rankingList'),
  statusText: document.getElementById('statusText'),
  restartFromRankingBtn: document.getElementById('restartFromRankingBtn'),
  appDialog: document.getElementById('appDialog'),
  appDialogEyebrow: document.getElementById('appDialogEyebrow'),
  appDialogTitle: document.getElementById('appDialogTitle'),
  appDialogMessage: document.getElementById('appDialogMessage'),
  appDialogCancel: document.getElementById('appDialogCancel'),
  appDialogConfirm: document.getElementById('appDialogConfirm'),
  renameDialog: document.getElementById('renameDialog'),
  renamePlayerInput: document.getElementById('renamePlayerInput'),
  renameCancelBtn: document.getElementById('renameCancelBtn'),
  renameSaveBtn: document.getElementById('renameSaveBtn'),
  restartDialog: document.getElementById('restartDialog'),
  restartDialogMessage: document.getElementById('restartDialogMessage'),
  restartCancelBtn: document.getElementById('restartCancelBtn'),
  restartNoWinBtn: document.getElementById('restartNoWinBtn'),
  restartWithWinBtn: document.getElementById('restartWithWinBtn'),
  winsList: document.getElementById('winsList'),
  resetWinsBtn: document.getElementById('resetWinsBtn'),
  resetAllDataBtn: document.getElementById('resetAllDataBtn'),
  scoreChartCanvas: document.getElementById('scoreChart'),
};

let dialogResolver;
let renameResolver;
let restartResolver;
const mobilePlayersQuery = window.matchMedia('(max-width: 640px)');

function syncPlayersDetailsMode() {
  if (!mobilePlayersQuery.matches) {
    el.playersDetails.open = true;
  }
}

// ---------- Data Factory ----------

function createPlayer(name) {
  return {
    id: crypto.randomUUID(),
    name,
  };
}

function createRound() {
  // New rounds always include every current player with 0 points.
  const scores = {};
  for (const player of state.players) {
    scores[player.id] = 0;
  }

  return {
    id: crypto.randomUUID(),
    scores,
  };
}

function normalizePlayerName(name) {
  return name.trim().replace(/\s+/g, ' ');
}

// Ensures score values are always non-negative integer numbers.
function clampScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.trunc(parsed));
}

function createRoundForPlayers(players) {
  const scores = {};
  for (const player of players) {
    scores[player.id] = 0;
  }

  return {
    id: crypto.randomUUID(),
    scores,
  };
}

function normalizeWins(winsInput) {
  if (!winsInput || typeof winsInput !== 'object') {
    return {};
  }

  const wins = {};
  for (const [name, value] of Object.entries(winsInput)) {
    if (typeof name !== 'string') {
      continue;
    }

    const normalizedName = normalizePlayerName(name);
    if (!normalizedName) {
      continue;
    }

    wins[normalizedName] = clampScore(value);
  }

  return wins;
}

function normalizePlayers(playersInput) {
  if (!Array.isArray(playersInput)) {
    return [];
  }

  const players = [];
  const seenIds = new Set();

  for (const player of playersInput) {
    if (!player || typeof player !== 'object') {
      continue;
    }

    const normalizedName = normalizePlayerName(String(player.name || '')).slice(0, 20);
    if (!normalizedName) {
      continue;
    }

    let id = typeof player.id === 'string' && player.id ? player.id : crypto.randomUUID();
    if (seenIds.has(id)) {
      id = crypto.randomUUID();
    }

    seenIds.add(id);
    players.push({ id, name: normalizedName });
  }

  return players;
}

function normalizeRounds(roundsInput, players) {
  if (!Array.isArray(roundsInput)) {
    return [createRoundForPlayers(players)];
  }

  const rounds = [];
  const seenIds = new Set();

  for (const round of roundsInput) {
    if (!round || typeof round !== 'object') {
      continue;
    }

    const scores = {};
    const rawScores = round.scores && typeof round.scores === 'object' ? round.scores : {};
    for (const player of players) {
      scores[player.id] = clampScore(rawScores[player.id]);
    }

    let id = typeof round.id === 'string' && round.id ? round.id : crypto.randomUUID();
    if (seenIds.has(id)) {
      id = crypto.randomUUID();
    }

    seenIds.add(id);
    rounds.push({ id, scores });
  }

  return rounds.length ? rounds : [createRoundForPlayers(players)];
}

function saveStateToStorage() {
  try {
    const snapshot = {
      players: state.players.map((player) => ({
        id: player.id,
        name: player.name,
      })),
      rounds: state.rounds.map((round) => {
        const scores = {};
        for (const player of state.players) {
          scores[player.id] = clampScore(round.scores[player.id]);
        }

        return {
          id: round.id,
          scores,
        };
      }),
      wins: normalizeWins(state.wins),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage write errors (e.g. private mode/quota exceeded).
  }
}

function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return;
    }

    const players = normalizePlayers(parsed.players);
    const rounds = normalizeRounds(parsed.rounds, players);
    const wins = normalizeWins(parsed.wins);

    state.players = players;
    state.rounds = rounds;
    state.wins = wins;
    prevGameOver = anyPlayerReachedTarget();
  } catch {
    // Ignore corrupted or unavailable storage data and continue with defaults.
  }
}

// ---------- Dialog Helpers ----------

function showPopup({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Abbrechen',
  variant = 'info',
  showCancel = false,
}) {
  // Generic modal helper used for both info and confirmation dialogs.
  el.appDialogEyebrow.textContent = variant === 'danger' ? 'Bestätigung' : 'Hinweis';
  el.appDialogTitle.textContent = title;
  el.appDialogMessage.textContent = message;
  el.appDialogConfirm.textContent = confirmLabel;
  el.appDialogCancel.textContent = cancelLabel;
  el.appDialogCancel.hidden = !showCancel;
  el.appDialogConfirm.className = variant === 'danger' ? 'btn btn-danger' : 'btn';

  return new Promise((resolve) => {
    dialogResolver = resolve;
    el.appDialog.showModal();
  });
}

function showAlert(title, message) {
  return showPopup({
    title,
    message,
    confirmLabel: 'Verstanden',
    showCancel: false,
  });
}

// Wrapper for dangerous/irreversible actions requiring user confirmation.
function showConfirm(title, message, options = {}) {
  return showPopup({
    title,
    message,
    confirmLabel: options.confirmLabel || 'Bestätigen',
    cancelLabel: options.cancelLabel || 'Abbrechen',
    variant: options.variant || 'danger',
    showCancel: true,
  });
}

function showRenameDialog(currentName) {
  el.renamePlayerInput.value = currentName;

  return new Promise((resolve) => {
    renameResolver = resolve;
    el.renameDialog.showModal();
    el.renamePlayerInput.focus();
    el.renamePlayerInput.select();
  });
}

function allPlayersBelowTarget() {
  const totals = getTotalsMap();
  return Object.values(totals).every((score) => score < TARGET_SCORE);
}

function showRestartDialog() {
  // "Ohne Sieg" is only available before any player reaches target score.
  const canRestartWithoutWin = allPlayersBelowTarget();
  el.restartDialogMessage.textContent = canRestartWithoutWin
    ? 'Du kannst jetzt ohne Siegpunkt neu starten oder dem aktuellen Führenden einen Siegpunkt geben.'
    : 'Bei einem Neustart erhält der aktuelle Führende einen Siegpunkt.';
  el.restartNoWinBtn.hidden = !canRestartWithoutWin;
  el.restartNoWinBtn.style.display = canRestartWithoutWin ? '' : 'none';

  return new Promise((resolve) => {
    restartResolver = resolve;
    el.restartDialog.showModal();
  });
}

// ---------- Game State + Scoring ----------

function getWins() {
  return state.wins;
}

function setWins(wins) {
  state.wins = wins;
}

function addWinsForLeaders() {
  const ranking = getRanking();
  if (!ranking.length) {
    return;
  }

  const topScore = ranking[0].total;
  const leaders = ranking.filter((r) => r.total === topScore);

  // Tie handling: every leader gets a win.
  const wins = getWins();
  for (const leader of leaders) {
    wins[leader.name] = (wins[leader.name] || 0) + 1;
  }

  setWins(wins);
}

function getRanking() {
  const totals = getTotalsMap();
  return state.players
    .map((player) => ({
      id: player.id,
      name: player.name,
      total: totals[player.id] || 0,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'de'));
}

function getTotalsMap() {
  // Totals are recomputed from rounds on each render to keep state minimal.
  const totals = {};
  for (const player of state.players) {
    totals[player.id] = 0;
  }

  for (const round of state.rounds) {
    for (const playerId of Object.keys(round.scores)) {
      const value = Number(round.scores[playerId]);
      if (!Number.isNaN(value)) {
        totals[playerId] = (totals[playerId] || 0) + value;
      }
    }
  }

  return totals;
}

function anyPlayerReachedTarget() {
  const totals = getTotalsMap();
  return Object.values(totals).some((score) => score >= TARGET_SCORE);
}

function hasAnyData() {
  if (!state.players.length || !state.rounds.length) {
    return false;
  }

  return state.rounds.some((round) => Object.values(round.scores).some((value) => Number(value) !== 0));
}

function resetCurrentGame() {
  state.rounds = [createRound()];
  prevGameOver = false;
}

function startNewGame({ shouldCountWin }) {
  // Winner points are only awarded when explicitly requested.
  if (shouldCountWin && hasAnyData()) {
    addWinsForLeaders();
  }

  resetCurrentGame();
  render();
}

function clearAllData() {
  state.players = [];
  state.rounds = [createRound()];
  state.wins = {};
  prevGameOver = false;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage access issues and still reset in-memory state.
  }

  render();
}

// ---------- Mutations ----------

async function addPlayer(name) {
  const normalized = normalizePlayerName(name);
  if (!normalized) {
    return false;
  }

  const isDuplicate = state.players.some((player) => player.name.toLowerCase() === normalized.toLowerCase());
  if (isDuplicate) {
    await showAlert('Name schon vorhanden', 'Bitte wähle einen anderen Spielernamen.');
    return false;
  }

  const player = createPlayer(normalized);
  state.players.push(player);
  for (const round of state.rounds) {
    round.scores[player.id] = 0;
  }
  render();
  return true;
}

async function renamePlayer(playerId) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    return;
  }

  const renamedValue = await showRenameDialog(player.name);
  if (renamedValue === null) {
    return;
  }

  const normalized = normalizePlayerName(renamedValue);
  if (!normalized) {
    await showAlert('Name fehlt', 'Bitte gib einen gültigen Spielernamen ein.');
    return;
  }

  const isDuplicate = state.players.some(
    (entry) => entry.id !== playerId && entry.name.toLowerCase() === normalized.toLowerCase(),
  );
  if (isDuplicate) {
    await showAlert('Name schon vorhanden', 'Bitte wähle einen anderen Spielernamen.');
    return;
  }

  const oldName = player.name;
  if (oldName !== normalized) {
    // Keep historical wins attached when a player gets renamed.
    const wins = getWins();
    if (Object.prototype.hasOwnProperty.call(wins, oldName)) {
      wins[normalized] = (wins[normalized] || 0) + wins[oldName];
      delete wins[oldName];
      setWins(wins);
    }
  }

  player.name = normalized;
  render();
}

function removePlayer(playerId) {
  state.players = state.players.filter((player) => player.id !== playerId);
  for (const round of state.rounds) {
    delete round.scores[playerId];
  }
  render();
}

async function addRound() {
  if (!state.players.length) {
    await showAlert('Spieler fehlen', 'Bitte füge zuerst mindestens einen Spieler hinzu.');
    return;
  }

  state.rounds.push(createRound());
  render();
}

function updateScore(roundId, playerId, value) {
  const round = state.rounds.find((item) => item.id === roundId);
  if (!round) {
    return;
  }

  // Score inputs are sanitized centrally: integer + non-negative.
  round.scores[playerId] = clampScore(value);
  render();
}

function focusScoreInput(order) {
  const target = el.roundsTbody.querySelector(`[data-score-order="${order}"]`);
  if (!target) {
    return;
  }

  target.focus();
  target.select();
}

// ---------- UI Rendering ----------

async function removeRound(roundId) {
  const confirmed = await showConfirm('Runde löschen', 'Möchtest du diese Runde wirklich löschen?', {
    confirmLabel: 'Löschen',
  });
  if (!confirmed) {
    return;
  }

  state.rounds = state.rounds.filter((round) => round.id !== roundId);
  render();
}

function getPositionMap() {
  const ranking = getRanking();
  const positions = {};
  let previousScore;
  let previousPosition = 0;

  ranking.forEach((entry, index) => {
    const position = entry.total === previousScore ? previousPosition : index + 1;
    positions[entry.id] = position;
    previousScore = entry.total;
    previousPosition = position;
  });

  return positions;
}

function renderPlayers() {
  el.playersList.innerHTML = '';
  if (!state.players.length) {
    const empty = document.createElement('li');
    empty.textContent = 'Noch keine Spieler';
    el.playersList.append(empty);
    return;
  }

  for (const player of state.players) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = player.name;

    const actions = document.createElement('span');
    actions.className = 'player-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'player-chip-btn edit-player';
    editBtn.type = 'button';
    editBtn.textContent = '✎';
    editBtn.title = `${player.name} bearbeiten`;
    editBtn.addEventListener('click', () => {
      void renamePlayer(player.id);
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'player-chip-btn remove-player';
    removeBtn.type = 'button';
    removeBtn.textContent = 'x';
    removeBtn.title = `${player.name} entfernen`;
    removeBtn.addEventListener('click', async () => {
      const confirmed = await showConfirm(
        'Spieler entfernen',
        `Möchtest du ${player.name} wirklich entfernen? Alle Punkte dieses Spielers werden aus den Runden gelöscht.`,
        { confirmLabel: 'Entfernen' },
      );
      if (!confirmed) {
        return;
      }
      removePlayer(player.id);
    });

    actions.append(editBtn, removeBtn);
    item.append(name, actions);
    el.playersList.append(item);
  }
}

function renderRoundsTable() {
  el.roundsThead.innerHTML = '';
  el.roundsTbody.innerHTML = '';
  el.roundsTfoot.innerHTML = '';
  el.roundsActions.innerHTML = '';

  const totals = getTotalsMap();
  const reachedTarget = Object.values(totals).some((score) => score >= TARGET_SCORE);
  const winningPlayerIds = new Set();

  if (reachedTarget && state.players.length) {
    const topTotal = Math.max(...state.players.map((player) => totals[player.id] ?? 0));
    for (const player of state.players) {
      if ((totals[player.id] ?? 0) === topTotal) {
        winningPlayerIds.add(player.id);
      }
    }
  }

  const headRow = document.createElement('tr');
  const firstHead = document.createElement('th');
  firstHead.textContent = 'Runde';
  headRow.append(firstHead);

  for (const player of state.players) {
    const playerHead = document.createElement('th');
    if (winningPlayerIds.has(player.id)) {
      playerHead.textContent = `${player.name} 👑`;
      playerHead.classList.add('winner-column-head');
      playerHead.title = 'Fuehrende Position';
    } else {
      playerHead.textContent = player.name;
    }
    headRow.append(playerHead);
  }

  const actionHead = document.createElement('th');
  actionHead.className = 'action-col';
  actionHead.textContent = 'Aktion';
  headRow.append(actionHead);

  el.roundsThead.append(headRow);

  if (!state.players.length) {
    const placeholderRow = document.createElement('tr');
    const placeholder = document.createElement('td');
    placeholder.colSpan = 3;
    placeholder.textContent = 'Keine Spieler vorhanden.';
    placeholderRow.append(placeholder);
    el.roundsTbody.append(placeholderRow);
    renderRoundsActions({ reachedTarget: false, canAddRound: false });
    prevGameOver = false;
    return;
  }

  if (!state.rounds.length) {
    const placeholderRow = document.createElement('tr');
    const placeholder = document.createElement('td');
    placeholder.colSpan = state.players.length + 2;
    placeholder.textContent = 'Noch keine Runde. Klicke auf "Runde hinzufügen".';
    placeholderRow.append(placeholder);
    el.roundsTbody.append(placeholderRow);
  }

  for (let roundIndex = 0; roundIndex < state.rounds.length; roundIndex += 1) {
    const round = state.rounds[roundIndex];
    const row = document.createElement('tr');
    const roundCell = document.createElement('td');
    roundCell.textContent = `Runde ${roundIndex + 1}`;
    row.append(roundCell);

    for (let playerIndex = 0; playerIndex < state.players.length; playerIndex += 1) {
      const player = state.players[playerIndex];
      const scoreCell = document.createElement('td');
      if (winningPlayerIds.has(player.id)) {
        scoreCell.classList.add('winner-column-cell');
      }
      const input = document.createElement('input');
      input.className = 'points-input';
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      // Stable keyboard navigation order across the complete score grid.
      const scoreOrder = roundIndex * state.players.length + playerIndex;
      input.dataset.scoreOrder = String(scoreOrder);
      input.tabIndex = 100 + scoreOrder;
      input.value = round.scores[player.id] ?? 0;
      input.addEventListener('change', (event) => {
        updateScore(round.id, player.id, event.target.value);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') {
          event.preventDefault();

          const currentOrder = Number(input.dataset.scoreOrder || 0);
          const delta = event.shiftKey ? -1 : 1;
          const nextOrder = currentOrder + delta;

          if (nextOrder < 0) {
            input.blur();
            return;
          }

          // Persist current value before jumping to the next/previous field.
          updateScore(round.id, player.id, input.value);
          requestAnimationFrame(() => {
            focusScoreInput(nextOrder);
          });
          return;
        }

        if (event.key !== 'Enter') {
          return;
        }

        event.preventDefault();
        const currentOrder = Number(input.dataset.scoreOrder || 0);
        updateScore(round.id, player.id, input.value);
        requestAnimationFrame(() => {
          const nextInput = el.roundsTbody.querySelector(`[data-score-order="${currentOrder + 1}"]`);
          if (nextInput) {
            nextInput.focus();
            nextInput.select();
            return;
          }

          input.blur();
        });
      });
      scoreCell.append(input);
      row.append(scoreCell);
    }

    const actionCell = document.createElement('td');
    actionCell.className = 'action-col';
    const actionWrap = document.createElement('div');
    actionWrap.className = 'round-cell-end';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'table-action-btn delete-round-btn';
    deleteBtn.textContent = '−';
    deleteBtn.title = `Runde ${roundIndex + 1} löschen`;
    deleteBtn.addEventListener('click', () => {
      void removeRound(round.id);
    });

    actionWrap.append(deleteBtn);
    actionCell.append(actionWrap);
    row.append(actionCell);

    el.roundsTbody.append(row);
  }

  const footerRow = document.createElement('tr');
  const totalLabel = document.createElement('td');
  totalLabel.textContent = 'Gesamt';
  footerRow.append(totalLabel);

  for (const player of state.players) {
    const playerTotalCell = document.createElement('td');
    const total = totals[player.id] ?? 0;
    playerTotalCell.textContent = total;
    if (winningPlayerIds.has(player.id)) {
      playerTotalCell.classList.add('winner-column-cell', 'winner-total-cell');
    }
    footerRow.append(playerTotalCell);
  }

  const footerActionCell = document.createElement('td');
  footerActionCell.className = 'action-col';
  footerRow.append(footerActionCell);
  el.roundsTfoot.append(footerRow);

  const positions = getPositionMap();
  const rankRow = document.createElement('tr');
  rankRow.className = 'footer-rank-row';

  const rankLabel = document.createElement('td');
  rankLabel.textContent = 'Platz';
  rankRow.append(rankLabel);

  for (const player of state.players) {
    const rankCell = document.createElement('td');
    if (winningPlayerIds.has(player.id)) {
      rankCell.classList.add('winner-column-cell');
    }
    const rankBadge = document.createElement('span');
    rankBadge.className = 'table-rank';
    if (winningPlayerIds.has(player.id)) {
      rankBadge.classList.add('winner-rank-badge');
    }
    rankBadge.textContent = `#${positions[player.id] ?? '–'}`;
    rankCell.append(rankBadge);
    rankRow.append(rankCell);
  }

  const rankActionCell = document.createElement('td');
  rankActionCell.className = 'action-col';
  rankRow.append(rankActionCell);

  el.roundsTfoot.append(rankRow);
  renderRoundsActions({ reachedTarget, canAddRound: true });
  prevGameOver = reachedTarget;
}

function renderRoundsActions({ reachedTarget, canAddRound }) {
  el.roundsActions.innerHTML = '';

  const addRoundBtn = document.createElement('button');
  addRoundBtn.type = 'button';
  addRoundBtn.className = 'rounds-action-btn rounds-action-btn-secondary';
  addRoundBtn.textContent = 'Neue Runde hinzufügen';
  addRoundBtn.disabled = !canAddRound;
  addRoundBtn.addEventListener('click', () => {
    void addRound();
  });
  el.roundsActions.append(addRoundBtn);

  if (!reachedTarget) {
    return;
  }

  const isNewlyOver = !prevGameOver;
  const restartBtn = document.createElement('button');
  restartBtn.type = 'button';
  restartBtn.className = isNewlyOver
    ? 'rounds-action-btn rounds-action-btn-danger restart-round-btn'
    : 'rounds-action-btn rounds-action-btn-danger restart-round-btn restart-round-btn--static';
  restartBtn.textContent = 'Neues Spiel starten';
  restartBtn.addEventListener('click', async () => {
    const choice = await showRestartDialog();
    if (choice === 'cancel' || choice === null) {
      return;
    }
    startNewGame({ shouldCountWin: choice === 'with-win' });
  });
  el.roundsActions.append(restartBtn);
}

function renderRanking() {
  const ranking = getRanking();
  el.rankingList.innerHTML = '';

  const allowRestart = hasAnyData();
  el.restartFromRankingBtn.hidden = !allowRestart;

  if (!ranking.length) {
    el.statusText.textContent = 'Noch kein Spielstand vorhanden.';
    return;
  }

  const reachedTarget = anyPlayerReachedTarget();
  if (reachedTarget) {
    el.statusText.textContent = `${TARGET_SCORE} Punkte erreicht. Neustart ist in der Tabelle bei Platz verfügbar.`;
  } else {
    el.statusText.textContent = 'Live-Platzierung während des Spiels.';
  }

  ranking.forEach((entry, index) => {
    const item = document.createElement('li');
    if (index === 0) {
      item.classList.add('top');
    }

    item.innerHTML = `<span>${index + 1}. ${entry.name}</span><strong>${entry.total} Punkte</strong>`;
    el.rankingList.append(item);
  });
}

function renderWinsPanel() {
  const wins = getWins();
  const entries = Object.entries(wins).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'));
  el.resetWinsBtn.hidden = entries.length === 0;
  el.resetAllDataBtn.hidden = false;

  el.winsList.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Noch keine abgeschlossenen Spiele.';
    el.winsList.append(empty);
    return;
  }

  for (const [name, winsCount] of entries) {
    const row = document.createElement('div');
    row.className = 'win-row';
    row.innerHTML = `<span>${name}</span><strong>${winsCount}</strong>`;
    el.winsList.append(row);
  }
}

function renderChart() {
  const totals = getTotalsMap();
  // Keep chart order aligned with the table/player order (not ranking order).
  const labels = state.players.map((player) => player.name);
  const data = state.players.map((player) => totals[player.id] || 0);

  if (!scoreChart) {
    scoreChart = new Chart(el.scoreChartCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Punkte',
            data,
            borderWidth: 1,
            borderColor: '#115e59',
            backgroundColor: 'rgba(15, 118, 110, 0.55)',
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: Math.max(TARGET_SCORE, ...data, 0),
            ticks: {
              precision: 0,
            },
          },
        },
      },
    });
    return;
  }

  scoreChart.data.labels = labels;
  scoreChart.data.datasets[0].data = data;
  scoreChart.options.scales.y.suggestedMax = Math.max(TARGET_SCORE, ...data, 0);
  scoreChart.update();
}

function render() {
  // Single render entry point after each state mutation.
  renderPlayers();
  renderRoundsTable();
  renderRanking();
  renderWinsPanel();
  renderChart();
  saveStateToStorage();
}

// ---------- Event Wiring ----------

el.playerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const added = await addPlayer(el.playerNameInput.value);
  if (added) {
    el.playerNameInput.value = '';
  }
  el.playerNameInput.focus();
});

if (typeof mobilePlayersQuery.addEventListener === 'function') {
  mobilePlayersQuery.addEventListener('change', syncPlayersDetailsMode);
} else if (typeof mobilePlayersQuery.addListener === 'function') {
  mobilePlayersQuery.addListener(syncPlayersDetailsMode);
}

el.restartFromRankingBtn.addEventListener('click', async () => {
  const choice = await showRestartDialog();
  if (choice === 'cancel' || choice === null) {
    return;
  }
  startNewGame({ shouldCountWin: choice === 'with-win' });
});

el.resetWinsBtn.addEventListener('click', async () => {
  const confirmed = await showConfirm('Siege zurücksetzen', 'Möchtest du wirklich alle gespeicherten Siege löschen?', {
    confirmLabel: 'Zurücksetzen',
  });
  if (!confirmed) {
    return;
  }
  setWins({});
  render();
});

el.resetAllDataBtn.addEventListener('click', async () => {
  const confirmed = await showConfirm(
    'Alle Daten löschen',
    'Möchtest du wirklich alle Spielerdaten, Runden und Siege löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
    { confirmLabel: 'Alles löschen' },
  );
  if (!confirmed) {
    return;
  }

  clearAllData();
});

el.appDialogConfirm.addEventListener('click', () => {
  el.appDialog.close('confirm');
  dialogResolver?.(true);
  dialogResolver = undefined;
});

el.appDialogCancel.addEventListener('click', () => {
  el.appDialog.close('cancel');
  dialogResolver?.(false);
  dialogResolver = undefined;
});

el.appDialog.addEventListener('close', () => {
  if (dialogResolver) {
    dialogResolver(false);
    dialogResolver = undefined;
  }
});

el.renameSaveBtn.addEventListener('click', () => {
  el.renameDialog.close('save');
  renameResolver?.(el.renamePlayerInput.value);
  renameResolver = undefined;
});

el.renamePlayerInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  event.preventDefault();
  el.renameSaveBtn.click();
});

el.renameCancelBtn.addEventListener('click', () => {
  el.renameDialog.close('cancel');
  renameResolver?.(null);
  renameResolver = undefined;
});

el.renameDialog.addEventListener('close', () => {
  if (renameResolver) {
    renameResolver(null);
    renameResolver = undefined;
  }
});

el.restartNoWinBtn.addEventListener('click', () => {
  el.restartDialog.close('no-win');
  restartResolver?.('no-win');
  restartResolver = undefined;
});

el.restartWithWinBtn.addEventListener('click', () => {
  el.restartDialog.close('with-win');
  restartResolver?.('with-win');
  restartResolver = undefined;
});

el.restartCancelBtn.addEventListener('click', () => {
  el.restartDialog.close('cancel');
  restartResolver?.('cancel');
  restartResolver = undefined;
});

el.restartDialog.addEventListener('close', () => {
  if (restartResolver) {
    restartResolver(null);
    restartResolver = undefined;
  }
});

loadStateFromStorage();
syncPlayersDetailsMode();
render();
