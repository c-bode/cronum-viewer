const GQL = 'https://arweave.net/graphql';
const GW  = 'https://arweave.net';

const GQL_RETRY_DELAYS_MS = [3000, 6000, 12000];

function sleep(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function gql(query, variables){
  for(let attempt = 0; attempt <= GQL_RETRY_DELAYS_MS.length; attempt += 1){
    const res = await fetch(GQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });

    if(res.ok) return res.json();

    // Retry temporary gateway issues using increasing backoff intervals.
    if(res.status === 502 && attempt < GQL_RETRY_DELAYS_MS.length){
      await sleep(GQL_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    throw new Error('GraphQL HTTP '+res.status);
  }

  throw new Error('GraphQL HTTP 502');
}

function parseDescriptorJson(text){
  try { return JSON.parse(text); } catch { return null; }
}

async function fetchDescriptor(id){
  const url = `${GW}/${id}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('Descriptor fetch '+res.status);
  const json = await res.json();
  return { json, url, id };
}

export async function discoverCronum(nft){
  const tagFilter = [
    { name:'App-Name', values:['NFU-Uploader'] },
    { name:'NFU-Schema', values:['nfu.descriptor.v1'] },
    { name:'NFU-Contract', values:[nft.contract] },
    { name:'NFU-TokenId', values:[String(nft.tokenId)] }
  ];
  // Optional chain filter if present
  if(nft.chain) tagFilter.push({ name:'NFU-Chain', values:[nft.chain] });

  const query = `query($tags:[TagFilter!]){
    transactions(tags:$tags, first: 100, sort: HEIGHT_DESC){
      edges{ node{ id } }
    }
  }`;

  const data = await gql(query, { tags: tagFilter });
  const edges = data?.data?.transactions?.edges || [];
  const ids = edges.map(e => e?.node?.id).filter(Boolean);

  const publics = [];
  const locks = [];

  for (const id of ids){
    try{
      const { json, url } = await fetchDescriptor(id);
      if(!json) continue;
      const kind = (json.kind || '').toLowerCase();
      const base = {
        descriptorUrl: url,
        id,
        createdAt: json.createdAt || null,
        nft: json.nft || {}
      };
      if(kind === 'public'){
        const file = json.file || {};
        const storage = json.storage || {};
        publics.push({
          ...base,
          file,
          dataUrl: storage.dataUrl || (storage.dataTxId ? `${GW}/${storage.dataTxId}` : null)
        });
      } else if (kind === 'unlockable'){
        locks.push({
          ...base,
          file: json.file || {},
          lit: json.lit || {}
        });
      }
    }catch(e){
      console.warn('descriptor parse error', id, e);
    }
  }

  return { publics, locks };
}
