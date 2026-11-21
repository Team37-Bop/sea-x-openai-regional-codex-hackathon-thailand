import {randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,rename,stat,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const memory=new Map();
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const folder=()=>join(process.env.BOP_CACHE_DIR || fileURLToPath(new URL('./.cache',import.meta.url)),'showcase');
let queue=Promise.resolve();
function allowed(request) {
  return !process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.BOP_LOCAL_DEMO==='1' &&
    ['127.0.0.1','::ffff:127.0.0.1','::1'].includes(request.socket?.remoteAddress) &&
    /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(request.headers.host || '');
}
export async function saveLocalTrip(request,result){
  if(!allowed(request) || !result?.plan?.days?.length) return;
  const id=randomUUID(),root=folder(),target=join(root,id+'.json');
  memory.set(id,result);
  if(memory.size>8)memory.delete(memory.keys().next().value);
  queue=queue.then(async()=>{
    await mkdir(root,{recursive:true,mode:0o700});
    await writeFile(target+'.tmp',JSON.stringify(result),{mode:0o600});
    await rename(target+'.tmp',target);
    const files=(await readdir(root)).filter(name=>name.endsWith('.json') && uuid.test(name.slice(0,-5)));
    const saved=await Promise.all(files.map(async name=>({name,created:(await stat(join(root,name))).mtimeMs})));
    saved.sort((a,b)=>b.created-a.created);
    for(const old of saved.slice(8)) await unlink(join(root,old.name));
  }).catch(()=>{});
  await queue;
  return id;
}
export async function readLocalTrip(request,id){
  if(!allowed(request) || !uuid.test(id))return;
  if(memory.has(id))return memory.get(id);
  try {
    const value=JSON.parse(await readFile(join(folder(),id+'.json'),'utf8'));
    if(value?.plan?.days?.length)return value;
  }catch{ /* A removed or unreadable trip is no longer available. */ }
}
