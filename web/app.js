import {
  DECK_STORAGE_KEY,
  addSlide,
  createDeck,
  deleteSlide,
  editSlide,
  nextSlide,
  previousSlide,
  readLibrary,
  renameDeck,
  slidePosition,
} from "/deck.mjs";
import { CHART_WINDOW_MS, createIntensitySeries } from "/intensity-series.mjs";
import {
  SESSION_STORAGE_KEY,
  averageMovement,
  readSessions,
  recordSample,
  recordTransition,
  startSession,
  stopSession,
} from "/session.mjs";

const label = document.querySelector("#coach-label");
const dot = document.querySelector("#coach-dot");
const detail = document.querySelector("#coach-detail");
const signal = document.querySelector("#coach-signal");
const pageLink = document.querySelector("#page-link");
const button = document.querySelector("#reconnect");
const sensorNote = document.querySelector("#sensor-note");
const sensorTime = document.querySelector("#sensor-time");
const accelX = document.querySelector("#accel-x");
const accelY = document.querySelector("#accel-y");
const accelZ = document.querySelector("#accel-z");
const intensityValue = document.querySelector("#intensity-value");
const intensityMeter = document.querySelector("#intensity-meter");
const intensityBar = document.querySelector("#intensity-bar");
const chartCanvas = document.querySelector("#intensity-chart");
const stageStatus = document.querySelector("#stage-status");
const stageDot = document.querySelector("#stage-dot");
const stageIntensity = document.querySelector("#stage-intensity");
const series = createIntensitySeries();
let chartSession = null;

const labels = {
  connected: "Connected",
  connecting: "Connecting",
  disconnected: "Disconnected",
};

let socket = null;
let retryTimer = null;
let holdTimer = null;
let lastSeen = null;
let latestLink = null;
let coachStatus = "connecting";
let desiredStatus = "connecting";
let holdUntil = 0;
const CONNECTING_HOLD_MS = 700;

function formatAxis(value) {
  return Number(value).toFixed(3);
}

function formatSampleTime(timestamp) {
  if (timestamp >= 1_000_000_000_000) {
    const date = new Date(timestamp);
    const clock = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    const ms = String(date.getMilliseconds()).padStart(3, "0");
    return `Sample ${clock}.${ms}`;
  }
  return `Sample timestamp ${timestamp}`;
}

function formatChartTime(timestamp) {
  if (timestamp >= 1_000_000_000_000) {
    return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }
  return String(Math.round(timestamp));
}

const chart = globalThis.Chart
  ? new globalThis.Chart(chartCanvas, {
      type: "line",
      data: {
        datasets: [
          {
            data: [],
            borderColor: "#1e4d6b",
            backgroundColor: "transparent",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.25,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "Time", color: "#5e6874" },
            ticks: {
              maxTicksLimit: 6,
              color: "#5e6874",
              callback: (value) => formatChartTime(value),
            },
            grid: { color: "#e4dacb" },
          },
          y: {
            min: 0,
            max: 100,
            title: { display: true, text: "Intensity", color: "#5e6874" },
            ticks: {
              color: "#5e6874",
              callback: (value) => `${value}%`,
            },
            grid: { color: "#e4dacb" },
          },
        },
      },
    })
  : null;

function paintChart() {
  if (!chart) return;
  chart.data.datasets[0].data = series.points.map((point) => ({ x: point.timestamp, y: point.intensity }));
  const newest = series.points.at(-1)?.timestamp;
  if (newest == null) {
    delete chart.options.scales.x.min;
    delete chart.options.scales.x.max;
  } else {
    chart.options.scales.x.min = newest - CHART_WINDOW_MS;
    chart.options.scales.x.max = newest;
  }
  chart.update("none");
}

function clearChart() {
  series.reset();
  paintChart();
}

function clearSample() {
  accelX.textContent = "—";
  accelY.textContent = "—";
  accelZ.textContent = "—";
  intensityValue.textContent = "—";
  intensityBar.style.width = "0%";
  intensityMeter.setAttribute("aria-valuenow", "0");
  stageIntensity.textContent = "—";
  sensorTime.textContent = "No sample yet";
  sensorNote.textContent = "Waiting for a sample.";
}

function renderIntensity(movement) {
  if (!Number.isFinite(movement)) {
    intensityValue.textContent = "—";
    intensityBar.style.width = "0%";
    intensityMeter.setAttribute("aria-valuenow", "0");
    return;
  }
  const percent = Math.round(Math.min(1, Math.max(0, movement)) * 100);
  intensityValue.textContent = `${percent}%`;
  intensityBar.style.width = `${percent}%`;
  intensityMeter.setAttribute("aria-valuenow", String(percent));
  stageIntensity.textContent = `${percent}%`;
}

function renderSample(message) {
  if (coachStatus === "disconnected" || !message.accel) return;
  accelX.textContent = formatAxis(message.accel.x);
  accelY.textContent = formatAxis(message.accel.y);
  accelZ.textContent = formatAxis(message.accel.z);
  renderIntensity(message.movement);
  if (series.push(message.timestamp, message.movement).action !== "ignore") paintChart();
  noteSample(message);
  sensorTime.textContent = formatSampleTime(message.timestamp);
  const standIn = message.transport === "development-stand-in" || latestLink?.transport === "development-stand-in";
  sensorNote.textContent = standIn
    ? "Development stand-in. This is not a FreeWili."
    : "Latest sample.";
}

function applyStatus(status) {
  coachStatus = status;
  label.textContent = labels[coachStatus];
  dot.dataset.status = coachStatus;
  stageStatus.textContent = labels[coachStatus];
  stageDot.dataset.status = coachStatus;
  button.setAttribute("aria-busy", coachStatus === "connecting" ? "true" : "false");
  paintSignal();
  if (coachStatus === "disconnected") clearSample();
}

function releaseHold() {
  applyStatus(desiredStatus);
  if (latestLink) renderDetail(latestLink);
}

function renderStatus(status) {
  desiredStatus = labels[status] ? status : "disconnected";
  if (desiredStatus === "connecting") {
    holdUntil = Date.now() + CONNECTING_HOLD_MS;
    applyStatus("connecting");
    return;
  }
  if (Date.now() < holdUntil) {
    applyStatus("connecting");
    clearTimeout(holdTimer);
    holdTimer = setTimeout(releaseHold, holdUntil - Date.now());
    return;
  }
  applyStatus(desiredStatus);
}

function renderDetail(message) {
  lastSeen = Number.isFinite(message.lastSeen) ? message.lastSeen : null;
  if (coachStatus === "connecting" || message.status === "connecting") {
    detail.textContent = message.transport === "development-stand-in"
      ? "Looking for the coach. The development stand-in is not a FreeWili."
      : "Looking for the coach.";
    paintSignal();
    return;
  }
  if (message.transport === "development-stand-in") {
    detail.textContent = "Development stand-in. This is not a FreeWili.";
  } else if (message.status === "connected") {
    detail.textContent = "Coach link is up.";
  } else {
    detail.textContent = "No coach is connected.";
  }
  paintSignal();
}

function paintSignal() {
  const epoch = lastSeen && lastSeen >= 1_000_000_000_000;
  if (!epoch || coachStatus !== "connected") {
    signal.hidden = true;
    return;
  }
  const age = Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
  signal.hidden = false;
  signal.textContent = age < 1 ? "Last signal just now" : `Last signal ${age}s ago`;
}

function connectPage() {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
  pageLink.textContent = "Reconnecting to this page";
  renderStatus("connecting");
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket = ws;

  ws.addEventListener("open", () => {
    pageLink.textContent = "This page is live";
    ws.send(JSON.stringify({ type: "hello", role: "browser", timestamp: Date.now() }));
  });

  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "sensor") {
      renderSample(message);
      return;
    }
    if (message.type !== "link") return;
    latestLink = message;
    const nextSession = Number.isInteger(message.session) ? message.session : chartSession;
    const sessionChanged = nextSession !== chartSession;
    if (sessionChanged) chartSession = nextSession;
    if (sessionChanged || message.status === "disconnected") clearChart();
    renderStatus(message.status);
    renderDetail(message);
  });

  ws.addEventListener("close", () => {
    if (socket !== ws) return;
    pageLink.textContent = "Reconnecting to this page";
    detail.textContent = "The page lost the server. Trying again.";
    signal.hidden = true;
    renderStatus("connecting");
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connectPage, 1000);
  });
}

button.addEventListener("click", () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    connectPage();
    return;
  }
  renderStatus("connecting");
  detail.textContent = "Looking for the coach.";
  signal.hidden = true;
  socket.send(JSON.stringify({ type: "reconnect", role: "browser", timestamp: Date.now() }));
});

setInterval(paintSignal, 1000);
connectPage();

const viewDashboard = document.querySelector("#view-dashboard");
const viewEditor = document.querySelector("#view-editor");
const viewStage = document.querySelector("#view-stage");
const viewPractice = document.querySelector("#view-practice");
const navDashboard = document.querySelector("#nav-dashboard");
const navPresentation = document.querySelector("#nav-presentation");
const navPractice = document.querySelector("#nav-practice");
const deckList = document.querySelector("#deck-list");
const deckCreate = document.querySelector("#deck-create");
const deckNameNew = document.querySelector("#deck-name-new");
const deckEditor = document.querySelector("#deck-editor");
const deckTitle = document.querySelector("#deck-title");
const slideCount = document.querySelector("#slide-count");
const slideTitle = document.querySelector("#slide-title");
const slideBody = document.querySelector("#slide-body");
const slidePrev = document.querySelector("#slide-prev");
const slideNext = document.querySelector("#slide-next");
const slideAdd = document.querySelector("#slide-add");
const slideDelete = document.querySelector("#slide-delete");
const presentStart = document.querySelector("#present-start");
const presentEnd = document.querySelector("#present-end");
const stagePrev = document.querySelector("#stage-prev");
const stageNext = document.querySelector("#stage-next");
const stageCount = document.querySelector("#stage-count");
const stageTitle = document.querySelector("#stage-title");
const stageBody = document.querySelector("#stage-body");
const stageTimer = document.querySelector("#stage-timer");

let library = readLibrary(localStorage.getItem(DECK_STORAGE_KEY));
let presenting = false;
let presentationTimer = null;
let runStarted = 0;
let shownSlideId = null;

function saveLibrary() {
  localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(library));
}

function activeDeck() {
  return library.decks.find((deck) => deck.id === library.activeId) ?? null;
}

function replaceDeck(next) {
  library = {
    activeId: next.id,
    decks: library.decks.map((deck) => (deck.id === next.id ? next : deck)),
  };
  saveLibrary();
  renderDecks();
}

function renderDecks() {
  const deck = activeDeck();
  deckList.replaceChildren();
  for (const item of library.decks) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.textContent = item.name;
    if (item.id === library.activeId) choice.setAttribute("aria-current", "true");
    choice.addEventListener("click", () => {
      library = { ...library, activeId: item.id };
      saveLibrary();
      renderDecks();
    });
    deckList.append(choice);
  }

  deckEditor.hidden = !deck;
  if (!deck) return;
  if (document.activeElement !== deckTitle) deckTitle.value = deck.name;
  slideCount.textContent = slidePosition(deck);
  const slide = deck.slides[deck.index] ?? null;
  const slideChanged = shownSlideId !== (slide?.id ?? null);
  shownSlideId = slide?.id ?? null;
  if (slideChanged || document.activeElement !== slideTitle) slideTitle.value = slide?.title ?? "";
  if (slideChanged || document.activeElement !== slideBody) slideBody.value = slide?.content ?? "";
  const atStart = !slide || deck.index <= 0;
  const atEnd = !slide || deck.index >= deck.slides.length - 1;
  slideTitle.disabled = !slide;
  slideBody.disabled = !slide;
  slideDelete.disabled = !slide;
  presentStart.disabled = !slide;
  slidePrev.disabled = atStart;
  slideNext.disabled = atEnd;
  stagePrev.disabled = atStart;
  stageNext.disabled = atEnd;
  stageCount.textContent = slidePosition(deck);
  stageTitle.textContent = slide?.title ?? "";
  stageBody.textContent = slide?.content ?? "";
}

function markNav(which) {
  const entries = [
    [navDashboard, "dashboard"],
    [navPresentation, "presentation"],
    [navPractice, "practice"],
  ];
  for (const [item, name] of entries) {
    if (name === which) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
}

function showDashboard() {
  if (presenting) endPresentation();
  viewDashboard.hidden = false;
  viewEditor.hidden = true;
  viewStage.hidden = true;
  viewPractice.hidden = true;
  markNav("dashboard");
  if (chart) requestAnimationFrame(() => {
    chart.resize();
    paintChart();
  });
}

function showEditor() {
  if (presenting) endPresentation();
  viewDashboard.hidden = true;
  viewEditor.hidden = false;
  viewStage.hidden = true;
  viewPractice.hidden = true;
  markNav("presentation");
  renderDecks();
}

function showStage() {
  viewDashboard.hidden = true;
  viewEditor.hidden = true;
  viewStage.hidden = false;
  viewPractice.hidden = true;
  markNav("presentation");
  renderDecks();
  paintPracticeControls();
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function startPresentation() {
  const deck = activeDeck();
  if (!deck || deck.slides.length === 0) return;
  presenting = true;
  runStarted = Date.now();
  stageTimer.textContent = "0:00";
  clearInterval(presentationTimer);
  presentationTimer = setInterval(() => {
    stageTimer.textContent = formatElapsed(Date.now() - runStarted);
  }, 200);
  showStage();
}

function endPresentation() {
  finishPractice();
  presenting = false;
  clearInterval(presentationTimer);
  presentationTimer = null;
}

function step(direction) {
  const deck = activeDeck();
  if (!deck) return;
  const fromIndex = deck.index;
  const next = direction === "next" ? nextSlide(deck) : previousSlide(deck);
  if (next.index === fromIndex) return;
  replaceDeck(next);
  if (!practiceSession) return;
  const slide = next.slides[next.index];
  practiceSession = recordTransition(practiceSession, {
    timestamp: Date.now(),
    deckId: next.id,
    deckName: next.name,
    fromIndex,
    toIndex: next.index,
    slideTitle: slide?.title ?? "",
  });
}

navDashboard.addEventListener("click", showDashboard);
navPresentation.addEventListener("click", showEditor);
deckCreate.addEventListener("submit", (event) => {
  event.preventDefault();
  const deck = createDeck(deckNameNew.value);
  library = { activeId: deck.id, decks: [...library.decks, deck] };
  deckNameNew.value = "";
  saveLibrary();
  renderDecks();
});
deckTitle.addEventListener("input", () => {
  const deck = activeDeck();
  if (deck) replaceDeck(renameDeck(deck, deckTitle.value));
});
deckTitle.addEventListener("blur", () => renderDecks());
slideTitle.addEventListener("input", () => {
  const deck = activeDeck();
  const slide = deck?.slides[deck.index];
  if (slide) replaceDeck(editSlide(deck, slide.id, { title: slideTitle.value }));
});
slideBody.addEventListener("input", () => {
  const deck = activeDeck();
  const slide = deck?.slides[deck.index];
  if (slide) replaceDeck(editSlide(deck, slide.id, { content: slideBody.value }));
});
slideAdd.addEventListener("click", () => {
  const deck = activeDeck();
  if (deck) replaceDeck(addSlide(deck));
});
slideDelete.addEventListener("click", () => {
  const deck = activeDeck();
  const slide = deck?.slides[deck.index];
  if (slide) replaceDeck(deleteSlide(deck, slide.id));
});
slidePrev.addEventListener("click", () => step("prev"));
slideNext.addEventListener("click", () => step("next"));
stagePrev.addEventListener("click", () => step("prev"));
stageNext.addEventListener("click", () => step("next"));
presentStart.addEventListener("click", startPresentation);
presentEnd.addEventListener("click", showEditor);

const practiceStart = document.querySelector("#practice-start");
const practiceStop = document.querySelector("#practice-stop");
const practiceClock = document.querySelector("#practice-clock");
const practiceTimer = document.querySelector("#practice-timer");
const practiceCap = document.querySelector("#practice-cap");
const sessionListCard = document.querySelector("#session-list-card");
const sessionList = document.querySelector("#session-list");
const sessionEmpty = document.querySelector("#session-empty");
const sessionDetail = document.querySelector("#session-detail");
const sessionBack = document.querySelector("#session-back");
const sessionWhen = document.querySelector("#session-when");
const sessionDuration = document.querySelector("#session-duration");
const sessionAverage = document.querySelector("#session-average");
const sessionCap = document.querySelector("#session-cap");
const sessionChartCanvas = document.querySelector("#session-chart");
const sessionTransitions = document.querySelector("#session-transitions");
const sessionEvents = document.querySelector("#session-events");

let practiceSessions = readSessions(localStorage.getItem(SESSION_STORAGE_KEY));
let practiceSession = null;
let practiceTick = null;
let sessionChart = null;

function savePracticeSessions() {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(practiceSessions));
}

function paintPracticeControls() {
  const running = Boolean(practiceSession);
  practiceStart.hidden = running;
  practiceStop.hidden = !running;
  practiceClock.hidden = !running;
  if (!running) practiceCap.hidden = true;
  else practiceCap.hidden = !practiceSession.capped;
}

function noteSample(message) {
  if (!practiceSession || !Number.isFinite(message.movement)) return;
  practiceSession = recordSample(practiceSession, {
    timestamp: message.timestamp,
    x: message.accel.x,
    y: message.accel.y,
    z: message.accel.z,
    movement: message.movement,
  });
  practiceCap.hidden = !practiceSession.capped;
}

function beginPractice() {
  if (!presenting || practiceSession) return;
  const deck = activeDeck();
  const slide = deck?.slides[deck.index];
  const startedAt = Date.now();
  practiceSession = startSession({
    startedAt,
    slide: deck && slide ? {
      deckId: deck.id,
      deckName: deck.name,
      fromIndex: deck.index,
      toIndex: deck.index,
      slideTitle: slide.title,
    } : null,
  });
  practiceTimer.textContent = "0:00";
  clearInterval(practiceTick);
  practiceTick = setInterval(() => {
    if (!practiceSession) return;
    practiceTimer.textContent = formatElapsed(Date.now() - practiceSession.startedAt);
  }, 200);
  paintPracticeControls();
}

function finishPractice() {
  if (!practiceSession) return;
  const saved = stopSession(practiceSession, Date.now());
  practiceSession = null;
  clearInterval(practiceTick);
  practiceTick = null;
  practiceSessions = { sessions: [saved, ...practiceSessions.sessions] };
  savePracticeSessions();
  paintPracticeControls();
}

function formatWhen(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderSessionList() {
  sessionList.replaceChildren();
  sessionEmpty.hidden = practiceSessions.sessions.length > 0;
  for (const session of practiceSessions.sessions) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.textContent = `${formatWhen(session.startedAt)} · ${formatElapsed(session.durationMs)}`;
    choice.addEventListener("click", () => openSession(session.id));
    sessionList.append(choice);
  }
}

function paintSessionChart(session) {
  if (!globalThis.Chart) return;
  const data = session.samples.map((sample) => ({ x: sample.timestamp, y: sample.movement * 100 }));
  if (!sessionChart) {
    sessionChart = new globalThis.Chart(sessionChartCanvas, {
      type: "line",
      data: { datasets: [{ data: [], borderColor: "#1e4d6b", backgroundColor: "transparent", borderWidth: 2, pointRadius: 0, tension: 0.25 }] },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "Time", color: "#5e6874" },
            ticks: { maxTicksLimit: 6, color: "#5e6874", callback: (value) => formatChartTime(value) },
            grid: { color: "#e4dacb" },
          },
          y: {
            min: 0,
            max: 100,
            title: { display: true, text: "Intensity", color: "#5e6874" },
            ticks: { color: "#5e6874", callback: (value) => `${value}%` },
            grid: { color: "#e4dacb" },
          },
        },
      },
    });
  }
  sessionChart.data.datasets[0].data = data;
  if (data.length > 1) {
    sessionChart.options.scales.x.min = data[0].x;
    sessionChart.options.scales.x.max = data[data.length - 1].x;
  } else {
    delete sessionChart.options.scales.x.min;
    delete sessionChart.options.scales.x.max;
  }
  sessionChart.update("none");
}

function openSession(id) {
  const session = practiceSessions.sessions.find((item) => item.id === id);
  if (!session) return;
  sessionListCard.hidden = true;
  sessionDetail.hidden = false;
  sessionWhen.textContent = formatWhen(session.startedAt);
  sessionDuration.textContent = `Duration ${formatElapsed(session.durationMs)}`;
  const average = averageMovement(session);
  sessionAverage.textContent = average == null
    ? "Average intensity —"
    : `Average intensity ${Math.round(average * 100)}%`;
  sessionCap.hidden = !session.capped;
  sessionTransitions.replaceChildren();
  if (session.transitions.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No slide changes.";
    sessionTransitions.append(item);
  }
  for (const change of session.transitions) {
    const item = document.createElement("li");
    const title = change.slideTitle || "Untitled slide";
    const label = change.fromIndex === change.toIndex
      ? `Started on ${title}`
      : `${change.fromIndex + 1} → ${change.toIndex + 1} · ${title}`;
    item.textContent = `${formatWhen(change.timestamp)} · ${label}`;
    sessionTransitions.append(item);
  }
  sessionEvents.textContent = "Gesture, excessive-movement, and buzz lists are empty.";
  paintSessionChart(session);
  requestAnimationFrame(() => sessionChart?.resize());
}

function showPractice() {
  if (presenting) endPresentation();
  viewDashboard.hidden = true;
  viewEditor.hidden = true;
  viewStage.hidden = true;
  viewPractice.hidden = false;
  sessionDetail.hidden = true;
  sessionListCard.hidden = false;
  markNav("practice");
  renderSessionList();
}

navPractice.addEventListener("click", showPractice);
practiceStart.addEventListener("click", beginPractice);
practiceStop.addEventListener("click", finishPractice);
sessionBack.addEventListener("click", () => {
  sessionDetail.hidden = true;
  sessionListCard.hidden = false;
});
document.addEventListener("keydown", (event) => {
  if (!presenting) return;
  if (event.key === "ArrowRight") step("next");
  if (event.key === "ArrowLeft") step("prev");
  if (event.key === "Escape") showEditor();
});
