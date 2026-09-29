import { useState } from "react";
import { useNavigate } from "react-router";
import { Layers3 } from "lucide-react";
import { useWorkbench } from "@/state/workbench";
export default function Login() {
  const { state, dispatch } = useWorkbench();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <main className="signin">
      <div className="signin-logo">
        <Layers3 size={25} />
        <span>售前工作台</span>
      </div>
      <section>
        <h1>登录工作空间</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            dispatch({ type: "login", username, password });
            navigate("/");
          }}
        >
          <label>
            账号
            <input
              required
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            密码
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {state.permissionNotice && (
            <p role="alert">{state.permissionNotice}</p>
          )}
          <button className="btn primary full" type="submit">
            登录
          </button>
        </form>
      </section>
    </main>
  );
}
