import liff from '@line/liff';
import './liff.css';
import { api, errText } from './ui/api.js';

const root = document.querySelector('#liff-app');
const tripId = new URLSearchParams(location.search).get('trip') || '';
let idToken = '', context = null, busy = false;

const node = (tag, cls, text) => { const element=document.createElement(tag); if(cls) element.className=cls; if(text!=null) element.textContent=text; return element; };
function shell(){ const page=node('div','liff'); const brand=node('div','brand'); brand.append(node('span','mark','B'),node('b','', 'Bop · LINE')); page.append(brand); root.replaceChildren(page); return page; }
function error(message){ const page=shell(); const card=node('section','card error'); card.append(node('h1','', 'เปิด Bop ไม่สำเร็จ'),node('p','',message)); page.append(card); }

async function selectMember(memberId){
  if(busy)return; busy=true;
  const result=await api.lineIdentity(tripId,{idToken,memberId});
  busy=false;
  if(result.type!=='done')return error(errText(result));
  context=result; render();
}
async function vote(option){
  if(busy||!context?.trip?.vote)return; busy=true; render();
  const result=await api.lineBallot(tripId,{idToken,voteId:context.trip.vote.id,option});
  busy=false;
  if(result.type!=='done')return error(errText(result));
  context.trip.vote=result.vote; render();
}
function render(){
  const page=shell(), trip=context.trip, identity=context.identity||{};
  const header=node('section','card'); header.append(node('h1','',trip.title||'ทริป Bop'));
  if(trip.summary)header.append(node('p','',trip.summary));
  header.append(node('p','muted','Bop เก็บ LINE ID ชื่อที่แสดง และบัตรโหวตไว้กับทริป และลบ 30 วันหลังจบทริปหรือตามคำขอ'));
  page.append(header);

  if(!identity.memberId){
    const card=node('section','card'); card.append(node('h2','',`ฉันคือ… (${identity.displayName||'สมาชิก LINE'})`));
    const members=node('div','members');
    for(const member of trip.members||[]){ const button=node('button',member.linked?'':'primary',`${member.name}${member.linked?' · เชื่อมแล้ว':''}`); button.disabled=busy||member.linked; button.addEventListener('click',()=>selectMember(member.id)); members.append(button); }
    card.append(members); page.append(card); return;
  }

  const linked=node('p','status',`เชื่อมกับ ${identity.displayName||identity.memberId} แล้ว`); page.append(linked);
  const current=trip.vote;
  if(!current){ const card=node('section','card'); card.append(node('h2','', 'ยังไม่มีการโหวต'),node('p','muted','เมื่อคนจัดทริปส่งทางเลือก การ์ดโหวตจะแสดงที่นี่')); page.append(card); return; }
  const card=node('section','card'); card.append(node('h2','',current.status==='OPEN'?'เลือกแผน':'ผลโหวต'));
  if(current.reason)card.append(node('p','muted',current.reason));
  const options=node('div','options');
  for(const option of current.options||[]){ const button=node('button','primary',`โหวต ${option.key} · ${option.title}`); button.disabled=busy||current.status!=='OPEN'; button.addEventListener('click',()=>vote(option.key)); options.append(button); }
  card.append(options);
  for(const ballot of Object.values(current.ballots||{})){ const row=node('div','ballot'); row.append(node('span','',ballot.displayName||'สมาชิก'),node('b','',ballot.option)); card.append(row); }
  if(current.status==='TIE')card.append(node('p','status','ผลเสมอ รอคนจัดทริปตัดสิน'));
  if(current.status==='CLOSED')card.append(node('p','status',`เลือกแผน ${current.winner||'-'}`));
  page.append(card);
}

async function boot(){
  if(!tripId)return error('ลิงก์นี้ไม่มีรหัสทริป');
  const config=await api.config();
  if(config.type!=='done'||!config.enabled)return error('Bop ยังไม่ได้เชื่อม LINE Messaging API');
  if(!config.liffId)return error('ผู้ดูแลยังไม่ได้ตั้งค่า LIFF_ID');
  await liff.init({liffId:config.liffId});
  if(!liff.isLoggedIn()){ liff.login({redirectUri:location.href}); return; }
  idToken=liff.getIDToken()||'';
  if(!idToken)return error('LINE ไม่ได้ส่ง ID token');
  const result=await api.lineIdentity(tripId,{idToken});
  if(result.type!=='done')return error(errText(result));
  context=result; render();
  setInterval(async()=>{ if(!context?.identity?.memberId||busy)return; const next=await api.lineIdentity(tripId,{idToken}); if(next.type==='done'){context=next;render();} },5000);
}

boot().catch(reason=>error(reason?.message||'เกิดข้อผิดพลาด'));
