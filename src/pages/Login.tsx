import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast, Toaster } from "sonner";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { useWorkbench } from "@/state/workbench";
import { connectLocalApi, connectCasdoorApi, localApiBase, clearLocalApiSession } from "@/lib/localApi";
export default function Login() {
  const { state, dispatch } = useWorkbench();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible,setVisible]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState("");
  const [identity,setIdentity]=useState<{enabled:boolean;login_url:string}|null>(null);
  useEffect(()=>{if(error)toast.error(error,{id:"signin-error"});},[error]);
  function startIdentityLogin(loginUrl:string){
    window.location.replace(localApiBase+loginUrl+(localStorage.getItem("presales-require-login")?"?fresh=1":""));
  }
  useEffect(()=>{
    let cancelled=false;
    const query=new URLSearchParams(window.location.search);
    const failure=query.get("login_error");
    const finish=query.has("casdoor");
    const messages:Record<string,string>={unassigned:"账号尚未分配工作台岗位，请联系管理员",unavailable:"登录服务暂时不可用，请稍后重试",expired:"登录页面已过期，请重新登录",failed:"登录失败，请重试"};
    async function enter(){
      try {
        const response=await fetch(`${localApiBase}/api/auth/config`);
        if(!response.ok)throw new Error("无法连接登录服务");
        const config=await response.json();
        if(cancelled)return;
        setIdentity(config);
        if(failure){clearLocalApiSession();setError(messages[failure]||messages.failed);window.history.replaceState(null,"","/");return;}
        if(!config.enabled)return;
        setSubmitting(true);
        if(finish||!localStorage.getItem("presales-require-login")){
          try {
            const account=await connectCasdoorApi();
            if(cancelled)return;
            dispatch({type:"login",username:account,password:"",serverVerified:true});navigate("/",{replace:true});return;
          } catch(error){if(finish)throw error;}
        }
        if(!cancelled)startIdentityLogin(config.login_url);
      } catch(error){if(!cancelled){setError(error instanceof Error?error.message:"登录失败，请重试");window.history.replaceState(null,"","/");}}
      finally {if(!cancelled)setSubmitting(false);}
    }
    void enter();
    return()=>{cancelled=true;};
  },[dispatch,navigate]);
  if(!identity || identity.enabled) return <>
    <Toaster position="top-center" richColors closeButton duration={5000}/>
    <main className="signin"><div className="signin-logo"><BrandMark size={40}/><span>售前工作台</span></div>
      {error?<section><h1>登录暂未完成</h1><p>{error}</p><button className="btn primary full" onClick={()=>identity?.enabled?startIdentityLogin(identity.login_url):window.location.reload()}>重新登录<ArrowRight size={17}/></button></section>:<p role="status">正在登录…</p>}
    </main>
  </>;
  return (
    <>
      <Toaster position="top-center" richColors closeButton duration={5000} />
    <main className="signin">

      <div className="signin-logo">
        <BrandMark size={40} />
        <span>售前工作台</span>
      </div>
      <section>
        <div className="signin-heading"><p>为每一次交付，做好准备。</p><h1>欢迎回来</h1><span>登录你的售前工作空间</span></div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSubmitting(true);setError("");
            try {
              await connectLocalApi(username.trim(), password);
              dispatch({ type: "login", username, password, serverVerified: true });
              navigate("/");
            } catch (e) {
              clearLocalApiSession();
              setError(e instanceof Error ? e.message : "登录失败，请重试");
            } finally {setSubmitting(false);}

          }}
        >
          <label>
            账号
            <input
              required
              placeholder="输入工作账号"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            密码
            <div className="signin-password"><input
              placeholder="输入密码"
              required
              type={visible?"text":"password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            /><button type="button" aria-label={visible?"隐藏密码":"显示密码"} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>
          </label>

          {state.permissionNotice && (
            <p role="alert">{state.permissionNotice}</p>
          )}
          <button className="btn primary full" type="submit" disabled={submitting}>
            {submitting?<LoaderCircle size={17} className="spin"/>:"进入工作空间"}{!submitting&&<ArrowRight size={17}/>}
          </button>
        </form>
      </section>
    </main>
    </>
  );
}
