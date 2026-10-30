/* 专业工具箱改版：理论库扩充 / 检索 / 分类 / 量表速查 / AI 兜底 */
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const WEB = path.join(__dirname, '..', 'web');
const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8');
const files=['data.js','theories-a.js','theories-b.js','theories-c.js','theories-d.js','theories-e.js',
  'kbsearch.js','scalebank.js','engine.js','ui.js','xlsx.js','pdffont.js','pdfdoc.js','pdfreport.js',
  'report.js','teacher.js','counselor.js','student.js','app.js'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0, fail=0;
function ok(n,c,x){ if(c) pass++; else {fail++; console.log('  ✗ '+n+(x?' — '+x:''));} }
const text=el=>(el&&el.textContent||'').replace(/\s+/g,' ').trim();

function boot(aiReply){
  const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true,
   beforeParse(w){w.scrollTo=()=>{};w.alert=()=>{};w.confirm=()=>true;w.print=()=>{};
    w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
    w.fetch=async(url,opt)=>{
      if(String(url).indexOf('/api/ai/kb')!==-1){
        return {ok:true,status:200,json:async()=>aiReply||{ok:false,error:'no mock'}};
      }
      return {ok:true,status:200,json:async()=>({ok:true,students:[],submissions:[],
        stats:{total:0,red:0,yellow:0,green:0,submissions:0}})};
    };
    if(!w.TextEncoder) w.TextEncoder=TextEncoder;
    if(!w.TextDecoder) w.TextDecoder=TextDecoder;
    if(typeof w.CompressionStream==='undefined') w.CompressionStream=CompressionStream;
    if(typeof w.Response==='undefined') w.Response=Response;}});
  const w=dom.window;
  for(const f of files) w.eval(fs.readFileSync(path.join(WEB,'js',f),'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}

(async()=>{
  console.log('===== 专业工具箱测试 =====');
  const w=boot();
  const doc=w.document;
  w.RB.state.user={user:'xinlijiaoshi',name:'李老师',role:'counselor',roleName:'心理教师',klass:'初一(2)班'};
  w.RB.route('toolbox'); await sleep(250);

  const view=doc.getElementById('view-toolbox');

  /* 1. 理论库规模 */
  const T=w.RB.THEORIES;
  ok('理论库 >= 80 条', T.length>=80, String(T.length));
  const ids=T.map(t=>t.id);
  ok('无重复 id', ids.filter((v,i)=>ids.indexOf(v)!==i).length===0);
  const cats={}; T.forEach(t=>cats[t.cat||'?']=(cats[t.cat||'?']||0)+1);
  ['疗法','发展','情绪','效应','议题','危机','群体'].forEach(c=>
    ok('分类覆盖：'+c, (cats[c]||0)>0, JSON.stringify(cats)));
  ok('每条都有 alias 同义词', T.filter(t=>!(t.alias||[]).length).length===0,
     String(T.filter(t=>!(t.alias||[]).length).length));

  /* 2. 用户举例的那几个概念必须能搜到 */
  const KB=w.RB.kb;
  [['损失厌恶','损失厌恶'],['野马结局','野马结局'],['破窗效应','破窗效应'],
   ['吊桥效应','吊桥效应'],['罗森塔尔效应','罗森塔尔'],['沉没成本','沉没成本'],
   ['锚定效应','锚定'],['旁观者效应','旁观者'],['首因效应','首因'],
   ['晕轮效应','晕轮'],['从众效应','从众'],['峰终定律','峰终'],
   ['蔡格尼克','蔡格尼克']].forEach(([q,expect])=>{
    const r=KB.search(q);
    ok('搜到「'+q+'」', r.hits.length>0, '0 hits');
    ok('「'+q+'」首条匹配', r.hits.length>0 && r.hits[0].t.name.includes(expect),
       r.hits.length?r.hits[0].t.name:'');
  });

  /* 3. 高频临床词也必须能搜到（原来全部搜不到） */
  ['焦虑','抑郁','考试焦虑','社交焦虑','学业压力','校园欺凌','自伤',
   '危机干预','留守儿童','手机成瘾','失眠','厌学','ADHD','强迫症',
   '进食障碍','创伤后应激','哀伤','亲子冲突','完美主义','自卑'].forEach(q=>{
    ok('搜到「'+q+'」', KB.search(q).hits.length>0);
  });

  /* 4. 同义词扩展生效 */
  const exp=KB.expand('考试焦虑');
  ok('同义词扩展：考试焦虑含焦虑', exp.indexOf('焦虑')!==-1, JSON.stringify(exp));
  const r1=KB.search('考试焦虑');
  ok('考试焦虑命中考试焦虑条目',
     r1.hits.some(h=>h.t.name.indexOf('考试焦虑')!==-1),
     r1.hits.map(h=>h.t.name).join('、'));

  /* 5. 界面渲染 */
  ok('条数标签', /收录 \d+ 条/.test(text(doc.getElementById('kbCount'))), text(doc.getElementById('kbCount')));
  ok('分类 chip 已渲染', doc.querySelectorAll('#kbCats .kb-chip').length>=7,
     String(doc.querySelectorAll('#kbCats .kb-chip').length));
  ok('推荐词已渲染', doc.querySelectorAll('#kbSug .kb-sug-b').length>=10,
     String(doc.querySelectorAll('#kbSug .kb-sug-b').length));
  ok('AI 补充按钮存在', !!doc.getElementById('kbAiBtn'));

  /* 6. 输入检索 */
  const q=doc.getElementById('ragQ'), out=doc.getElementById('ragOut');
  q.value='破窗效应';
  q.dispatchEvent(new w.Event('input')); await sleep(150);
  ok('检索结果已渲染', out.querySelectorAll('.theory').length>0,
     String(out.querySelectorAll('.theory').length));
  ok('结果含破窗效应', text(out).includes('破窗效应'), text(out).slice(0,100));
  ok('显示命中数', /命中 \d+ 条/.test(text(out)), text(out).slice(0,80));

  /* 7. 分类筛选 */
  const catBtn=[...doc.querySelectorAll('#kbCats .kb-chip')].filter(b=>b.dataset.kbCat==='效应')[0];
  ok('有效应分类 chip', !!catBtn);
  catBtn.click(); await sleep(150);
  ok('筛选后仅剩效应类',
     [...doc.querySelectorAll('#kbCats .kb-chip')].filter(b=>b.dataset.kbCat==='效应')[0]
       .classList.contains('on'));

  /* 8. 推荐词点击 */
  w.RB.route('toolbox'); await sleep(150);
  const sug=[...doc.querySelectorAll('#kbSug .kb-sug-b')].filter(b=>b.dataset.kbSug==='考试焦虑')[0];
  ok('有「考试焦虑」推荐词', !!sug);
  if(sug){ sug.click(); await sleep(150); }
  ok('点推荐词后填入搜索框', doc.getElementById('ragQ').value==='考试焦虑',
     doc.getElementById('ragQ').value);
  ok('点推荐词后出结果', doc.getElementById('ragOut').querySelectorAll('.theory').length>0);

  /* 9. 量表派发面板（原「量表速查」已改为可施测的派发面板，
        详细功能测试见 scaletest.js，这里只验证在工具箱里正常挂载） */
  const sl=doc.getElementById('scalePanel');
  ok('量表派发面板已渲染', !!sl);
  const st=text(sl);
  ok('有派发入口', !!doc.getElementById('spAssign'));
  ok('有学生下拉', !!doc.getElementById('spStu'));
  ok('有量表下拉', !!doc.getElementById('spScale'));
  const opts=[...doc.querySelectorAll('#spScale option')].map(o=>o.value);
  ['PHQ-9','GAD-7','ISI','C-SSRS'].forEach(k=>
    ok('量表可选 '+k, opts.includes(k), opts.join(',')));
  ok('不含需授权的 SDQ', !opts.includes('SDQ'), opts.join(','));
  /* 施测通用原则已从界面移除，迁入 docs/技术文档.md 5.3.1，
     界面只保留可操作的派发功能（用户反馈说教式说明影响观感） */
  ok('界面不再显示施测通用原则', !st.includes('筛查不等于诊断'), st.slice(0,120));
  ok('有已派发区', st.includes('已派发量表'), st.slice(0,160));

  /* 11. AI 兜底：本地未命中时 */
  {
    const w2=boot({ok:true,engine:'llm',found:true,name:'测试概念',category:'效应',
      author:'某研究者',summary:'这是AI给出的解释。',apply:'这样用。',
      cautions:['注意核实'],confidence:'medium',aiGenerated:true,
      disclaimer:'AI 生成，未经专业审核，仅供参考。'});
    const d2=w2.document;
    w2.RB.state.user={user:'x',name:'李',role:'counselor',klass:'初一(2)班'};
    w2.RB.route('toolbox'); await sleep(200);
    d2.getElementById('ragQ').value='某个库里没有的概念xyz';
    d2.getElementById('kbAiBtn').click();
    await sleep(600);
    const o2=d2.getElementById('ragOut');
    ok('AI 卡片已渲染', !!o2.querySelector('.kb-ai-card'), o2.innerHTML.slice(0,80));
    ok('AI 卡片标注未经审核', text(o2).includes('未经专业审核'), text(o2).slice(0,150));
    ok('AI 卡片含解释内容', text(o2).includes('这是AI给出的解释'));
    ok('AI 卡片含免责声明', text(o2).includes('仅供参考'));
  }

  /* 12. AI 判为非公认概念时的呈现 */
  {
    const w3=boot({ok:true,engine:'llm',found:false,name:'野马结局2',
      summary:'这不是公认的心理学概念。',cautions:[],confidence:'low',
      aiGenerated:true,disclaimer:'AI 生成，未经专业审核，仅供参考。'});
    const d3=w3.document;
    w3.RB.state.user={user:'x',name:'李',role:'counselor',klass:'初一(2)班'};
    w3.RB.route('toolbox'); await sleep(200);
    d3.getElementById('ragQ').value='伪心理学概念abc';
    d3.getElementById('kbAiBtn').click(); await sleep(600);
    const o3=d3.getElementById('ragOut');
    ok('非公认概念有专门样式', !!o3.querySelector('.kb-ai-no'), o3.innerHTML.slice(0,80));
    ok('非公认概念明确标注', text(o3).includes('非公认概念'), text(o3).slice(0,120));
  }

  /* 12b. 上游未按结构化返回（degraded）—— 这是线上真实行为，必须测 */
  {
    const w6=boot({ok:true,engine:'llm',found:true,name:'具身认知',alias:[],category:'',
      author:'',summary:'一句话理解\n\n具身认知的核心主张是身体参与认知。\n\n落地用法\n· 姿势切换',
      apply:'',cautions:['本条为模型自由作答，未按结构化格式返回，仅供参考，请自行核实。'],
      confidence:'low',aiGenerated:true,degraded:true,
      disclaimer:'AI 生成，未经专业审核，仅供参考。'});
    const d6=w6.document;
    w6.RB.state.user={user:'x',name:'李',role:'counselor',klass:'初一(2)班'};
    w6.RB.route('toolbox'); await sleep(200);
    d6.getElementById('ragQ').value='具身认知xyz';
    d6.getElementById('kbAiBtn').click(); await sleep(600);
    const o6=d6.getElementById('ragOut');
    ok('降级结果已渲染', !!o6.querySelector('.kb-ai-card'), o6.innerHTML.slice(0,80));
    ok('降级卡片有专用样式', !!o6.querySelector('.kb-ai-soft'));
    ok('降级标注自由作答', text(o6).includes('自由作答'), text(o6).slice(0,120));
    ok('降级仍标注未经审核', text(o6).includes('未经专业审核'));
    ok('降级正文已显示', text(o6).includes('身体参与认知'), text(o6).slice(0,200));
  }

  /* 13. AI 失败时降级 */
  {
    const w4=boot({ok:false,error:'服务端未配置 AI_API_KEY'});
    const d4=w4.document;
    w4.RB.state.user={user:'x',name:'李',role:'counselor',klass:'初一(2)班'};
    w4.RB.route('toolbox'); await sleep(200);
    d4.getElementById('ragQ').value='查不到的概念zzz';
    d4.getElementById('kbAiBtn').click(); await sleep(600);
    const o4=d4.getElementById('ragOut');
    ok('AI 失败不崩', o4.innerHTML.length>0);
    ok('AI 失败有说明', text(o4).includes('失败')||text(o4).includes('未配置'), text(o4).slice(0,150));
    ok('AI 失败后按钮恢复可用', !d4.getElementById('kbAiBtn').disabled);
  }

  /* 14. 本地已收录时不浪费 AI 调用 */
  {
    let called=0;
    const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true,
     beforeParse(w){w.scrollTo=()=>{};w.alert=()=>{};w.confirm=()=>true;w.print=()=>{};
      w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
      w.fetch=async(url)=>{
        if(String(url).indexOf('/api/ai/kb')!==-1){
          called++;
          return {ok:true,status:200,json:async()=>({ok:true,engine:'llm',found:true,
            name:'损失厌恶',alias:[],category:'效应',author:'Kahneman',
            summary:'同等金额的损失带来的痛苦约为收益的两倍。',apply:'慎用威胁式表达。',
            cautions:[],confidence:'high',aiGenerated:true,degraded:false,
            disclaimer:'AI 生成，未经专业审核，仅供参考。'})};
        }
        return {ok:true,status:200,json:async()=>({ok:true,students:[],submissions:[],
          stats:{total:0,red:0,yellow:0,green:0,submissions:0}})};
      };
      if(!w.TextEncoder) w.TextEncoder=TextEncoder;
      if(!w.TextDecoder) w.TextDecoder=TextDecoder;
      if(typeof w.CompressionStream==='undefined') w.CompressionStream=CompressionStream;
      if(typeof w.Response==='undefined') w.Response=Response;}});
    const w5=dom.window;
    for(const f of files) w5.eval(fs.readFileSync(path.join(WEB,'js',f),'utf8'));
    w5.document.dispatchEvent(new w5.Event('DOMContentLoaded'));
    w5.RB.state.user={user:'x',name:'李',role:'counselor',klass:'初一(2)班'};
    w5.RB.route('toolbox'); await sleep(200);
    w5.document.getElementById('ragQ').value='损失厌恶';
    w5.document.getElementById('kbAiBtn').click(); await sleep(600);
    /* 行为已变更：原先「本地已收录就静默 return」导致按钮点下去毫无反应
       （理论库 91 条 + 同义词扩展后几乎总能本地命中，按钮等于永久失效）。
       现在用户主动点按钮就一定会调用 AI，本地命中与否不再拦截。 */
    ok('本地已收录时点击仍会调用 AI', called===1, 'called='+called);
    ok('本地结果仍照常展示', w5.document.getElementById('ragOut').querySelectorAll('.theory').length>0,
       String(w5.document.getElementById('ragOut').querySelectorAll('.theory').length));
    ok('同时出现 AI 补充卡片', !!w5.document.getElementById('ragOut').querySelector('.kb-ai-card'));
  }

  console.log('\n通过 '+pass+' / 失败 '+fail);
  if(!fail) console.log('全部通过 ✅');
})().catch(e=>{ console.error('崩溃:', e.stack||e.message); process.exit(1); });
