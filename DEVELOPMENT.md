# ez-ai 本地开发环境

本文件记录本地开发用的地址、数据库连接和账号，供开发者和 AI 助手直接使用。
以下账号密码**仅用于本地开发**，不要用于任何对外部署的环境。

## 1. 地址一览

| 服务 | 地址 | 说明 |
|---|---|---|
| 前端开发服务器 | http://localhost:5174 | Rsbuild 热更新；`/api` `/v1` `/mj` `/pg` 代理到后端 3000 |
| 后端 | http://localhost:3000 | Go 服务，同时提供内嵌的已构建前端（`web/dist`） |
| PostgreSQL | `127.0.0.1:5433` | Docker 容器 `ez-ai-dev-pg`，容器内端口 5432 |

端口说明：本机 5173 和 5432 已被其他项目占用，所以前端用 5174、数据库映射到 5433。

## 2. 账号密码

| 用途 | 用户名 | 密码 | 说明 |
|---|---|---|---|
| 管理后台（超级管理员，role=100） | `root` | `12345678` | 首次启动时由 `SETUP_ROOT_*` 自动创建 |
| 普通用户（role=1） | `user` | `12345678` | 每次启动若不存在则由 `DEFAULT_USER_*` 自动创建；初始额度 0 |
| PostgreSQL | `root` | `123456` | 数据库名 `ez-ai` |

管理员和普通用户在同一个登录页登录：http://localhost:5174/sign-in

## 3. 数据库连接

**连接串（后端 `.env` 中的 `SQL_DSN`）：**

```
postgresql://root:123456@127.0.0.1:5433/ez-ai?sslmode=disable
```

**连接参数（用于 DBeaver、DataGrip、TablePlus 等客户端）：**

| 项 | 值 |
|---|---|
| Host | `127.0.0.1` |
| Port | `5433` |
| Database | `ez-ai` |
| User | `root` |
| Password | `123456` |
| SSL | 关闭 |

**命令行查询（本机未安装 psql，通过容器执行）：**

```bash
# 交互式
docker exec -it ez-ai-dev-pg psql -U root -d ez-ai

# 单条 SQL（适合 AI / 脚本调用）
docker exec ez-ai-dev-pg psql -U root -d ez-ai -c "select id, username, role, status, quota from users;"

# 列出所有表
docker exec ez-ai-dev-pg psql -U root -d ez-ai -c '\dt'
```

**常用表：**

| 表 | 内容 |
|---|---|
| `users` | 用户；`role` 100=超级管理员、10=管理员、1=普通用户；`status` 1=启用 |
| `tokens` | 用户的 API 令牌 |
| `channels` | 上游渠道（OpenAI、Claude 等的密钥与地址） |
| `abilities` | 渠道与模型、分组的对应关系 |
| `options` | 系统设置（键值对） |
| `logs` | 调用与消费日志 |
| `setups` | 初始化记录；有记录即视为已完成初始化 |

注意：表名 `group`、`key` 等是保留字列，原生 SQL 中 PostgreSQL 需写成 `"group"`、`"key"`。

## 4. 启动与停止

```bash
# 数据库
docker compose -f docker-compose.dev.yml up -d postgres   # 启动
docker compose -f docker-compose.dev.yml stop postgres    # 停止

# 后端（在项目根目录，自动读取 .env）
go build -o ez-ai . && ./ez-ai --log-dir ./logs

# 前端（另开终端）
cd web && bun run dev -- --port 5174
```

一键重启（推荐）：`scripts/dev-restart.sh` 先编译后端，再重启后端、前端开发服务器和开通服务（`services/dogpay-fulfiller` 有 `.env` 和 `node_modules` 时），并等待它们可访问；编译失败时不停旧服务。`scripts/dev-restart.sh status` 查看状态，`scripts/dev-restart.sh stop` 全部停止。输出和 pid 在 `logs/dev/`。本地 Claude Code 的 Stop 钩子（`.claude/settings.local.json`）在每轮 AI 回复结束、且代码有变化时自动执行它。

首次启动后端前需先构建一次前端：`cd web && bun install && bun run build`（后端通过 `go:embed` 内嵌 `web/dist`）。

后端日志在 `logs/` 目录。

## 5. 配置文件 `.env`

`.env` 在 `.gitignore` 中，不会提交；新环境请从 `.env.example` 复制。本地当前内容：

```
PORT=3000
APP_ENV=dev
SQL_DSN=postgresql://root:123456@127.0.0.1:5433/ez-ai?sslmode=disable

# 首次启动自动完成初始化，跳过 /setup 页面；已初始化后不再生效
SETUP_ROOT_USERNAME=root
SETUP_ROOT_PASSWORD=12345678
SETUP_SELF_USE_MODE=false
SETUP_DEMO_SITE=false

# 默认普通用户：启动时若不存在则自动创建
DEFAULT_USER_USERNAME=user
DEFAULT_USER_PASSWORD=12345678
```

规则：

- 用户名最多 12 位，账号密码至少 8 位（系统原有限制）。
- `SETUP_ROOT_*` 只在数据库还没有初始化时使用一次；之后修改不会改变 root 的密码，请在页面的个人设置里改。
- `DEFAULT_USER_*` 只在该用户名不存在时创建账号；改密码不会影响已有账号，改用户名会在下次启动时新建一个账号。
- 当前未配置 Redis（`REDIS_CONN_STRING`），使用内存缓存。
- `APP_ENV=dev` 会默认关闭 API、页面、关键接口（登录、续期、退出登录等）和搜索限流，避免本地频繁刷新时登录返回 429；单独设置 `CRITICAL_RATE_LIMIT_ENABLE=true` 等可以重新打开某一项。生产环境不要设置。

## 6. 商品订单自动开通（DogPay）

后台“商品订单”页的“执行支付”按钮会把订单交给独立服务 `services/dogpay-fulfiller`：它在比特浏览器（BitBrowser）里用买家提交的 ChatGPT Session 打开结账页，用 DogPay 虚拟卡付款，再回调 ez-ai 把订单置为已完成（失败则保留“处理中”并记录原因，可重试）。

全部开通配置（服务地址、共享密钥、回调地址、可购买套餐、DogPay 卡、账单地址、浏览器代理）在后台“系统设置 → 计费 → 商品自动开通”填写，只有超级管理员可见。它们用 `CONFIG_ENCRYPTION_KEY` 以 AES-256-GCM 加密后，作为 `options` 表中的一条 `ProductFulfillerConfig` 保存（值以 `enc:v1:` 开头），通用设置接口既不返回也不能修改它。卡号、CVC、密钥和代理保存后不再显示，卡号只显示末四位。

ez-ai 的 `.env` 必须有固定的加密密钥（本地已生成）：

```
CONFIG_ENCRYPTION_KEY=<至少 32 位，生成：openssl rand -hex 32>
```

未设置时这些配置不能保存；更换密钥后已保存的配置无法解密，需要换回原密钥或重新填写。

开通服务本身只需要共享密钥；运行它的电脑上还要装好比特浏览器客户端，并保持登录：

```bash
cd services/dogpay-fulfiller
bun install
bunx playwright install chromium     # 只有跑单元测试需要；付款用比特浏览器
cp .env.example .env                 # 填 FULFILLER_SECRET，与后台设置的共享密钥一致
node src/server.mjs                  # 默认监听 127.0.0.1:3100
npm test                             # 服务自身的单元测试
```

浏览器用的是比特浏览器本地接口（文档：https://doc2.bitbrowser.cn/jiekou/liu-lan-qi-jie-kou.html）。`.env` 里的 `BITBROWSER_URL` 默认为 `http://127.0.0.1:54345`，以比特浏览器“设置 → 本地接口”显示的地址为准。

每次执行支付的过程：

1. 先调用 `/checkagent` 让比特浏览器通过后台设置的浏览器代理连一次，查出代理的出口 IP、国家、城市和时区并记入详细日志；没设置代理、代理连不上，或出口国家不是账单国家时，直接失败，不开窗口、不扣款。
2. 调用 `/browser/add` 新建一个临时窗口。窗口名为 `ez-ai <订单号>`，使用随机 Windows 指纹，语言固定为 en-US，代理用后台设置的浏览器代理；时区和地理位置按代理 IP 生成，WebRTC 设为“替换”（网站看到的是代理 IP），Cookie 不同步到比特云端。
3. 调用 `/browser/open` 打开窗口，再用 Playwright 的 `connectOverCDP` 连接它返回的 `ws` 地址来操作页面。
4. 无论成功还是失败，结束后都调用 `/browser/close` 关闭窗口，按文档等 5 秒后再调用 `/browser/delete` 彻底删除，买家的登录信息不会留在比特浏览器里。

`HEADLESS=true`（默认）时以 `--headless` 打开窗口；设为 `false` 可以在比特浏览器窗口里看到整个过程，或手动通过人机验证。开通服务启动时会检查比特浏览器本地接口，连不上就打印警告；此时执行支付会在“启动浏览器”一步失败，并写明原因。

每次执行支付时，ez-ai 把卡和账单信息随任务发给开通服务，请求体用共享密钥派生的密钥加密并签名，网络上不出现明文卡号。

浏览器代理填 `http://user:pass@host:port`（也支持 `https://` 和带账号密码的 `socks5://user:pass@host:port`，由比特浏览器窗口使用）。浏览器代理是必填项：直接用本机 IP 结账会被 chatgpt.com 以“异常活动”拒绝，请用账单国家（默认 US）的住宅代理。窗口打开后“启动浏览器”一步还会记录 chatgpt.com / claude.ai 看到的出口 IP 和国家，与账单国家不一致时在结账前停止。

开通服务不可用时，“执行支付”弹窗和设置页会说明原因（未设置加密密钥、配置无法解密、缺少哪些项、服务未启动、密钥不一致），并给出“前往开通设置”或“重新检查”。

Claude 商品：启动时自动录入一次“Claude”商品（Pro / Max 5x / Max 20x，各 1 个月；options 表 `ProductClaudeSeeded` 标记已录入，删除后不会再加回）。买家下单必须填写 claude.ai 的 Cookie（输入类型 `claude_cookie`）：可以是 `sessionKey` 的值（`sk-ant-sid…`），也可以是整段 Cookie 请求头；服务端只保留合法的键值对并去掉 Cloudflare 的 Cookie，没有有效 sessionKey 时拒绝下单。对 Claude 订单“执行支付”时，套餐固定为 `claude_pro`、`claude_max_5x`、`claude_max_20x`（由开通服务 `src/claude.mjs` 定义，不在设置里配置，弹窗按规格名预选）；开通服务把 Cookie 写入浏览器，用 `/api/organizations` 检查现有订阅，打开 `claude.ai/upgrade/pro` 或 `/upgrade/max` 选档位后用同一张 DogPay 卡付款。claude.ai 的页面和接口随时可能变化，失败时支付记录会写明停在哪一步。

使用条件：

- 点“执行支付”时在弹窗里选择要购买的套餐：ChatGPT 订单的可选项是设置里的“可购买套餐”，Claude 订单是上面三个固定套餐。设置里的 ChatGPT 套餐仍是必填项。
- 执行支付不校验订单状态，任何状态的订单都可以执行；只有该订单的自动支付正在进行中时不能重复发起，避免重复扣卡。
- 开通前会检查账号是否已有订阅，已有则不扣款；遇到验证码或 3-D Secure 时停止，需要人工完成。

支付记录：每次点“执行支付”都会单独生成一条记录（表 `product_fulfillment_attempts`），按固定步骤记录进度：校验订单与设置 → 提交给开通服务 → 排队 → 启动浏览器 → 检查现有订阅 → 创建结账页 → 填写银行卡和账单地址 → 提交付款 → 等待付款结果 → 完成订单。前两步和最后一步由 ez-ai 记录，中间步骤由开通服务通过签名的进度回调（与结果回调同一地址，`type: "progress"`）上报，每一步的开始/结束时间、结果和详细日志都会保存。后台“商品订单”每行的“支付记录”按钮打开弹窗，查看每次执行当前到了哪一步、下一步是什么、是否成功；执行中的记录每 3 秒自动刷新。点“执行支付”成功后也会自动打开该弹窗。

## 7. 重置数据库

清空所有数据，回到全新状态（重启后端后会按 `.env` 重新创建 root 和 user）：

```bash
docker compose -f docker-compose.dev.yml rm -sf postgres
docker volume rm ez-ai_dev_pg_data
docker compose -f docker-compose.dev.yml up -d postgres
```
