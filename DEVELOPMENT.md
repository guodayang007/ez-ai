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

首次启动后端前需先构建一次前端：`cd web && bun install && bun run build`（后端通过 `go:embed` 内嵌 `web/dist`）。

后端日志在 `logs/` 目录。

## 5. 配置文件 `.env`

`.env` 在 `.gitignore` 中，不会提交；新环境请从 `.env.example` 复制。本地当前内容：

```
PORT=3000
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

## 6. 重置数据库

清空所有数据，回到全新状态（重启后端后会按 `.env` 重新创建 root 和 user）：

```bash
docker compose -f docker-compose.dev.yml rm -sf postgres
docker volume rm ez-ai_dev_pg_data
docker compose -f docker-compose.dev.yml up -d postgres
```
