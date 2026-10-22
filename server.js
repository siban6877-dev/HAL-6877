const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const envFile=path.join(__dirname,'.env');if(fs.existsSync(envFile))for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'')}
const PORT=Number(process.env.PORT||3000),KEY=process.env.GEMINI_API_KEY||'',MODEL=process.env.GEMINI_MODEL||'gemini-2.5-flash';let weatherCache=null,weatherAt=0;const send=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};async function jsonFetch(url,opts={},ms=12000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{let r=await fetch(url,{...opts,signal:c.signal});let body=await r.text();if(!r.ok)throw Error('Upstream HTTP '+r.status+' '+body.slice(0,180));return JSON.parse(body)}finally{clearTimeout(t)}}
function parseKp(rows){if(!Array.isArray(rows))throw Error('Unexpected NOAA format');let items=rows.filter(r=>r&&typeof r==='object'&&!Array.isArray(r)&&r.time_tag&&r.kp_index!==undefined);let last=items.at(-1);if(!last)throw Error('No valid NOAA readings');return {kp:Number(last.kp_index).toFixed(2),time:last.time_tag,source:'planetary_k_index_1m.json'}}
let hits=new Map();function limited(ip){let now=Date.now(),h=hits.get(ip)||[];h=h.filter(t=>now-t<60000);if(h.length>=8){hits.set(ip,h);return true}h.push(now);hits.set(ip,h);return false}
server.listen(PORT, '0.0.0.0', () => {
  console.log('HAL-6877 listening on port ' + PORT);
});
