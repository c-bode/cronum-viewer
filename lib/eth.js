const RPCS = {
  ethereum: 'https://cloudflare-eth.com',
  polygon: 'https://polygon-rpc.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  optimism: 'https://mainnet.optimism.io',
  base: 'https://mainnet.base.org'
};

function rpc(chain){
  return RPCS[chain] || RPCS.ethereum;
}
let _id = 1;
async function eth_call(chain, to, data){
  const body = {
    jsonrpc: '2.0',
    id: _id++,
    method: 'eth_call',
    params: [{ to, data }, 'latest']
  };
  const res = await fetch(rpc(chain), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if(json.error) throw new Error(json.error.message || 'eth_call error');
  return json.result;
}

export async function connectEvm(){
  if(!window.ethereum) throw new Error('No EVM wallet (window.ethereum) found');
  const addrs = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if(!addrs || !addrs[0]) throw new Error('EVM account request rejected');
  return addrs[0];
}

export async function ensureChain(_chain){ return true; }

function pad32(hex){ return hex.replace(/^0x/,'').padStart(64,'0'); }
function toHex32(n){
  const bi = BigInt(n);
  return '0x' + bi.toString(16).padStart(64, '0');
}

export async function ownerOf({ chain='ethereum', contract, tokenId }){
  // ownerOf(uint256) -> 0x6352211e + 32-byte tokenId
  const sig = '0x6352211e';
  const data = sig + pad32(toHex32(tokenId));
  const out = await eth_call(chain, contract, data);
  if(!out || out === '0x') return null;
  // Address is rightmost 20 bytes
  const addr = '0x' + out.slice(-40);
  return addr.toLowerCase();
}

export async function balanceOf({ chain='ethereum', contract, account, tokenId }){
  // balanceOf(address,uint256) -> 0x00fdd58e
  const sig = '0x00fdd58e';
  const addr = '0x' + account.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const id = pad32(toHex32(tokenId)).replace(/^0x/, '');
  const data = sig + addr + id;
  const out = await eth_call(chain, contract, data);
  if(!out || out === '0x') return '0';
  return BigInt(out).toString(10);
}
