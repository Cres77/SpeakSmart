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

function clearSample() {
  accelX.textContent = "—";
  accelY.textContent = "—";
  accelZ.textContent = "—";
  sensorTime.textContent = "No sample yet";
  sensorNote.textContent = "Waiting for a sample.";
}

function renderSample(message) {
  if (coachStatus === "disconnected" || !message.accel) return;
  accelX.textContent = formatAxis(message.accel.x);
  accelY.textContent = formatAxis(message.accel.y);
  accelZ.textContent = formatAxis(message.accel.z);
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
