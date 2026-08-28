'use strict';

const DEFAULTS = {
  maxComments: 5000,
  commentLimit: 1000,
  dmSourceMode: 'seg',
  renderMode: 'nico',
  debugEnabled: true,
  commentOpacity: 1,
  font: 'defont',
  lazy: true,
  lang: 'zh',
};

const I18N = {
  zh: {
    title: 'Bili2Nico 设置',
    langLabel: '语言 / 言語',
    maxComments: '弹幕总数上限 (MAX_COMMENTS)',
    maxHint: '超过该数量的弹幕会被截取，避免初始化卡死。',
    commentLimit: '单帧绘制上限 (commentLimit)',
    limitHint: '同屏弹幕超过该数量时优先保留较新的弹幕。',
    sourceMode: '弹幕来源优先级',
    font: '弹幕字体',
    opacity: '弹幕不透明度',
    renderMode: '弹幕渲染格式',
    lazy: '完整弹幕（关闭 lazy 惰性布局，性能略降）',
    debug: '显示右下角调试日志面板',
    save: '保存设置',
  },
  ja: {
    title: 'Bili2Nico 設定',
    langLabel: '语言 / 言語',
    maxComments: '弾幕総数上限 (MAX_COMMENTS)',
    maxHint: 'この数を超える弾幕は切り捨てられ、初期化のフリーズを防ぎます。',
    commentLimit: '1 フレーム描画上限 (commentLimit)',
    limitHint: '同画面の弾幕がこの数を超える場合は新しい弾幕を優先します。',
    sourceMode: '弾幕取得元優先度',
    font: '弾幕フォント',
    opacity: '弾幕の不透明度',
    renderMode: 'レンダリング形式',
    lazy: '完全な弾幕（lazy を無効化、性能は若干低下）',
    debug: '右下のデバッグログパネルを表示',
    save: '設定を保存',
  },
};

let opacityTimer = null;

function getSettings() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, resolve));
}

function applyLang(lang) {
  const t = I18N[lang] || I18N.zh;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (t[key] !== undefined) el.textContent = t[key];
  });
  const langSel = document.getElementById('lang');
  if (langSel) langSel.value = lang;
  document.documentElement.lang = lang === 'ja' ? 'ja' : 'zh-CN';
}

function updateOpacityLabel() {
  const el = document.getElementById('commentOpacity');
  const label = document.getElementById('commentOpacityVal');
  if (el && label) label.textContent = el.value + '%';
}

async function load() {
  const items = await getSettings();
  document.getElementById('maxComments').value = items.maxComments;
  document.getElementById('commentLimit').value = items.commentLimit;
  document.getElementById('dmSourceMode').value = items.dmSourceMode;
  document.getElementById('renderMode').value = items.renderMode;
  document.getElementById('font').value = items.font;
  document.getElementById('lazyFull').checked = !items.lazy;
  document.getElementById('debugEnabled').checked = !!items.debugEnabled;
  const opacity = Math.round((Number(items.commentOpacity) || 1) * 100);
  document.getElementById('commentOpacity').value = opacity;
  updateOpacityLabel();
  applyLang(items.lang || 'zh');
}

async function save() {
  const clampInt = (id, min, max, fallback) => {
    const n = parseInt(document.getElementById(id).value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  const opacityPct = parseInt(document.getElementById('commentOpacity').value, 10);
  const opacity = Number.isNaN(opacityPct) ? DEFAULTS.commentOpacity : Math.max(0, Math.min(100, opacityPct)) / 100;
  const lang = document.getElementById('lang').value === 'ja' ? 'ja' : 'zh';

  const settings = {
    maxComments: clampInt('maxComments', 1, 100000, DEFAULTS.maxComments),
    commentLimit: clampInt('commentLimit', 0, 5000, DEFAULTS.commentLimit),
    dmSourceMode: document.getElementById('dmSourceMode').value === 'xml' ? 'xml' : 'seg',
    renderMode: document.getElementById('renderMode').value === 'bili' ? 'bili' : 'nico',
    font: ['defont', 'gothic', 'mincho'].includes(document.getElementById('font').value) ? document.getElementById('font').value : 'defont',
    lazy: !document.getElementById('lazyFull').checked,
    debugEnabled: document.getElementById('debugEnabled').checked,
    commentOpacity: opacity,
    lang: lang,
  };

  await chrome.storage.sync.set(settings);
  const msg = document.getElementById('msg');
  msg.textContent = lang === 'ja' ? '設定を保存しました' : '已保存';
  setTimeout(() => { msg.textContent = ''; }, 1500);
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  document.getElementById('save').addEventListener('click', save);
  document.getElementById('lang').addEventListener('change', (e) => {
    const lang = e.target.value === 'ja' ? 'ja' : 'zh';
    applyLang(lang);
    chrome.storage.sync.set({ lang: lang });
  });
  document.getElementById('commentOpacity').addEventListener('input', () => {
    updateOpacityLabel();
    if (opacityTimer) clearTimeout(opacityTimer);
    opacityTimer = setTimeout(() => {
      const v = parseInt(document.getElementById('commentOpacity').value, 10);
      const opacity = Number.isNaN(v) ? DEFAULTS.commentOpacity : Math.max(0, Math.min(100, v)) / 100;
      chrome.storage.sync.set({ commentOpacity: opacity });
    }, 120);
  });
});