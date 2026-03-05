export const LIT_BUNDLE_URL = new URL('./lit.bundle.esm.js', import.meta.url).href;
export const LIT_NETWORK = 'datil';

let LIT_OBJ = null;
let LIT_CLIENT = null;

function isLitReady(obj){
  if (!obj) return false;
  return !!(obj.LitNodeClient || obj.encryptToJson || obj.decryptToString || obj.checkAndSignAuthMessage || obj.saveEncryptionKey);
}
function pickLitGlobal(){
  const names = ['LitJsSdk','litJsSdk','LitSDK','Lit','lit','LitProtocol','litProtocol'];
  for (let i=0;i<names.length;i++){
    const g = window[names[i]];
    if (isLitReady(g)) return g;
  }
  if (window.LitNodeClient) return { LitNodeClient: window.LitNodeClient };
  return null;
}
async function importESM(url){
  try {
    const mod = await import(url);
    if (isLitReady(mod)) return mod;
    if (isLitReady(mod && mod.default)) return mod.default;
    const g = pickLitGlobal(); if (g) return g;
    return null;
  } catch(e) { return null; }
}
function loadClassic(url){
  return new Promise((resolve,reject)=>{
    const s = document.createElement('script'); s.src = url; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Classic script failed to load'));
    document.head.appendChild(s);
  });
}

export async function loadLit(){
  if (LIT_OBJ && isLitReady(LIT_OBJ)) return LIT_OBJ;
  let obj = await importESM(LIT_BUNDLE_URL);
  if (!isLitReady(obj)) {
    try { await loadClassic(LIT_BUNDLE_URL); } catch {}
    const g = pickLitGlobal(); if (g) obj = g;
  }
  if (!isLitReady(obj)) throw new Error('Lit SDK not loaded');
  LIT_OBJ = obj;
  return LIT_OBJ;
}

export async function ensureLitClient(){
  await loadLit();
  if (LIT_CLIENT) return LIT_CLIENT;
  const Ctor = LIT_OBJ.LitNodeClient || (LIT_OBJ.default && LIT_OBJ.default.LitNodeClient);
  if (!Ctor) return null;
  const client = new Ctor({ litNetwork: LIT_NETWORK, debug: false });
  await client.connect();
  LIT_CLIENT = client;
  return LIT_CLIENT;
}

export async function getAuthSig(chain){
  await loadLit();
  if (typeof LIT_OBJ.checkAndSignAuthMessage === 'function') {
    return await LIT_OBJ.checkAndSignAuthMessage({ chain });
  }
  if (!window.ethereum) throw new Error('No EVM wallet available for AuthSig');
  const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
  const addr = accounts[0];
  const domain = window.location.host;
  const origin = window.location.origin;
  const msg = [
    'Cronum Viewer / Lit Authorization',
    'Sign this message to authenticate with Lit Protocol.',
    'This does not trigger a blockchain transaction.',
    '',
    'Domain: ' + domain,
    'Origin: ' + origin,
    'Address: ' + addr,
    'Chain: ' + chain,
    'Timestamp: ' + new Date().toISOString()
  ].join('\n');
  const sig = await window.ethereum.request({ method:'personal_sign', params:[msg, addr] });
  return { sig, derivedVia:'web3.eth.personal.sign', signedMessage: msg, address: addr };
}

export async function decryptPackedToString({ packed, uacc, chain='ethereum', authSig }){
  await loadLit();
  const client = await ensureLitClient();
  // Standard encryptToJson pack: { ciphertext, dataToEncryptHash, ... }
  if (typeof LIT_OBJ.decryptToString === 'function') {
    return await LIT_OBJ.decryptToString(
      { accessControlConditions: uacc, chain, authSig, ...packed },
      client
    );
  }
  // Fallback using getEncryptionKey + browser decrypt
  const encKey = await client.getEncryptionKey({
    accessControlConditions: uacc,
    chain,
    authSig,
    toDecrypt: packed.encryptedSymmetricKey || packed.encryptedSymmetricKeyHex || ''
  });
  // LitJsSdk.decryptString exists in some bundles
  if (typeof LIT_OBJ.decryptString === 'function') {
    return await LIT_OBJ.decryptString(packed.ciphertext, encKey);
  }
  // Last resort: attempt manual AES-GCM with ciphertext in base64
  const raw = typeof encKey === 'string' ? Uint8Array.from(encKey.match(/.{1,2}/g).map(b=>parseInt(b,16))) : new Uint8Array(encKey);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const ctBytes = Uint8Array.from(atob(packed.ciphertext), c => c.charCodeAt(0));
  // dataToEncryptHash is not IV; but if ciphertext is Lit's default, decryptString should have been used.
  throw new Error('This Lit bundle does not expose decryptToString/decryptString; please use a compatible bundle.');
}

export async function decryptLocalGCM({ uacc, chain='ethereum', authSig, ciphertextB64, ivB64, encryptedSymmetricKey=null }){
  await loadLit();
  const client = await ensureLitClient();
  const params = { accessControlConditions: uacc, chain, authSig };
  if (encryptedSymmetricKey) params.toDecrypt = encryptedSymmetricKey;

  const symmKey = await client.getEncryptionKey(params);
  const keyRaw = symmKey instanceof Uint8Array ? symmKey : Uint8Array.from(typeof symmKey === 'string' ? symmKey.match(/.{1,2}/g).map(h=>parseInt(h,16)) : symmKey);
  const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['decrypt']);
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);
  const dec = new TextDecoder();
  return dec.decode(pt);
}
