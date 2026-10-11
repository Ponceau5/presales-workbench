import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { useWorkbench } from "@/state/workbench";
import { authenticate } from "@/lib/accounts";
import { connectLocalApi, clearLocalApiSession } from "@/lib/localApi";
export default function Login() {
  const { state, dispatch } = useWorkbench();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible,setVisible]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  return (
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
            if (!authenticate(username, password)) {
              dispatch({ type: "login", username, password });
              return;
            }
            setSubmitting(true);
            try {
              await connectLocalApi(username.trim(), password);
            } catch {
              // The browser-only mock stays usable without the optional local API.
              clearLocalApiSession();
            }
            setSubmitting(false);
            dispatch({ type: "login", username, password });
            navigate("/");
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
  );
}
