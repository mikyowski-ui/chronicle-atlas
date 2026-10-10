from pathlib import Path
import json,hashlib,subprocess,os,urllib.request,time
app=Path(__file__).resolve().parents[1];root=app.parents[1];out=app/'verification/local-followups'
out.mkdir(parents=True,exist_ok=True)
entries=json.loads((app/'verification/research-workspace/protected-inputs.json').read_text());bad=[]
for entry in entries:
 p=root/entry['path']
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=entry['sha256']:bad.append(entry['path'])
assert len(entries)==2282 and not bad,bad
(out/'protected.json').write_text(json.dumps({'status':'PASS','checked':len(entries),'changed':bad},indent=2))
proc=subprocess.Popen(['node','serve.mjs'],cwd=app,env={**os.environ,'PORT':'4192'},stdout=subprocess.PIPE,stderr=subprocess.PIPE)
try:
 assert b'http://localhost:4192/' in proc.stdout.readline()
 checks=[]
 for file in [app/'dist/index.html',app/'dist/build-info.json',*sorted((app/'dist/assets').iterdir())]:
  if not file.is_file():continue
  rel=file.relative_to(app/'dist').as_posix()
  with urllib.request.urlopen('http://127.0.0.1:4192/'+rel) as response:
   body=response.read();assert body==file.read_bytes();checks.append({'path':rel,'status':response.status,'exactBytes':True})
 req=urllib.request.Request('http://127.0.0.1:4192/index.html',headers={'Range':'bytes=0-9'})
 with urllib.request.urlopen(req) as response:assert response.status==206 and len(response.read())==10
 (out/'production-server.json').write_text(json.dumps({'status':'PASS','assets':checks,'range206':True,'browser':'NOT RUN by this HTTP verification script'},indent=2))
 print(json.dumps({'protectedFiles':len(entries),'productionAssets':len(checks),'range206':'PASS'}))
finally:proc.terminate();proc.wait(timeout=5)
