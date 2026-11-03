import { describe, expect, it } from "vitest";
import {
  AGENT_INITIAL_MESSAGE,
  AGENT_SYSTEM_PROMPT,
  buildAgentParams,
  buildCredentialParams,
  buildDeploymentParams,
  buildEnvironmentParams,
  buildVaultParams,
  mcpInternalUrl,
  upsertEnvLine,
} from "../lib/agent-config";
import { runSetup, type SetupDeps, type SetupIds } from "../setup-agent";

const MCP_URL = "https://asia-northeast1-demo-project.cloudfunctions.net/mcpInternal";

describe("buildAgentParams（契約 §13 と brief の値）", () => {
  const params = buildAgentParams(MCP_URL);

  it("道具は mcp_toolset 1 つだけで、always_allow を明示する（agent_toolset は無し）", () => {
    expect(params.tools).toEqual([
      { type: "mcp_toolset", mcp_server_name: "internal", default_config: { permission_policy: { type: "always_allow" } } },
    ]);
  });

  it("model は claude-sonnet-5-5、effort は medium", () => {
    expect(params.model).toEqual({ id: "claude-sonnet-5-5", effort: "medium" });
  });

  it("mcp_servers に internal を 1 つ宣言し、toolset の名前と一致する（公式の作りで、brief の tools だけでは足りない）", () => {
    expect(params.mcp_servers).toEqual([{ type: "url", name: "internal", url: MCP_URL }]);
    const toolset = params.tools?.[0];
    expect(toolset && "mcp_server_name" in toolset ? toolset.mcp_server_name : null).toBe(params.mcp_servers?.[0]?.name);
  });

  it("system に AGENT_SYSTEM_PROMPT を使う", () => {
    expect(params.system).toBe(AGENT_SYSTEM_PROMPT);
  });
});

describe("buildEnvironmentParams", () => {
  it("cloud、制限つきネットワーク、MCP だけ許可（パッケージ、ホストは許可しない）", () => {
    const params = buildEnvironmentParams();
    expect(params.config).toEqual({ type: "cloud", networking: { type: "limited", allow_mcp_servers: true } });
    expect(typeof params.name).toBe("string");
  });
});

describe("vault と credential", () => {
  it("static_bearer の credential の URL が、agent の MCP の URL と同じ文字列", () => {
    const agent = buildAgentParams(MCP_URL);
    const credential = buildCredentialParams(MCP_URL, "test-token-not-a-real-secret");
    expect(credential.auth).toEqual({ type: "static_bearer", mcp_server_url: MCP_URL, token: "test-token-not-a-real-secret" });
    const auth = credential.auth;
    expect(auth.type === "static_bearer" ? auth.mcp_server_url : null).toBe(agent.mcp_servers?.[0]?.url);
  });

  it("vault は名前だけ", () => {
    expect(typeof buildVaultParams().display_name).toBe("string");
  });
});

describe("mcpInternalUrl", () => {
  it("プロジェクトから作る。末尾の path は mcpInternal", () => {
    expect(mcpInternalUrl("demo-project")).toBe(MCP_URL);
  });

  it("プロジェクトの形でなければ例外", () => {
    expect(() => mcpInternalUrl("")).toThrow();
    expect(() => mcpInternalUrl("a/b")).toThrow();
    expect(() => mcpInternalUrl("evil.example.com#")).toThrow();
  });
});

describe("buildDeploymentParams", () => {
  const params = buildDeploymentParams({ agentId: "agent_x", environmentId: "env_x", vaultId: "vlt_x" });

  it("ID を渡し、vault を付ける", () => {
    expect(params.agent).toBe("agent_x");
    expect(params.environment_id).toBe("env_x");
    expect(params.vault_ids).toEqual(["vlt_x"]);
  });

  it("毎週月曜 07:00 JST の cron", () => {
    expect(params.schedule).toEqual({ type: "cron", expression: "0 7 * * 1", timezone: "Asia/Tokyo" });
  });

  it("budget は 1 ドル（セント単位の文字列 \"100\"）", () => {
    expect(params.budget).toEqual({ type: "limit", max_list_cost: { amount: "100", currency: "USD" } });
  });

  it("initial_events[0] は user.message で、本文は AGENT_INITIAL_MESSAGE", () => {
    expect(params.initial_events).toHaveLength(1);
    expect(params.initial_events[0]).toEqual({ type: "user.message", content: [{ type: "text", text: AGENT_INITIAL_MESSAGE }] });
  });
});

describe("AGENT_SYSTEM_PROMPT に入れること（brief Step 3）", () => {
  const p = AGENT_SYSTEM_PROMPT;
  it("道具は 3 つだけで、名前を挙げる", () => {
    expect(p).toContain("list_entrance_targets");
    expect(p).toContain("fetch_pref_page");
    expect(p).toContain("propose_entrance");
    expect(p).toMatch(/3 つだけ/);
  });
  it("取得した本文はデータで、指示に従わない", () => {
    expect(p).toMatch(/データ/);
    expect(p).toMatch(/指示に従わない/);
  });
  it("対象は currentUrl が null か failingSince がある県だけ", () => {
    expect(p).toContain("currentUrl");
    expect(p).toContain("null");
    expect(p).toContain("failingSince");
  });
  it("畜産、家畜衛生、家畜伝染病の順にたどる", () => {
    const a = p.indexOf("畜産");
    const b = p.indexOf("家畜衛生");
    const c = p.indexOf("家畜伝染病");
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
  it("年度を含まない URL を優先し、1 県 1 件、URL を推測しない", () => {
    expect(p).toMatch(/年度を含まない/);
    expect(p).toMatch(/1 県 1 件/);
    expect(p).toMatch(/推測しない/);
  });
  it("見回り先を変える権限はない", () => {
    expect(p).toMatch(/見回り先を変える権限は(ない|ありません)/);
  });
  it("秘密や個人の情報を含めない（鍵、農場の所在地などの語が入らない）", () => {
    expect(p).not.toMatch(/sk-ant|Bearer|password/i);
  });
});

describe("upsertEnvLine", () => {
  it("空の AGENT_DEPLOYMENT_ID= を置き換えて 1 行のまま", () => {
    const out = upsertEnvLine("GMAIL_USER=a\nAGENT_DEPLOYMENT_ID=\nAPP_URL=b\n", "AGENT_DEPLOYMENT_ID", "depl_1");
    expect(out).toBe("GMAIL_USER=a\nAGENT_DEPLOYMENT_ID=depl_1\nAPP_URL=b\n");
    expect(out.split("\n").filter((l) => l.startsWith("AGENT_DEPLOYMENT_ID="))).toHaveLength(1);
  });

  it("入っている値も置き換える", () => {
    expect(upsertEnvLine("AGENT_DEPLOYMENT_ID=old\n", "AGENT_DEPLOYMENT_ID", "depl_2")).toBe("AGENT_DEPLOYMENT_ID=depl_2\n");
  });

  it("なければ末尾に足す（末尾の改行がなくても 1 行に収まる）", () => {
    expect(upsertEnvLine("A=1\n", "K", "v")).toBe("A=1\nK=v\n");
    expect(upsertEnvLine("A=1", "K", "v")).toBe("A=1\nK=v\n");
    expect(upsertEnvLine("", "K", "v")).toBe("K=v\n");
  });

  it("他の行（コメント、空行、似た名前、CRLF）は 1 バイトも変えない", () => {
    const input = "# AGENT_DEPLOYMENT_ID=commented\r\n\r\nAGENT_DEPLOYMENT_ID_OLD=keep\nXAGENT_DEPLOYMENT_ID=keep\nAGENT_DEPLOYMENT_ID=\nZ=1 # note\n";
    const out = upsertEnvLine(input, "AGENT_DEPLOYMENT_ID", "depl_3");
    expect(out).toBe("# AGENT_DEPLOYMENT_ID=commented\r\n\r\nAGENT_DEPLOYMENT_ID_OLD=keep\nXAGENT_DEPLOYMENT_ID=keep\nAGENT_DEPLOYMENT_ID=depl_3\nZ=1 # note\n");
  });

  it("同じキーの行が複数あるときは全部を同じ値にする（後の行が勝つ dotenv で食い違わない）", () => {
    expect(upsertEnvLine("K=1\nA=2\nK=3\n", "K", "v")).toBe("K=v\nA=2\nK=v\n");
  });

  it("改行を含む値、不正なキーは例外", () => {
    expect(() => upsertEnvLine("", "K", "a\nB=c")).toThrow();
    expect(() => upsertEnvLine("", "K", "a\rb")).toThrow();
    expect(() => upsertEnvLine("", "bad key", "v")).toThrow();
    expect(() => upsertEnvLine("", "K=", "v")).toThrow();
  });
});

// ── setup-agent.ts の流れ（実物の API には触れない。偽の client で順序と作り直さないことを確かめる）──

interface Harness {
  deps: SetupDeps;
  calls: string[];
  out: string[];
  store: { ids: SetupIds | null; envFile: string | null };
  tokenReads: number;
}

function harness(opts: { ids?: SetupIds | null; token?: string | null; envFile?: string | null; env?: Record<string, string> } = {}): Harness {
  const calls: string[] = [];
  const out: string[] = [];
  const store = { ids: opts.ids ?? null, envFile: opts.envFile === undefined ? "AGENT_DEPLOYMENT_ID=\n" : opts.envFile };
  const h: Harness = { deps: undefined as never, calls, out, store, tokenReads: 0 };
  h.deps = {
    env: { FIREBASE_PROJECT: "demo-project", ANTHROPIC_API_KEY: "test-key-not-real", ...(opts.env ?? {}) },
    client: {
      beta: {
        environments: { create: async () => (calls.push("environments.create"), { id: "env_1" }) },
        agents: { create: async () => (calls.push("agents.create"), { id: "agent_1", version: 1 }) },
        vaults: {
          create: async () => (calls.push("vaults.create"), { id: "vlt_1" }),
          credentials: { create: async () => (calls.push("vaults.credentials.create"), { id: "cred_1" }) },
        },
        deployments: {
          create: async () => (calls.push("deployments.create"), { id: "depl_1", schedule: { upcoming_runs_at: ["2026-11-09T22:00:00Z"] } }),
        },
      },
    },
    readIds: () => store.ids,
    writeIds: (ids) => {
      store.ids = structuredClone(ids);
    },
    readToken: () => {
      h.tokenReads++;
      return opts.token === undefined ? "test-internal-token-not-real" : opts.token;
    },
    readEnvFile: () => store.envFile,
    writeEnvFile: (text) => {
      store.envFile = text;
    },
    write: (s) => out.push(s),
  };
  return h;
}

describe("runSetup", () => {
  it("environments → agents → vaults → credentials → deployments の順に作り、ID を控え、env に AGENT_DEPLOYMENT_ID を書く", async () => {
    const h = harness();
    expect(await runSetup(h.deps)).toBe(0);
    expect(h.calls).toEqual(["environments.create", "agents.create", "vaults.create", "vaults.credentials.create", "deployments.create"]);
    expect(h.store.ids).toMatchObject({ environmentId: "env_1", agentId: "agent_1", vaultId: "vlt_1", credentialId: "cred_1", deploymentId: "depl_1" });
    expect(h.store.envFile).toBe("AGENT_DEPLOYMENT_ID=depl_1\n");
  });

  it("出力は AGENT_DEPLOYMENT_ID が設定済みと言うだけで、値（ID）もトークンも出さない", async () => {
    const h = harness();
    await runSetup(h.deps);
    const text = h.out.join("");
    expect(text).toContain("AGENT_DEPLOYMENT_ID: 設定済み");
    expect(text).not.toContain("depl_1");
    expect(text).not.toContain("test-internal-token-not-real");
    expect(text).not.toContain("test-key-not-real");
    expect(text).toContain("2026-11-09T22:00:00Z"); // upcoming_runs_at（G1 の確認用）
  });

  it("全部あれば何も作り直さない", async () => {
    const ids: SetupIds = {
      mcpUrl: MCP_URL,
      environmentId: "env_1",
      agentId: "agent_1",
      vaultId: "vlt_1",
      credentialId: "cred_1",
      deploymentId: "depl_1",
    };
    const h = harness({ ids, envFile: "AGENT_DEPLOYMENT_ID=depl_1\n" });
    expect(await runSetup(h.deps)).toBe(0);
    expect(h.calls).toEqual([]);
    expect(h.tokenReads).toBe(0);
  });

  it("途中まで済んでいれば続きから作る（作った分は作り直さない）", async () => {
    const h = harness({ ids: { mcpUrl: MCP_URL, environmentId: "env_1", agentId: "agent_1" } });
    expect(await runSetup(h.deps)).toBe(0);
    expect(h.calls).toEqual(["vaults.create", "vaults.credentials.create", "deployments.create"]);
  });

  it("途中で失敗しても、そこまでの ID は控えに残る", async () => {
    const h = harness();
    h.deps.client.beta.agents.create = async () => {
      throw new Error("boom");
    };
    await expect(runSetup(h.deps)).rejects.toThrow("boom");
    expect(h.store.ids).toMatchObject({ environmentId: "env_1" });
    expect(h.store.ids?.agentId).toBeUndefined();
  });

  it("控えの mcpUrl が今のプロジェクトのものと違えば、何も作らず止まる", async () => {
    const h = harness({ ids: { mcpUrl: "https://asia-northeast1-other.cloudfunctions.net/mcpInternal", environmentId: "env_1" } });
    expect(await runSetup(h.deps)).toBe(2);
    expect(h.calls).toEqual([]);
  });

  it("FIREBASE_PROJECT、ANTHROPIC_API_KEY、トークンの控えが無ければ、何も作らず止まる", async () => {
    const a = harness({ env: { FIREBASE_PROJECT: "" } });
    expect(await runSetup(a.deps)).toBe(2);
    expect(a.calls).toEqual([]);

    const b = harness({ env: { ANTHROPIC_API_KEY: "" } });
    expect(await runSetup(b.deps)).toBe(2);
    expect(b.calls).toEqual([]);

    const c = harness({ token: null });
    expect(await runSetup(c.deps)).toBe(2);
    expect(c.calls).toEqual([]);
  });

  it("env ファイルが無い（null）ときは新しく作る", async () => {
    const h = harness({ envFile: null });
    expect(await runSetup(h.deps)).toBe(0);
    expect(h.store.envFile).toBe("AGENT_DEPLOYMENT_ID=depl_1\n");
  });
});
