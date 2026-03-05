export const UPLOADER_URL = 'https://cronum.art/cronum-uploader/'; // TODO: set your uploader URL

export function h(tag, props = {}, children){
  const el = document.createElement(tag);
  for(const [k,v] of Object.entries(props || {})){
    if(k === 'style' && v && typeof v === 'object'){
      Object.assign(el.style, v);
    } else if(k.startsWith('on') && typeof v === 'function'){
      el.addEventListener(k.slice(2), v);
    } else {
      el.setAttribute(k, v);
    }
  }
  if(children !== undefined){
    const arr = Array.isArray(children) ? children : [children];
    for(const c of arr){
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return el;
}

export function prettyBytes(num){
  if (!Number.isFinite(num)) return '0 B';
  const neg = num < 0;
  if (neg) num = -num;
  if (num < 1) return (neg ? '-' : '') + num + ' B';
  const units = ['B','KB','MB','GB','TB','PB'];
  const exp = Math.min(Math.floor(Math.log10(num) / 3), units.length - 1);
  const n = Number((num / Math.pow(1000, exp)).toFixed(2));
  return (neg ? '-' : '') + n + ' ' + units[exp];
}
