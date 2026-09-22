import { parentPort, workerData } from 'node:worker_threads';
import XLSX from 'xlsx';
import JSZip from 'jszip';
function checkZip(b) {
  let end = -1;
  for (let i=b.length-22;i>=Math.max(0,b.length-65557);i--) if(b.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0) throw Error('invalid_workbook');
  let offset=b.readUInt32LE(end+16), total=0;
  const count=b.readUInt16LE(end+10);
  if(count>3000) throw Error('workbook_too_large');
  for(let n=0;n<count;n++){
    if(offset+46>b.length || b.readUInt32LE(offset)!==0x02014b50) throw Error('invalid_workbook');
    total+=b.readUInt32LE(offset+24);
    if(total>30*1024*1024) throw Error('workbook_too_large');
    offset+=46+b.readUInt16LE(offset+28)+b.readUInt16LE(offset+30)+b.readUInt16LE(offset+32);
  }
}
try {
  const buffer=Buffer.from(workerData.buffer), files=[];
  if(workerData.filename.toLowerCase().endsWith('.zip')){
    checkZip(buffer);
    const zip=await JSZip.loadAsync(buffer);
    const entries=Object.values(zip.files).filter(f=>!f.dir && /\.xlsx?$/i.test(f.name));
    if(!entries.length || entries.length>30) throw Error('invalid_workbook');
    for(const entry of entries) files.push({name:entry.name.split('/').pop(),buffer:await entry.async('nodebuffer')});
  } else files.push({name:workerData.filename,buffer});
  const sheets=[];
  for(const file of files){
    if(file.buffer.length>5*1024*1024) throw Error('workbook_too_large');
    const zip=file.buffer.subarray(0,2).toString()==='PK';
    if(zip) checkZip(file.buffer);
    else if(file.buffer.subarray(0,8).toString('hex')!=='d0cf11e0a1b11ae1') throw Error('invalid_workbook');
    const wb=XLSX.read(file.buffer,{cellFormula:false,cellHTML:false,cellStyles:false});
    if(wb.SheetNames.length>50) throw Error('workbook_too_large');
    for(const name of wb.SheetNames){
      const ws=wb.Sheets[name]; if(!ws?.['!ref']) continue;
      const range=XLSX.utils.decode_range(ws['!ref']);
      if(range.e.r>3500 || range.e.c>100) throw Error('workbook_too_large');
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true,range:0});
      sheets.push({workbook:file.name,sheet:name,rows});
    }
  }
  parentPort.postMessage({sheets});
} catch(e) {parentPort.postMessage({error:e.message});}
