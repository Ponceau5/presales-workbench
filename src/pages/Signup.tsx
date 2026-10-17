import {useState} from 'react';
import {useNavigate} from 'react-router';
import {ArrowRight,Eye,EyeOff,LoaderCircle} from 'lucide-react';
import {BrandMark} from '@/components/BrandMark';
import {connectCasdoorApi,localApiBase} from '@/lib/localApi';
import {useWorkbench} from '@/state/workbench';
const roles=[['admin','系统管理员'],['sales','销售'],['solution','解决方案'],['hardware','硬件产品'],['software','软件产品'],['commercial','商务支持'],['finance','财务 / 风控'],['logistics','货运关务'],['dev','研发'],['legal','认证 / 法务']];
export default function Signup(){
 const {dispatch}=useWorkbench(),navigate=useNavigate();
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[role,setRole]=useState('admin'),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <main className="signin signup-page"><div className="signin-logo"><BrandMark size={38}/><span>售前工作台</span></div><section><div className="signin-heading"><p>为每一次交付，做好准备。</p><h1>创建试用账号</h1><span>设置账号密码，开始使用售前工作台</span></div><form onSubmit={async e=>{e.preventDefault();if(password!==confirm){setError('两次输入的密码不一致');return;}setBusy(true);setError('');try{const response=await fetch(localApiBase+'/api/auth/register',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username.trim(),password,confirm_password:confirm,role})});const result=await response.json();if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'请检查用户名和密码');const account=await connectCasdoorApi();dispatch({type:'login',username:account,password:'',serverVerified:true});localStorage.removeItem('presales-require-login');navigate('/',{replace:true});}catch(e){setError(e instanceof Error?e.message:'注册失败，请重试');}finally{setBusy(false);}}}>
 <label>用户名<input autoComplete="username" required pattern="[a-zA-Z][a-zA-Z0-9_-]{2,39}" maxLength={40} value={username} onChange={e=>setUsername(e.target.value)} placeholder="3–40 位字母、数字、下划线或短横线"/></label>
 <label>密码<div className="signin-password"><input autoComplete="new-password" type={visible?'text':'password'} required minLength={6} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder="至少 6 位"/><button type="button" aria-label={visible?'隐藏密码':'显示密码'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label>
 <label>确认密码<input autoComplete="new-password" type={visible?'text':'password'} required minLength={6} maxLength={128} value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="再次输入密码"/></label>
 <label>试用角色<select aria-label="试用角色" value={role} onChange={e=>setRole(e.target.value)}>{roles.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><p className="signup-role-note">{role==='admin'?'系统管理员可操作和管理全部项目与工作区。':'按所选岗位使用工作区，项目范围由管理员分配。'}</p>
 {error&&<p role="alert">{error}</p>}<button className="btn primary full" disabled={busy}>{busy?<LoaderCircle size={17} className="spin"/>:<>创建账号并进入<ArrowRight size={17}/></>}</button><a className="signup-back" href="/">已有账号，返回登录</a></form></section></main>;
}
