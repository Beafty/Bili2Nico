/* Bili2Nico content script
 * Loads Bilibili 弹幕 (video comments) and renders them with the
 * Niconico-compatible engine @xpadev-net/niconicomments, which is injected
 * above by lib/niconicomments.js and exposed as a global (NiconiComments).
 */
(() => {
  'use strict';
  if (globalThis.__bili2nicoInitialized__) return;
  globalThis.__bili2nicoInitialized__ = true;

  const LOGICAL_W = 1920;
  const LOGICAL_H = 1080;
  const SEGMENT_MS = 6 * 60 * 1000; // 6-minute Bilibili danmaku segment
  const MAX_SEGMENTS = 60;
  const MAX_COMMENTS = 5000;

  // Stored in chrome.storage.sync via the extension popup; the content script
  // reads these at startup and re-applies on storage changes.
  const SETTINGS_DEFAULTS = {
    maxComments: 5000,
    commentLimit: 1000,
    dmSourceMode: 'seg',
    renderMode: 'nico',
    debugEnabled: true,
    commentOpacity: 1,
    font: 'defont',
    lazy: true,
  };

  const state = {
    video: null,
    canvas: null,
    renderHandle: null,
    niconi: null,
    hideNative: true,
    debugEnabled: true,
    debugEl: null,
    initInProgress: false,
    initFailCount: 0,
    initScheduled: false,
    initSettled: false,
    lastStatus: '',
    settings: Object.assign({}, SETTINGS_DEFAULTS),
  };

  // ---------- styles / status ----------
  function addStyles(text) {
    let el = document.getElementById('__bili2nico_styles__');
    if (!el) {
      el = document.createElement('style');
      el.id = '__bili2nico_styles__';
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = text;
  }

  function hideNativeDanmaku() {
    // Hide only the on-video comment layer (modern [bpx-player-*] renderer,
    // advanced [bas-danmaku], and the old Flash/HTML5 overlays). Do NOT hide
    // the page's danmaku-list panel (.danmaku-box / #danmukuBox) or the
    // player's danmaku settings / switch controls.
    addStyles([
      '.bpx-player-render-dm-wrap,',
      '.bpx-player-dm-mask-wrap,',
      '.bpx-player-row-dm-wrap,',
      '.bas-danmaku,',
      '.bilibili-player-video-danmaku,',
      'bwp-danmaku,',
      '.bwp-danmaku,',
      '.s1-danmaku { display: none !important; }',
    ].join(' '));
  }

  function showNativeDanmaku() {
    const el = document.getElementById('__bili2nico_styles__');
    if (el) el.remove();
  }

  function setStatus(text) {
    // The bottom-left status badge was removed; status now lives inside the
    // bottom-right debug panel (and is also written to the console log).
    state.lastStatus = text;
    debugLog('info', text);
    const panel = state.debugEl;
    if (panel) {
      const s = panel.querySelector('.b2n-debug-status');
      if (s) s.textContent = text;
    }
  }

  function applyDebugVisibility() {
    if (state.debugEnabled) {
      const d = getDebugPanel();
      d.style.display = 'flex';
    } else if (state.debugEl) {
      state.debugEl.style.display = 'none';
    }
  }

  function applyCommentOpacity() {
    if (!state.canvas) return;
    const o = Math.max(0, Math.min(1, Number(state.settings.commentOpacity) || 1));
    state.canvas.style.opacity = String(o);
  }

  function getDebugPanel() {
    let el = document.getElementById('bili2nico-debug');
    if (el && el.isConnected) return el;
    el = document.createElement('div');
    el.id = 'bili2nico-debug';
    el.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'z-index:2147483001',
      'width:360px',
      'max-height:240px',
      (state.debugEnabled ? 'display:flex' : 'display:none'),
      'flex-direction:column',
      'background:rgba(15,17,20,.92)',
      'color:#c8ccd0',
      'font:11px/1.5 Consolas,Menlo,monospace',
      'border:1px solid rgba(255,255,255,.12)',
      'border-radius:8px',
      'overflow:hidden',
      'pointer-events:auto',
    ].join(';') + ';';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;background:rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.12);flex:none;';
    const title = document.createElement('span');
    title.textContent = 'Bili2Nico Debug';
    title.style.cssText = 'flex:1;font-weight:600;';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空';
    clearBtn.style.cssText = 'border:1px solid rgba(255,255,255,.3);border-radius:4px;padding:0 4px;background:transparent;color:#fff;cursor:pointer;font-size:11px;';
    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = '收起';
    collapseBtn.style.cssText = 'border:1px solid rgba(255,255,255,.3);border-radius:4px;padding:0 4px;background:transparent;color:#fff;cursor:pointer;font-size:11px;';
    const modeBtn = document.createElement('button');
    modeBtn.className = 'b2n-debug-mode';
    modeBtn.textContent = state.settings.dmSourceMode === 'seg' ? '来源:Seg' : '来源:XML';
    modeBtn.style.cssText = 'border:1px solid rgba(255,255,255,.3);border-radius:4px;padding:0 4px;background:transparent;color:#fff;cursor:pointer;font-size:11px;';
    modeBtn.title = 'Switch danmaku source order: segment (protobuf) first vs XML first';
    modeBtn.addEventListener('click', () => {
      state.settings.dmSourceMode = state.settings.dmSourceMode === 'seg' ? 'xml' : 'seg';
      modeBtn.textContent = state.settings.dmSourceMode === 'seg' ? '来源:Seg' : '来源:XML';
      debugLog('info', '弹幕来源切换为: ' + (state.settings.dmSourceMode === 'seg' ? 'segment (protobuf) 优先' : 'XML 优先'));
      // Re-initialize so the new order takes effect immediately.
      cleanup();
      scheduleInit();
    });

    const body = document.createElement('div');
    body.className = 'b2n-debug-body';
    body.style.cssText = 'flex:1;overflow:auto;padding:4px 6px;';

    const statusEl = document.createElement('div');
    statusEl.className = 'b2n-debug-status';
    statusEl.style.cssText = 'flex:none;padding:2px 6px;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.08);font-weight:600;font-size:11px;color:#eee;';
    statusEl.textContent = state.lastStatus || 'Bili2Nico';

    clearBtn.addEventListener('click', () => { body.textContent = ''; });
    collapseBtn.addEventListener('click', () => {
      const collapsed = el.classList.toggle('b2n-debug-collapsed');
      body.style.display = collapsed ? 'none' : 'block';
      el.style.maxHeight = collapsed ? '30px' : '240px';
      collapseBtn.textContent = collapsed ? '展开' : '收起';
    });

    head.appendChild(title);
    head.appendChild(modeBtn);
    head.appendChild(clearBtn);
    head.appendChild(collapseBtn);
    el.appendChild(head);
    el.appendChild(statusEl);
    el.appendChild(body);
    (document.body || document.documentElement).appendChild(el);
    state.debugEl = el;
    return el;
  }

  function debugLog(level, msg) {
    if (!state.debugEnabled) {
      // Even if the panel was shown earlier while it was enabled, make sure it
      // stays hidden when the setting is off.
      if (state.debugEl) state.debugEl.style.display = 'none';
      return;
    }
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const line = '[' + time + '] [' + level + '] ' + msg;
    try {
      console.debug('[Bili2Nico]', line);
    } catch (_) {}
    const panel = getDebugPanel();
    const body = panel.querySelector('.b2n-debug-body');
    const div = document.createElement('div');
    div.className = 'b2n-debug-line';
    div.textContent = line;
    body.appendChild(div);
    while (body.children.length > 200) body.removeChild(body.firstChild);
    panel.scrollTop = panel.scrollHeight;
  }

  // ---------- URL / video info ----------
  function parseBvid() {
    const m = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
    return m ? m[1] : null;
  }

  function parseAv() {
    const m = location.pathname.match(/\/video\/av(\d+)/i);
    return m ? m[1] : null;
  }

  function isVideoPage() {
    return /\/video\/(?:BV[0-9A-Za-z]+|av\d+)/i.test(location.pathname);
  }

  // Multi-part (分P) videos use ?p=N to pick which part to play. Return the
  // page index (1-based), defaulting to the first part.
  function getPageIndex() {
    const m = new URLSearchParams(location.search).get('p');
    const n = parseInt(m, 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  function pickPageInfo(data, pageIndex) {
    const pages = data && Array.isArray(data.pages) ? data.pages : [];
    const page = pages[pageIndex - 1];
    return page && page.cid ? page : null;
  }

  async function getVideoInfo() {
    const bvid = parseBvid();
    const av = parseAv();
    let url = null;
    if (bvid) {
      url = 'https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid);
    } else if (av) {
      url = 'https://api.bilibili.com/x/web-interface/view?aid=' + encodeURIComponent(av);
    }
    if (!url) throw new Error('未找到稿件信息');
    const res = await fetch(url, { credentials: 'include' });
    const json = await res.json();
    if (json.code !== 0 || !json.data) throw new Error(json.message || 'view api error');
    const data = json.data;
    const p = getPageIndex();
    const page = pickPageInfo(data, p);
    if (page) {
      // Multi-part (分P): use the selected part's cid and duration.
      return Object.assign({}, data, {
        cid: Number(page.cid),
        duration: Number(page.duration || data.duration || 0),
      });
    }
    return data;
  }

  async function getVideoInfoFromPage() {
    // 1) Direct access (works in main-world contexts / tests).
    try {
      const st = window.__INITIAL_STATE__ || {};
      const vd = st.videoData || {};
      const pi = (window.__playinfo__ && window.__playinfo__.data) || {};
      const p = getPageIndex();
      const page = (Array.isArray(vd.pages) ? vd.pages : [])[p - 1] || null;
      const aid = vd.aid || st.aid || pi.aid || (parseAv() ? Number(parseAv()) : 0);
      const cid = page ? page.cid : (vd.cid || st.cid || pi.cid);
      const duration = page ? page.duration : (vd.duration || st.duration || pi.duration);
      if (cid) {
        return {
          aid,
          cid: Number(cid),
          duration: Number(duration || 0),
        };
      }
    } catch (_) {}

    // 2) The content-script isolated world cannot read page globals directly.
    //    Inject a tiny main-world script that copies __INITIAL_STATE__ /
    //    __playinfo__ onto documentElement attributes, then read them back.
    //    Retry a few times because the page may set the state asynchronously.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        document.documentElement.setAttribute('data-b2n-aid', '');
        document.documentElement.setAttribute('data-b2n-cid', '');
        document.documentElement.setAttribute('data-b2n-dur', '');
        const script = document.createElement('script');
        script.textContent = '(function(){try{var s=window.__INITIAL_STATE__||{};var d=s.videoData||{};var p=(window.__playinfo__&&window.__playinfo__.data)||{};var m=new URLSearchParams(location.search).get("p");var pi=parseInt(m,10)||1;var pg=(d.pages||[])[pi-1]||null;var aid=pg?pg.aid:(d.aid||s.aid||p.aid||"");var cid=pg?pg.cid:(d.cid||s.cid||p.cid||"");var dur=pg?pg.duration:(d.duration||s.duration||p.duration||"");document.documentElement.setAttribute("data-b2n-aid",String(aid));document.documentElement.setAttribute("data-b2n-cid",String(cid));document.documentElement.setAttribute("data-b2n-dur",String(dur));}catch(e){}})();';
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        const aidAttr = document.documentElement.getAttribute('data-b2n-aid');
        const cidAttr = document.documentElement.getAttribute('data-b2n-cid');
        const durAttr = document.documentElement.getAttribute('data-b2n-dur');
        if (cidAttr) {
          const avNum = parseAv();
          return {
            aid: aidAttr ? Number(aidAttr) : (avNum ? Number(avNum) : 0),
            cid: Number(cidAttr),
            duration: durAttr ? Number(durAttr) : 0,
          };
        }
      } catch (_) {}
      await sleep(300);
    }

    // 3) Last resort: scan inline scripts for the state JSON.
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const text = s.textContent || '';
      if (!text.includes('__INITIAL_STATE__')) continue;
      const aid2 = /"aid"\s*:\s*(\d+)/.exec(text);
      const cid2 = /"cid"\s*:\s*(\d+)/.exec(text);
      const dur2 = /"duration"\s*:\s*(\d+)/.exec(text);
      if (cid2) {
        const avNum2 = parseAv();
        return {
          aid: aid2 ? Number(aid2[1]) : (avNum2 ? Number(avNum2) : 0),
          cid: Number(cid2[1]),
          duration: dur2 ? Number(dur2[1]) : 0,
        };
      }
    }
    return null;
  }

  // ---------- minimal protobuf reader for DmSegMobileReply / DanmakuElem ----------
  function readVarInt(u8, pos) {
    let result = 0n;
    let shift = 0;
    let i = pos;
    for (; i < u8.length; i++) {
      const b = u8[i];
      result |= BigInt(b & 0x7f) << BigInt(7 * shift);
      if (!(b & 0x80)) return { value: result, next: i + 1 };
      shift++;
      if (shift > 9) throw new Error('varint too long');
    }
    throw new Error('varint eof');
  }

  function parseProto(u8) {
    const out = {};
    const push = (k, v) => {
      if (out[k] === undefined) out[k] = v;
      else if (Array.isArray(out[k])) out[k].push(v);
      else out[k] = [out[k], v];
    };
    let pos = 0;
    while (pos < u8.length) {
      const { value: key, next } = readVarInt(u8, pos);
      pos = next;
      const field = Number(key >> 3n);
      const wire = Number(key & 7n);
      if (wire === 0) {
        const r = readVarInt(u8, pos);
        pos = r.next;
        push(field, Number(r.value));
      } else if (wire === 2) {
        const r = readVarInt(u8, pos);
        pos = r.next;
        const len = Number(r.value);
        const start = pos;
        pos += len;
        push(field, u8.subarray(start, pos));
      } else if (wire === 1) {
        pos += 8;
      } else if (wire === 5) {
        pos += 4;
      } else {
        throw new Error('unsupported proto wire ' + wire);
      }
    }
    return out;
  }

  function readUtf8(u8) {
    return new TextDecoder('utf-8').decode(u8);
  }

  function parseDmSeg(u8) {
    const reply = parseProto(u8);
    // DmSegMobileReply.elems is repeated DanmakuElem (field 1).
    const list = Array.isArray(reply[1]) ? reply[1] : (reply[1] !== undefined ? [reply[1]] : []);
    const elems = [];
    for (const raw of list) {
      const e = parseProto(raw);
      // DanmakuElem fields: progress=2, mode=3, fontsize=4, color=5, content=7, ctime=8, pool=11
      // proto3 omits default (0) scalar fields, so missing progress == 0.
      const progress = e[2] !== undefined ? Number(e[2]) : 0;
      const mode = e[3] !== undefined ? Number(e[3]) : 0;
      const fontsize = e[4] !== undefined ? Number(e[4]) : 25;
      const color = e[5] !== undefined ? Number(e[5]) : 0xffffff;
      const content = e[7] ? readUtf8(e[7]) : '';
      const ctime = e[8] !== undefined ? Number(e[8]) : 0;
      const pool = e[11] !== undefined ? Number(e[11]) : 0;
      elems.push({ progress, mode, fontsize, color, content, ctime, pool });
    }
    return elems;
  }

  // ---------- Bilibili -> Niconico mapping ----------
  function hexColor(decimal) {
    const n = Number(decimal) >>> 0;
    return '#' + n.toString(16).padStart(6, '0').toUpperCase();
  }

  function sizeCommand(fontsize) {
    // Bilibili standard: 18=small, 25=medium, 36=big. Use ranges so
    // non-standard values (e.g. 64 from some reverse/advanced comments) still
    // map to the closest Niconico size instead of silently defaulting.
    const f = Number(fontsize);
    if (f <= 18) return 'small';
    if (f <= 25) return 'medium';
    return 'big';
  }

  function modeCommands(mode) {
    // Bilibili: 1/2/3 = scroll, 4 = bottom fixed, 5 = top fixed, 6 = reverse.
    switch (Number(mode)) {
      case 4: return ['shita'];
      case 5: return ['ue'];
      default: return ['naka'];
    }
  }

  function toFormattedComments(elems) {
    const out = [];
    const sizeStats = { small: 0, medium: 0, big: 0, unknown: 0, unknownRaw: [] };
    for (const e of elems) {
      if (!e || !e.content) continue;
      const mode = Number(e.mode);
      // Skip advanced / code / BAS comments (mode >= 7); their body is JSON.
      if (mode >= 7) continue;
      const rawSize = Number(e.fontsize);
      const size = sizeCommand(rawSize);
      // Count the final output size command (small/medium/big).
      if (size === 'small') sizeStats.small += 1;
      else if (size === 'big') sizeStats.big += 1;
      else sizeStats.medium += 1;
      // fontsize -> mail size command conversion check (Bilibili 18/25/36).
      const isStandardSize = rawSize === 18 || rawSize === 25 || rawSize === 36;
      if (!isStandardSize) {
        sizeStats.unknown += 1;
        if (sizeStats.unknownRaw.length < 10) sizeStats.unknownRaw.push(rawSize);
        debugLog('warn', 'fontsize 非标准值 ' + rawSize + ' -> 映射为 ' + size);
      }

      const mail = modeCommands(mode);
      mail.push(size);
      // Apply the user-selected font (defont / gothic / mincho) to every comment.
      mail.push(state.settings.font || 'defont');
      // Bilibili sends color as decimal RGB888 (e.g. 16711935). Accept both that
      // and an explicit #RRGGBB string in case an upstream format ever changes.
      const rawColor = e.color;
      let colorHex = null;
      if (typeof rawColor === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(rawColor)) {
        if (rawColor.length === 4) {
          // Expand shorthand "#F0F" to "#FF00FF".
          const c = rawColor.slice(1);
          colorHex = (('#' + c[0] + c[0] + c[1] + c[1] + c[2] + c[2])).toUpperCase();
        } else {
          colorHex = hexColor(parseInt(rawColor.slice(1), 16));
        }
      } else {
        const col = Number(rawColor);
        if (Number.isFinite(col) && col !== 0xffffff) colorHex = hexColor(col);
      }
      if (colorHex) mail.push(colorHex);
      const vpos = Math.round(Number(e.progress) / 10); // ms -> centiseconds (Niconico vpos)
      if (!Number.isFinite(vpos)) continue;
      const reverse = mode === 6;
      if (reverse) {
        // Log the original Bilibili attributes for reverse (mode 6) comments.
        debugLog('info', '逆向弹幕原始属性: ' + JSON.stringify({
          progressMs: Number(e.progress),
          mode: mode,
          fontsize: rawSize,
          sizeCommand: size,
          colorDec: typeof rawColor === 'string' ? rawColor : Number(rawColor),
          colorHex: colorHex,
          pool: Number(e.pool) || 0,
          ctime: Number(e.ctime) || 0,
          vpos: vpos,
          content: e.content,
          mail: mail.slice(),
        }));
      }
      out.push({
        vpos,
        content: e.content,
        mail,
        date: Number(e.ctime) || 0,
        premium: true, // allow arbitrary RGB colour codes to be rendered
        reverse: reverse,
      });
    }
    debugLog('info', 'fontsize 映射统计: small=' + sizeStats.small + ', medium=' + sizeStats.medium + ', big=' + sizeStats.big + ', unknown=' + sizeStats.unknown + (sizeStats.unknownRaw.length ? '（未知值示例: ' + sizeStats.unknownRaw.join(',') + '）' : ''));
    return out;
  }

  // ---------- fetch danmaku ----------
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchWithRetry(url, attempts = 2) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (res.ok) return res;
        lastError = new Error('HTTP ' + res.status);
      } catch (err) {
        lastError = err;
      }
      await sleep(500 * (i + 1));
    }
    throw lastError || new Error('fetch failed');
  }

  async function fetchDanmakuXml(info) {
    // Legacy real-time-pool XML endpoint; used as a fallback when the
    // protobuf segment API is unavailable (e.g. temporary rate limiting).
    const url = 'https://comment.bilibili.com/' + encodeURIComponent(info.cid) + '.xml';
    const res = await fetchWithRetry(url);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const nodes = doc.querySelectorAll('d');
    const out = [];
    for (const node of nodes) {
      const p = node.getAttribute('p');
      if (!p) continue;
      const parts = p.split(',');
      const time = parseFloat(parts[0]);
      const mode = parseInt(parts[1], 10);
      const fontsize = parseInt(parts[2], 10);
      const color = parseInt(parts[3], 10);
      const date = parseInt(parts[4], 10);
      const content = node.textContent || '';
      if (!content) continue;
      out.push({
        progress: Math.round(time * 1000),
        mode,
        fontsize,
        color,
        content,
        ctime: date,
      });
    }
    return out;
  }

  async function fetchDanmakuSeg(info) {
    const cid = info.cid;
    const pid = info.aid;
    const durationMs = Number(info.duration) * 1000;
    const segments = Math.max(1, Math.min(MAX_SEGMENTS, Math.ceil(durationMs / SEGMENT_MS)));
    debugLog('info', '分段数: ' + segments + '（每段 ' + (SEGMENT_MS / 1000 / 60) + ' 分钟）');
    const all = [];
    for (let i = 1; i <= segments; i++) {
      let url = 'https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=' + encodeURIComponent(cid);
      if (pid !== undefined && pid !== null && pid !== '') {
        url += '&pid=' + encodeURIComponent(pid);
      }
      url += '&segment_index=' + i;
      debugLog('info', '拉取分段 ' + i + '/' + segments);
      try {
        const res = await fetchWithRetry(url, 2);
        const buf = new Uint8Array(await res.arrayBuffer());
        try {
          const elems = parseDmSeg(buf);
          all.push(...elems);
          debugLog('info', '分段 ' + i + ' 解析到 ' + elems.length + ' 条');
        } catch (err) {
          debugLog('warn', '分段解析失败 ' + i + ': ' + (err && err.message ? err.message : String(err)));
        }
      } catch (err) {
        debugLog('warn', '分段请求失败 ' + i + ': ' + (err && err.message ? err.message : String(err)));
      }
    }
    return all;
  }

  async function fetchDanmaku(info) {
    const xmlFirst = state.settings.dmSourceMode === 'xml';
    debugLog('info', '弹幕来源策略: ' + (xmlFirst ? 'XML 优先' : 'segment 优先'));

    if (xmlFirst) {
      // XML first: a single request, no protobuf decoding needed.
      try {
        const xmlElems = await fetchDanmakuXml(info);
        if (xmlElems.length > 0) {
          debugLog('info', 'XML 优先命中，共 ' + xmlElems.length + ' 条');
          return xmlElems;
        }
        debugLog('warn', 'XML 返回为空，回退到分段接口');
      } catch (err) {
        debugLog('warn', 'XML 获取失败: ' + (err && err.message ? err.message : String(err)) + '，回退到分段接口');
      }
      return await fetchDanmakuSeg(info);
    }

    // Segment (protobuf) first: current Bilibili web player API, full history.
    const segElems = await fetchDanmakuSeg(info);
    if (segElems.length > 0) {
      debugLog('info', 'segment 优先命中，共 ' + segElems.length + ' 条');
      return segElems;
    }
    debugLog('warn', 'segment 接口无返回，回退到 XML');
    try {
      const xmlElems = await fetchDanmakuXml(info);
      debugLog('info', 'XML 兜底解析到 ' + xmlElems.length + ' 条');
      return xmlElems;
    } catch (err) {
      debugLog('warn', 'XML 兜底失败: ' + (err && err.message ? err.message : String(err)));
      return segElems;
    }
  }

  // ---------- overlay ----------
  function findVideoWrapper(video) {
    let el = video.parentElement;
    let candidate = el;
    for (let i = 0; i < 8 && el; i++) {
      const sel = (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '');
      if (/bilibili-player|bili-player|bwp-video|video-container|player/i.test(sel)) {
        candidate = el;
        break;
      }
      el = el.parentElement;
    }
    return candidate || video.parentElement || document.body;
  }

  function makeOverlay(video) {
    const wrapper = findVideoWrapper(video);
    const cs = getComputedStyle(wrapper);
    if (cs.position === 'static') wrapper.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.id = 'bili2nico-overlay';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = LOGICAL_W * dpr;
    canvas.height = LOGICAL_H * dpr;
    canvas.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'width:100%',
      'height:100%',
      'z-index:10',
      'pointer-events:none',
      'background:transparent',
    ].join(';') + ';';
    const opacity = Math.max(0, Math.min(1, Number(state.settings.commentOpacity) || 1));
    canvas.style.opacity = String(opacity);
    wrapper.appendChild(canvas);

    // Create a Niconico-styled engine over this canvas. The backing canvas is
    // fixed to the logical 1920x1080 grid (x dpr) and CSS-stretched to 100%,
    // so window/fullscreen resizing never requires rebuilding the engine.
    return { canvas, wrapper };
  }

  // ---------- rendering lifecycle ----------
  function setupRendering(video, canvas, comments) {
    // Cap the total number of comments handed to the engine so that very
    // large videos (popular Bilibili videos can have 100k+ comments) do not
    // freeze the tab during position pre-computation.
    const maxComments = Math.max(1, Math.min(100000, Number(state.settings.maxComments) || MAX_COMMENTS));
    const commentLimit = Math.max(0, Number(state.settings.commentLimit) || 1000);
    const trimmed = comments.length > maxComments;
    const engineComments = trimmed ? comments.slice(0, maxComments) : comments;
    if (trimmed) {
      debugLog('warn', '弹幕数量过多，已截取前 ' + maxComments + ' 条（原 ' + comments.length + ' 条）');
    }

    const niconi = new globalThis.NiconiComments(canvas, engineComments, {
      format: 'formatted',
      mode: 'html5',
      // Lazy resolves comment positions only for the current time window.
      // Toggle it off in the settings to pre-compute every comment position
      // up front (full danmaku-artist behaviour), at some startup cost.
      lazy: !!state.settings.lazy,
      config: {
        // Cap the number of comments drawn in a single frame (Niconico-style
        // display limit); `asc` keeps the newer comments when the limit is hit.
        commentLimit: commentLimit,
        hideCommentOrder: 'asc',
      },
    });
    state.niconi = niconi;
    debugLog('info', 'NiconiComments 引擎已创建，弹幕数: ' + engineComments.length + (trimmed ? '（已截取）' : ''));

    let raf = null;
    const draw = () => {
      raf = null;
      niconi.drawCanvas(video.currentTime * 100);
      if (!video.paused && document.visibilityState !== 'hidden') {
        raf = requestAnimationFrame(draw);
      }
    };
    const startLoop = () => {
      if (raf === null && !video.paused && document.visibilityState !== 'hidden') {
        raf = requestAnimationFrame(draw);
      }
    };
    const stopLoop = () => {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      niconi.drawCanvas(video.currentTime * 100, true);
    };

    video.addEventListener('play', startLoop);
    video.addEventListener('pause', stopLoop);
    video.addEventListener('seeking', stopLoop);
    video.addEventListener('seeked', startLoop);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stopLoop();
      else startLoop();
    });

    // Initial frame + starting loop if playing.
    niconi.drawCanvas(video.currentTime * 100, true);
    startLoop();

    return {
      destroy() {
        if (raf !== null) {
          cancelAnimationFrame(raf);
          raf = null;
        }
        video.removeEventListener('play', startLoop);
        video.removeEventListener('pause', stopLoop);
        video.removeEventListener('seeking', stopLoop);
        video.removeEventListener('seeked', startLoop);
        try { niconi.destroy?.(); } catch (_) {}
        state.niconi = null;
      },
    };
  }

  function cleanup() {
    if (state.renderHandle) {
      try { state.renderHandle.destroy(); } catch (_) {}
      state.renderHandle = null;
    }
    if (state.canvas) {
      state.canvas.remove();
      state.canvas = null;
    }
    state.video = null;
    state.niconi = null;
    debugLog('info', '已清理当前渲染实例');
  }

  // ---------- init ----------
  async function doInit() {
    if (!isVideoPage()) return false;
    const video = document.querySelector('video');
    if (!video) return false;
    if (state.video === video && state.niconi) return true;

    if (state.settings.renderMode === 'bili') {
      // "B站（原生）" format: do not take over, use Bilibili's own danmaku.
      showNativeDanmaku();
      cleanup();
      return true;
    }

    cleanup();
    setStatus('Bili2Nico: 加载弹幕…', 'rgba(0,0,0,.7)');
    debugLog('info', '开始初始化: ' + location.href);
    // Hide the native Bilibili on-video comment layer as early as possible so
    // the user does not see duplicate danmaku while comments are loading.
    if (state.hideNative) hideNativeDanmaku();

    let info = null;
    try {
      info = await getVideoInfo();
      debugLog('info', '稿件信息(API): aid=' + info.aid + ', cid=' + info.cid + ', duration=' + info.duration + 's');
    } catch (err) {
      debugLog('warn', 'view API 获取失败: ' + (err && err.message ? err.message : String(err)) + '，尝试从页面读取');
      info = await getVideoInfoFromPage();
    }
    if (!info) {
      debugLog('error', '未从 API 或页面读取到稿件信息');
      setStatus('Bili2Nico: 未找到稿件信息', 'rgba(120,0,0,.75)');
      return false;
    }
    if (!info.duration) info.duration = Number(video.duration) || 0;
    debugLog('info', '稿件信息: aid=' + info.aid + ', cid=' + info.cid + ', duration=' + info.duration + 's');
    try {
      setStatus('Bili2Nico: 获取分段弹幕…');
      const elems = await fetchDanmaku(info);
      debugLog('info', '拉取弹幕共 ' + elems.length + ' 条（原始）');
      if (!elems.length) {
        // Empty danmaku is a valid completed state — don't retry forever.
        setStatus('Bili2Nico: 实时弹幕池为空', 'rgba(0,0,0,.7)');
        return true;
      }
      const comments = toFormattedComments(elems);
      if (!comments.length) {
        // Nothing renderable (e.g. only advanced/code/BAS) — also don't retry.
        setStatus('Bili2Nico: 无可渲染弹幕', 'rgba(0,0,0,.7)');
        return true;
      }
      setStatus('Bili2Nico: ' + comments.length + ' 条弹幕', 'rgba(0,0,0,.7)');
      if (state.hideNative) hideNativeDanmaku();

      const { canvas } = makeOverlay(video);
      state.video = video;
      state.canvas = canvas;
      state.renderHandle = setupRendering(video, canvas, comments);
      debugLog('info', '初始化成功');
      return true;
    } catch (err) {
      debugLog('error', '初始化失败: ' + (err && err.message ? err.message : String(err)));
      setStatus(
        'Bili2Nico: ' + (err && err.message ? err.message : '加载失败'),
        'rgba(120,0,0,.75)',
      );
      return false;
    }
  }

  async function initForCurrentVideo() {
    if (state.initSettled) return;
    if (state.initInProgress) return;
    state.initInProgress = true;
    let ok = false;
    try {
      ok = await doInit();
    } finally {
      state.initInProgress = false;
    }
    if (ok) {
      state.initFailCount = 0;
      state.initSettled = true;
    } else {
      state.initFailCount += 1;
      debugLog('warn', '初始化未成功，连续失败次数: ' + state.initFailCount);
    }
  }

  // ---------- watch route / video ----------
  let lastUrl = location.href;

  function scheduleInit() {
    if (state.initSettled) return;
    if (state.initScheduled) return;
    state.initScheduled = true;
    // Exponential backoff when the first attempts fail (e.g. Bilibili risk
    // control temporarily returning HTML instead of JSON).
    const backoff = Math.min(6000, 500 * Math.pow(2, Math.min(state.initFailCount, 6)));
    setTimeout(() => {
      state.initScheduled = false;
      initForCurrentVideo().catch((err) => debugLog('error', 'init error: ' + (err && err.message ? err.message : String(err))));
    }, 250 + backoff);
  }

  function startWatch() {
    setInterval(() => {
      if (location.href !== lastUrl) {
        debugLog('info', '检测到路由变化: ' + location.href);
        lastUrl = location.href;
        cleanup();
        state.initSettled = false;
        if (isVideoPage()) scheduleInit();
        else showNativeDanmaku();
      } else if (!state.niconi && !state.initSettled && isVideoPage()) {
        scheduleInit();
      }
    }, 900);

    const mo = new MutationObserver(() => {
      if (!state.niconi && !state.initSettled && isVideoPage() && document.querySelector('video')) {
        scheduleInit();
      }
    });
    mo.observe(document, { childList: true, subtree: true });

    // kick off on initial page load
    scheduleInit();
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(SETTINGS_DEFAULTS, (items) => {
          state.settings = Object.assign({}, SETTINGS_DEFAULTS, items || {});
          state.hideNative = state.settings.renderMode !== 'bili';
          state.debugEnabled = !!state.settings.debugEnabled;
          if (!state.hideNative) showNativeDanmaku();
          debugLog(
            'info',
            '读取设置: maxComments=' + state.settings.maxComments +
            ', commentLimit=' + state.settings.commentLimit +
            ', source=' + state.settings.dmSourceMode +
            ', renderMode=' + state.settings.renderMode +
            ', font=' + (state.settings.font || 'defont') +
            ', hideNative=' + state.hideNative +
            ', debug=' + state.debugEnabled,
          );
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  function setupSettingsWatch() {
    try {
      const REINIT_KEYS = new Set(['maxComments', 'commentLimit', 'dmSourceMode', 'renderMode', 'font', 'lazy']);
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        let changed = false;
        let needsReinit = false;
        for (const key of Object.keys(SETTINGS_DEFAULTS)) {
          if (changes[key]) {
            state.settings[key] = changes[key].newValue;
            changed = true;
            if (REINIT_KEYS.has(key)) needsReinit = true;
          }
        }
        if (!changed) return;
        state.hideNative = state.settings.renderMode !== 'bili';
        state.debugEnabled = !!state.settings.debugEnabled;
        if (state.hideNative) hideNativeDanmaku();
        else showNativeDanmaku();
        applyDebugVisibility();
        applyCommentOpacity(); // real-time opacity update, no full re-init
        debugLog('info', '设置已更新');
        if (needsReinit) {
          cleanup();
          state.initSettled = false;
          scheduleInit();
        }
      });
    } catch (_) {}
  }

  // Load persisted settings (popup) before starting the watcher so the first
  // init uses the user's configuration.
  loadSettings().then(() => {
    setupSettingsWatch();
    startWatch();
  });
})();
