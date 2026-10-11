import { marked, type Token } from "@/lib/vendor/marked";
import type { ReactNode } from "react";
type InlineTokens={tokens?:Token[]};
function nodes(tokens:Token[]|undefined):ReactNode {return (tokens??[]).map((t,i)=>{switch(t.type){
case "heading":return <div key={i} className={"gsa-md-heading level-"+t.depth}>{nodes(t.tokens)}</div>;
case "paragraph":return <p key={i}>{nodes(t.tokens)}</p>;
case "text":return <span key={i}>{"tokens" in t&&t.tokens?nodes(t.tokens):t.text}</span>;
case "strong":return <strong key={i}>{nodes(t.tokens)}</strong>;
case "em":return <em key={i}>{nodes(t.tokens)}</em>;
case "del":return <del key={i}>{nodes(t.tokens)}</del>;
case "codespan":return <code key={i}>{t.text}</code>;
case "code":return <pre key={i}><code>{t.text}</code></pre>;
case "list":{const items=t.items.map((item:InlineTokens,j:number)=><li key={j}>{nodes(item.tokens)}</li>);return t.ordered?<ol key={i} start={t.start||1}>{items}</ol>:<ul key={i}>{items}</ul>;}
case "blockquote":return <blockquote key={i}>{nodes(t.tokens)}</blockquote>;
case "table":return <div key={i} className="gsa-md-table"><table><thead><tr>{t.header.map((c:InlineTokens,j:number)=><th key={j}>{nodes(c.tokens)}</th>)}</tr></thead><tbody>{t.rows.map((row:InlineTokens[],j:number)=><tr key={j}>{row.map((c:InlineTokens,k:number)=><td key={k}>{nodes(c.tokens)}</td>)}</tr>)}</tbody></table></div>;
case "link":return /^https?:\/\//i.test(t.href)?<a key={i} href={t.href} target="_blank" rel="noreferrer">{nodes(t.tokens)}</a>:<span key={i}>{nodes(t.tokens)}</span>;
case "br":return <br key={i}/>;case "hr":return <hr key={i}/>;case "space":return null;
default:return <span key={i}>{"text" in t?String(t.text):t.raw}</span>;
}});}
export function MarkdownReply({text}:{text:string}){return <div className="gsa-markdown">{nodes(marked.lexer(text.replace(/\*\*([^*\n]+[：:])\*\*(?=[\u3400-\u9fffA-Za-z0-9])/g,"**$1** "),{gfm:true,breaks:true}))}</div>;}
