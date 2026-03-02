import { h, prettyBytes, UPLOADER_URL } from '../lib/util.js';
import { discoverCronum } from '../lib/cronum.js';
import { connectEvm, ensureChain, ownerOf, balanceOf } from '../lib/eth.js';
import { loadLit, getAuthSig, decryptPackedToString, decryptLocalGCM } from '../lib/lit.js';

const $ = sel => document.querySelector(sel);
const on = (el, ev, fn) => el.addEventListener(ev, fn);

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

/* ------------ Helpers for previews ------------ */
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
  const ext = it?.file?.ext ? `.${it.file.ext}` : '';
  const title = `${it.file?.name || '(unnamed)'}${ext}`;
  const previewBtn = h('button', {}, 'Preview');
  const previewBox = h('div', { class: 'preview', style: { display: 'none' } });

  const card = h('div', { class: 'item' }, [
    h('h3', {}, title),
    h('div', { class: 'meta' }, [
      `size: ${prettyBytes(it.file?.size || 0)} · mime: ${it.file?.mime || 'n/a'} · created: ${it.createdAt || 'n/a'}`
    ]),
    h('div', { class: 'row' }, [
      it.dataUrl ? h('a', { href: it.dataUrl, target: '_blank', rel: 'noopener' }, 'Open data') : h('span', { class: 'bad' }, 'No dataUrl'),
      h('a', { href: it.descriptorUrl, target: '_blank', rel: 'noopener' }, 'Descriptor'),
      it.dataUrl ? previewBtn : h('span', { class: 'warn' }, 'Preview unavailable')
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
      `size: ${prettyBytes(it.file?.size || 0)} · mime: ${it.file?.mime || 'text/plain'} · created: ${it.createdAt || 'n/a'}`
    ]),
    h('div', { class: 'row' }, [
      h('a', { href: it.descriptorUrl, target: '_blank', rel: 'noopener' }, 'Descriptor'),
      btn
    ]),
    h('pre', { style: { display:'none', whiteSpace:'pre-wrap', background:'#f7f7f7', padding:'8px', borderRadius:'8px', border:'1px solid #eee', maxHeight:'180px', overflow:'auto' } }, '')
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

  $('#list-public').innerHTML = 'Loading…';
  $('#list-unlockable').innerHTML = 'Loading…';

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
  if (detected) writeNFTToUI(detected);
  else updateAddLink();

  // Initial load if we have enough to go
  if ($('#contract').value && $('#tokenId').value) refreshCronum();
}

init();
