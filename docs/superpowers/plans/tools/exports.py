import re,os,json,collections
S=os.environ['S']
d=json.load(open(S+'/dead2.json')); dead=set(d['prod_dead'])|set(d['test_dead'])
def walk(dd):
  for r,ds,fs in os.walk(dd):
    ds[:]=[x for x in ds if x not in('node_modules','.next')]
    for f in fs:
      if f.endswith(('.ts','.tsx','.mjs','.js')): yield os.path.normpath(os.path.join(r,f))
files=[f for f in list(walk('src'))+list(walk('tests'))+list(walk('scripts')) if f not in dead]
text={f:open(f,errors='ignore').read() for f in files}
# word counts across corpus
wc=collections.Counter()
per=collections.defaultdict(collections.Counter)
tok=re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*')
for f,t in text.items():
  c=collections.Counter(tok.findall(t)); per[f]=c; wc.update(c)
decl=re.compile(r'^export\s+(?:async\s+)?(function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)',re.M)
isTest=lambda f: '.test.' in f or '__tests__' in f or f.startswith('tests/')
res=[]
for f,t in text.items():
  if not f.startswith('src/') or isTest(f): continue
  if re.search(r'/(page|layout|route|loading|error|not-found|robots|sitemap)\.tsx?$',f) or f=='src/lib/db/schema/index.ts': continue
  lines=t.split('\n')
  for m in decl.finditer(t):
    kind,name=m.groups()
    if name in ('default','GET','POST','PUT','PATCH','DELETE','metadata','dynamic','runtime','revalidate','config','generateMetadata'): continue
    total=wc[name]; inself=per[f][name]
    # used by tests only?
    prod_other=sum(per[g][name] for g in text if g!=f and not isTest(g))
    test_other=sum(per[g][name] for g in text if g!=f and isTest(g))
    if prod_other==0:
      ln=t[:m.start()].count('\n')
      # body length: brace/paren depth from decl line
      depth=0; started=False; end=ln
      for i in range(ln,len(lines)):
        for ch in lines[i]:
          if ch in '{(': depth+=1; started=True
          elif ch in '})': depth-=1
        if started and depth<=0 and (lines[i].rstrip().endswith(('}','};',');','})',')')) or ';' in lines[i]): end=i; break
        if not started and lines[i].rstrip().endswith(';'): end=i; break
      n=end-ln+1
      status='dead' if inself==1 else 'local-only'
      res.append(dict(f=f,line=ln+1,name=name,kind=kind,lines=n,status=status,tests=test_other))
json.dump(res,open(S+'/exports.json','w'))
dead_ex=[r for r in res if r['status']=='dead']
fn=[r for r in dead_ex if r['kind'] not in('type','interface')]
print('dead exports',len(dead_ex),'(values',len(fn),'lines',sum(r['lines'] for r in fn),'; types',len(dead_ex)-len(fn),'lines',sum(r['lines'] for r in dead_ex if r['kind'] in('type','interface')),')')
print('export-only-used-locally',sum(1 for r in res if r['status']=='local-only'))
print('dead but tested',sum(1 for r in fn if r['tests']>0))
for r in sorted(fn,key=lambda r:-r['lines'])[:40]: print(r['lines'],f"{r['f']}:{r['line']}",r['name'],'(tested)' if r['tests'] else '')
