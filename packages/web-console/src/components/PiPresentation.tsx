// pi-agent-dashboard uses Material Design Icons and Prism for these surfaces.
import { Fragment, type ReactNode } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-markdown.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-yaml.js';

export function codeLanguage(path?:string):string|undefined {
 const ext=path?.split('.').at(-1)?.toLowerCase();
 return ext ? ({js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',json:'json',md:'markdown',py:'python',sh:'bash',bash:'bash',yml:'yaml',yaml:'yaml',html:'markup',xml:'markup',css:'css'} as Record<string,string>)[ext] : undefined;
}
export function highlightedCode(text:string,language?:string):ReactNode {
 if(!language || !Prism.languages[language]) return text;
 function render(token: string | Prism.Token, key:number):ReactNode {
  if(typeof token==='string') return <Fragment key={key}>{token}</Fragment>;
  const value=typeof token.content==='string' ? token.content : Array.isArray(token.content) ? token.content.map(render) : render(token.content,0);
  return <span key={key} className={`token pi-token-${token.type}`}>{value}</span>;
 }
 // React renders text tokens, never interpolated HTML from file contents.
 return Prism.tokenize(text,Prism.languages[language]).map(render);
}

export function highlightedLines(text:string,language?:string): ReactNode[][] {
 const lines: ReactNode[][]=[[]];
 function visit(token:string|Prism.Token, classes:string[]=[]) {
  if(typeof token !== 'string') {
   const nested=[...classes,'token',`pi-token-${token.type}`];
   if(Array.isArray(token.content)) token.content.forEach(part=>visit(part,nested)); else visit(token.content,nested);
   return;
  }
  token.split('\n').forEach((part,index)=>{
   if(index) lines.push([]);
   if(part) lines.at(-1)!.push(classes.length ? <span key={lines.at(-1)!.length} className={classes.join(' ')}>{part}</span> : part);
  });
 }
 const tokens=language && Prism.languages[language] ? Prism.tokenize(text,Prism.languages[language]) : [text];
 tokens.forEach(token=>visit(token));
 return lines;
}
