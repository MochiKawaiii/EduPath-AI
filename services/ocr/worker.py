"""Pull-only demo worker. No inbound port, browser secrets, or direct database access."""
import argparse
from contextlib import ExitStack
import base64
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler

ROOT=Path(__file__).resolve().parent

def read_config():
    env=ROOT/'.env'
    if env.exists():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                key,value=line.split('=',1)
                if key.strip() in {'OCR_API_URL','OCR_WORKER_KEY','OCR_DEVICE','OCR_DET_MODEL'}:
                    os.environ.setdefault(key.strip(),value.strip().strip('"').strip("'"))
    url=os.environ.get('OCR_API_URL','http://localhost:4000').rstrip('/')
    key=os.environ.get('OCR_WORKER_KEY','')
    parsed=urlparse(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/') or not parsed.hostname:
        raise ValueError('OCR_API_URL must be an origin without credentials or a path.')
    if parsed.scheme!='https' and not (parsed.scheme=='http' and parsed.hostname in {'localhost','127.0.0.1','::1'}):
        raise ValueError('Use HTTPS, or localhost HTTP for development.')
    if len(key)<32: raise ValueError('Set OCR_WORKER_KEY (at least 32 characters).')
    return url,key

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

def send(url,key,path,body):
    request=Request(url+'/api/worker/transcripts'+path,data=json.dumps(body).encode(),
        headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='POST')
    with build_opener(NoRedirect()).open(request,timeout=35) as response:
        raw=response.read(8*1024*1024+1)
        if len(raw)>8*1024*1024: raise ValueError('Response too large')
        return json.loads(raw)

def parse_pdf(pdf_path,result_path):
    import pymupdf
    from test_ocr import Options, extract_transcript, DEFAULT_REC_MODEL
    result={}
    try:
        if pdf_path.stat().st_size>5*1024*1024: raise ValueError('invalid_pdf')
        with ExitStack() as stack:
            document=stack.enter_context(pymupdf.open(pdf_path))
            if not document.is_pdf: raise ValueError('invalid_pdf')
            if document.needs_pass: raise ValueError('encrypted_pdf')
            if not 1<=len(document)<=20: raise ValueError('too_many_pages')
            # Bound raster allocation for malformed/oversized PDF canvases at 150 DPI.
            if any(p.rect.width<=0 or p.rect.height<=0 or p.rect.width*p.rect.height*(150/72)**2>10_000_000 for p in document):
                raise ValueError('unsupported_layout')
            model_dir=DEFAULT_REC_MODEL
            # Paddle's Windows native loader cannot open Unicode model paths.
            if os.name=='nt' and not str(model_dir).isascii():
                model_dir=Path(stack.enter_context(tempfile.TemporaryDirectory(prefix='edupath-model-')))
                if not str(model_dir).isascii():
                    raise ValueError('ASCII temporary directory required for Paddle on Windows')
                for name in ('inference.json','inference.pdiparams','inference.yml'):
                    shutil.copyfile(DEFAULT_REC_MODEL/name,model_dir/name)
            options=Options(device=os.environ.get('OCR_DEVICE','cpu'),det_model=os.environ.get('OCR_DET_MODEL','PP-OCRv5_mobile_det'),rec_model_dir=model_dir)
            result={'result':extract_transcript(document,'transcript.pdf',options,log=lambda _:None)}
    except ValueError as error:
        code=str(error)
        result={'error':code if code in {'invalid_pdf','encrypted_pdf','too_many_pages','unsupported_layout'} else 'ocr_failed'}
    except Exception:
        result={'error':'ocr_failed'}
    result_path.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')

def process_job(job):
    with tempfile.TemporaryDirectory(prefix='edupath-ocr-') as directory:
        pdf=Path(directory)/'input.pdf'; result=Path(directory)/'result.json'
        payload=base64.b64decode(job['pdf'],validate=True)
        if not 8<=len(payload)<=5*1024*1024: return {'error':'invalid_pdf'}
        pdf.write_bytes(payload)
        # Each task has its own process: a hard timeout frees Paddle memory, including after failures.
        child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--parse',str(pdf),str(result)],
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
            env={**os.environ,'PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK':'True'})
        try:
            child.wait(timeout=300)
        except subprocess.TimeoutExpired:
            if os.name=='nt':
                subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            child.kill(); child.wait()
            return {'error':'parse_timeout'}
        except BaseException:
            if os.name=='nt':
                subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            child.kill(); child.wait()
            raise
        if child.returncode or not result.exists() or result.stat().st_size>1_900_000:
            return {'error':'ocr_failed'}
        return json.loads(result.read_text(encoding='utf-8'))

def run(once=False):
    url,key=read_config()
    stop=threading.Event()
    def heartbeat():
        while not stop.wait(20):
            try: send(url,key,'/heartbeat',{})
            except (OSError,ValueError): pass
    threading.Thread(target=heartbeat,daemon=True).start()
    print('Worker ready. Keep this process running to receive transcript jobs.',flush=True)
    try:
        while True:
            try:
                job=send(url,key,'/claim',{}).get('job')
                if job:
                    print('Processing PDF: text layer first, OCR when needed.',flush=True)
                    result=process_job(job)
                    for attempt in range(3):
                        try:
                            send(url,key,'/'+job['id']+'/complete',{'leaseToken':job['leaseToken'],**result})
                            print('Result delivered.' if 'result' in result else 'Processing failed; status delivered.',flush=True)
                            break
                        except HTTPError as error:
                            if error.code==409:
                                print('Task cancelled or lease expired; result discarded.',flush=True);break
                            if attempt==2: raise
                            time.sleep(3)
                        except (URLError,TimeoutError):
                            if attempt==2: raise
                            time.sleep(3)
                if once: break
                if not job: time.sleep(5)
            except (OSError,ValueError,KeyError) as error:
                print('Backend unavailable or configuration invalid; retry in 15 seconds. '+
                    (f'HTTP {error.code}.' if isinstance(error,HTTPError) else type(error).__name__),flush=True)
                if once: raise SystemExit(1)
                time.sleep(15)
    finally: stop.set()

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--parse',nargs=2,metavar=('PDF','RESULT'))
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args()
    if args.parse: parse_pdf(Path(args.parse[0]),Path(args.parse[1]))
    else:
        try: run(args.once)
        except KeyboardInterrupt: print('Worker stopped.')
