import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const files=['README.md','LICENSE-STATUS.md','THIRD_PARTY_NOTICES.md',...readdirSync('docs').filter(n=>n.endsWith('.md')).map(n=>'docs/'+n)];
const failures=[];
for(const file of files){
 const text=readFileSync(file,'utf8');
 for(const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
  const target=match[1].split('#')[0];
  if(!target||/^(https?:|mailto:)/.test(target))continue;
  if(!existsSync(resolve(dirname(file),decodeURIComponent(target))))failures.push(`${file}: missing ${target}`);
 }
 if(/[A-Z]:[\\/](Users|Program Files)/i.test(text))failures.push(`${file}: machine-specific path`);
}
if(failures.length)throw Error(failures.join('\n'));
console.log(`Verified local links in ${files.length} Markdown documents.`);
