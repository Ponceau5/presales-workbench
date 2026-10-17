import { marked, type Token } from "@/lib/vendor/marked";
import {useEffect,useState,type ReactNode} from "react";
import {localApiBase} from "@/lib/localApi";
export function SourceFigure({src,label}:{src:string;label:string}){const [url,setUrl]=useState('');useEffect(()=>{if(!/^\/api\/documents\/[a-zA-Z0-9_-]+\/figures\/[1-4]$/.test(src))return;const controller=new AbortController();let objectUrl='';void fetch(localApiBase+src,{headers:{Authorization:'Bearer '+sessionStorage.getItem('presales-local-api-token')},signal:controller.signal}).then(async response=>{if(response.ok){objectUrl=URL.createObjectURL(await response.blob());setUrl(objectUrl);}}).catch(()=>{});return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};},[src]);return url?<figure className="source-figure"><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={label}/></a><figcaption>{label}</figcaption></figure>:null;}
type InlineTokens={tokens?:Token[]};
function nodes(tokens:Token[]|undefined):ReactNode {return (tokens??[]).map((t,i)=>{switch(t.type){
case "heading":return <div key={i} className={"gsa-md-heading level-"+t.depth}>{nodes(t.tokens)}</div>;
case "paragraph":return t.tokens?.some(v=>v.type==="image")?<div key={i}>{nodes(t.tokens)}</div>:<p key={i}>{nodes(t.tokens)}</p>;
case "text":return <span key={i}>{"tokens" in t&&t.tokens?nodes(t.tokens):t.text}</span>;
case "strong":return <strong key={i}>{nodes(t.tokens)}</strong>;
case "em":return <em key={i}>{nodes(t.tokens)}</em>;
case "del":return <del key={i}>{nodes(t.tokens)}</del>;
case "codespan":return <code key={i}>{t.text}</code>;
case "code":return <pre key={i}><code>{t.text}</code></pre>;
case "list":{const items=t.items.map((item:InlineTokens,j:number)=><li key={j}>{nodes(item.tokens)}</li>);return t.ordered?<ol key={i} start={t.start||1}>{items}</ol>:<ul key={i}>{items}</ul>;}
case "blockquote":return <blockquote key={i}>{nodes(t.tokens)}</blockquote>;
case "table":return <div key={i} className="gsa-md-table"><table><thead><tr>{t.header.map((c:InlineTokens,j:number)=><th key={j}>{nodes(c.tokens)}</th>)}</tr></thead><tbody>{t.rows.map((row:InlineTokens[],j:number)=><tr key={j}>{row.map((c:InlineTokens,k:number)=><td key={k}>{nodes(c.tokens)}</td>)}</tr>)}</tbody></table></div>;
case "image":return <SourceFigure key={i} src={t.href} label={t.text||"来源图片"}/>;
case "link":return /^https?:\/\//i.test(t.href)?<a key={i} href={t.href} target="_blank" rel="noreferrer">{nodes(t.tokens)}</a>:<span key={i}>{nodes(t.tokens)}</span>;
case "br":return <br key={i}/>;case "hr":return <hr key={i}/>;case "space":return null;
default:return <span key={i}>{"text" in t?String(t.text):t.raw}</span>;
}});}
export function MarkdownReply({text}:{text:string}){return <div className="gsa-markdown">{nodes(marked.lexer(text.replace(/\*\*([^*\n]+[：:])\*\*(?=[\u3400-\u9fffA-Za-z0-9])/g,"**$1** "),{gfm:true,breaks:true}))}</div>;}
