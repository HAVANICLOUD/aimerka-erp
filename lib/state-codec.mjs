export function splitState(state) {
  const rows=[];
  for(const name of Object.keys(state).sort()) {
    if(state[name]===undefined)continue;
    const bytes=new TextEncoder().encode(JSON.stringify(state[name]));
    // D1 stores UTF-8. Bound bytes and never divide a multibyte character
    // (or a JS surrogate pair) between independently stored fragments.
    for(let offset=0,part=0;offset<bytes.length;part++) {
      let end=Math.min(offset+90000,bytes.length);
      while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
      rows.push({name,part,body:new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset,end))});
      offset=end;
    }
  }
  return rows;
}
export function joinState(rows) {
  const grouped=new Map();
  for(const row of rows) {if(!grouped.has(row.name))grouped.set(row.name,[]);grouped.get(row.name)[row.part]=row.body;}
  return Object.fromEntries([...grouped].map(([name,parts])=>[name,JSON.parse(parts.join(''))]));
}
export function diffFragments(before,after) {
  const a=new Map(splitState(before).map(r=>[r.name+'|'+r.part,r]));
  const b=new Map(splitState(after).map(r=>[r.name+'|'+r.part,r]));
  return {upserts:[...b].filter(([key,r])=>a.get(key)?.body!==r.body).map(([,r])=>r),deletes:[...a].filter(([key])=>!b.has(key)).map(([,r])=>r)};
}
