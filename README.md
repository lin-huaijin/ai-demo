# AI Creative Workflow Demo

这是一个用于个人作品集展示的 AI 创意工作流 Demo：把素材接入、证据化分析、语义标注、人工筛选和制作 Brief 串成一个可运行的 Web 应用。

## 展示重点

- React + TypeScript 前端工作流与状态管理
- Node/Vite API 层和服务端媒体处理
- 多模态分析结果的结构化校验与降级处理
- 本地 MCP wrapper：把广告库能力接入本地 AI 工具
- API 密钥仅通过环境变量或当前会话内存传递，不写入前端构建产物

## 本地运行

```bash
npm install
npm run dev
```

不配置外部服务也可以使用示例数据查看主要流程。运行检查：

```bash
npm run check
```

## API 配置

复制 `.env.example` 为 `.env.local`，再按需要填写自己的服务密钥。真实密钥不要提交到 Git；`.env.local` 已被忽略。

MCP 示例位于 `mcp/foreplay/`。它只从 `FOREPLAY_API_KEY` 环境变量读取凭证：

```json
{
  "mcpServers": {
    "foreplay": {
      "command": "node",
      "args": ["<path-to-this-repo>/mcp/foreplay/index.mjs"],
      "env": { "FOREPLAY_API_KEY": "<your-key>" }
    }
  }
}
```

## 作品集说明

这是一个经过脱敏的个人展示版本。示例数据、服务地址和工具入口均为通用配置，不包含公司内部部署地址、客户数据、访问口令或真实 API 密钥。使用本项目中的第三方服务时，请遵守相应服务条款，并替换成你自己的账号和密钥。

## 技术栈

React 19 · TypeScript · Vite · Vitest · Node.js · Model Context Protocol
