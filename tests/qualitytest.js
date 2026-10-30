/* 数据质量提示：5 类信号检测 / 去重 / 严重度排序 */
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const WEB = path.join(__dirname, '..', 'web');
const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8');
const files=['data.js','theories-a.js','theories-b.js','theories-c.js','theories-d.js','theories-e.js',
  'kbsearch.js','engine.js','ui.js','xlsx.js','pdffont.js','pdfdoc.js','pdfreport.js',
  'report.js','teacher.js','counselor.js','student.js','app.js'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0, fail=0;
function ok(n,c,x){ if(c) pass++; else {fail++; console.log('  \u2717 '+n+(x?' \u2014 '+x:''));} }
const text=el=>(el&&el.textContent||'').replace(/\s+/g,' ').trim();

function boot(data){
  const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true,
   beforeParse(w){w.scrollTo=()=>{};w.alert=()=>{};w.confirm=()=>true;w.print=()=>{};
    w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
    w.fetch=async()=>({ok:true,status:200,json:async()=>data});
    if(!w.TextEncoder) w.TextEncoder=TextEncoder;
    if(!w.TextDecoder) w.TextDecoder=TextDecoder;
    if(typeof w.CompressionStream==='undefined') w.CompressionStream=CompressionStream;
    if(typeof w.Response==='undefined') w.Response=Response;}});
  const w=dom.window;
  for(const f of files) w.eval(fs.readFileSync(path.join(WEB,'js',f),'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}
async function login(w){
  const d=w.document;
  d.getElementById('u').value='banzhuren123'; d.getElementById('p').value='12345678';
  d.getElementById('loginForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await sleep(250);
}
function mkData(subs, students){
  return {ok:true,updatedAt:Date.now(),
    stats:{total:(students||[]).length,red:1,yellow:1,green:1,submissions:subs.length},
    students:students||[], submissions:subs};
}

(async()=>{
  console.log('===== 数据质量提示测试 =====');
  const now=Date.now(), DAY=86400000;

  /* ---------- 1. 仅提交 1 次 ---------- */
  {
    const w=boot(mkData([
      {id:'a',user:'s1',name:'\u5b66\u751f1',type:'questionnaire',level:'green',score:2,
       answers:{d1:1,d2:0,d3:0,d4:0,d5:0,d6:0,a1:0,a2:0,a3:0,s1:0,s2:0,s3:0},
       qVersion:'v2',createdAt:now}
    ],[{user:'s1',name:'\u5b66\u751f1',level:'green',score:2,last:'10-27',createdAt:now}]));
    await login(w); w.RB.route('collect'); await sleep(200);
    const t=text(w.document.getElementById('collectQuality'));
    ok('\u68c0\u51fa\u4ec5\u63d0\u4ea4 1 \u6b21', t.includes('\u4ec5\u63d0\u4ea4 1 \u6b21'), t.slice(0,80));
  }

  /* ---------- 2. \u76f4\u7ebf\u4f5c\u7b54\uff08\u5168\u9009\u6700\u9ad8\u9891\uff09---------- */
  {
    const w=boot(mkData([
      {id:'b',user:'s2',name:'\u5b66\u751f2',type:'questionnaire',level:'red',score:90,
       answers:{d1:3,d2:3,d3:3,d4:3,d5:3,d6:3,a1:3,a2:3,a3:3,s1:3,s2:3,s3:3},
       qVersion:'v2',createdAt:now},
      {id:'b2',user:'s2',name:'\u5b66\u751f2',type:'questionnaire',level:'red',score:80,
       answers:{d1:2,d2:3,d3:1,d4:2,d5:3,d6:2,a1:3,a2:1,a3:2,s1:0,s2:0,s3:0},
       qVersion:'v2',createdAt:now-DAY}
    ],[{user:'s2',name:'\u5b66\u751f2',level:'red',score:90,last:'10-27',createdAt:now}]));
    await login(w); w.RB.route('collect'); await sleep(200);
    const t=text(w.document.getElementById('collectQuality'));
    const el=w.document.getElementById('collectQuality');
    ok('\u68c0\u51fa\u76f4\u7ebf\u4f5c\u7b54', t.includes('\u5168\u90e8\u9009'), t.slice(0,100));
    ok('\u76f4\u7ebf\u4f5c\u7b54\u6807\u4e3a warn', el.querySelectorAll('.q-warn').length>0,
       String(el.querySelectorAll('.q-warn').length));
  }

  /* ---------- 3. \u5168\u9009\u300c\u5b8c\u5168\u6ca1\u6709\u300d\u4e0d\u62a5 warn ---------- */
  {
    const w=boot(mkData([
      {id:'c',user:'s3',name:'\u5b66\u751f3',type:'questionnaire',level:'green',score:0,
       answers:{d1:0,d2:0,d3:0,d4:0,d5:0,d6:0,a1:0,a2:0,a3:0,s1:0,s2:0,s3:0},
       qVersion:'v2',createdAt:now},
      {id:'c2',user:'s3',name:'\u5b66\u751f3',type:'record',level:'green',score:0,text:'\u597d',
       answers:{},createdAt:now-DAY}
    ],[{user:'s3',name:'\u5b66\u751f3',level:'green',score:0,last:'10-27',createdAt:now}]));
    await login(w); w.RB.route('collect'); await sleep(200);
    const el=w.document.getElementById('collectQuality');
    const t=text(el);
    ok('\u5168\u90090 \u4ecd\u63d0\u793a\u76f4\u7ebf\u4f5c\u7b54', t.includes('\u5168\u90e8\u9009'), t.slice(0,80));
    ok('\u5168\u90090 \u4e0d\u5347\u7ea7\u4e3a warn', el.querySelectorAll('.q-warn').length===0,
       String(el.querySelectorAll('.q-warn').length));
  }

  /* ---------- 4. \u8fde\u7eed\u4e24\u6b21\u95ee\u5377\u5b8c\u5168\u4e00\u81f4 ---------- */
  {
    const same={d1:1,d2:2,d3:1,d4:2,d5:1,d6:2,a1:1,a2:2,a3:1,s1:0,s2:0,s3:0};
    const w=boot(mkData([
      {id:'d1',user:'s4',name:'\u5b66\u751f4',type:'questionnaire',level:'yellow',score:20,
       answers:same,qVersion:'v2',createdAt:now},
      {id:'d2',user:'s4',name:'\u5b66\u751f4',type:'questionnaire',level:'yellow',score:20,
       answers:same,qVersion:'v2',createdAt:now-DAY}
    ],[{user:'s4',name:'\u5b66\u751f4',level:'yellow',score:20,last:'10-27',createdAt:now}]));
    await login(w); w.RB.route('collect'); await sleep(200);
    const t=text(w.document.getElementById('collectQuality'));
    ok('\u68c0\u51fa\u8fde\u7eed\u4e24\u6b21\u4e00\u81f4', t.includes('\u8fde\u7eed\u4e24\u6b21\u95ee\u5377\u7b54\u6848\u5b8c\u5168\u4e00\u81f4'), t.slice(0,100));
  }

  /* ---------- 5. 问卷与日常记录不一致 ---------- */
  {
    const w=boot(mkData([
      {id:'e1',user:'s5',name:'\u5b66\u751f5',type:'questionnaire',level:'green',score:1,
       answers:{d1:0,d2:0,d3:0,d4:0,d5:0,d6:0,a1:0,a2:0,a3:0,s1:0,s2:0,s3:0},
       qVersion:'v2',createdAt:now},
      {id:'e2',user:'s5',name:'\u5b66\u751f5',type:'record',level:'yellow',score:0,
       text:'\u7761\u7720\u4e0d\u597d\uff0c\u4e0d\u60f3\u4e0a\u5b66',answers:{},createdAt:now-1000}
    ],[{user:'s5',name:'\u5b66\u751f5',level:'green',score:1,last:'10-27',createdAt:now}]));
    await login(w); w.RB.route('collect'); await sleep(200);
    const t=text(w.document.getElementById('collectQuality'));
    ok('\u68c0\u51fa\u95ee\u5377\u4e0e\u8bb0\u5f55\u4e0d\u4e00\u81f4', t.includes('\u95ee\u5377\u4e0e\u65e5\u5e38\u8bb0\u5f55\u4e0d\u4e00\u81f4'), t.slice(0,120));
  }

  /* ---------- 6. 历史提交等级偏低（levelDrift）---------- */
  {
    const w=boot(mkData([
      {id:'f1',user:'s6',name:'\u5b66\u751f6',type:'questionnaire',level:'yellow',score:50,
       levelDrift:true,levelNow:'red',
       answers:{d1:0,d2:2,d3:1,d4:1,d5:0,d6:1,a1:1,a2:0,a3:1,s1:0,s2:1,s3:0},
       qVersion:'v2',createdAt:now},
      {id:'f2',user:'s6',name:'\u5b66\u751f6',type:'record',level:'green',score:0,text:'\u8fd8\u884c',
       answers:{},createdAt:now-DAY}
    ],[{user:'s6',name:'\u5b66\u751f6',level:'green',score:0,last:'10-27',createdAt:now}]));
    await login(w); w.RB.route('collect'); await sleep(200);
    const t=text(w.document.getElementById('collectQuality'));
    ok('\u68c0\u51fa\u5386\u53f2\u7b49\u7ea7\u504f\u4f4e', t.includes('\u5386\u53f2\u63d0\u4ea4\u7b49\u7ea7\u504f\u4f4e'), t.slice(0,120));
  }

  /* ---------- 7. 干净数据不误报 ---------- */
  {
    const w=boot(mkData([
      /* \u6ce8\u610f\uff1a\u4e0d\u80fd\u7528\u300c\u5168\u9009\u5b8c\u5168\u6ca1\u6709\u300d\u505a\u5e72\u51c0\u6570\u636e\u2014\u201412 \u9898\u540c\u9009\u4e00\u9879\u672c\u8eab\u5c31\u662f\u76f4\u7ebf\u4f5c\u7b54\uff0c
         \u4ee3\u7801\u4f1a\u6b63\u786e\u62a5\u51fa\u63d0\u793a\u3002\u7528\u4e24\u79cd\u53d6\u503c\u7684\u771f\u5b9e\u4f5c\u7b54\uff08\u91cd\u7b97 7 \u5206 / green\uff09\u3002 */
      {id:'g1',user:'s7',name:'\u5b66\u751f7',type:'questionnaire',level:'green',score:7,
       answers:{d1:1,d2:0,d3:0,d4:1,d5:0,d6:0,a1:0,a2:0,a3:0,s1:0,s2:0,s3:0},
       qVersion:'v2',createdAt:now},
      {id:'g2',user:'s7',name:'\u5b66\u751f7',type:'questionnaire',level:'green',score:7,
       answers:{d1:0,d2:1,d3:0,d4:0,d5:1,d6:0,a1:0,a2:0,a3:0,s1:0,s2:0,s3:0},
       qVersion:'v2',createdAt:now-DAY},
      {id:'g3',user:'s7',name:'\u5b66\u751f7',type:'record',level:'green',score:0,
       text:'\u4eca\u5929\u5f88\u5f00\u5fc3',answers:{},createdAt:now-2000}
    ],[{user:'s7',name:'\u5b66\u751f7',level:'green',score:3,last:'10-27',createdAt:now}]));
    await login(w); w.RB.route('collect'); await sleep(200);
    const t=text(w.document.getElementById('collectQuality'));
    ok('\u5e72\u51c0\u6570\u636e\u65e0\u8bef\u62a5', t.includes('\u672a\u53d1\u73b0\u660e\u663e\u7684\u6570\u636e\u8d28\u91cf\u95ee\u9898'), t.slice(0,120));
  }

  /* ---------- 8. warn 级排在 info 前 ---------- */
  {
    const same={d1:3,d2:3,d3:3,d4:3,d5:3,d6:3,a1:3,a2:3,a3:3,s1:0,s2:0,s3:0};
    const w=boot(mkData([
      {id:'h1',user:'s8',name:'\u5b66\u751f8',type:'questionnaire',level:'red',score:95,
       answers:same,qVersion:'v2',createdAt:now},
      {id:'h2',user:'s8',name:'\u5b66\u751f8',type:'questionnaire',level:'red',score:95,
       answers:same,qVersion:'v2',createdAt:now-DAY},
      /* \u53ea\u63d0\u4ea4\u4e00\u6b21\u7684\u53e6\u4e00\u4eba\uff0c\u7528\u4e8e\u6bd4\u8f83 warn \u4e0e info \u7684\u6392\u5e8f */
      {id:'h3',user:'s8b',name:'\u5b66\u751f8b',type:'questionnaire',level:'green',score:0,
       answers:{d1:0,d2:0,d3:0,d4:0,d5:0,d6:0,a1:0,a2:0,a3:0,s1:0,s2:0,s3:0},
       qVersion:'v2',createdAt:now-500}
    ],[{user:'s8',name:'\u5b66\u751f8',level:'red',score:95,last:'10-27',createdAt:now},
       {user:'s8b',name:'\u5b66\u751f8b',level:'green',score:0,last:'10-27',createdAt:now-500}]));
    await login(w); w.RB.route('collect'); await sleep(200);
    const el=w.document.getElementById('collectQuality');
    const items=[...el.querySelectorAll('.act-item')];
    ok('\u6709\u591a\u6761\u8d28\u91cf\u63d0\u793a', items.length>=2, String(items.length));
    if(items.length>=2){
      ok('warn \u6392\u5728\u9996\u4f4d', items[0].classList.contains('q-warn'), items[0].className);
    }
  }

  /* ---------- 9. \u53bb\u91cd\uff1a\u540c\u4e00\u5b66\u751f\u540c\u4e00\u7c7b\u4fe1\u53f7\u53ea\u62a5\u4e00\u6b21 ---------- */
  {
    const same={d1:2,d2:2,d3:2,d4:2,d5:2,d6:2,a1:2,a2:2,a3:2,s1:0,s2:0,s3:0};
    const w=boot(mkData([
      {id:'i1',user:'s9',name:'\u5b66\u751f9',type:'questionnaire',level:'yellow',score:40,
       answers:same,qVersion:'v2',createdAt:now},
      {id:'i2',user:'s9',name:'\u5b66\u751f9',type:'questionnaire',level:'yellow',score:40,
       answers:same,qVersion:'v2',createdAt:now-DAY},
      {id:'i3',user:'s9',name:'\u5b66\u751f9',type:'questionnaire',level:'yellow',score:40,
       answers:same,qVersion:'v2',createdAt:now-2*DAY}
    ],[{user:'s9',name:'\u5b66\u751f9',level:'yellow',score:40,last:'10-27',createdAt:now}]));
    await login(w); w.RB.route('collect'); await sleep(200);
    const t=text(w.document.getElementById('collectQuality'));
    const count=(t.match(/\u8fde\u7eed\u4e24\u6b21\u95ee\u5377\u7b54\u6848\u5b8c\u5168\u4e00\u81f4/g)||[]).length;
    ok('\u540c\u7c7b\u4fe1\u53f7\u53bb\u91cd\u4e3a 1 \u6761', count===1, '\u51fa\u73b0 '+count+' \u6b21');
  }

  /* ---------- 10. \u7a7a\u6570\u636e\u4e0d\u5d29 ---------- */
  {
    const w=boot(mkData([],[]));
    await login(w); w.RB.route('collect'); await sleep(200);
    ok('\u7a7a\u6570\u636e\u4e0d\u5d29', w.document.getElementById('collectQuality').innerHTML.length>0);
  }

  console.log('\n\u901a\u8fc7 '+pass+' / \u5931\u8d25 '+fail);
  if(!fail) console.log('\u5168\u90e8\u901a\u8fc7 \u2705');
})().catch(e=>{ console.error('\u5d29\u6e83:', e.stack||e.message); process.exit(1); });
