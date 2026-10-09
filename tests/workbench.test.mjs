import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
// Transpile only the domain modules, with the project's existing TypeScript dependency.
function moduleUrl(file, imports = {}) {
  let code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  for (const [name, url] of Object.entries(imports))
    code = code
      .replaceAll(`'${name}'`, JSON.stringify(url))
      .replaceAll(`"${name}"`, JSON.stringify(url));
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const dataUrl = moduleUrl("src/lib/presales.ts");
const stagesUrl = moduleUrl("src/lib/stages.ts");
const portfolioUrl = moduleUrl("src/lib/portfolio.ts");
const workspaceUrl = moduleUrl("src/lib/workspace.ts");
const accountsUrl = moduleUrl("src/lib/accounts.ts", {
  "@/lib/workspace": workspaceUrl,
});
const workflowEngineUrl = moduleUrl("src/lib/workflowEngine.ts", {
  "./accounts": accountsUrl,
});
const { defaultSettings, testLiveConnection, loadSettings, saveSettings } =
  await import(dataUrl);
const {
  domainReducer: reducer,
  reducer: authenticatedReducer,
  permitted,
  initialState,
  canWrite,
} = await import(
  moduleUrl("src/state/workbench.ts", {
    "@/lib/collaboration": moduleUrl("src/lib/collaboration.ts", {
      "./workflowEngine": workflowEngineUrl,
    }),
    "@/lib/workflowEngine": workflowEngineUrl,
    "@/lib/demoReview": moduleUrl("src/lib/demoReview.ts", {
      "./presales": dataUrl,
    }),
    "@/lib/projectStages": moduleUrl("src/lib/projectStages.ts", {
      "./stages": stagesUrl,
      "./portfolio": portfolioUrl,
    }),
    "@/lib/presales": dataUrl,
    "@/lib/stages": stagesUrl,
    "@/lib/workspace": workspaceUrl,
    "@/lib/portfolio": portfolioUrl,
    "@/lib/accounts": accountsUrl,
    "@/lib/referenceReview": moduleUrl("src/lib/referenceReview.ts"),
    react: pathToFileURL(`${process.cwd()}/node_modules/react/index.js`).href,
  })
);
const actor = "演示软件评审人";
const note = "已核对合成来源，保留缺项与承诺边界";
function generated() {
  return reducer(initialState(defaultSettings), { type: "finish" });
}
function ready() {
  let s = generated();
  for (const id of ["Q-01", "Q-02"])
    s = reducer(s, {
      type: "respond",
      id,
      text: "合成答复，按已有平台索引，条件待复核",
      evidence: "合成澄清 V1 · 软件产品",
      actor,
    });
  s = reducer(s, { type: "model", actor });
  for (const r of s.rows)
    s = reducer(s, {
      type: "review",
      id: r.id,
      action: "approve",
      actor,
      note,
    });
  assert.ok(canWrite(s));
  return s;
}
test("高风险未澄清时拒绝批准与写回，不能仅改变应答文本绕过门槛", () => {
  let s = generated();
  s = reducer(s, {
    type: "review",
    id: "A-04",
    action: "edit",
    text: "满足",
    actor,
    note,
  });
  s = reducer(s, {
    type: "review",
    id: "A-04",
    action: "approve",
    actor,
    note,
  });
  assert.equal(s.rows.find((r) => r.id === "A-04").status, "waiting");
  assert.equal(canWrite(s), false);
  assert.equal(reducer(s, { type: "write", actor }).facts.length, 0);
  assert.equal(
    reducer(s, {
      type: "respond",
      id: "Q-01",
      text: "答复",
      evidence: "",
      actor,
    }).clarified["Q-01"],
    undefined,
  );
});
test("完整人审写回保留 11 条工件，未验证服务器演算不成为有效规格事实", () => {
  const s = reducer(ready(), { type: "write", actor });
  assert.equal(s.facts.length, 11);
  assert.ok(s.facts.every((r) => r.artifact !== "server"));
  assert.equal(s.audit[0].action, "write");
});
test("V7 只撤销视频关联工件，保留未受影响的批准与事实，澄清和模型确认失效", () => {
  let s = reducer(ready(), { type: "write", actor });
  s = reducer(s, { type: "change", id: "D-01", status: "reviewing" });
  assert.equal(s.sourceVersion, 7);
  assert.equal(s.clarified["Q-01"], undefined);
  assert.equal(s.modelConfirmed, false);
  assert.equal(s.rows.find((r) => r.id === "A-04").status, "waiting");
  assert.equal(s.rows.find((r) => r.id === "A-02").status, "approved");
  assert.equal(s.facts.length, 8);
  assert.equal(canWrite(s), false);
});
test("修改和新答复撤销旧有效事实，结构化记录保留修改前后文本", () => {
  const written = reducer(ready(), { type: "write", actor });
  const edited = reducer(written, {
    type: "review",
    id: "A-02",
    action: "edit",
    text: "更正后的合成应答",
    actor,
    note,
  });
  assert.ok(!edited.facts.some((r) => r.id === "A-02"));
  assert.notEqual(edited.audit[0].before, edited.audit[0].after);
  assert.equal(edited.audit[0].previousStatus, "approved");
  const answered = reducer(written, {
    type: "respond",
    id: "Q-01",
    text: "新版答复",
    evidence: "合成澄清 V2",
    actor,
  });
  assert.ok(answered.facts.every((r) => r.req !== "REQ-04"));
});
test("驳回后局部重生成，未受影响批准不变，驳回意见进入复核关注", () => {
  let s = ready();
  s = reducer(s, {
    type: "review",
    id: "A-02",
    action: "reject",
    actor,
    note: "补充 TLS 适用边界",
  });
  s = reducer(s, { type: "start", ids: ["A-02"] });
  s = reducer(s, { type: "finish", ids: ["A-02"] });
  assert.equal(s.rows.find((r) => r.id === "A-01").status, "approved");
  assert.equal(s.rows.find((r) => r.id === "A-02").status, "waiting");
  assert.match(s.rows.find((r) => r.id === "A-02").text, /TLS 适用边界/);
});
test("全链路环节具有生成、答复、评审、写回及局部变更状态", () => {
  let s = initialState(defaultSettings);
  for (const id of Object.keys(s.stageStates)) {
    const action = (kind, extra = {}) => {
      s = reducer(s, { type: "stage", id, kind, actor, note, ...extra });
    };
    action("generate");
    action("write");
    assert.equal(s.stageStates[id].written, false);
    action("respond", {
      text: "已确认缺项作为待办保留，不生成专业结论",
      evidence: "合成确认记录 V1",
    });
    for (let index = 0; index < s.stageStates[id].rows.length; index++)
      action("approve", { index });
    action("write");
    assert.equal(s.stageStates[id].written, true);
    action("change");
    assert.equal(s.stageStates[id].rows[0].status, "waiting");
    assert.equal(s.stageStates[id].rows[1].status, "approved");
    assert.equal(s.stageStates[id].written, false);
    action("assign");
    assert.equal(s.stageStates[id].assigned, true);
  }
});
test("连接偏好不持久化 Key 或直连许可，迁移时删除旧密钥存储", () => {
  const memory = new Map([["presales-workbench-settings-v1", "old-secret"]]);
  globalThis.localStorage = {
    getItem: (k) => memory.get(k),
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
  };
  saveSettings({
    ...defaultSettings,
    apiKey: "synthetic-test-key",
    allowBrowserKey: true,
  });
  assert.ok(
    ![...memory.values()].some((v) => v.includes("synthetic-test-key")),
  );
  assert.equal(loadSettings().apiKey, "");
  assert.equal(loadSettings().allowBrowserKey, false);
  assert.equal(memory.has("presales-workbench-settings-v1"), false);
  delete globalThis.localStorage;
});
test("连接测试拒绝不安全地址；兼容返回只显示固定摘要，不泄露响应", async () => {
  globalThis.window = globalThis;
  const s = {
    ...defaultSettings,
    mode: "live",
    allowBrowserKey: true,
    model: "test-model",
    apiKey: "synthetic-test-key",
  };
  await assert.rejects(
    testLiveConnection({ ...s, baseUrl: "http://remote.example/v1" }),
    /HTTPS/,
  );
  await assert.rejects(
    testLiveConnection({
      ...s,
      baseUrl: "https://user:password@remote.example/v1",
    }),
    /认证信息/,
  );
  const original = globalThis.fetch;
  let payload;
  globalThis.fetch = async (url, options) => {
    payload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    };
  };
  try {
    assert.match(await testLiveConnection(s), /连接成功/);
    assert.equal(payload.messages[0].content, "Reply with ok.");
    globalThis.fetch = async () => ({ ok: false, status: 401 });
    await assert.rejects(testLiveConnection(s), /HTTP 401/);
  } finally {
    globalThis.fetch = original;
    delete globalThis.window;
  }
});
test("角色与主题切换不改变共享事实和项目状态", () => {
  const s = ready();
  const changed = reducer(reducer(s, { type: "role", role: "销售" }), {
    type: "theme",
    theme: "dark",
  });
  assert.equal(changed.role, "销售");
  assert.equal(changed.theme, "dark");
  assert.deepEqual(changed.rows, s.rows);
  assert.deepEqual(changed.knowledge, s.knowledge);
});
test("知识先待审，审核需要治理视角与意见；状态在项目切换后仍共享", () => {
  let s = initialState(defaultSettings);
  s = reducer(s, {
    type: "knowledge",
    item: {
      id: "test-knowledge",
      title: "测试知识",
      summary: "摘要",
      content: "仅演示",
      category: "模板",
      owner: "软件产品",
      version: "V1",
      updated: "刚刚",
      scope: "内部共享",
      status: "approved",
      related: [],
    },
  });
  assert.equal(s.knowledge[0].status, "pending");
  s = reducer(s, {
    type: "knowledgeApprove",
    id: "test-knowledge",
    note: "已核对",
  });
  assert.equal(s.knowledge[0].status, "pending");
  s = reducer(s, { type: "role", role: "PM / PO" });
  s = reducer(s, {
    type: "knowledgeApprove",
    id: "test-knowledge",
    note: "已核对内容和复用权限",
  });
  assert.equal(s.knowledge[0].status, "approved");
  assert.equal(s.knowledge[0].approvedBy, "PM / PO");
  s = reducer(s, {
    type: "projectCreate",
    name: "第二个演示项目",
    owner: "销售",
  });
  s = reducer(s, {
    type: "projectSwitch",
    id: s.projects.find((p) => p.name === "第二个演示项目").id,
  });
  assert.equal(s.knowledge[0].status, "approved");
  assert.equal(s.role, "PM / PO");
});
test("多项目数据隔离，返回项目恢复评审与事实；重置仅清空当前项目", () => {
  let s = reducer(ready(), { type: "write", actor });
  s = reducer(s, {
    type: "projectCreate",
    name: "第二个演示项目",
    owner: "销售",
  });
  const second = s.projects.find((p) => p.name === "第二个演示项目").id;
  s = reducer(s, { type: "projectSwitch", id: second });
  assert.equal(s.facts.length, 0);
  assert.equal(s.generated, false);
  s = reducer(s, { type: "stage", id: "F3", kind: "generate", actor, note });
  s = reducer(s, { type: "projectSwitch", id: "DEMO-026" });
  assert.equal(s.facts.length, 11);
  assert.equal(s.stageStates.F3.generated, false);
  s = reducer(s, { type: "projectSwitch", id: second });
  assert.equal(s.stageStates.F3.generated, true);
  s = reducer(s, { type: "reset", settings: defaultSettings });
  assert.equal(s.stageStates.F3.generated, false);
  assert.equal(s.projects.length, 3);
  s = reducer(s, { type: "projectSwitch", id: "DEMO-026" });
  assert.equal(s.facts.length, 11);
});

test("真实项目使用统一流程且独立保存状态，跟进不修改原始资料", () => {
  const s = reducer(ready(), { type: "write", actor });
  const rack = reducer(s, { type: "projectSwitch", id: "RCJM1" });
  assert.equal(rack.currentProjectId, "RCJM1");
  assert.equal(rack.facts.length, 0);
  assert.equal(rack.stageStates.F3.generated, false);
  assert.match(rack.stageStates.F3.rows[0].text, /595,644/);
  assert.doesNotMatch(rack.stageStates.F1.rows[0].text, /DEMO-026/);
  const changed = reducer(rack, {
    type: "stage",
    id: "F3",
    kind: "generate",
    actor,
    note,
  });
  const back = reducer(changed, { type: "projectSwitch", id: "DEMO-026" });
  assert.equal(back.facts.length, 11);
  assert.equal(back.stageStates.F3.generated, false);
  assert.equal(
    reducer(back, { type: "projectSwitch", id: "RCJM1" }).stageStates.F3
      .generated,
    true,
  );
  let next = reducer(s, {
    type: "followup",
    projectId: "RCJM1",
    title: "核实 OS 偏离",
    owner: "软件产品",
  });
  assert.deepEqual(next.resources, s.resources);
  assert.deepEqual(next.facts, s.facts);
  next = reducer(next, { type: "reset", settings: defaultSettings });
  assert.equal(next.followups[0].title, "核实 OS 偏离");
  assert.equal(next.resources.length, s.resources.length);
});

const { textDiff } = await import(moduleUrl("src/lib/textDiff.ts"));
test("版本对比保留原文，仅标记增删；中文、换行与空版本可逆恢复", () => {
  for (const [before, after] of [
    ["采集周期 5 秒，保留 7 天", "采集周期 10 秒，保留 7 天"],
    ["A 区\n120", "A 区\n144"],
    ["", "新增"],
    ["删除", ""],
    ["未变化", "未变化"],
  ]) {
    const diff = textDiff(before, after);
    assert.equal(diff.before.map((p) => p.text).join(""), before);
    assert.equal(diff.after.map((p) => p.text).join(""), after);
    assert.equal(
      diff.before
        .filter((p) => !p.changed)
        .map((p) => p.text)
        .join(""),
      diff.after
        .filter((p) => !p.changed)
        .map((p) => p.text)
        .join(""),
    );
    if (before === after)
      assert.ok(
        diff.before.every((p) => !p.changed) &&
          diff.after.every((p) => !p.changed),
      );
  }
});

const { referenceItems, initialReferenceReview, referenceAction } =
  await import(moduleUrl("src/lib/referenceReview.ts"));
test("真实项目：未澄清的容量要求不能批准或写回", () => {
  const s = initialReferenceReview(),
    id = "RC-S01";
  const patch = {
    text: "待验证容量",
    evidence: "原文 p.6",
    note: "核对原文，参数未定",
  };
  assert.equal(referenceAction(s, id, "approve", "解决方案", patch), s);
  assert.equal(referenceAction(s, id, "write", "解决方案", patch), s);
});
test("真实项目：角色、依据、人审与修改失效", () => {
  let s = initialReferenceReview(),
    id = "RC-R03";
  const patch = {
    extraction: {
      runId: "test-source-1",
      at: "2026-09-29",
      source: "BMS Spec · PDF p.16 / TS-02 p.12",
      requirement: "4秒显示、2秒更新",
      status: "confirmed",
    },
    disposition: "偏离",
    resolution: "限定已验证测试规模，不作无条件性能承诺",
    text: "仅完成要求提取核对，产品支持结论仍待测试",
    evidence: "BMS Spec PDF p.5",
    note: "核对原文，无对外承诺",
  };
  assert.equal(referenceAction(s, id, "approve", "销售", patch), s);
  s = referenceAction(s, id, "verify", "软件产品", {
    extraction: patch.extraction,
  });
  s = referenceAction(s, id, "edit", "软件产品", patch);
  s = referenceAction(s, id, "approve", "软件产品", {});
  assert.equal(s.rows[id].status, "approved");
  s = referenceAction(s, id, "write", "软件产品", {});
  assert.equal(s.rows[id].written, true);
  s = referenceAction(s, id, "edit", "软件产品", { text: "重新核对接口" });
  assert.equal(s.rows[id].written, false);
  assert.equal(s.rows[id].status, "waiting");
  assert.equal(s.audit.length, 5);
  assert.equal(s.audit[0].before, patch.text);
});
test("本机原始点表：四分表合计与单元格计算一致，未解释符号保留", {
  skip: !existsSync("public/project-data/rcjm1/points.json") && "原始点表不在公开仓库中",
}, () => {
  const data = JSON.parse(
    readFileSync("public/project-data/rcjm1/points.json", "utf8"),
  );
  assert.deepEqual(
    data.sheets.map((s) => s.total),
    [9665, 579040, 2697, 4242],
  );
  assert.equal(
    data.sheets.reduce((n, s) => n + s.total, 0),
    595644,
  );
  const tap = data.sheets[1].rows.find((r) => r.row === 41);
  assert.equal(tap.quantityCell, "B41");
  assert.equal(tap.quantity * tap.perUnit, 513216);
  for (const sheet of data.sheets)
    for (const row of sheet.rows)
      assert.equal(
        row.points,
        row.quantity *
          row.cells.reduce(
            (n, c) => n + (typeof c.value === "number" ? c.value : 0),
            0,
          ),
      );
  assert.ok(data.sheets[0].rows.some((r) => r.unresolved.length));
  assert.ok(referenceItems.every((i) => i.source && i.owner));
});

const { accounts, demoPassword, stageReviewers, stageRowOwner } = await import(
  moduleUrl("src/lib/accounts.ts", { "@/lib/workspace": workspaceUrl })
);
test("十个账号：登录身份固定，非负责岗位不能修改或批准同一工件", () => {
  for (const account of accounts) {
    let s = authenticatedReducer(initialState(defaultSettings), {
      type: "login",
      username: account.id,
      password: demoPassword,
    });
    assert.equal(s.accountId, account.id);
    assert.equal(s.role, account.role);
    for (const row of s.rows)
      assert.equal(
        permitted(s, {
          type: "review",
          id: row.id,
          action: "edit",
          text: "x",
          note: "x",
          actor: "伪造用户",
        }),
        row.owner === account.role,
      );
    for (const stage of Object.keys(stageReviewers))
      assert.equal(
        permitted(s, {
          type: "stage",
          id: stage,
          kind: "approve",
          actor: "x",
          note: "x",
        }),
        stageRowOwner(stage, 0) === account.role,
      );
    s = authenticatedReducer(s, { type: "role", role: "PM / PO" });
    assert.equal(s.role, account.role);
  }
  assert.equal(
    authenticatedReducer(initialState(defaultSettings), {
      type: "login",
      username: "sales",
      password: "bad",
    }).accountId,
    null,
  );
});
test("账号审计不接受伪造操作人，退出清除 Key 且保留共享项目", () => {
  let s = authenticatedReducer(initialState(defaultSettings), {
    type: "login",
    username: "solution",
    password: demoPassword,
  });
  s = authenticatedReducer(s, {
    type: "stage",
    id: "F3",
    kind: "generate",
    actor: "其他人",
    note: "核对点表",
  });
  assert.equal(s.activity[0].accountId, "solution");
  assert.equal(s.activity[0].role, "解决方案");
  s = { ...s, settings: { ...s.settings, apiKey: "private-secret" } };
  const next = authenticatedReducer(s, { type: "logout" });
  assert.equal(next.settings.apiKey, "");
  assert.equal(next.accountId, null);
  assert.equal(next.stageStates.F3.generated, true);
  assert.equal(
    permitted(next, {
      type: "stage",
      id: "F3",
      kind: "edit",
      actor: "x",
      note: "x",
    }),
    false,
  );
});

test("软件闭环经三个真实账号交接，全部复核后才可写回", () => {
  let s = authenticatedReducer(initialState(defaultSettings), {
    type: "login",
    username: "software",
    password: demoPassword,
  });
  s = authenticatedReducer(s, { type: "finish" });
  for (const id of ["Q-01", "Q-02"])
    s = authenticatedReducer(s, {
      type: "respond",
      id,
      text: "演示确认：按已有平台索引；协议按批准范围",
      evidence: "合成澄清 V1",
      actor: "不得采信的手填名",
    });
  for (const username of ["software", "dev", "solution"]) {
    s = authenticatedReducer(s, {
      type: "login",
      username,
      password: demoPassword,
    });
    if (username === "solution")
      s = authenticatedReducer(s, { type: "model", actor: "x" });
    for (const r of s.rows.filter((r) => r.owner === s.role))
      s = authenticatedReducer(s, {
        type: "review",
        id: r.id,
        action: "approve",
        note: "演示按岗位核对来源与边界",
        actor: "x",
      });
  }
  assert.equal(canWrite(s), true);
  assert.equal(permitted(s, { type: "write", actor: "x" }), false);
  s = authenticatedReducer(s, {
    type: "login",
    username: "software",
    password: demoPassword,
  });
  s = authenticatedReducer(s, { type: "write", actor: "x" });
  assert.equal(s.facts.length, 11);
  assert.ok(
    s.activity.some((a) => a.accountId === "dev" && a.action === "approve"),
  );
  assert.ok(
    s.activity.some((a) => a.accountId === "solution" && a.action === "model"),
  );
  assert.equal(s.activity[0].accountId, "software");
});

const demoReview = await import(
  moduleUrl("src/lib/demoReview.ts", { "./presales": dataUrl })
);
test("两个项目的软件复核使用同一审批门槛，高风险未答复不能写回", () => {
  const items = demoReview.demoReviewItems;
  let review = initialReferenceReview(items);
  const item = items.find((i) => i.category === "澄清");
  assert.ok(item);
  const root = items.find(
    (i) => i.category === "客户应答" && i.dependsOn?.includes(item.id),
  );
  review = referenceAction(
    review,
    root.id,
    "verify",
    root.owner,
    {
      extraction: {
        runId: "review-source",
        at: "2026-09-29",
        source: root.source,
        requirement: root.requirement,
        status: "confirmed",
      },
    },
    "software",
    items,
  );
  const refused = referenceAction(
    review,
    item.id,
    "approve",
    item.owner,
    { note: "核对", evidence: "版本依据" },
    "software",
    items,
  );
  assert.equal(refused, review);
  review = referenceAction(
    review,
    item.id,
    "respond",
    item.owner,
    { note: "核对", evidence: "版本依据", resolution: "经责任人确认的范围" },
    "software",
    items,
  );
  review = referenceAction(
    review,
    item.id,
    "approve",
    item.owner,
    {},
    "software",
    items,
  );
  review = referenceAction(
    review,
    item.id,
    "write",
    item.owner,
    {},
    "software",
    items,
  );
  assert.equal(review.rows[item.id].written, true);
  const edited = referenceAction(
    review,
    item.id,
    "edit",
    item.owner,
    { text: "修订后的候选内容" },
    "software",
    items,
  );
  assert.equal(edited.rows[item.id].written, false);
  assert.equal(edited.rows[item.id].status, "waiting");
});

const { readProjectReview, reviewKey } = await import(
  moduleUrl("src/lib/projectReview.ts", {
    "./referenceReview": moduleUrl("src/lib/referenceReview.ts"),
    "./demoReview": moduleUrl("src/lib/demoReview.ts", {
      "./presales": dataUrl,
    }),
  })
);
test("旧演示批准缺少提取核对时不可沿用；已核对的无关条目不受版本变化影响", () => {
  const previous = globalThis.sessionStorage;
  const previousLocal = globalThis.localStorage;
  const saved = new Map();
  globalThis.sessionStorage = { getItem: (k) => saved.get(k) || null };
  globalThis.localStorage = { getItem: (k) => saved.get(k) || null };
  try {
    let state = reducer(ready(), { type: "write", actor });
    const review = readProjectReview("DEMO-026", state);
    assert.equal(review.rows["A-02"].written, false);
    review.rows["A-02"].extraction = {
      runId: "reviewed",
      at: "2026-09-29",
      source: demoReview.demoReviewItems.find((i) => i.id === "A-02").source,
      requirement: "账户与传输加密",
      status: "confirmed",
      reviewer: "software",
    };
    review.rows["A-02"].status = "approved";
    review.rows["A-02"].written = true;
    saved.set(reviewKey("DEMO-026"), JSON.stringify(review));
    state = reducer(state, { type: "change", id: "D-01", status: "reviewing" });
    const next = readProjectReview("DEMO-026", state);
    assert.equal(next.rows["A-02"].written, true);
    assert.equal(next.rows["A-04"].written, false);
    assert.equal(next.rows["A-04"].status, "waiting");
  } finally {
    globalThis.sessionStorage = previous;
    globalThis.localStorage = previousLocal;
  }
});
test("跟进完成需要责任账号和处理结果，审计记录项目和结果", () => {
  let state = authenticatedReducer(initialState(defaultSettings), {
    type: "login",
    username: "software",
    password: "demo2026",
  });
  state = authenticatedReducer(state, {
    type: "followup",
    projectId: "RCJM1",
    title: "核对接口范围",
    owner: "软件产品",
  });
  const id = state.followups[0].id;
  assert.equal(
    authenticatedReducer(state, {
      type: "followupComplete",
      id,
      projectId: "RCJM1",
      result: "",
    }).followups[0].status,
    undefined,
  );
  const other = authenticatedReducer(state, {
    type: "login",
    username: "hardware",
    password: "demo2026",
  });
  assert.equal(
    authenticatedReducer(other, {
      type: "followupComplete",
      id,
      projectId: "RCJM1",
      result: "越权完成",
    }).followups[0].status,
    undefined,
  );
  const next = authenticatedReducer(state, {
    type: "followupComplete",
    id,
    projectId: "RCJM1",
    result: "已记录接口范围与验证依据",
  });
  assert.equal(next.followups[0].status, "done");
  assert.equal(next.activity[0].projectId, "RCJM1");
  assert.equal(next.activity[0].accountId, "software");
  assert.match(next.activity[0].after, /已记录接口范围/);
});

const { alignLines } = await import(moduleUrl("src/lib/lineDiff.ts"));
test("全文对比保留未变化行并对齐插入和删除", () => {
  const rows = alignLines("标题\nA\nB\n尾部", "标题\nA\n新增\nB\n尾部");
  assert.equal(rows.filter((r) => r.changed).length, 1);
  assert.equal(rows.find((r) => r.right === "新增").left, undefined);
  assert.equal(
    rows
      .filter((r) => r.left !== undefined)
      .map((r) => r.left)
      .join("\n"),
    "标题\nA\nB\n尾部",
  );
  assert.equal(
    rows
      .filter((r) => r.right !== undefined)
      .map((r) => r.right)
      .join("\n"),
    "标题\nA\n新增\nB\n尾部",
  );
  const removed = alignLines("A\n删除\nB", "A\nB");
  assert.equal(removed.find((r) => r.left === "删除").right, undefined);
});

test("配置全文按设备名称对齐，新增设备不会错配数量", () => {
  const rows = alignLines(
    "1 | 通讯网关 Gateway | PMC-1606 | 142\n2 | 温度传感器 | TH200 | 10",
    "1 | 氢气传感器 | H2 | 150\n2 | 通讯网关 Gateway | PMC-1606 | 240\n3 | 温度传感器 | TH200 | 10",
  );
  const gateway = rows.find((r) => r.left?.includes("PMC-1606"));
  assert.ok(gateway.right.includes("PMC-1606"));
  assert.equal(gateway.changed, true);
  assert.equal(
    rows.find((r) => r.right?.includes("氢气传感器")).left,
    undefined,
  );
});

const refUrl = moduleUrl("src/lib/referenceReview.ts");
const { referenceItems: changeItems, initialReferenceReview: changeReview } =
  await import(refUrl);
const { projectChanges } = await import(
  moduleUrl("src/lib/projectChanges.ts", {
    "@/lib/referenceChanges": moduleUrl("src/lib/referenceChanges.ts"),
    "@/lib/sampleChanges": moduleUrl("src/lib/sampleChanges.ts"),
    "@/lib/presales": dataUrl,
    "@/state/workbench":
      "data:text/javascript,export function useWorkbench(){}",
    "@/lib/projectStages": moduleUrl("src/lib/projectStages.ts", {
      "./stages": stagesUrl,
      "./portfolio": portfolioUrl,
    }),
    "@/lib/referenceReview": refUrl,
    "@/lib/demoReview": moduleUrl("src/lib/demoReview.ts", {
      "./presales": dataUrl,
    }),
    "@/lib/projectReview":
      "data:text/javascript,export function readProjectReview(id,state){return state.testReview}",
  })
);
test("全文历史对比不混入后续修改，并包含确认和依据", () => {
  const items = changeItems.filter((i) => i.category === "客户应答");
  const [first, second] = items;
  const review = changeReview(changeItems);
  const originalFirst = { ...review.rows[first.id] };
  const changedFirst = {
    ...originalFirst,
    text: "应答修改",
    resolution: "接口已确认",
    evidence: "联调记录",
    revision: 2,
  };
  const originalSecond = { ...review.rows[second.id] };
  review.rows[first.id] = changedFirst;
  review.rows[second.id] = {
    ...originalSecond,
    text: "后续改动不应出现在旧快照",
  };
  const oldEvent = {
    id: "older",
    projectId: "RCJM1",
    action: "edit",
    target: first.id,
    before: JSON.stringify(originalFirst),
    after: JSON.stringify(changedFirst),
    accountId: "software",
    role: "软件产品",
  };
  const laterEvent = {
    ...oldEvent,
    id: "later",
    target: second.id,
    before: JSON.stringify(originalSecond),
    after: JSON.stringify(review.rows[second.id]),
  };
  const entries = projectChanges(
    {
      ...initialState(defaultSettings),
      currentProjectId: "RCJM1",
      testReview: review,
      activity: [laterEvent, oldEvent],
    },
    "RCJM1",
  );
  const old = entries.find((e) => e.id === "older");
  assert.ok(old.documentBefore.includes(originalSecond.text));
  assert.ok(!old.documentBefore.includes("后续改动不应出现在旧快照"));
  assert.ok(old.documentAfter.includes("确认：接口已确认"));
  assert.ok(old.documentAfter.includes("依据：联调记录"));
});

const projectStageUrl = moduleUrl("src/lib/projectStages.ts", {
  "./stages": stagesUrl,
  "./portfolio": portfolioUrl,
});
const accountUrl = moduleUrl("src/lib/accounts.ts", {
  "@/lib/workspace": workspaceUrl,
});
const { executeAgentTask, softwareArtifact, taskOptions, stageArtifact } =
  await import(
    moduleUrl("src/lib/agentTasks.ts", {
      "./projectStages": projectStageUrl,
      "./accounts": accountUrl,
    })
  );
test("Agent 提取遵循所选来源，专业答复不能单独生成工件，PM 不代写专业结论", () => {
  const artifact = stageArtifact("RCJM1", "F4", 0);
  const sourceOnly = executeAgentTask(
    "RCJM1",
    "F4",
    artifact,
    "extract",
    "提取",
    [artifact.source],
  );
  assert.ok(sourceOnly.findings.some((f) => f.title === "原文要求"));
  assert.ok(!sourceOnly.findings.some((f) => f.title === "当前工件"));
  assert.deepEqual(sourceOnly.inputSources, [artifact.source]);
  const targetOnly = executeAgentTask(
    "RCJM1",
    "F4",
    artifact,
    "extract",
    "提取",
    [artifact.title + " · R1"],
  );
  assert.ok(!targetOnly.findings.some((f) => f.title === "原文要求"));
  assert.ok(targetOnly.findings.some((f) => f.title === "当前工件"));
  const replyOnly = executeAgentTask(
    "RCJM1",
    "F4",
    { ...artifact, context: "专业答复" },
    "draft",
    "整理",
    ["当前参数与专业答复"],
  );
  assert.equal(replyOnly.proposal, undefined);
  const pm = executeAgentTask(
    "RCJM1",
    "F4",
    artifact,
    "draft",
    "整理协作清单",
    [artifact.source],
    "PM / PO",
  );
  assert.equal(pm.proposal, undefined);
  assert.ok(pm.findings.some((f) => f.title === "专业协作"));
});
const { projectTasks } = await import(
  moduleUrl("src/lib/projectTasks.ts", {
    "./projectReview":
      "data:text/javascript,export function readProjectReview(id,state){return state.testReview || {rows:{}}}",
    "./referenceReview": refUrl,
    "./demoReview": moduleUrl("src/lib/demoReview.ts", {
      "./presales": dataUrl,
    }),
    "./accounts": accountUrl,
    "./projectStages": projectStageUrl,
    "./workflowEngine": workflowEngineUrl,
  })
);
test("Agent 不读取未选择输入，未澄清条件不能变成无条件满足", () => {
  const item = changeItems.find((i) => i.blocker && i.category === "客户应答");
  const row = changeReview(changeItems).rows[item.id];
  const artifact = softwareArtifact(item, row);
  const noInput = executeAgentTask(
    "RCJM1",
    "F5",
    artifact,
    "draft",
    "起草客户应答",
    [],
  );
  assert.equal(noInput.proposal, undefined);
  assert.equal(noInput.findings[0].title, "输入未指定");
  const unsafe = executeAgentTask(
    "RCJM1",
    "F5",
    artifact,
    "draft",
    "把应答改成无条件满足",
    [item.source],
  );
  assert.equal(unsafe.proposal, undefined);
  assert.match(unsafe.findings[0].text, /不能/);
  const draft = executeAgentTask(
    "RCJM1",
    "F5",
    artifact,
    "draft",
    "起草客户应答",
    [item.source],
  );
  assert.equal(draft.artifactId, item.id);
  assert.equal(draft.inputText, row.text);
  assert.match(draft.proposal, /待确认/);
  assert.equal(row.status, "waiting");
});
test("同一节点按工件责任区分财务和法务任务，保留实际核对字段", () => {
  assert.notDeepEqual(
    taskOptions("F12", undefined, "财务 / 风控"),
    taskOptions("F12", undefined, "认证 / 法务"),
  );
  const artifact = stageArtifact("RCJM1", "F13", 0);
  const result = executeAgentTask(
    "RCJM1",
    "F13",
    artifact,
    "check",
    "检查测算输入",
    [artifact.source],
  );
  assert.ok(
    result.findings.some((f) => f.text.includes("采购与供应链支出计划")),
  );
  assert.ok(result.findings.some((f) => f.text.includes("不输出峰值垫资")));
});
test("Agent 执行记录保留真实账号和输入结果，不更改任何项目事实", () => {
  let state = authenticatedReducer(initialState(defaultSettings), {
    type: "login",
    username: "hardware",
    password: "demo2026",
  });
  const next = authenticatedReducer(state, {
    type: "agentRun",
    projectId: "RCJM1",
    id: "F4:0",
    summary: "所选资料和选型核对结果",
  });
  assert.deepEqual(next.stageStates, state.stageStates);
  assert.deepEqual(next.facts, state.facts);
  assert.equal(next.activity[0].accountId, "hardware");
  assert.equal(next.activity[0].after, "所选资料和选型核对结果");
  assert.equal(
    permitted(state, {
      type: "agentRun",
      projectId: "missing",
      id: "x",
      summary: "x",
    }),
    false,
  );
});
test("每个岗位在两个项目都有完整工作入口，未访问项目也不丢任务", () => {
  for (const username of [
    "sales",
    "hardware",
    "commercial",
    "finance",
    "logistics",
    "legal",
    "pm",
  ]) {
    const state = authenticatedReducer(initialState(defaultSettings), {
      type: "login",
      username,
      password: "demo2026",
    });
    const tasks = projectTasks(state);
    for (const p of state.projects)
      assert.ok(
        tasks.some((t) => t.projectId === p.id),
        username + "缺项目" + p.id,
      );
    assert.ok(
      tasks.some((t) => t.status === (username === "pm" ? "待协调" : "待开始")),
    );
  }
});
test("跨岗位答复回到发起人，只有发起账号可标记已阅，不自动批准工件", () => {
  let state = authenticatedReducer(initialState(defaultSettings), {
    type: "login",
    username: "software",
    password: "demo2026",
  });
  state = authenticatedReducer(state, {
    type: "followup",
    projectId: "RCJM1",
    title: "存储参数确认",
    owner: "解决方案",
    url: "/projects/RCJM1?view=review&stage=F5&item=RC-R02",
  });
  const id = state.followups[0].id;
  state = authenticatedReducer(state, {
    type: "login",
    username: "solution",
    password: "demo2026",
  });
  state = authenticatedReducer(state, {
    type: "followupComplete",
    projectId: "RCJM1",
    id,
    result: "容量仍需按批准模型验证",
  });
  assert.equal(
    permitted(state, { type: "followupAccept", projectId: "RCJM1", id }),
    false,
  );
  state = authenticatedReducer(state, {
    type: "login",
    username: "software",
    password: "demo2026",
  });
  assert.ok(
    projectTasks(state).some((t) => t.id === id && t.status === "待处理答复"),
  );
  const next = authenticatedReducer(state, {
    type: "followupAccept",
    projectId: "RCJM1",
    id,
  });
  assert.ok(next.followups[0].acceptedAt);
  assert.deepEqual(next.facts, state.facts);
  assert.equal(next.activity[0].accountId, "software");
  assert.ok(!projectTasks(next).some((t) => t.id === id));
});

test("reviewed output creates per-role next-stage deliveries, receipt and invalidation", () => {
  let s = authenticatedReducer(initialState(defaultSettings), {
    type: "login",
    username: "sales",
    password: "demo2026",
  });
  s = authenticatedReducer(s, {
    type: "stage",
    id: "F1",
    kind: "generate",
    actor: "",
    note: "",
  });
  s = authenticatedReducer(s, {
    type: "stage",
    id: "F1",
    kind: "respond",
    text: "地区与范围演示确认",
    evidence: "登记表V1",
    actor: "",
    note: "",
  });
  s = authenticatedReducer(s, {
    type: "stage",
    id: "F1",
    kind: "approve",
    index: 0,
    actor: "",
    note: "销售核对",
  });
  s = authenticatedReducer(s, {
    type: "login",
    username: "commercial",
    password: "demo2026",
  });
  s = authenticatedReducer(s, {
    type: "stage",
    id: "F1",
    kind: "approve",
    index: 1,
    actor: "",
    note: "商务核对",
  });
  s = authenticatedReducer(s, {
    type: "stage",
    id: "F1",
    kind: "write",
    actor: "",
    note: "专业复核完成",
  });
  assert.equal(s.deliveries.length, 4);
  assert(
    s.deliveries.every((d) => d.toStage === "F2" && d.status === "pending"),
  );
  const d = s.deliveries.find(
    (d) => d.owner === "解决方案" && d.artifactId === "F1:0",
  );
  const wrong = authenticatedReducer(s, {
    type: "deliveryReceive",
    id: d.id,
    projectId: d.projectId,
    status: "accepted",
    note: "核对",
  });
  assert.equal(wrong.deliveries.find((x) => x.id === d.id).status, "pending");
  s = authenticatedReducer(s, {
    type: "login",
    username: "solution",
    password: "demo2026",
  });
  s = authenticatedReducer(s, {
    type: "deliveryReceive",
    id: d.id,
    projectId: d.projectId,
    status: "accepted",
    note: "输入范围确认",
  });
  assert.equal(s.deliveries.find((x) => x.id === d.id).receivedBy, "solution");
  s = authenticatedReducer(s, {
    type: "login",
    username: "sales",
    password: "demo2026",
  });
  s = authenticatedReducer(s, {
    type: "stage",
    id: "F1",
    kind: "edit",
    index: 0,
    text: "更新项目范围",
    actor: "",
    note: "范围变化",
  });
  assert(s.deliveries.find((x) => x.id === d.id).outdated);
  assert.equal(s.deliveries.find((x) => x.id === d.id).text, d.text);
  const unaffected = s.deliveries.find(
    (x) => x.artifactId === "F1:1" && x.owner === "解决方案",
  );
  assert.equal(unaffected.outdated, false);
  s = authenticatedReducer(s, {
    type: "stage",
    id: "F1",
    kind: "approve",
    index: 0,
    actor: "",
    note: "重新复核",
  });
  s = authenticatedReducer(s, {
    type: "stage",
    id: "F1",
    kind: "write",
    actor: "",
    note: "交付新版",
  });
  assert.equal(s.deliveries.length, 6);
  assert.equal(
    s.deliveries.find((x) => x.id === unaffected.id).outdated,
    false,
  );
  const replacement = s.deliveries.find(
    (x) => x.artifactId === "F1:0" && x.owner === "解决方案" && !x.outdated,
  );
  s = authenticatedReducer(s, {
    type: "login",
    username: "solution",
    password: "demo2026",
  });
  s = authenticatedReducer(s, {
    type: "deliveryReceive",
    id: replacement.id,
    projectId: replacement.projectId,
    status: "accepted",
    note: "替代输入确认",
  });
  assert.equal(s.deliveries.find((x) => x.id === d.id).status, "returned");
});

test("unresolved obsolete input blocks downstream publication", () => {
  let s = initialState(defaultSettings);
  s.accountId = "solution";
  s.role = "解决方案";
  s.stageStates.F2 = {
    ...s.stageStates.F2,
    generated: true,
    response: { text: "已确认", evidence: "证据" },
    rows: s.stageStates.F2.rows.map((r) => ({ ...r, status: "approved" })),
  };
  s.deliveries = [
    {
      id: "obsolete",
      projectId: s.currentProjectId,
      artifactId: "F1:0",
      title: "项目档案",
      fromStage: "F1",
      toStage: "F2",
      sender: "sales",
      senderRole: "销售",
      owner: "解决方案",
      version: "V1",
      text: "旧范围",
      evidence: "登记",
      at: "2026-09-29",
      status: "accepted",
      outdated: true,
    },
  ];
  s = authenticatedReducer(s, {
    type: "stage",
    id: "F2",
    kind: "write",
    actor: "",
    note: "写回",
  });
  assert.equal(s.stageStates.F2.written, false);
  s = authenticatedReducer(s, {
    type: "deliveryReceive",
    id: "obsolete",
    projectId: s.currentProjectId,
    status: "returned",
    note: "等待新版",
  });
  s = authenticatedReducer(s, {
    type: "stage",
    id: "F2",
    kind: "write",
    actor: "",
    note: "范围重新复核",
  });
  assert.equal(s.stageStates.F2.written, true);
});

const sharedUrl = moduleUrl("src/lib/sharedWorkspace.ts");
const { sharedWorkspace, mergeShared } = await import(sharedUrl);
test("shared workspace synchronizes projects without identities or keys", () => {
  const producer = initialState(defaultSettings);
  producer.accountId = "sales";
  producer.role = "销售";
  producer.settings.apiKey = "secret";
  producer.stageStates.F1.generated = true;
  const shared = sharedWorkspace(producer);
  assert.equal("accountId" in shared, false);
  assert.equal("settings" in shared, false);
  const receiver = initialState(defaultSettings);
  receiver.accountId = "solution";
  receiver.role = "解决方案";
  const merged = mergeShared(receiver, shared);
  assert.equal(merged.accountId, "solution");
  assert.equal(merged.role, "解决方案");
  assert.equal(merged.stageStates.F1.generated, true);
});

const { referenceServerRows } = await import(
  moduleUrl("src/lib/deploymentModel.ts", {
    "./configVersions": moduleUrl("src/lib/configVersions.ts"),
  })
);
test("deployment reflects five server groups from the latest original configuration", () => {
  const rows = referenceServerRows();
  assert.equal(rows.length, 5);
  assert(
    rows.find((r) => r.title.includes("DB servers")).spec.includes("128G"),
  );
  assert(
    rows.find((r) => r.title === "DCOM数据库服务器").spec.includes("8T*4"),
  );
  assert(rows.every((r) => r.quantity === "2"));
});

test("软件要求链：上游确认、应答结论、版本变更与局部失效", () => {
  let s = initialReferenceReview();
  const readyPatch = {
    note: "评审记录",
    evidence: "联调记录 V1",
    resolution: "本次已确认范围",
  };
  assert.equal(
    referenceAction(s, "RC-R01", "approve", "软件产品", {
      ...readyPatch,
      disposition: "满足",
    }),
    s,
  );
  s = referenceAction(
    s,
    "RC-R01",
    "verify",
    "软件产品",
    {
      extraction: {
        runId: "source-run",
        at: "2026-09-29",
        source: referenceItems.find((i) => i.id === "RC-R01").source,
        requirement: "OPC client/server",
        status: "confirmed",
      },
    },
    "software",
  );
  s = referenceAction(s, "RC-D01", "edit", "研发", {
    ...readyPatch,
    implementation: "适配",
    costBasis: "复用接口0工时；适配3人日；重建10人日。选择适配，另计互通验证。",
  });
  s = referenceAction(s, "RC-D01", "approve", "研发", {});
  s = referenceAction(s, "RC-D01", "write", "研发", {});
  assert.equal(s.rows["RC-D01"].written, true);
  assert.equal(
    referenceAction(s, "RC-R01", "approve", "软件产品", readyPatch),
    s,
  );
  s = referenceAction(s, "RC-R01", "edit", "软件产品", {
    ...readyPatch,
    disposition: "偏离",
  });
  s = referenceAction(s, "RC-R01", "approve", "软件产品", {});
  s = referenceAction(s, "RC-R01", "write", "软件产品", {});
  assert.equal(s.rows["RC-R01"].written, true);
  assert.equal(
    s.rows["RC-R01"].dependencyVersions["RC-D01"],
    s.rows["RC-D01"].revision,
  );
  s = referenceAction(s, "RC-D01", "edit", "研发", { text: "适配范围改变" });
  assert.equal(s.rows["RC-R01"].written, false);
  assert.equal(s.rows["RC-R01"].status, "waiting");
  assert.equal(s.rows["RC-R03"].revision, 1);
});
test("视频应答不能用本地确认文字绕过客户澄清和研发路径", () => {
  const items = demoReview.demoReviewItems;
  const s = initialReferenceReview(items);
  assert.equal(
    referenceAction(
      s,
      "A-04",
      "approve",
      "软件产品",
      {
        text: "无条件满足",
        note: "评审",
        evidence: "规格书",
        resolution: "已确认",
        disposition: "满足",
      },
      "software",
      items,
    ),
    s,
  );
});

test("客户草稿不混入内部成本，关联阻塞不能绕过", () => {
  const item = referenceItems.find((i) => i.id === "RC-R01");
  const artifact = {
    ...softwareArtifact(item, initialReferenceReview().rows[item.id]),
    context: "研发内部成本：3人日，许可费待估",
    pendingDependencies: true,
    followupTarget: { id: "RC-D01", owner: "研发" },
  };
  const draft = executeAgentTask(
    "RCJM1",
    "F5",
    artifact,
    "draft",
    "起草客户应答",
    [item.source],
    "软件产品",
  );
  assert.ok(!draft.proposal.includes("3人日"));
  const refused = executeAgentTask(
    "RCJM1",
    "F5",
    artifact,
    "draft",
    "改成无条件满足",
    [item.source],
    "软件产品",
  );
  assert.equal(refused.proposal, undefined);
  assert.equal(draft.followup.owner, "研发");
});

test("提取确认不是产品满足批准；改正原文要求撤销关联结论", () => {
  let s = initialReferenceReview();
  const i = referenceItems.find((i) => i.id === "RC-R03");
  const patch = {
    text: "应答草稿",
    disposition: "满足",
    resolution: "测试范围",
    note: "核对",
    evidence: "测试记录",
  };
  assert.equal(referenceAction(s, i.id, "approve", i.owner, patch), s);
  s = referenceAction(
    s,
    i.id,
    "extract",
    i.owner,
    {
      extraction: {
        runId: "read-1",
        at: "2026-09-29",
        source: i.source,
        requirement: i.requirement,
        status: "candidate",
      },
    },
    "software",
  );
  assert.equal(s.rows[i.id].extraction.status, "candidate");
  assert.equal(referenceAction(s, i.id, "approve", i.owner, patch), s);
  s = referenceAction(
    s,
    i.id,
    "verify",
    i.owner,
    { extraction: { ...s.rows[i.id].extraction, requirement: "纠正后要求" } },
    "software",
  );
  assert.equal(s.rows[i.id].status, "waiting");
  assert.equal(s.rows[i.id].extraction.reviewer, "software");
  assert.equal(s.rows[i.id].written, false);
});

const { routeTargets, routeRecipients, stageFlow, canReceiveInput } =
  await import(workflowEngineUrl);
test("固定流程分流到并行专业节点，F14 作为贯穿变更处理", () => {
  assert.deepEqual(routeTargets("F2"), ["F3", "F4", "F5", "F6"]);
  assert.deepEqual(routeRecipients("F5"), ["软件产品", "研发", "解决方案"]);
  assert.deepEqual(routeTargets("F14"), []);
});
test("流程引擎拒绝无依据发布、失效上游输入和错误岗位接收", () => {
  const artifact = {
    generated: true,
    written: false,
    response: { text: "已核对", evidence: "规格书 V1 · p.6" },
    rows: [{ status: "approved" }],
  };
  assert.equal(stageFlow(artifact, [], "RCJM1", "F5").status, "ready");
  assert.equal(
    stageFlow({ ...artifact, response: { text: "已核对", evidence: "" } }, [], "RCJM1", "F5").status,
    "reviewing",
  );
  const input = {
    projectId: "RCJM1",
    toStage: "F5",
    owner: "软件产品",
    status: "accepted",
    outdated: true,
  };
  assert.equal(stageFlow(artifact, [input], "RCJM1", "F5").status, "blocked");
  assert.equal(
    stageFlow({ ...artifact, written: true }, [input], "RCJM1", "F5").status,
    "blocked",
  );
  assert.equal(canReceiveInput(input, "研发", "returned", "重审"), false);
  assert.equal(canReceiveInput(input, "软件产品", "accepted", "重审"), false);
  assert.equal(canReceiveInput(input, "软件产品", "returned", "重审"), true);
});
