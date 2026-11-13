# ez-ai
简单的使用ai

ez-ai 基于 [QuantumNous/new-api](https://github.com/QuantumNous/new-api)（上游提交 `87c8848`）二次开发，遵循 AGPL-3.0 协议，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。上游原始文档见 `README.zh_CN.md` 等文件。

## 本地开发

地址、数据库连接、账号密码等完整说明见 [DEVELOPMENT.md](DEVELOPMENT.md)。

依赖：Go 1.26（`GOTOOLCHAIN=auto` 会自动下载）、Bun 1.4+

```bash
# 1. 构建前端（后端通过 go:embed 内嵌 web/dist，首次必须先构建）
cd web && bun install && bun run build && cd ..

# 2. 启动 PostgreSQL（root / 123456，库名 ez-ai，映射到本机 5433）
docker compose -f docker-compose.dev.yml up -d postgres

# 3. 复制配置并启动后端（端口 3000，读取 .env）
cp .env.example .env   # 按需填写 SQL_DSN 与 SETUP_ROOT_*，见下方
mkdir -p logs
go build -o ez-ai . && ./ez-ai --log-dir ./logs

# 4. 启动前端开发服务器（热更新，/api /v1 代理到 localhost:3000）
cd web && bun run dev -- --port 5174
```

- 前端开发：http://localhost:5174
- 后端（内嵌构建好的前端）：http://localhost:3000

`.env` 示例：

```
SQL_DSN=postgresql://root:123456@127.0.0.1:5433/ez-ai?sslmode=disable
SETUP_ROOT_USERNAME=root      # 首次启动自动初始化，跳过 /setup 页面
SETUP_ROOT_PASSWORD=12345678  # 至少 8 位
DEFAULT_USER_USERNAME=user    # 默认普通用户，启动时不存在则自动创建
DEFAULT_USER_PASSWORD=12345678
```

| 账号 | 用户名 | 密码 |
|---|---|---|
| 管理员 | root | 12345678 |
| 普通用户 | user | 12345678 |

## 与上游的差异

- 支持通过 `SETUP_ROOT_USERNAME` / `SETUP_ROOT_PASSWORD`（及可选 `SETUP_SELF_USE_MODE`、`SETUP_DEMO_SITE`）在首次启动时自动完成初始化
- 支持通过 `DEFAULT_USER_USERNAME` / `DEFAULT_USER_PASSWORD` 在启动时自动创建默认普通用户

- 默认系统名称、页面标题、前端包名、二进制 / Docker / systemd 服务名改为 ez-ai
- 按 AGPL-3.0 第 7 条附加条款，保留了页脚与「关于」页中的上游署名及原项目链接；Go 模块路径保持 `github.com/QuantumNous/new-api` 不变，便于合并上游更新
