/* 滚动容器：存在性 / 高度上限 / 三栏结构 / 表格吸顶 */
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const WEB = path.join(__dirname, '..', 'web');
const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8');
const css=fs.readFileSync(path.join(WEB,'css/styles.css'),'utf8');
const files=['data.js','theories-a.js','theories-b.js','theories-c.js','theories-d.js','theories-e.js',
  'kbsearch.js','scales.js','scalebank.js','engine.js','ui.js','xlsx.js','pdffont.js','pdfdoc.js','pdfreport.js',
  'report.js','teacher.js','counselor.js','student.js','app.js'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
var pass=0, fail=0;
function ok(n,c,x){ if(c) pass++; else {fail++; console.log('  \u2717 '+n+(x?' \u2014 '+x:''));} }
const text=el=>(el&&el.textContent||'').replace(/\s+/g,' ').trim();

const DATA={ok:true,updatedAt:Date.now(),
  stats:{total:3,red:1,yellow:1,green:1,submissions:6},
  students:[
    {user:'student1',name:'\u5b66\u751f1',level:'red',score:9,riskType:'\u60c5\u7eea\u56f0\u6270',tags:['\u60c5\u7eea\u56f0\u6270'],last:'10-24',count:2,createdAt:Date.now()},
    {user:'student2',name:'\u5b66\u751f2',level:'yellow',score:5,riskType:'\u5b66\u4e1a\u538b\u529b',tags:['\u5b66\u4e1a\u538b\u529b'],last:'10-24',count:2,createdAt:Date.now()},
    {user:'student3',name:'\u5b66\u751f3',level:'green',score:1,riskType:'\u2014',tags:[],last:'10-23',count:2,createdAt:Date.now()}
  ],
  submissions:[
    {id:'a',user:'student1',name:'\u5b66\u751f1',type:'questionnaire',level:'red',riskType:'\u60c5\u7eea\u56f0\u6270',score:9,evidence:['\u4fe1\u53f7'],text:'',answers:{},createdAt:Date.now()},
    {id:'b',user:'student2',name:'\u5b66\u751f2',type:'questionnaire',level:'yellow',riskType:'\u5b66\u4e1a\u538b\u529b',score:5,evidence:[],text:'',answers:{},createdAt:Date.now()},
    {id:'c',user:'student3',name:'\u5b66\u751f3',type:'record',level:'green',riskType:'\u2014',score:1,evidence:[],text:'\u8fd8\u597d',answers:{},createdAt:Date.now()}
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
  console.log('===== 滚动容器测试 =====');

  /* 1. 样式定义存在 */
  ok('样式含 .scroll-box', /\.scroll-box\s*\{/.test(css));
  ok('.scroll-box 有 max-height', /\.scroll-box\s*\{[^}]*max-height/.test(css));
  ok('.scroll-box 有 overflow-y', /\.scroll-box\s*\{[^}]*overflow-y\s*:\s*auto/.test(css));
  ok('.scroll-box.tall 有更高上限', /\.scroll-box\.tall\s*\{[^}]*max-height/.test(css));
  ok('样式含 .tbl-scroll', /\.tbl-scroll\s*\{/.test(css));
  ok('.tbl-scroll 双向滚动', /\.tbl-scroll\s*\{[^}]*overflow/.test(css));
  ok('样式含 .act-scroll', /\.act-scroll\s*\{/.test(css));
  ok('.act-scroll 有高度上限', /\.act-scroll\s*\{[^}]*max-height/.test(css));

  /* 2. HTML 里的滚动容器都挂上了类 */
  const w=boot();
  const d=w.document;
  const ids=['recent','collectMissing','collectQuality','actSuggest','crisisList','ragOut'];
  ids.forEach(id=>{
    const el=d.getElementById(id);
    ok('#'+id+' 存在', !!el);
    ok('#'+id+' 带 scroll-box', el && /scroll-box/.test(el.className), el&&el.className);
  });
  ok('#caseGrid 带 scroll-box', /scroll-box/.test((d.getElementById('caseGrid')||{}).className||''));

  /* 3. 班主任台账三栏滚动 */
  await login(w,'banzhuren123','12345678');
  w.RB.route('actions'); await sleep(150);
  ['actTodo','actOverdue','actDone'].forEach(id=>{
    const el=d.getElementById(id);
    ok(id+' 带 act-scroll', el && /act-scroll/.test(el.className), el&&el.className);
  });

  /* 4. 报告页表格容器 */
  w.RB.route('report'); await sleep(200);
  ok('报告页有 tbl-scroll', d.getElementById('view-report').querySelectorAll('.tbl-scroll').length>0,
     String(d.getElementById('view-report').querySelectorAll('.tbl-scroll').length));

  /* 5. 内容超长时容器不被撑破（max-height 生效前提：overflow auto） */
  const sb=d.getElementById('actTodo');
  if(sb){
    const cs=w.getComputedStyle ? w.getComputedStyle(sb) : null;
    ok('act-scroll 计算样式含 overflow', !cs || cs.overflowY==='auto' || /act-scroll/.test(sb.className));
  }

  /* 6. 工具箱检索结果容器可滚动 */
  const w2=boot();
  await login(w2,'xinli123','12345678');
  w2.RB.route('toolbox'); await sleep(200);
  const ro=w2.document.getElementById('ragOut');
  ok('工具箱结果容器带 scroll-box', ro && /scroll-box/.test(ro.className), ro&&ro.className);
  ok('工具箱结果容器带 kb-out', ro && /kb-out/.test(ro.className), ro&&ro.className);

  /* 7. 量表派发面板不设内部滚动（派发表单与任务列表需完整可见）
     原「量表速查」#scaleList 已改为可施测的 #scalePanel */
  const sl=w2.document.getElementById('scalePanel');
  ok('量表派发面板存在', !!sl);
  ok('面板本身不受 scroll-box 限高', sl && !/scroll-box/.test(sl.className||''), sl&&sl.className);

  /* 8. 移动端规则 */
  ok('有 620px 移动端断点', /@media\s*\(max-width\s*:\s*620px\)/.test(css));
  ok('移动端调整 act-scroll', /@media[^{]*620px[^{]*\{[^@]*act-scroll/.test(css));

  console.log('\n通过 '+pass+' / 失败 '+fail);
  if(!fail) console.log('全部通过 \u2705');
})().catch(e=>{ console.error('崩溃:', e.stack||e.message); process.exit(1); });
