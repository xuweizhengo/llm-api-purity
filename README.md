# 中转生态人物图鉴

记录 AI API 中转服务背后的公开人物、联系方式与关联站点状态。

这个项目从“API 纯度检测工具”重构为一个轻量内容站：不追求收录最多的中转站，而是帮助用户先看清每个站背后的人、公开联系方式、关联站点和基础稳定性。

## 核心卖点

**先看人，再选中转站。**

中转行业真正影响信任的往往不是页面写得多漂亮，而是：

- 背后是谁
- 能不能联系到
- 关联哪个站
- 现在稳不稳

本项目围绕这四件事设计首页、人物目录、站点目录、人物站点联合详情页和提交线索页。

## 页面

- 首页：核心卖点、三张精选人物/站点、10 个站点预览。
- 人物：轻量人物卡，展示公开身份、联系方式数量和关联站点。
- 站点：精选站点目录，展示负责人、支持模型、网络、首帧、24h 稳定性。
- 联合详情页：把人物详情和站点详情放在同一页，避免早期资料太少导致页面空。
- 提交线索：人物信息、站点信息、纠错/认领、商务合作四个 tab。

## 快速开始

```bash
git clone https://github.com/xuweizhengo/llm-api-purity.git
cd llm-api-purity
npm start
```

打开：

```text
http://localhost:3078
```

开发模式：

```bash
npm run dev
```

语法检查：

```bash
npm run check
```

## Docker Compose + 数据库

推荐生产或长期运行时使用 Docker Compose。它会同时启动应用和 Postgres，应用启动后自动建表；如果数据库是空的，会从 `data/ecosystem.json` 和 `data/sites.json` 导入第一批数据。

```bash
docker compose up -d --build
```

打开：

```text
http://localhost:3078
```

查看健康状态：

```bash
curl http://localhost:3078/api/health
```

默认数据库连接由 `docker-compose.yml` 注入：

```text
postgres://relay_atlas:relay_atlas_password@db:5432/relay_atlas
```

正式部署时建议复制 `.env.example` 为 `.env`，至少改掉：

```text
POSTGRES_PASSWORD=
RANKING_ADMIN_TOKEN=
```

Docker 模式下容器内固定监听 `3078`，如果只想改宿主机暴露端口，设置 `APP_PORT` 即可。

## 数据文件

人物和精选站点数据：

```text
data/ecosystem.json
```

提交线索运行时文件：

```text
data/submitted-leads.jsonl
```

`submitted-leads.jsonl` 已加入 `.gitignore`，不会被提交到仓库。

大规模公开站点目录：

```text
data/sites.json
```

运行时监控结果：

```text
data/monitor-results.json
```

`monitor-results.json` 是后端定时任务生成的运行时文件，也不会提交。

如果配置了 `DATABASE_URL`，后端会优先使用数据库；未配置时继续使用上述 JSON 文件，方便本地轻量开发。

## 数据库表

核心表：

- `people`：人物主档案。
- `person_contacts` / `person_links` / `person_tags` / `person_identities`：人物联系方式、链接、标签、身份。
- `ecosystem_sites`：精选站点目录。
- `ranking_sites`：大规模公开站点库和监控配置。
- `monitor_results`：每次探活结果，保留 24h 历史用于计算稳定性。
- `leads`：提交线索、认领、纠错和商务合作表单。

## 接口

- `GET /api/ecosystem`：读取人物图鉴和精选站点数据。
- `POST /api/leads`：提交人物、站点、纠错/认领或商务合作线索。
- `GET /api/ranking`：读取后端站点目录和监控结果。
- `POST /api/ranking/refresh`：手动刷新站点监控。
- `GET /api/health`：健康检查和当前数据源。
- `POST /api/check`：保留原来的 OpenAI / Claude API 兼容性检测能力，当前前端不再作为主入口展示。

## 导入公开站点目录

可以继续导入 proxyai.best 的公开目录作为大规模站点库：

```bash
npm run import:proxyai
```

导入脚本会清理常见推广参数，例如 `aff`、`ref`、`invite`、`utm_*`，避免直接挂别人的返佣链接。

## 后台监控

| 环境变量 | 默认值 | 说明 |
|---|---:|---|
| `PORT` | `3078` | 服务端口 |
| `APP_PORT` | `3078` | Docker Compose 暴露到宿主机的端口 |
| `DATABASE_URL` | 空 | Postgres 连接串；为空时使用 JSON 文件模式 |
| `DB_SSL` | `false` | 远程 Postgres 需要 SSL 时可设为 `true` |
| `DB_SEED_ON_START` | `true` | 空库启动时是否导入现有 JSON 数据 |
| `REQUEST_TIMEOUT_MS` | `45000` | API 检测请求超时 |
| `MONITOR_INTERVAL_MS` | `86400000` | 定时监控间隔，默认每天一次 |
| `MONITOR_ON_START` | `false` | 服务启动后是否立即跑一次监控 |
| `MONITOR_DEEP_CHECKS` | `false` | 是否启用真实 API 深度检测，会消耗 Key 额度 |
| `RANKING_ADMIN_TOKEN` | 空 | 远程手动刷新时的 Bearer Token |

手动刷新：

```bash
curl -X POST http://localhost:3078/api/ranking/refresh
```

如果设置了 `RANKING_ADMIN_TOKEN`：

```bash
curl -X POST http://localhost:3078/api/ranking/refresh \
  -H "Authorization: Bearer your-token"
```

当前定时任务分两层：

- 轻量探活：默认启用，对站点入口做 `HEAD/GET`，更新可达性、响应时间和 24h 稳定性。
- 深度检测：`MONITOR_DEEP_CHECKS=true` 且配置对应 API Key 时启用，会调用原有 `/api/check` 的协议兼容检测能力。

## 收录边界

页面文案默认强调：

> 仅收录公开信息与站点自愿提交信息，支持本人认领、纠错与下架申请。

建议后续维护时坚持这个边界，只展示公开资料、本人提交资料或站点方授权资料，避免把项目做成隐私曝光站。

## License

[MIT](LICENSE)
