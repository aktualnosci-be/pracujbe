const ts=require('/workspace/pracujbe/node_modules/typescript');const fs=require('fs');const path=require('path');
const roots=process.argv.slice(2);const files=[];
const walk=d=>{if(fs.statSync(d).isFile()){files.push(d);return;}for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(fs.statSync(p).isDirectory())walk(p);else if(/\.tsx?$/.test(f)&&!/\.test\./.test(f))files.push(p);}};
roots.forEach(r=>{try{walk(r)}catch{}});
const IGN=new Set(['className','href','src','type','id','name','rel','target','role','as','variant','size','key','method','autoComplete','inputMode','htmlFor','lang','hrefLang','sizes','data-testid','side','align','mode','strategy','loading','fetchPriority','decoding','dir','property','content','crossOrigin','form','pattern','viewBox','d','fill','stroke','xmlns','aria-hidden','aria-live','aria-current','aria-haspopup','aria-controls','aria-describedby','aria-labelledby','tabIndex','enterKeyHint','scope','charSet','itemProp','itemType','encType','action','accept','defaultValue','value','prefetch','locale','orientation','position','namespace','icon','tone','fillRule','clipRule','strokeWidth','strokeLinecap','strokeLinejoin']);
for(const f of files){const src=fs.readFileSync(f,'utf8');const sf=ts.createSourceFile(f,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const rep=(n,kind,t)=>{const {line}=sf.getLineAndCharacterOfPosition(n.getStart());console.log(`${f.replace('/workspace/pracujbe/','')}:${line+1} [${kind}] ${JSON.stringify(t).slice(0,90)}`)};
 const v=n=>{
  if(ts.isJsxText(n)){const t=n.text.trim();if(/[A-Za-zÀ-ž]{2,}/.test(t)&&t!=='Pracuj.be')rep(n,'jsxtext',t);}
  if(ts.isJsxAttribute(n)&&n.initializer){const nm=n.name.getText();const init=n.initializer;let s=null;
   if(ts.isStringLiteral(init))s=init.text;else if(ts.isJsxExpression(init)&&init.expression&&(ts.isStringLiteral(init.expression)||ts.isNoSubstitutionTemplateLiteral(init.expression)))s=init.expression.text;
   if(s&&!IGN.has(nm)&&/[A-Za-zÀ-ž]{3,}/.test(s)&&s!=='Pracuj.be'&&!/^[a-z0-9_.\-\/:#?=&]+$/.test(s))rep(n,'attr '+nm,s);}
  if((ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))&&/\s/.test(n.text)&&/[A-Za-zÀ-ž]{3,}\s+[A-Za-zÀ-ž]{3,}/.test(n.text)&&!ts.isImportDeclaration(n.parent)&&!(ts.isJsxAttribute(n.parent))&&!/^(use |[a-z-]+:|.*\b(flex|grid|px-|py-|text-|bg-|rounded|border|h-|w-|gap-)\b)/.test(n.text)){
   const p=n.parent; if(!(ts.isCallExpression(p)&&/^(t|cn|clsx|cva|console\.\w+|Error|new Error|throw)$/.test(p.expression.getText()))) rep(n,'str',n.text);}
  ts.forEachChild(n,v)};v(sf);}
