'use strict';

const DEFAULTS = {
  maxComments: 5000,
  commentLimit: 1000,
  dmSourceMode: "seg",
  renderMode: "nico",
  debugEnabled: true,
  commentOpacity: 1,
  font: "defont",
  lazy: true,
};

let opacityTimer = null;

function getSettings() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, resolve));
}

function updateOpacityLabel() {
  const el = document.getElementById("commentOpacity");
  const label = document.getElementById("commentOpacityVal");
  if (el && label) label.textContent = `${el.value}%`;
}

async function load() {
  const items = await getSettings();
  document.getElementById("maxComments").value = items.maxComments;
  document.getElementById("commentLimit").value = items.commentLimit;
  document.getElementById("dmSourceMode").value = items.dmSourceMode;
  document.getElementById("renderMode").value = items.renderMode;
  document.getElementById("font").value = items.font;
  document.getElementById("lazyFull").checked = !items.lazy;
  document.getElementById("debugEnabled").checked = !!items.debugEnabled;
  const opacity = Math.round((Number(items.commentOpacity) || 1) * 100);
  document.getElementById("commentOpacity").value = opacity;
  updateOpacityLabel();
}

async function save() {
  const clampInt = (id, min, max, fallback) => {
    const n = parseInt(document.getElementById(id).value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  const opacityPct = parseInt(document.getElementById("commentOpacity").value, 10);
  const opacity = Number.isNaN(opacityPct) ? DEFAULTS.commentOpacity : Math.max(0, Math.min(100, opacityPct)) / 100;

  const settings = {
    maxComments: clampInt("maxComments", 1, 100000, DEFAULTS.maxComments),
    commentLimit: clampInt("commentLimit", 0, 5000, DEFAULTS.commentLimit),
    dmSourceMode: document.getElementById("dmSourceMode").value === "xml" ? "xml" : "seg",
    renderMode: document.getElementById("renderMode").value === "bili" ? "bili" : "nico",
    font: ["defont", "gothic", "mincho"].includes(document.getElementById("font").value) ? document.getElementById("font").value : "defont",
    lazy: !document.getElementById("lazyFull").checked,
    debugEnabled: document.getElementById("debugEnabled").checked,
    commentOpacity: opacity,
  };

  await chrome.storage.sync.set(settings);
  const msg = document.getElementById("msg");
  msg.textContent = "已保存";
  setTimeout(() => { msg.textContent = ""; }, 1500);
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  document.getElementById("save").addEventListener("click", save);
  document.getElementById("commentOpacity").addEventListener("input", () => {
    updateOpacityLabel();
    if (opacityTimer) clearTimeout(opacityTimer);
    opacityTimer = setTimeout(() => {
      const v = parseInt(document.getElementById("commentOpacity").value, 10);
      const opacity = Number.isNaN(v) ? DEFAULTS.commentOpacity : Math.max(0, Math.min(100, v)) / 100;
      chrome.storage.sync.set({ commentOpacity: opacity });
    }, 120);
  });
});