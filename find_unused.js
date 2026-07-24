const fs=require('fs');
const path=require('path');
const src=path.join(__dirname,'src');
const files=[];
function walk(d){try{fs.readdirSync(d,{withFileTypes:true}).forEach(e=>{const f=path.join(d,e.name);if(e.name!=='node_modules'&&e.name!=='.next'){if(e.isDirectory())walk(f);else if(e.name.endsWith('.ts')||e.name.endsWith('.tsx'))files.push(f)}}) }catch(e){}}
walk(src);
const im={};
files.forEach(file=>{const c=fs.readFileSync(file,'utf8');const re=/from\s+[''"]@\/components\/([^\x27\x22]+)[\x27\x22]/g;let m;while((m=re.exec(c))!==null){const comp=m[1].split('/')[0];if(!im[comp])im[comp]=[];im[comp].push(file)}});
const comps=[];
function walkC(d){try{fs.readdirSync(d,{withFileTypes:true}).forEach(e=>{const f=path.join(d,e.name);if(e.isDirectory())walkC(f);else if((e.name.endsWith('.tsx')||e.name.endsWith('.ts'))&&!e.name.match(/\.test\./)){comps.push(e.name.replace(/\.tsx?$/,'').replace(/\/index$/,''))}}) }catch(e){}}
walkC(path.join(src,'components'));
console.log('=== UNUSED COMPONENTS ===');
let u=0;comps.forEach(c=>{if(!im[c]){console.log('  - '+c);u++}});console.log('\nTotal: '+u);
