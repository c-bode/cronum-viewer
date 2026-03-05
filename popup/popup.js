import { h, prettyBytes, UPLOADER_URL } from '../lib/util.js';
import { discoverCronum } from '../lib/cronum.js';
import { connectEvm, ensureChain, ownerOf, balanceOf } from '../lib/eth.js';
import { loadLit, getAuthSig, decryptPackedToString, decryptLocalGCM } from '../lib/lit.js';

const $ = sel => document.querySelector(sel);
const on = (el, ev, fn) => el.addEventListener(ev, fn);
const THEME_PREF_KEY = 'cronum-theme-pref';
const THEME_OPTIONS = ['auto', 'light', 'dark'];

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = kind ? `show ${kind}` : 'show';
  setTimeout(() => { t.className = ''; }, 3500);
}

async function getDetectedNFT() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'CRONUM_GET_NFT' });
    return res?.nft || null;
  } catch {
    return null;
  }
}

function readNFTFromUI() {
  return {
    chain: $('#chain').value.trim() || 'ethereum',
    contract: $('#contract').value.trim(),
    tokenId: $('#tokenId').value.trim(),
    standard: $('#standard').value
  };
}

function writeNFTToUI(nft) {
  if (!nft) return;
  $('#chain').value = nft.chain || 'ethereum';
  $('#contract').value = nft.contract || '';
  $('#tokenId').value = nft.tokenId || '';
  $('#standard').value = (nft.standard || 'erc721').toLowerCase();
  updateAddLink();
}

function hasDetectedArtwork(nft) {
  return Boolean(nft?.chain && nft?.standard && nft?.contract && nft?.tokenId);
}

function setArtworkUIState(nft) {
  const hasArtwork = hasDetectedArtwork(nft);
  $('#artwork-details').hidden = !hasArtwork;
  $('#no-artwork').hidden = hasArtwork;
}

function updateAddLink() {
  try{
    const url = new URL(UPLOADER_URL);
    const composed = `${readNFTFromUI().contract}:${readNFTFromUI().tokenId}`;
    url.searchParams.set('nftUrl', encodeURIComponent(composed));
    $('#btn-add').href = url.toString();
  }catch{}
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
}

function readThemePreference() {
  const saved = localStorage.getItem(THEME_PREF_KEY);
  return THEME_OPTIONS.includes(saved) ? saved : 'auto';
}

function nextThemePreference(pref) {
  const idx = THEME_OPTIONS.indexOf(pref);
  return THEME_OPTIONS[(idx + 1) % THEME_OPTIONS.length];
}

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolvedTheme(pref) {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return systemPrefersDark() ? 'dark' : 'light';
}

function updateThemeButton(pref) {
  const btn = $('#btn-theme');
  if (!btn) return;
  const label = pref === 'auto' ? 'Auto' : pref[0].toUpperCase() + pref.slice(1);
  btn.textContent = `Theme: ${label}`;
  btn.title = `Theme: ${label}`;
}

function applyTheme(pref) {
  document.documentElement.dataset.theme = resolvedTheme(pref);
  updateThemeButton(pref);
}

function initThemeControl() {
  let pref = readThemePreference();
  applyTheme(pref);

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemThemeChange = () => {
    if (pref === 'auto') applyTheme(pref);
  };

  if (typeof media.addEventListener === 'function') media.addEventListener('change', handleSystemThemeChange);
  else if (typeof media.addListener === 'function') media.addListener(handleSystemThemeChange);

  const themeBtn = $('#btn-theme');
  if (!themeBtn) return;

  on(themeBtn, 'click', () => {
    pref = nextThemePreference(pref);
    localStorage.setItem(THEME_PREF_KEY, pref);
    applyTheme(pref);
  });
}

function createLoadingIndicator() {
  const wrap = h('div', { class: 'loading-indicator', role: 'status', 'aria-label': 'Loading' });
  wrap.appendChild(h('span', { class: 'dot' }));
  wrap.appendChild(h('span', { class: 'dot' }));
  wrap.appendChild(h('span', { class: 'dot' }));
  return wrap;
}

function setListLoadingState(sel) {
  const list = $(sel);
  list.innerHTML = '';
  list.appendChild(createLoadingIndicator());
}

/* ------------ Helpers for previews ------------ */
function formatCreatedAt(createdAt) {
  if (!createdAt) return 'n/a';
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return String(createdAt);
  // Intl uses the browser's current locale + timezone by default.
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
}

function looksLikeJSON(s) {
  if (!s) return false;
  const t = s.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}
function prettyJSON(s) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}
function codeBox(text) {
  return h('pre', { class: 'code' }, text);
}
async function buildPreviewFromUrl(url, fallbackMime) {
  if (!url) return { element: null, type: null };
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Preview fetch failed (${res.status})`);
  const ct = (res.headers.get('content-type') || fallbackMime || '').toLowerCase();

  if (ct.startsWith('image/')) {
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => URL.revokeObjectURL(objectUrl);
    img.src = objectUrl;
    return { element: img, type: 'image' };
  }

  // Text-ish: JSON / HTML / plain
  const text = await res.text();
  if (ct.includes('json') || looksLikeJSON(text)) {
    return { element: codeBox(prettyJSON(text)), type: 'json' };
  }
  // Never render HTML; show as text
  return { element: codeBox(text.slice(0, 200000)), type: 'text' }; // soft cap
}

/* ------------ Renderers ------------ */
function itemCardPublic(it) {
  const rawName = (it?.file?.name || '').trim();
  const rawExt = (it?.file?.ext || '').trim();
  const normalizedExt = rawExt ? (rawExt.startsWith('.') ? rawExt : `.${rawExt}`) : '';
  const title = rawName
    ? (normalizedExt && !rawName.toLowerCase().endsWith(normalizedExt.toLowerCase()) ? `${rawName}${normalizedExt}` : rawName)
    : '(unnamed)';
  const previewBtn = h('button', {}, 'Preview');
  const previewBox = h('div', { class: 'preview', style: { display: 'none' } });

  const card = h('div', { class: 'item' }, [
    h('h3', {}, title),
    h('div', { class: 'meta' }, [
      `${formatCreatedAt(it.createdAt)} · ${it.file?.mime || 'n/a'} · ${prettyBytes(it.file?.size || 0)} · `,
      h('a', { href: it.descriptorUrl, target: '_blank', rel: 'noopener' }, 'descriptor')
    ]),
    h('div', { class: 'row' }, [
      it.dataUrl ? previewBtn : h('span', { class: 'warn' }, 'Preview unavailable'),
      it.dataUrl ? h('a', { class: 'link', href: it.dataUrl, target: '_blank', rel: 'noopener' }, 'Open') : h('span', { class: 'bad' }, 'No dataUrl')
    ]),
    previewBox
  ]);

  if (it.dataUrl) {
    previewBtn.addEventListener('click', async () => {
      try {
        previewBtn.disabled = true;
        previewBtn.textContent = 'Loading…';
        const { element } = await buildPreviewFromUrl(it.dataUrl, it.file?.mime);
        previewBox.innerHTML = '';
        previewBox.appendChild(element || codeBox('No preview available'));
        previewBox.style.display = 'block';
        previewBtn.textContent = 'Preview';
      } catch (e) {
        console.error(e);
        toast(e?.message || String(e), 'bad');
        previewBtn.textContent = 'Preview';
      } finally {
        previewBtn.disabled = false;
      }
    });
  }

  return card;
}

function itemCardUnlockable(it, ctx) {
  const title = `${it.file?.name || '(unlockable)'}`;
  const btn = h('button', { }, 'Unlock');
  const out = h('div', { class: 'item' }, [
    h('h3', {}, title),
    h('div', { class: 'meta' }, [
      `${formatCreatedAt(it.createdAt)} · ${it.file?.mime || 'text/plain'} · ${prettyBytes(it.file?.size || 0)} · `,
      h('a', { href: it.descriptorUrl, target: '_blank', rel: 'noopener' }, 'descriptor')
    ]),
    h('div', { class: 'row' }, [
      btn
    ]),
    h('pre', { class: 'unlock-pre' }, '')
  ]);
  const pre = out.querySelector('pre');

  btn.addEventListener('click', async () => {
    try {
      btn.disabled = true;
      btn.textContent = 'Unlocking…';

      await ensureChain(ctx.nft.chain);
      await loadLit();
      const authSig = await getAuthSig('ethereum'); // chain used for auth

      const uacc = it?.lit?.uacc || buildUacc(ctx.nft);
      const packed = it?.lit?.packed || it?.lit?.data || it?.lit; // flexible

      let plaintext = null;
      if (packed?.version === 'nfu-local-gcm-1') {
        plaintext = await decryptLocalGCM({
          uacc,
          chain: it?.lit?.chain || 'ethereum',
          authSig,
          ciphertextB64: packed.ciphertext,
          ivB64: packed.iv,
          encryptedSymmetricKey: packed.encryptedSymmetricKey || null
        });
      } else {
        plaintext = await decryptPackedToString({
          packed,
          uacc,
          chain: it?.lit?.chain || 'ethereum',
          authSig
        });
      }

      // Pretty-print JSON automatically
      const display = looksLikeJSON(plaintext) ? prettyJSON(plaintext) : plaintext;
      pre.textContent = display;
      pre.style.display = 'block';
      btn.textContent = 'Unlocked';
      toast('Unlocked content shown below', 'good');
    } catch (e) {
      console.error(e);
      toast(e?.message || String(e), 'bad');
      btn.textContent = 'Unlock';
    } finally {
      btn.disabled = false;
    }
  });

  return out;
}

/* ------------ Access control helpers ------------ */
function buildUacc({ standard, chain, contract, tokenId }) {
  const c = contract;
  if ((standard || '').toLowerCase() === 'erc1155') {
    return [{
      conditionType: 'evmBasic', contractAddress: c, chain,
      standardContractType: 'ERC1155', method: 'balanceOf',
      parameters: [':userAddress', String(tokenId)],
      returnValueTest: { comparator: '>', value: '0' }
    }];
  }
  return [{
    conditionType: 'evmBasic', contractAddress: c, chain,
    standardContractType: 'ERC721', method: 'ownerOf',
    parameters: [String(tokenId)],
    returnValueTest: { comparator: '=', value: ':userAddress' }
  }];
}

async function isOwner(nft, addr) {
  if (!addr) return false;
  if ((nft.standard || '').toLowerCase() === 'erc1155') {
    const bal = await balanceOf({ chain: nft.chain, contract: nft.contract, account: addr, tokenId: nft.tokenId });
    return BigInt(bal || '0') > 0n;
    }
  const own = await ownerOf({ chain: nft.chain, contract: nft.contract, tokenId: nft.tokenId });
  return (own || '').toLowerCase() === (addr || '').toLowerCase();
}

/* ------------ Flow ------------ */
async function refreshCronum() {
  const nft = readNFTFromUI();
  if (!nft.contract || !nft.tokenId) { toast('Enter contract & tokenId', 'warn'); return; }

  setListLoadingState('#list-public');
  setListLoadingState('#list-unlockable');

  try {
    const { publics, locks } = await discoverCronum(nft);

    // Render public
    const pubList = publics.map(p => itemCardPublic(p));
    const lockList = locks.map(u => itemCardUnlockable(u, { nft }));

    $('#list-public').innerHTML = '';
    pubList.forEach(el => $('#list-public').appendChild(el));

    $('#list-unlockable').innerHTML = '';
    lockList.forEach(el => $('#list-unlockable').appendChild(el));

    $('#count').textContent = `${publics.length + locks.length} items`;
  } catch (e) {
    console.error(e);
    $('#list-public').textContent = 'Error loading Cronum.';
    $('#list-unlockable').textContent = 'Error loading Cronum.';
    toast(e?.message || String(e), 'bad');
  }
}

async function init() {
  initThemeControl();

  // tabs
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // connect EVM + Lit bundle preload
  $('#btn-connect').addEventListener('click', async () => {
    try {
      await connectEvm();
      await loadLit();
      toast('Wallet connected', 'good');
    } catch (e) {
      toast(e?.message || String(e), 'bad');
    }
  });

  $('#btn-refresh').addEventListener('click', refreshCronum);
  $('#contract').addEventListener('input', updateAddLink);
  $('#tokenId').addEventListener('input', updateAddLink);

  // Seed fields from detected NFT
  const detected = await getDetectedNFT();
  setArtworkUIState(detected);
  if (hasDetectedArtwork(detected)) writeNFTToUI(detected);
  else updateAddLink();

  // Initial load if we have enough to go
  if ($('#contract').value && $('#tokenId').value) refreshCronum();
}

init();
