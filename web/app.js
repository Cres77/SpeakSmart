import { CHART_WINDOW_MS, createIntensitySeries } from "/intensity-series.mjs";

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
}

function renderSample(message) {
  if (coachStatus === "disconnected" || !message.accel) return;
  accelX.textContent = formatAxis(message.accel.x);
  accelY.textContent = formatAxis(message.accel.y);
  accelZ.textContent = formatAxis(message.accel.z);
  renderIntensity(message.movement);
  if (series.push(message.timestamp, message.movement).action !== "ignore") paintChart();
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
