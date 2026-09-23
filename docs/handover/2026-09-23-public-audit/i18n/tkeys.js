const fs=require('fs'),path=require('path');const pl=require('/workspace/pracujbe/src/messages/pl.json');
const get=k=>k.split('.').reduce((o,p)=>o&&o[p],pl);
const files=[];const walk=d=>{for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(fs.statSync(p).isDirectory())walk(p);else if(/\.tsx?$/.test(f))files.push(p);}};walk('/workspace/pracujbe/src');
let checked=0;const miss=[];
for(const f of files){const s=fs.readFileSync(f,'utf8');
 const vars={};const re=/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([\w.]*)'|\{[^}]*namespace:\s*'([\w.]*)'[^}]*\}|\{\s*locale[^}]*\})?\s*\)/g;let m;
 while((m=re.exec(s)))vars[m[1]]=m[2]??m[3]??'';
 // destructured Promise.all
 const re2=/\[([\w\s,]+)\]\s*=\s*await\s+Promise\.all\(\[([\s\S]*?)\]\)/g;while((m=re2.exec(s))){const names=m[1].split(',').map(x=>x.trim());const calls=[...m[2].matchAll(/(?:getTranslations|useTranslations)\(\s*(?:'([\w.]*)'|\{[^}]*namespace:\s*'([\w.]*)'[^}]*\})?/g)];names.forEach((n,i)=>{if(calls[i])vars[n]=calls[i][1]??calls[i][2]??''})}
 for(const [v,ns] of Object.entries(vars)){const r=new RegExp(`\\b${v}(?:\\.(?:rich|markup|raw|has))?\\(\\s*'([\\w.]+)'`,'g');let k;while((k=r.exec(s))){checked++;const full=ns?ns+'.'+k[1]:k[1];if(get(full)===undefined)miss.push(f.replace('/workspace/pracujbe/','')+': '+v+"('"+k[1]+"') -> "+full);}}
}
console.log('checked',checked);console.log(miss.join('\n'));
