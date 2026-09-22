# Cloudflare Worker Supabase 反向代理

专为突破国内 GFW 对 `*.supabase.co` 域名的 SNI 阻断 / TCP RST (`os error 104`) 设计。
运行在 **Cloudflare Workers 全球边缘网络**，支持所有 HTTP 方法、流式响应、WebSocket (Supabase Realtime) 以及全自动 CORS 跨域支持。

---

## 🌟 核心特性

1. **三合一泛代理路由**：
   - **默认兜底模式**：直接访问 `https://<你的域名>/rest/v1/...`，自动转发至预设的主项目（默认：`nqrsydzsyowmrdqsclzj`）。
   - **路径前缀模式**：`https://<你的域名>/<project-ref>/rest/v1/...`，代理任意当前或未来的 Supabase 项目。
   - **子域名模式**：`https://<project-ref>.<你的域名>/rest/v1/...`，支持通配符泛子域名。
2. **免受 SNI 干扰**：
   - 在 Cloudflare 绑定自定义域名（如 `db.aikeyu.cn`）后，国内请求访问的是你自己的域名，彻底摆脱 `supabase.co` 的 GFW 阻断。
3. **全自动 CORS 预检**：
   - 内置处理 `OPTIONS` 预检请求并自动注入 CORS Headers，前端/小程序/Postman 直连均不报跨域错误。
4. **WebSocket 透传**：
   - 原生支持 `Upgrade: websocket`，无缝适配 Supabase Realtime 订阅推送。

---

## 🚀 部署方式（任选其一）

### 方式一：Cloudflare Dashboard 在线粘贴（最快，无需配置本机 Token）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 点击左侧菜单 **Workers 和 Pages** ➔ **创建应用程序** ➔ **创建 Worker**。
3. 输入名称（例如 `supabase-proxy`），点击 **部署**。
4. 点击右上角 **编辑代码**，将本项目 [src/index.js](src/index.js) 中的代码完整复制并替换进去。
5. 点击 **部署** 即可立即生效！

---

### 方式二：通过 GitHub 仓库持续部署 (推荐)

1. 在 Cloudflare 控制台中进入 **Workers 和 Pages** ➔ **创建** ➔ 选择 **Pages** 或 **连接 Git**。
2. 选择此 GitHub 仓库：`Aiky156/supabase-cf-worker`。
3. 以后每次推送代码，Cloudflare 会自动更新。

---

### 方式三：通过命令行 Wrangler 部署

```bash
# 1. 进入项目目录
cd /home/uin/supabase-cf-worker

# 2. 登录 Cloudflare (会弹出浏览器授权)
npx wrangler login

# 3. 一键部署
npx wrangler deploy
```

---

## 🌐 绑定自定义域名（关键步骤）

要彻底避免 `workers.dev` 域名在国内被污染，必须绑定自己的域名：

1. 确保你的主域名（如 `aikeyu.cn`）已经托管在 Cloudflare。
2. 进入刚才创建的 Worker 页面。
3. 点击 **设置 (Settings)** ➔ **域和路由 (Domains & Routes)** ➔ **添加自定义域 (Add Custom Domain)**。
4. 输入你的子域名，例如 `db.aikeyu.cn`。
5. Cloudflare 会自动添加 DNS 解析并签发 SSL 证书。
6. 绑定完成后，国内用户和 ESA 边缘节点直接访问 `https://db.aikeyu.cn`，即可享受到极速、不被掐线的 Supabase 连接！

---

## ⚙️ 环境变量配置

在 `wrangler.jsonc` 或 Cloudflare Worker 的 **设置 ➔ 变量 (Variables)** 中配置：

| 变量名 | 默认值 | 描述 |
| :--- | :--- | :--- |
| `DEFAULT_SUPABASE_REF` | `nqrsydzsyowmrdqsclzj` | 当请求没有指定特定 project-ref 时转发的目标项目 ID |
