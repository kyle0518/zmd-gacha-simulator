'use strict';

/* ===== Constants ===== */
const COST_PER_DRAW = 500;
const BASE_SIX_RATE = 0.8;
const FIVE_RATE = 8.0;
const SOFT_PITY_START = 65;
const SOFT_PITY_STEP = 5;
const HARD_PITY_SIX = 80;
const PITY_FIVE = 10;
const FEATURED_GUARANTEE = 120;
const TOKEN_CYCLE = 240;
const TOKEN_POTENTIAL_CAP = 6;
const HISTORY_LIMIT = 80;
const STORAGE_KEY = 'zmd-gacha-simulator:v2';

const DEFAULT_CONFIG = {
    commonUnits: {
        6: ['艾爾黛拉', '俊衛', '別禮', '餘燼', '黎風'],
        5: ['佩麗卡', '弧光', '艾維文娜', '大潘', '陳千語', '狼衛', '賽希', '晝雪', '阿列什'],
        4: ['秋栗', '卡契爾', '埃特拉', '螢石', '安塔爾']
    },
    pools: [{
        key: 'standard', tabLabel: '常駐', title: '基礎尋訪', subtitle: '永久開放',
        subtitleColor: '#fbff00', featured6: null, infoHtml: '<br><br>',
        panelGradient: 'linear-gradient(to right, rgba(254, 221, 0, 0.22) 0%, rgba(254, 221, 0, 0.62) 100%)'
    }]
};

/* ===== State ===== */
let COMMON_UNITS = {};
let POOL_CONFIG = {};
let GLOBAL_UNIT_IMAGES = {};
let GLOBAL_UNIT_IMAGE_FOCUS = {};
let currentPool = '';
let poolPityState = {};
let sharedSixPityNonStandard = 0;
let totalCost = 0;
let totalDraws = 0;
let sixStarCounts = {};
let historyRecords = [];
let pending = null;

const $ = (id) => document.getElementById(id);
const els = {};

/* ===== Config ===== */
function buildUnits(extraUnits = {}) {
    return {
        6: [...(COMMON_UNITS[6] || []), ...(extraUnits[6] || [])],
        5: [...(COMMON_UNITS[5] || []), ...(extraUnits[5] || [])],
        4: [...(COMMON_UNITS[4] || []), ...(extraUnits[4] || [])]
    };
}

function normalizeConfig(raw) {
    const config = raw || DEFAULT_CONFIG;
    COMMON_UNITS = config.commonUnits || DEFAULT_CONFIG.commonUnits;
    GLOBAL_UNIT_IMAGES = config.unitImages || {};
    GLOBAL_UNIT_IMAGE_FOCUS = config.unitImageFocus || {};
    POOL_CONFIG = {};
    (config.pools || []).forEach((pool, i) => {
        const key = pool.key || `pool_${i + 1}`;
        POOL_CONFIG[key] = {
            key,
            tabLabel: pool.tabLabel || pool.title || `卡池${i + 1}`,
            title: pool.title || pool.tabLabel || `卡池${i + 1}`,
            subtitle: pool.subtitle || '',
            subtitleColor: pool.subtitleColor || '#f4c542',
            panelGradient: pool.panelGradient || '',
            featured6: pool.featured6 || null,
            infoHtml: pool.infoHtml || '',
            units: pool.units || buildUnits(pool.extraUnits || {})
        };
    });
}

function getImageCandidates(unitName, poolKey) {
    const pool = POOL_CONFIG[poolKey] || {};
    const explicit = (pool.unitImages && pool.unitImages[unitName]) || GLOBAL_UNIT_IMAGES[unitName];
    if (explicit) return [explicit];
    return [`images/${unitName}.png`, `images/${unitName}.webp`, `images/${unitName}.jpg`, `images/${unitName}.jpeg`];
}

function getImageFocus(unitName, poolKey) {
    const pool = POOL_CONFIG[poolKey] || {};
    return (pool.unitImageFocus && pool.unitImageFocus[unitName]) || GLOBAL_UNIT_IMAGE_FOCUS[unitName] || '50% 22%';
}

/* ===== Persistence ===== */
function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            currentPool, poolPityState, sharedSixPityNonStandard,
            totalCost, totalDraws, sixStarCounts, historyRecords,
            skipLever: Boolean(els.skipLeverToggle && els.skipLeverToggle.checked)
        }));
    } catch { /* storage unavailable (private mode etc.) */ }
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s && typeof s === 'object') {
            if (POOL_CONFIG[s.currentPool]) currentPool = s.currentPool;
            if (s.poolPityState) {
                for (const k of Object.keys(poolPityState)) {
                    if (s.poolPityState[k]) Object.assign(poolPityState[k], s.poolPityState[k]);
                }
            }
            sharedSixPityNonStandard = s.sharedSixPityNonStandard || 0;
            totalCost = s.totalCost || 0;
            totalDraws = s.totalDraws || 0;
            sixStarCounts = s.sixStarCounts || {};
            historyRecords = Array.isArray(s.historyRecords) ? s.historyRecords.slice(0, HISTORY_LIMIT) : [];
            if (els.skipLeverToggle) els.skipLeverToggle.checked = Boolean(s.skipLever);
        }
    } catch { /* corrupted storage: start fresh */ }
}

/* ===== Pity model (single source of truth) ===== */
function freshPityState(pool) {
    return {
        drawsWithoutFive: 0, drawsWithoutSix: 0,
        drawsWithoutFeatured6: 0, featured6CounterActive: Boolean(pool.featured6),
        drawsSinceTokenCounterStart: 0, tokensObtained: 0
    };
}

function initPoolState() {
    poolPityState = Object.fromEntries(
        Object.entries(POOL_CONFIG).map(([k, p]) => [k, freshPityState(p)])
    );
}

const isSharedPool = (poolKey) => poolKey !== 'standard';

function sixRateFor(pity) {
    const bonus = pity.drawsWithoutSix >= SOFT_PITY_START
        ? (pity.drawsWithoutSix - (SOFT_PITY_START - 1)) * SOFT_PITY_STEP : 0;
    return Math.min(BASE_SIX_RATE + bonus, 100);
}

function drawUnitByStar(star, pool) {
    const candidates = pool.units[star] || [];
    if (!candidates.length) return '';
    if (star !== 6 || !pool.featured6 || !candidates.includes(pool.featured6) || candidates.length === 1) {
        return candidates[Math.floor(Math.random() * candidates.length)];
    }
    if (Math.random() < 0.5) return pool.featured6;
    const others = candidates.filter((n) => n !== pool.featured6);
    return others[Math.floor(Math.random() * others.length)];
}

/**
 * Roll `times` draws against a cloned pity state, without touching live state.
 * Used both for the lever preview (glow) and for the committed draw, so the
 * probability logic exists exactly once.
 */
function simulateBatch(times, pool, sourcePity, poolKey, sharedBase) {
    const pity = { ...sourcePity };
    let shared = sharedBase;
    const records = [];
    let maxStar = 4;

    for (let i = 0; i < times; i++) {
        const sixRate = sixRateFor(pity);
        const rand = Math.random() * 100;
        let star = 4;
        if (rand < sixRate) star = 6;
        else if (rand < sixRate + FIVE_RATE) star = 5;

        const forceFeatured = Boolean(pool.featured6) && pity.featured6CounterActive
            && pity.drawsWithoutFeatured6 >= FEATURED_GUARANTEE - 1;
        if (forceFeatured) star = 6;

        const hardCounter = isSharedPool(poolKey) ? shared : pity.drawsWithoutSix;
        if (hardCounter >= HARD_PITY_SIX - 1 && star < 6) star = 6;
        else if (pity.drawsWithoutFive >= PITY_FIVE - 1 && star < 5) star = 5;

        const result = forceFeatured ? pool.featured6 : drawUnitByStar(star, pool);

        if (star === 6) { pity.drawsWithoutFive = 0; pity.drawsWithoutSix = 0; if (isSharedPool(poolKey)) shared = 0; }
        else if (star === 5) { pity.drawsWithoutFive = 0; pity.drawsWithoutSix += 1; if (isSharedPool(poolKey)) shared += 1; }
        else { pity.drawsWithoutFive += 1; pity.drawsWithoutSix += 1; if (isSharedPool(poolKey)) shared += 1; }

        if (pool.featured6 && pity.featured6CounterActive) {
            if (result === pool.featured6) pity.featured6CounterActive = false;
            else pity.drawsWithoutFeatured6 += 1;
        }

        let token = false;
        if (pool.featured6) {
            pity.drawsSinceTokenCounterStart += 1;
            if (pity.drawsSinceTokenCounterStart >= TOKEN_CYCLE) {
                pity.drawsSinceTokenCounterStart = 0;
                pity.tokensObtained += 1;
                token = true;
            }
        }

        records.push({ star, result, tokenObtained: token, tokenIndex: pity.tokensObtained });
        maxStar = Math.max(maxStar, star);
    }
    return { records, maxStar, pity, shared };
}

/* ===== Rendering helpers ===== */
function textEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function setImageWithFallback(imageEl, candidates, onLoaded, onExhausted) {
    let idx = 0;
    const tryNext = () => {
        if (idx >= candidates.length) { if (onExhausted) onExhausted(); return; }
        const path = candidates[idx++];
        imageEl.onload = () => { imageEl.onload = imageEl.onerror = null; if (onLoaded) onLoaded(path); };
        imageEl.onerror = tryNext;
        imageEl.src = path;
    };
    tryNext();
}

function setVisualGlow(star) {
    els.characterVisual.className = 'character-visual' + (star ? ` visual-glow-${Math.min(star, 6)}` : '');
}

function updateCharacterVisual(unitName, star, poolKey) {
    els.characterStrip.hidden = true;
    els.characterStrip.innerHTML = '';
    els.characterImage.style.objectPosition = getImageFocus(unitName, poolKey);
    setVisualGlow(star);
    setImageWithFallback(els.characterImage, getImageCandidates(unitName, poolKey),
        () => {
            els.characterImage.hidden = false;
            els.characterPlaceholder.textContent = '';
            els.characterCaption.textContent = `★${star} ${unitName}`;
            els.characterCaption.style.display = 'inline-flex';
        },
        () => {
            els.characterImage.hidden = true;
            els.characterImage.removeAttribute('src');
            els.characterPlaceholder.textContent = `${unitName}\n(尚未設定圖片)`;
            els.characterCaption.textContent = `★${star} ${unitName}`;
            els.characterCaption.style.display = 'inline-flex';
        });
}

function updateCharacterStrip(records, poolKey) {
    els.characterImage.hidden = true;
    els.characterImage.removeAttribute('src');
    els.characterCaption.style.display = 'none';
    els.characterPlaceholder.textContent = '';
    els.characterStrip.innerHTML = '';
    els.characterStrip.hidden = false;
    setVisualGlow(0);

    records.slice(0, 10).forEach((record) => {
        const tile = textEl('div', `character-tile rarity-${record.star}`);
        const img = textEl('img', 'character-tile-image');
        img.alt = `★${record.star} ${record.result}`;
        img.style.objectPosition = getImageFocus(record.result, poolKey);
        const fallback = textEl('div', 'character-tile-fallback', `★${record.star}\n${record.result}`);
        setImageWithFallback(img, getImageCandidates(record.result, poolKey),
            () => { img.hidden = false; fallback.style.display = 'none'; },
            () => { img.hidden = true; fallback.style.display = 'flex'; });
        tile.append(img, fallback);
        els.characterStrip.appendChild(tile);
    });
}

/* ===== Panels ===== */
function renderSixStarStats() {
    const entries = Object.entries(sixStarCounts).sort((a, b) => {
        const ta = (a[1].draws || 0) + (a[1].tokens || 0);
        const tb = (b[1].draws || 0) + (b[1].tokens || 0);
        return tb - ta || a[0].localeCompare(b[0], 'zh-Hant');
    });
    els.sixStarStats.innerHTML = '';
    els.sixStarStats.appendChild(textEl('div', 'sixstar-title', '六星統計'));
    if (!entries.length) {
        els.sixStarStats.appendChild(textEl('div', 'sixstar-item sixstar-empty', '尚未抽到六星'));
        return;
    }
    for (const [name, stat] of entries) {
        const total = (stat.draws || 0) + (stat.tokens || 0);
        const maxed = total >= TOKEN_POTENTIAL_CAP;
        const line = textEl('div', 'sixstar-item');
        line.append(
            document.createTextNode(name + ' '),
            textEl('span', 'sixstar-mark' + (maxed ? ' maxed' : ''), stat.tokens > 0 ? `${stat.draws}+${stat.tokens}` : `${stat.draws}`)
        );
        if (maxed) line.appendChild(textEl('span', 'sixstar-full', '已滿潛'));
        els.sixStarStats.appendChild(line);
    }
}

function renderHistory() {
    els.historyList.innerHTML = '';
    if (!historyRecords.length) {
        els.historyList.appendChild(textEl('div', 'history-empty', '近期抽取紀錄...'));
        return;
    }
    for (const r of historyRecords) {
        const entry = textEl('div', `history-item rarity-${r.star}`);
        entry.appendChild(document.createTextNode(`★${r.star} ${r.result}`));
        if (r.tokenObtained) {
            const maxed = r.tokenIndex >= TOKEN_POTENTIAL_CAP;
            entry.append(
                document.createTextNode(' '),
                textEl('span', 'token-mark' + (maxed ? ' maxed' : ''), `M+${r.tokenIndex}`)
            );
            if (maxed) entry.append(document.createTextNode(' '), textEl('span', 'token-full', '已滿潛'));
        }
        els.historyList.appendChild(entry);
    }
}

function updatePityIndicator() {
    const pity = poolPityState[currentPool];
    const pool = POOL_CONFIG[currentPool];
    if (!pity || !pool) return;
    const hardCounter = isSharedPool(currentPool) ? sharedSixPityNonStandard : pity.drawsWithoutSix;
    const lines = [
        `當前六星率：${sixRateFor(pity).toFixed(1)}%`,
        `剩餘 ${PITY_FIVE - pity.drawsWithoutFive} 次內必得五星以上幹員`,
        `剩餘 ${HARD_PITY_SIX - hardCounter} 次內必得六星幹員`
    ];
    if (pool.featured6) {
        lines.push(pity.featured6CounterActive
            ? `僅限一次：${FEATURED_GUARANTEE - pity.drawsWithoutFeatured6} 次內必得 ${pool.featured6}`
            : `${TOKEN_CYCLE - pity.drawsSinceTokenCounterStart} 次尋訪後可獲得信物`);
    }
    els.pityIndicator.innerHTML = '';
    lines.forEach((line, i) => {
        if (i) els.pityIndicator.appendChild(document.createElement('br'));
        els.pityIndicator.appendChild(document.createTextNode(line));
    });
}

function updateCostBadge() {
    const originite = totalCost / 75;
    els.costBadge.textContent =
        `使用的嵌晶玉：${totalCost.toLocaleString('zh-TW')}（共 ${totalDraws} 抽）\n約 ${originite.toFixed(2)} 源石 | 約 NT$${(originite * 10.3).toFixed(2)}`;
}

function renderPoolTabs() {
    els.sidebar.innerHTML = '';
    Object.values(POOL_CONFIG).forEach((pool) => {
        const tab = textEl('button', 'pool-tab' + (pool.key === currentPool ? ' active' : ''));
        tab.type = 'button';
        tab.dataset.pool = pool.key;
        tab.setAttribute('aria-pressed', String(pool.key === currentPool));
        tab.append(
            textEl('span', 'pool-tab-label', pool.tabLabel),
            textEl('span', 'pool-tab-sub', pool.featured6 || '常駐尋訪')
        );
        tab.addEventListener('click', () => switchPool(pool.key));
        els.sidebar.appendChild(tab);
    });
}

function switchPool(poolKey) {
    const pool = POOL_CONFIG[poolKey];
    if (!pool) return;
    currentPool = poolKey;
    els.infoTitle.textContent = pool.title;
    els.infoSubtitle.textContent = pool.subtitle;
    els.infoSubtitle.style.color = pool.subtitleColor;
    els.infoText.innerHTML = pool.infoHtml; // trusted local config only
    els.infoPanel.style.background = pool.panelGradient;
    document.documentElement.style.setProperty('--pool-accent', pool.subtitleColor);
    document.querySelectorAll('.pool-tab').forEach((tab) => {
        const active = tab.dataset.pool === poolKey;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-pressed', String(active));
    });
    updatePityIndicator();
    saveState();
}

/* ===== Draw flow ===== */
function bumpSixStar(name, field) {
    if (!sixStarCounts[name]) sixStarCounts[name] = { draws: 0, tokens: 0 };
    sixStarCounts[name][field] += 1;
}

function commitBatch(batch, pool, { reveal = true } = {}) {
    for (const r of batch.records) r.isNew = r.star === 6 && !sixStarCounts[r.result];
    poolPityState[currentPool] = batch.pity;
    sharedSixPityNonStandard = batch.shared;
    totalCost += batch.records.length * COST_PER_DRAW;
    totalDraws += batch.records.length;

    for (const r of batch.records) {
        if (r.star === 6) bumpSixStar(r.result, 'draws');
        if (r.tokenObtained && pool.featured6) bumpSixStar(pool.featured6, 'tokens');
    }
    historyRecords = [...batch.records.map((r) => ({ ...r })), ...historyRecords].slice(0, HISTORY_LIMIT);

    if (batch.records.length >= 10) updateCharacterStrip(batch.records, currentPool);
    else if (batch.records.length) {
        const best = batch.records.reduce((a, b) => (b.star > a.star ? b : a));
        updateCharacterVisual(best.result, best.star, currentPool);
    }

    renderSixStarStats();
    renderHistory();
    updatePityIndicator();
    updateCostBadge();
    announce(batch.records);
    saveState();
    if (reveal) showReveal(batch.records, pool);
}

function announce(records) {
    if (!els.liveRegion) return;
    const six = records.filter((r) => r.star === 6).map((r) => r.result);
    els.liveRegion.textContent = six.length
        ? `抽取完成，獲得六星：${six.join('、')}`
        : `抽取完成，共 ${records.length} 抽`;
}

function gacha(times) {
    const pool = POOL_CONFIG[currentPool];
    if (!pool || pending || revealOpen) return;
    const batch = simulateBatch(times, pool, poolPityState[currentPool], currentPool, sharedSixPityNonStandard);

    if (els.skipLeverToggle.checked) { commitBatch(batch, pool, { reveal: false }); return; }

    pending = batch;
    els.lever.style.transition = 'none';
    els.lever.style.transform = 'rotate(0deg)';
    clearLeverGlow();
    els.pullOverlay.style.display = 'flex';
    els.lever.focus({ preventScroll: true });
}

function executeDraw() {
    els.pullOverlay.style.display = 'none';
    clearLeverGlow();
    if (!pending) return;
    const batch = pending;
    pending = null;
    const pool = POOL_CONFIG[currentPool];
    commitBatch(batch, pool, { reveal: false });
    playPodTransition(batch, pool);
}

/* Orbital drop-pod segment between the switch and the reveal,
   mirroring the in-game sequence. Click to skip. */
let podTimer = null;
function playPodTransition(batch, pool) {
    const reduced = typeof window !== 'undefined' && window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !els.podOverlay) { showReveal(batch.records, pool); return; }
    els.podOverlay.hidden = false;
    els.podOverlay.dataset.star = String(batch.maxStar);
    els.podOverlay.classList.remove('landed');
    void els.podOverlay.offsetWidth;
    els.podOverlay.classList.add('landed');
    const finish = () => {
        clearTimeout(podTimer);
        els.podOverlay.hidden = true;
        els.podOverlay.removeEventListener('click', finish);
        showReveal(batch.records, pool);
    };
    els.podOverlay.addEventListener('click', finish);
    podTimer = setTimeout(finish, 1550);
}

function cancelDraw() {
    els.pullOverlay.style.display = 'none';
    clearLeverGlow();
    pending = null;
}

function resetTracking() {
    totalCost = 0; totalDraws = 0;
    sixStarCounts = {}; historyRecords = [];
    sharedSixPityNonStandard = 0;
    initPoolState();
    els.characterImage.hidden = true;
    els.characterStrip.hidden = true;
    els.characterCaption.style.display = 'none';
    els.characterPlaceholder.textContent = 'CHARACTER VISUAL';
    setVisualGlow(0);
    renderSixStarStats(); renderHistory(); updatePityIndicator(); updateCostBadge();
    saveState();
}


/* ===== Reveal演出 ===== */
let revealOpen = false;
let revealTimers = [];

function clearRevealTimers() { revealTimers.forEach(clearTimeout); revealTimers = []; }

function rarityLabel(star) { return '★'.repeat(star); }

function buildRevealImage(record, poolKey, className) {
    const wrap = textEl('div', className);
    const img = textEl('img', className + '-img');
    img.alt = record.result;
    img.style.objectPosition = getImageFocus(record.result, poolKey);
    const fallback = textEl('div', className + '-fallback', record.result);
    setImageWithFallback(img, getImageCandidates(record.result, poolKey),
        () => { img.hidden = false; fallback.style.display = 'none'; },
        () => { img.hidden = true; fallback.style.display = 'flex'; });
    wrap.append(img, fallback);
    return wrap;
}

function showReveal(records, pool) {
    if (!els.revealOverlay) return;
    clearRevealTimers();
    revealOpen = true;
    els.revealOverlay.hidden = false;
    els.revealOverlay.dataset.maxStar = String(Math.max(...records.map((r) => r.star)));
    els.revealPool.textContent = pool ? pool.title : '';
    els.revealStage.innerHTML = '';
    els.revealClose.hidden = true;

    const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (records.length === 1) {
        els.revealSkip.hidden = true;
        const single = buildSingleReveal(records[0]);
        els.revealStage.appendChild(single);
        revealTimers.push(setTimeout(() => single.classList.add('lit'), reduced ? 0 : 650));
        els.revealClose.hidden = false;
        els.revealClose.focus({ preventScroll: true });
        return;
    }

    els.revealSkip.hidden = false;
    const strips = records.map((record) => buildRevealStrip(record));
    strips.forEach((st) => els.revealStage.appendChild(st));
    let litCount = 0;
    const lightStrip = (i) => {
        if (!strips[i] || strips[i].classList.contains('lit')) return;
        strips[i].classList.add('lit');
        if (records[i].star >= 5) flashRarity(records[i].star);
        litCount += 1;
        if (litCount >= strips.length) presentSixStars(records, strips);
    };
    strips.forEach((strip, i) => strip.addEventListener('click', () => lightStrip(i)));
    if (reduced) { strips.forEach((_, i) => lightStrip(i)); return; }
    strips.forEach((_, i) => revealTimers.push(setTimeout(() => lightStrip(i), 600 + i * 430)));
}

/* After all strips are lit, each 6-star gets a full-screen presentation,
   then the view returns to the lit strip summary. */
function presentSixStars(records, strips) {
    const sixes = records.filter((r) => r.star === 6);
    if (!sixes.length) { finishReveal(); return; }
    els.revealSkip.hidden = true;
    let idx = 0;
    const next = () => {
        if (idx >= sixes.length) {
            els.revealStage.innerHTML = '';
            strips.forEach((st) => els.revealStage.appendChild(st));
            finishReveal();
            return;
        }
        const splash = buildSingleReveal(sixes[idx]);
        idx += 1;
        els.revealStage.innerHTML = '';
        els.revealStage.appendChild(splash);
        revealTimers.push(setTimeout(() => splash.classList.add('lit'), 60));
        revealTimers.push(setTimeout(next, 2100));
        splash.addEventListener('click', () => { clearRevealTimers(); next(); });
    };
    revealTimers.push(setTimeout(next, 650));
}

function buildSingleReveal(record) {
    const root = textEl('div', `reveal-single rarity-${record.star}`);
    const info = textEl('div', 'reveal-single-info');
    info.append(
        textEl('div', 'reveal-stars', rarityLabel(record.star)),
        textEl('div', 'reveal-name', record.result),
        textEl('div', 'reveal-sub', record.star === 6 ? '六星幹員' : record.star === 5 ? '五星幹員' : '四星幹員')
    );
    if (record.isNew) info.appendChild(textEl('div', 'reveal-badge new', 'NEW'));
    if (record.tokenObtained) info.appendChild(textEl('div', 'reveal-badge token', `信物 M+${record.tokenIndex}`));
    root.append(buildRevealImage(record, currentPool, 'reveal-single-art'), info);
    return root;
}

function buildRevealStrip(record) {
    const strip = textEl('div', `reveal-strip rarity-${record.star}`);
    strip.setAttribute('role', 'button');
    strip.setAttribute('aria-label', `揭示 ${record.result}`);
    const art = buildRevealImage(record, currentPool, 'reveal-strip-art');
    const meta = textEl('div', 'reveal-strip-meta');
    meta.append(
        textEl('span', 'reveal-strip-stars', rarityLabel(record.star)),
        textEl('span', 'reveal-strip-name', record.result)
    );
    if (record.isNew) meta.appendChild(textEl('span', 'reveal-badge new small', 'NEW'));
    if (record.tokenObtained) meta.appendChild(textEl('span', 'reveal-badge token small', `M+${record.tokenIndex}`));
    strip.append(art, meta);
    return strip;
}

function flashRarity(star) {
    els.revealOverlay.classList.remove('flash-5', 'flash-6');
    void els.revealOverlay.offsetWidth;
    els.revealOverlay.classList.add(`flash-${star}`);
}

function finishReveal() {
    clearRevealTimers();
    els.revealStage.querySelectorAll('.reveal-strip').forEach((c) => c.classList.add('lit'));
    els.revealSkip.hidden = true;
    els.revealClose.hidden = false;
    els.revealClose.focus({ preventScroll: true });
}

function closeReveal() {
    clearRevealTimers();
    revealOpen = false;
    if (els.revealOverlay) els.revealOverlay.hidden = true;
}

/* ===== Lever ===== */
function glowClass(star, soft) { return `${soft ? 'pre-glow' : 'glow'}-${Math.min(star, 6)}`; }

function applyLeverGlow(star, soft) {
    clearLeverGlow();
    const cls = glowClass(star, soft);
    els.lever.classList.add(cls);
    els.leverContainer.classList.add(cls);
}

function clearLeverGlow() {
    const all = ['glow-4', 'glow-5', 'glow-6', 'pre-glow-4', 'pre-glow-5', 'pre-glow-6'];
    els.lever.classList.remove(...all);
    els.leverContainer.classList.remove(...all);
}

function updateLeverGlowByProgress(progress, star) {
    if (progress < 0.3) clearLeverGlow();
    else applyLeverGlow(star, progress < 0.58);
}

/* Knife-switch: drag rotates the arm around its pivot with resistance. */
const SWITCH_MAX_ANGLE = 68;
const SWITCH_TRIGGER_ANGLE = 58;

function computeSwitchAngle(deltaY) {
    const d = Math.max(0, deltaY);
    // two-stage resistance: easy first third, heavier after
    const stage = 110;
    const deg = d <= stage ? d * 0.34 : stage * 0.34 + (d - stage) * 0.22;
    return Math.min(deg, SWITCH_MAX_ANGLE);
}

function setSwitchAngle(deg, animate) {
    els.lever.style.transition = animate ? 'transform 0.28s cubic-bezier(0.3, 1.4, 0.5, 1)' : 'none';
    els.lever.style.transform = `rotate(${deg}deg)`;
}

function fireSwitch() {
    setSwitchAngle(SWITCH_MAX_ANGLE + 4, true);
    els.pullOverlay.classList.add('switch-fired');
    setTimeout(() => {
        els.pullOverlay.classList.remove('switch-fired');
        executeDraw();
        setSwitchAngle(0, false);
    }, 240);
}

function setupLeverControls() {
    let dragging = false, startY = 0;

    els.lever.addEventListener('pointerdown', (e) => {
        dragging = true; startY = e.clientY;
        els.lever.setPointerCapture(e.pointerId);
        els.lever.style.transition = 'none';
        clearLeverGlow();
        e.preventDefault();
    });
    els.lever.addEventListener('pointermove', (e) => {
        if (!dragging || !pending) return;
        const angle = computeSwitchAngle(e.clientY - startY);
        els.lever.style.transform = `rotate(${angle}deg)`;
        updateLeverGlowByProgress(angle / SWITCH_MAX_ANGLE, pending.maxStar);
        if (angle >= SWITCH_TRIGGER_ANGLE) { dragging = false; fireSwitch(); }
    });
    const endDrag = () => {
        if (!dragging) return;
        dragging = false; clearLeverGlow();
        setSwitchAngle(0, true);
        setTimeout(() => { els.lever.style.transition = 'none'; }, 300);
    };
    els.lever.addEventListener('pointerup', endDrag);
    els.lever.addEventListener('pointercancel', endDrag);
    els.lever.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (pending) fireSwitch(); }
        if (e.key === 'Escape') cancelDraw();
    });
    els.pullOverlay.addEventListener('pointerdown', (e) => {
        if (e.target === els.pullOverlay) cancelDraw();
    });
}

/* ===== Init ===== */
async function initApp() {
    ['sidebar', 'characterVisual', 'characterImage', 'characterStrip', 'characterPlaceholder',
     'characterCaption', 'infoPanel', 'infoTitle', 'infoSubtitle', 'infoText', 'pityIndicator',
     'sixStarStats', 'historyList', 'costBadge', 'lever', 'skipLeverToggle', 'liveRegion', 'revealStage', 'revealPool', 'revealSkip', 'revealClose']
        .forEach((id) => { els[id] = $(id); });
    els.pullOverlay = $('pull-overlay');
    els.revealOverlay = $('reveal-overlay');
    els.podOverlay = $('pod-overlay');
    els.leverContainer = document.querySelector('.switch-panel');

    let jsonConfig = null;
    try {
        const res = await fetch('config.json');
        if (res.ok) jsonConfig = await res.json();
    } catch { jsonConfig = null; }

    normalizeConfig(jsonConfig || DEFAULT_CONFIG);
    initPoolState();
    currentPool = Object.keys(POOL_CONFIG)[0] || '';
    loadState();
    renderPoolTabs();
    if (currentPool) switchPool(currentPool);

    document.querySelectorAll('[data-draw]').forEach((btn) => {
        btn.addEventListener('click', () => gacha(Number(btn.dataset.draw)));
    });
    $('resetBtn').addEventListener('click', resetTracking);
    els.revealSkip.addEventListener('click', finishReveal);
    els.revealClose.addEventListener('click', closeReveal);
    els.revealOverlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReveal(); });
    els.skipLeverToggle.addEventListener('change', saveState);

    updateCostBadge();
    renderSixStarStats();
    renderHistory();
    setupLeverControls();
}

if (typeof document !== 'undefined') initApp();

/* Node test hook (no-op in browser) */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { computeSwitchAngle, SWITCH_TRIGGER_ANGLE, simulateBatch, sixRateFor, freshPityState, normalizeConfig, gacha, switchPool, executeDraw, closeReveal, getPoolConfig: () => POOL_CONFIG, getState: () => ({ currentPool, totalCost, totalDraws, historyRecords, poolPityState }) };
}
