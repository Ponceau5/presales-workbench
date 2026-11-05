export class ConversationPrompt extends Error {readonly kind="prompt";}
export function responseIssue(body:{detail?:unknown},fallback="请求失败"):Error{
 const detail=body.detail;
 if(detail&&typeof detail==="object"&&"kind" in detail&&detail.kind==="prompt"&&"message" in detail)return new ConversationPrompt(String(detail.message));
 return new Error(typeof detail==="string"?detail:fallback);
}
