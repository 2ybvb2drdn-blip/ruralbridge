/* 来源标签与来源执行率：5 类来源 / 标签文案 / 统计口径 / 角标联动 */
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const WEB = path.join(__dirname, '..', 'web');
const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8');
const files=['data.js','theories-a.js','theories-b.js','theories-c.js','theories-d.js','theories-e.js',
  'kbsearch.js','scalebank.js','engine.js','ui.js','xlsx.js','pdffont.js','pdfdoc.js','pdfreport.js',
  'report.js','teacher.js','counselor.js','student.js','app.js'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
var pass=0, fail=0;
function ok(n,c,x){ if(c) pass++; else {fail++; console.log('  \u2717 '+n+(x?' \u2014 '+x:''));} }
const text=el=>(el&&el.textContent||'').replace(/\s+/g,' ').trim();

const DATA={ok:true,updatedAt:Date.now(),
  stats:{total:2,red:1,yellow:0,green:1,submissions:2},
  students:[
    {user:'student1',name:'\u5b66\u751f1',level:'red',score:9,riskType:'\u60c5\u7eea\u56f0\u6270',tags:['\u60c5\u7eea\u56f0\u6270'],last:'10-24',count:1,createdAt:Date.now()},
    {user:'student2',name:'\u5b66\u751f2',level:'green',score:1,riskType:'\u2014',tags:[],last:'10-24',count:1,createdAt:Date.now()}
  ],
  submissions:[
    {id:'a',user:'student1',name:'\u5b66\u751f1',type:'questionnaire',level:'red',riskType:'\u60c5\u7eea\u56f0\u6270',score:9,evidence:['\u4fe1\u53f7'],text:'',answers:{},createdAt:Date.now()},
    {id:'b',user:'student2',name:'\u5b66\u751f2',type:'record',level:'green',riskType:'\u2014',score:1,evidence:[],text:'\u8fd8\u597d',answers:{},createdAt:Date.now()}
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
async function login(w){
  const d=w.document;
  d.getElementById('u').value='banzhuren123'; d.getElementById('p').value='12345678';
  d.getElementById('loginForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await sleep(250);
}

(async()=>{
  console.log('===== 来源标签与执行率测试 =====');
  const w=boot();
  const d=w.document;
  await login(w);

  /* 1. 五类来源都能正确落库 */
  const now=Date.now();
  w.localStorage.setItem('rb_actions', JSON.stringify([
    {id:'s1',text:'\u6765\u6e90A',dim:'\u4e2a\u4f53',target:'\u5b66\u751f1',source:'ai_class',  priority:'P1',createdAt:now,     done:false,doneAt:0},
    {id:'s2',text:'\u6765\u6e903',dim:'\u4e2a\u4f53',target:'\u5b66\u751f1',source:'ai_student',priority:'P1',createdAt:now-1000,done:true, doneAt:now},
    {id:'s3',text:'\u6765\u6e90C',dim:'\u8bfe\u5802',target:'\u5168\u73ed',source:'ai_dash',   priority:'P2',createdAt:now-2000,done:true, doneAt:now},
    {id:'s4',text:'\u6765\u6e90D',dim:'\u5bb6\u6821',target:'\u5b66\u751f2',source:'collect',   priority:'P2',createdAt:now-3000,done:false,doneAt:0},
    {id:'s5',text:'\u6765\u6e90E',dim:'\u4f5c\u4e1a',target:'\u5168\u73ed',source:'manual',    priority:'P3',createdAt:now-4000,done:true, doneAt:now}
  ]));
  w.RB.route('actions'); await sleep(200);

  const t=text(d.getElementById('view-actions'));

  /* 2. 五类标签文案都出现 */
  const LABELS=[['AI \u00b7 \u73ed\u7ea7\u7814\u5224','ai_class'],
                ['AI \u00b7 \u4e2a\u6848\u7814\u5224','ai_student'],
                ['AI \u00b7 \u4eca\u65e5\u5efa\u8bae','ai_dash'],
                ['\u7cfb\u7edf \u00b7 \u6570\u636e\u63d0\u9192','collect'],
                ['\u6559\u5e08 \u00b7 \u624b\u5de5\u5f55\u5165','manual']];
  LABELS.forEach(([label,key])=>ok('\u6765\u6e90\u6807\u7b7e\uff1a'+label, t.indexOf(label)!==-1, ''));

  /* 3. 标签样式类正确 */
  const tags=[...d.querySelectorAll('#view-actions .src-tag')];
  ok('\u6765\u6e90\u6807\u7b7e\u5df2\u6e32\u67d3', tags.length>0, String(tags.length));
  ok('\u6807\u7b7e\u542b ai \u7c7b', tags.some(x=>x.classList.contains('ai')));
  ok('\u6807\u7b7e\u542b sys \u7c7b', tags.some(x=>x.classList.contains('sys')));
  ok('\u6807\u7b7e\u542b man \u7c7b', tags.some(x=>x.classList.contains('man')));

  /* 4. 来源执行率统计表 */
  const stat=d.getElementById('actSourceStat');
  ok('\u6765\u6e90\u7edf\u8ba1\u8868\u5b58\u5728', !!stat);
  const st=text(stat);
  ok('\u7edf\u8ba1\u8868\u542b\u8868\u5934', st.indexOf('\u6765\u6e90')!==-1 || st.indexOf('\u6267\u884c\u7387')!==-1, st.slice(0,80));
  /* ai_student 1/1 = 100%，ai_dash 1/1=100%，manual 1/1=100%，ai_class 0/1=0%，collect 0/1=0% */
  ok('\u7edf\u8ba1\u8868\u542b\u767e\u5206\u6bd4', st.indexOf('%')!==-1, st.slice(0,120));
  ok('\u7edf\u8ba1\u8868\u542b 5 \u7c7b\u6765\u6e90',
     stat.querySelectorAll('tbody tr').length===5,
     String(stat.querySelectorAll('tbody tr').length));

  /* 5. 执行率数值正确性（用 DOM 解析核对） */
  const rows=[...stat.querySelectorAll('tbody tr')].map(tr=>{
    const c=[...tr.querySelectorAll('td')].map(x=>text(x));
    return {src:c[0], total:c[1], done:c[2], rate:c[3]};
  });
  const aiStu=rows.find(r=>r.src.indexOf('\u4e2a\u6848\u7814\u5224')!==-1);
  ok('ai_student \u6267\u884c\u7387 100%', aiStu && aiStu.rate==='100%',
     aiStu?JSON.stringify(aiStu):'\u672a\u627e\u5230');
  const aiCls=rows.find(r=>r.src.indexOf('\u73ed\u7ea7\u7814\u5224')!==-1);
  ok('ai_class \u6267\u884c\u7387 0%', aiCls && aiCls.rate==='0%',
     aiCls?JSON.stringify(aiCls):'\u672a\u627e\u5230');

  /* 6. 未知来源兜底为 manual，不崩 */
  {
    w.localStorage.setItem('rb_actions', JSON.stringify([
      {id:'x1',text:'\u672a\u77e5\u6765\u6e90',dim:'\u4e2a\u4f53',target:'\u5168\u73ed',source:'nonsense',priority:'P2',createdAt:now,done:false,doneAt:0}
    ]));
    w.RB.route('actions'); await sleep(150);
    const t2=text(d.getElementById('view-actions'));
    ok('\u672a\u77e5\u6765\u6e90\u56de\u9000\u4e3a\u624b\u5de5\u5f55\u5165', t2.indexOf('\u6559\u5e08 \u00b7 \u624b\u5de5\u5f55\u5165')!==-1);
  }

  /* 7. 角标只统计未完成，与来源无关 */
  {
    w.localStorage.setItem('rb_actions', JSON.stringify([
      {id:'b1',text:'a',dim:'\u4e2a\u4f53',target:'x',source:'ai_class',  priority:'P1',createdAt:now,done:false,doneAt:0},
      {id:'b2',text:'b',dim:'\u4e2a\u4f53',target:'x',source:'manual',    priority:'P2',createdAt:now,done:false,doneAt:0},
      {id:'b3',text:'c',dim:'\u4e2a\u4f53',target:'x',source:'collect',   priority:'P3',createdAt:now,done:true, doneAt:now}
    ]));
    w.RB.renderChrome ? w.RB.renderChrome() : null;
    w.RB.route('dash'); await sleep(150);
    const b=d.querySelector('#tabs button[data-tab="actions"] .nav-badge');
    ok('\u89d2\u6807\u4ec5\u7edf\u672a\u5b8c\u6210 = 2', b && b.textContent==='2', b&&b.textContent);
  }

  console.log('\n\u901a\u8fc7 '+pass+' / \u5931\u8d25 '+fail);
  if(!fail) console.log('\u5168\u90e8\u901a\u8fc7 \u2705');
})().catch(e=>{ console.error('崩溃:', e.stack||e.message); process.exit(1); });
