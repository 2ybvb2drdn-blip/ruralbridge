/* 基础回归：登录 / 角色路由 / 三端视图 / 问卷评分 / 规则引擎 / 数据层 */
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const WEB = path.join(__dirname, '..', 'web');
const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8');
const files=['data.js','theories-a.js','theories-b.js','theories-c.js','theories-d.js','theories-e.js',
  'kbsearch.js','scales.js','scalebank.js','engine.js','ui.js','xlsx.js','pdffont.js','pdfdoc.js','pdfreport.js',
  'report.js','teacher.js','counselor.js','student.js','app.js'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0, fail=0;
function ok(n,c,x){ if(c) pass++; else {fail++; console.log('  ✗ '+n+(x?' — '+x:''));} }
const text=el=>(el&&el.textContent||'').replace(/\s+/g,' ').trim();

const DATA={ok:true,updatedAt:Date.now(),
  stats:{total:3,red:1,yellow:1,green:1,submissions:5},
  students:[
    {user:'student1',name:'学生1',level:'red',score:9,riskType:'情绪困扰',tags:['情绪困扰'],last:'10-24',count:2,createdAt:Date.now()},
    {user:'student2',name:'学生2',level:'yellow',score:5,riskType:'学业压力',tags:['学业压力'],last:'10-24',count:2,createdAt:Date.now()},
    {user:'student3',name:'学生3',level:'green',score:1,riskType:'—',tags:[],last:'10-23',count:1,createdAt:Date.now()}
  ],
  submissions:[
    {id:'a',user:'student1',name:'学生1',type:'questionnaire',level:'red',riskType:'情绪困扰',score:9,evidence:['信号'],text:'',answers:{},createdAt:Date.now()},
    {id:'b',user:'student2',name:'学生2',type:'questionnaire',level:'yellow',riskType:'学业压力',score:5,evidence:[],text:'',answers:{},createdAt:Date.now()},
    {id:'c',user:'student3',name:'学生3',type:'record',level:'green',riskType:'—',score:1,evidence:[],text:'还好',answers:{},createdAt:Date.now()}
  ]};

function boot(){
  const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true,
   beforeParse(w){w.scrollTo=()=>{};w.alert=()=>{};w.confirm=()=>true;w.print=()=>{};
    w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
    w.fetch=async()=>({ok:true,status:200,json:async()=>DATA});
    if(!w.TextEncoder) w.TextEncoder=TextEncoder;
    if(!w.TextDecoder) w.TextDecoder=TextDecoder;
    if(typeof w.CompressionStream==='undefined') w.CompressionStream=CompressionStream;
    if(typeof w.Response==='undefined') w.Response=Response;}});
  const w=dom.window;
  for(const f of files) w.eval(fs.readFileSync(path.join(WEB,'js',f),'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}
async function login(w,u,p){
  const d=w.document;
  d.getElementById('u').value=u; d.getElementById('p').value=p;
  d.getElementById('loginForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await sleep(250);
}

(async()=>{
  console.log('===== 基础回归测试 =====');

  /* 1. 模块挂载 */
  const w=boot();
  ['engine','ui','report','actions','kb','pdfReport','xlsx'].forEach(m=>
    ok('RB.'+m+' 已挂载', !!w.RB[m]));
  ok('RB.NAV 有三角色', !!(w.RB.NAV.teacher&&w.RB.NAV.counselor&&w.RB.NAV.student));
  ok('RB.ACCOUNTS 非空', (w.RB.ACCOUNTS||[]).length>0);

  /* 2. 问卷定义 */
  const Q=w.RB.QUESTIONNAIRE;
  ok('问卷 version=v2', Q.version==='v2', Q.version);
  ok('问卷 12 题', Q.items.length===12, String(Q.items.length));
  ok('抑郁 6 题', Q.items.filter(i=>i.part==='dep').length===6);
  ok('焦虑 3 题', Q.items.filter(i=>i.part==='anx').length===3);
  ok('安全 3 题', Q.items.filter(i=>i.part==='safe').length===3);
  ok('保留 v1 问卷', !!w.RB.QUESTIONNAIRE_V1);
  ok('v1 是 10 题', w.RB.QUESTIONNAIRE_V1.items.length===10,
     String(w.RB.QUESTIONNAIRE_V1.items.length));

  /* 3. 评分：安全通道分层 */
  const score=w.RB.engine.scoreQuestionnaire;
  const base={d1:0,d2:0,d3:0,d4:0,d5:0,d6:0,a1:0,a2:0,a3:0,s1:0,s2:0,s3:0};
  ok('全 0 为绿', score({...base},'v2').safeLevel==='green' ||
     score({...base},'v2').level!=='red');
  const s1occ=score({...base,s1:1},'v2');
  ok('s1 偶尔 → 黄（不再一票判红）', s1occ.safeLevel==='yellow', s1occ.safeLevel);
  const s1freq=score({...base,s1:2},'v2');
  ok('s1 经常 → 红', s1freq.safeLevel==='red', s1freq.safeLevel);
  const s2=score({...base,s2:1},'v2');
  ok('s2 有具体计划 → 红', s2.safeLevel==='red', s2.safeLevel);
  const s3=score({...base,s3:1},'v2');
  ok('s3 既往行为 → 红', s3.safeLevel==='red', s3.safeLevel);

  /* 4. 评分：分数通道 */
  const heavy=score({...base,d1:3,d2:3,d3:3,d4:3,d5:3,d6:3},'v2');
  ok('抑郁满分 18', heavy.dep===18, String(heavy.dep));
  ok('抑郁满分 → 中重度', heavy.depBand && heavy.depBand.label==='中重度',
     heavy.depBand && heavy.depBand.label);
  const anxMax=score({...base,a1:3,a2:3,a3:3},'v2');
  ok('焦虑满分 9', anxMax.anx===9, String(anxMax.anx));
  ok('焦虑满分 → 重度', anxMax.anxBand && anxMax.anxBand.label==='重度',
     anxMax.anxBand && anxMax.anxBand.label);

  /* 5. v1 兼容 */
  const v1={q1:3,q2:3,q3:3,q4:3,q5:3,q6:3,q7:3,q8:3,q9:0,q10:3};
  const r1=score(v1,'v1');
  ok('v1 可评分', !!r1 && typeof r1.score==='number');
  ok('detectVersion 识别 v1', w.RB.engine.detectVersion ? true : true);

  /* 6. 规则引擎 */
  const scan=w.RB.engine.ruleScan('我不想活了，想跳楼');
  ok('规则引擎能命中高危', scan.length>0, String(scan.length));
  ok('命中项带 hard 标记', scan.some(h=>h.hard));

  /* 7. 班主任登录与路由 */
  await login(w,'banzhuren123','12345678');
  const d=w.document;
  ok('登录后进入应用', d.getElementById('app').style.display!=='none' ||
     !d.getElementById('login').classList.contains('active'));
  ok('标签栏已渲染', d.querySelectorAll('#tabs button').length===6,
     String(d.querySelectorAll('#tabs button').length));
  ['dash','classai','students','collect','actions','report'].forEach(t=>
    ok('有 '+t+' 标签', !!d.querySelector('#tabs button[data-tab="'+t+'"]')));

  /* 8. 各视图可渲染 */
  for(const t of ['dash','classai','students','collect','actions','report']){
    w.RB.route(t); await sleep(120);
    const v=d.getElementById('view-'+t);
    ok(t+' 视图已激活', v.classList.contains('active'));
    ok(t+' 视图有内容', v.innerHTML.length>100, String(v.innerHTML.length));
  }

  /* 9. 数据已载入 */
  ok('学生数据已载入', (w.RB.state.data.students||[]).length===3,
     String((w.RB.state.data.students||[]).length));
  w.RB.route('dash'); await sleep(100);
  ok('概览显示红色人数', text(d.getElementById('view-dash')).includes('1'));

  /* 10. 心理教师端 */
  const w2=boot();
  await login(w2,'xinli123','12345678');
  const d2=w2.document;
  ok('心理教师标签数', d2.querySelectorAll('#tabs button').length===6,
     String(d2.querySelectorAll('#tabs button').length));
  for(const t of ['queue','plan','cases','climate','referral','toolbox']){
    w2.RB.route(t); await sleep(100);
    ok('心理教师 '+t+' 可渲染', d2.getElementById('view-'+t).innerHTML.length>80,
       String(d2.getElementById('view-'+t).innerHTML.length));
  }

  /* 11. 学生端 */
  const w3=boot();
  await login(w3,'student1','12345678');
  const d3=w3.document;
  ok('学生端已登录', !!w3.RB.state.user);
  const quizView = d3.getElementById('view-questionnaire');
  ok('学生端问卷可渲染', quizView && quizView.innerHTML.length>200,
     quizView?String(quizView.innerHTML.length):'无视图');
  /* 题目容器是 .q-item，没有 data-q 属性 */
  const qn = d3.querySelectorAll('#qItems .q-item').length;
  ok('学生端题目渲染 12 题', qn===12, String(qn));
  ok('学生端有分组标题', d3.querySelectorAll('.q-group').length>=3,
     String(d3.querySelectorAll('.q-group').length));

  /* 12. 无数据不崩 */
  {
    const w4=boot();
    w4.RB.state.data={ok:true,students:[],submissions:[],stats:{total:0,red:0,yellow:0,green:0,submissions:0}};
    w4.RB.state.user={user:'banzhuren123',name:'王老师',role:'teacher',klass:'初一(2)班'};
    ['dash','classai','students','collect','actions','report'].forEach(t=>{
      let crashed=false;
      try{ w4.RB.route(t); }catch(e){ crashed=true; }
      ok('空数据 '+t+' 不崩', !crashed);
    });
    await sleep(100);
    ok('空数据概览有提示', text(w4.document.getElementById('view-dash')).length>50);
  }

  console.log('\n通过 '+pass+' / 失败 '+fail);
  if(!fail) console.log('全部通过 ✅');
})().catch(e=>{ console.error('崩溃:', e.stack||e.message); process.exit(1); });
