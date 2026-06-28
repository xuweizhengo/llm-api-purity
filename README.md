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

## 接口

- `GET /api/ecosystem`：读取人物图鉴和精选站点数据。
- `POST /api/leads`：提交人物、站点、纠错/认领或商务合作线索。
- `GET /api/ranking`：读取后端站点目录和监控结果。
- `POST /api/ranking/refresh`：手动刷新站点监控。
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
| `REQUEST_TIMEOUT_MS` | `45000` | API 检测请求超时 |
| `MONITOR_INTERVAL_MS` | `1800000` | 定时监控间隔，默认 30 分钟 |
| `MONITOR_ON_START` | `false` | 服务启动后是否立即跑一次监控 |
| `MONITOR_DEEP_CHECKS` | `false` | 是否启用真实 API 深度检测，会消耗 Key 额度 |
| `RANKING_ADMIN_TOKEN` | 空 | 远程手动刷新时的 Bearer Token |

手动刷新：

```bash
curl -X POST http://localhost:3078/api/ranking/refresh
```

## 收录边界

页面文案默认强调：

> 仅收录公开信息与站点自愿提交信息，支持本人认领、纠错与下架申请。

建议后续维护时坚持这个边界，只展示公开资料、本人提交资料或站点方授权资料，避免把项目做成隐私曝光站。

## License

[MIT](LICENSE)
