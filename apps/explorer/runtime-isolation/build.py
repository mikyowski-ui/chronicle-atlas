"""Build the reviewed fixed worker using local tools; no downloads or generated source."""
import hashlib, json, os, pathlib, platform, subprocess
if platform.system() != 'Linux' or platform.machine().lower() not in ('x86_64', 'amd64'):
    print(json.dumps({'status': 'BLOCKED', 'code': 'ISOLATION_UNAVAILABLE', 'reason': 'UNSUPPORTED_PLATFORM', 'required': 'linux-x64', 'platform': platform.system(), 'architecture': platform.machine(), 'generatedExecution': False, 'modelProcessing': False}))
    raise SystemExit(2)
root = pathlib.Path(__file__).resolve().parent
out = root.parent / 'verification' / 'm3' / 'runtime'
out.mkdir(exist_ok=True, parents=True)
source = root / 'worker.c'
binary = out / 'chronicle-isolation-worker'
command = ['cc', '-static', '-O2', '-Wall', '-Wextra', '-Werror', '-fstack-protector-strong', '-D_FORTIFY_SOURCE=2', str(source), '-o', str(binary)]
subprocess.run(command, check=True)
binary.chmod(0o755)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
receipt = {'schema': 1, 'sourceHash': sha(source), 'binaryHash': sha(binary), 'platform': platform.platform(), 'compiler': subprocess.check_output(['cc','--version'],text=True).splitlines()[0], 'command': command, 'generatedExecution': False, 'modelProcessing': False}
(out / 'build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
