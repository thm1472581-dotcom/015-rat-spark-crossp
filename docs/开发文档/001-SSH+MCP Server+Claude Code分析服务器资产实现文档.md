# SSH MCP Server + Claude Code 服务器资产分析实现文档

## 1. 方案概述

本方案通过 **SSH MCP Server** 将 Claude Code 与远程服务器连接，使 Claude Code 能够像操作本地文件一样操作目标服务器，完成服务器资产分析任务。

**核心优势**：
- **目标服务器零部署**：只需目标服务器开放 SSH，无需安装任何 Agent
- **配置一次，批量分析**：在分析机完成一次配置，即可分析所有目标服务器
- **安全可控**：使用标准 SSH 协议，密钥认证，分析阶段只读操作

**与 Spark RAT 方案的对比**：

| 维度 | SSH MCP 方案 | Spark RAT 方案 |
|---|---|---|
| 目标服务器部署 | 零部署（仅需 SSH） | 需部署 Client |
| 通信协议 | 标准 SSH | 私有 WebSocket |
| 配置复杂度 | 低（一次配置） | 高（需改造代码） |
| 分析机要求 | 4核8G 推荐 | 2核4G 可跑 |


## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    分析机（云服务器）                         │
│                                                             │
│  ┌─────────────┐      ┌──────────────────────────────┐     │
│  │ Claude Code │─────▶│ SSH MCP Server                │     │
│  │             │      │ (@pyrokine/mcp-ssh 等)         │     │
│  │             │      │                               │     │
│  │             │      │ 提供工具：                     │     │
│  │             │      │ - ssh_exec (执行命令)          │     │
│  │             │      │ - ssh_read_file (读文件)       │     │
│  │             │      │ - ssh_list_dir (列目录)        │     │
│  │             │      │ - ssh_pty_* (交互会话)         │     │
│  └─────────────┘      └──────────────┬───────────────┘     │
│                                      │                     │
└──────────────────────────────────────┼─────────────────────┘
                                       │ SSH (端口 22)
                                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    目标服务器（多台）                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    SSHD (标准 SSH 服务)              │   │
│  │        无需安装任何额外软件                          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```


## 3. 环境准备

### 3.1 分析机要求

| 配置项 | 最低要求 | 推荐配置 |
|---|---|---|
| CPU | 2 核 | 4 核 |
| 内存 | 4GB | 8GB |
| 硬盘 | 20GB | 50GB SSD |
| 系统 | Ubuntu 20.04+ / Debian 10+ | Ubuntu 22.04 |

### 3.2 目标服务器要求

- SSH 服务已开启（默认端口 22，或其他自定义端口）
- 分析机持有可登录的 SSH 密钥（推荐）或密码
- 用于分析的账号具有**只读权限**（非 root 也可，能读取 `/proc`、`/etc`、应用目录即可）

### 3.3 安装 Claude Code

```bash
# 安装 Node.js 18+（如果未安装）
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 Claude Code
npm install -g @anthropic-ai/claude-code

# 验证安装
claude --version
```


## 4. SSH MCP Server 选型与配置

### 4.1 推荐方案：@pyrokine/mcp-ssh

这是功能最完整的 SSH MCP Server 之一，提供命令执行、文件读写、持久 PTY 会话、端口转发等能力。

**安装方式**（无需安装，直接通过 npx 调用）：

```bash
# 在分析机上添加 MCP Server 配置
claude mcp add ssh --transport stdio ssh-mcp
```

或者使用配置文件方式：

```bash
# 创建或编辑 Claude Code 的 MCP 配置
# 配置文件位置：~/.claude.json 或项目目录下的 .mcp.json
```

**配置示例**（`~/.claude.json` 或项目 `.mcp.json`）：

```json
{
  "mcpServers": {
    "ssh": {
      "command": "npx",
      "args": ["-y", "@pyrokine/mcp-ssh"],
      "env": {
        "SSH_MCP_CONFIG": "~/.ssh-mcp/config.json"
      }
    }
  }
}
```

### 4.2 备选方案对比

| 方案 | 特点 | 适用场景 |
|---|---|---|
| **@pyrokine/mcp-ssh** | 功能最全，支持 PTY、SFTP、端口转发 | 复杂分析任务，需要交互式命令 |
| **firstfinger/ssh-mcp** | Docker 部署，HTTP 传输 | 多用户共享，或需要远程访问 |
| **@shiharu/mcp-remote-ssh** | 支持 tmux 屏幕会话，TUI 支持 | 需要长时间运行的分析任务 |

本方案以 **@pyrokine/mcp-ssh** 为主进行说明，其他方案工具名类似。


## 5. SSH 连接配置

### 5.1 配置 SSH 密钥认证（推荐）

在分析机上生成 SSH 密钥（如果还没有）：

```bash
ssh-keygen -t ed25519 -C "asset-analysis" -f ~/.ssh/asset_key
```

将公钥分发到所有目标服务器：

```bash
ssh-copy-id -i ~/.ssh/asset_key.pub user@target-server
```

### 5.2 配置目标服务器清单

创建 `~/.ssh-mcp/config.json`：

```json
{
  "targets": {
    "prod-web-01": {
      "host": "10.0.0.5",
      "port": 22,
      "username": "analyst",
      "privateKeyPath": "~/.ssh/asset_key"
    },
    "prod-api-01": {
      "host": "10.0.0.6",
      "port": 22,
      "username": "analyst",
      "privateKeyPath": "~/.ssh/asset_key"
    },
    "prod-php-01": {
      "host": "10.0.0.7",
      "port": 2222,
      "username": "analyst",
      "privateKeyPath": "~/.ssh/asset_key"
    }
  }
}
```

### 5.3 验证 MCP Server 连接

```bash
# 启动 Claude Code
claude

# 在会话中检查 MCP 状态
/mcp

# 应该看到 ssh 服务器状态为 "Connected"
```


## 6. 创建服务器分析 Skill

### 6.1 Skill 目录结构

```bash
# 在分析机上创建 Skill
mkdir -p ~/.claude/skills/server-asset-analysis
```

### 6.2 SKILL.md 内容

创建 `~/.claude/skills/server-asset-analysis/SKILL.md`：

```markdown
---
name: server-asset-analysis
description: 分析远程服务器资产，识别应用语言、配置和数据库连接。当用户要求分析服务器架构或资产时使用。
allowed-tools: 
  - mcp__ssh__ssh_exec
  - mcp__ssh__ssh_read_file
  - mcp__ssh__ssh_list_dir
  - Read
  - Write
  - Glob
  - Grep
---

# 服务器资产分析流程

## 目标
对指定目标服务器进行只读分析，输出结构化资产报告。

## 前置条件
- 目标服务器已在 SSH MCP 中配置（通过 `target` 参数指定）
- 分析账号具有只读权限

## 分析步骤

### 步骤 1：系统信息采集
执行以下命令（target 替换为目标名称）：
1. `ssh_exec(target="prod-web-01", command="hostname")`
2. `ssh_exec(target="prod-web-01", command="cat /etc/os-release | head -3")`
3. `ssh_exec(target="prod-web-01", command="uname -a")`
4. 运行时检测：
   - `java -version 2>&1 | head -1`
   - `php -v 2>/dev/null | head -1`
   - `python3 -V 2>/dev/null`
   - `node -v 2>/dev/null`
   - `go version 2>/dev/null`

### 步骤 2：进程侦察
1. `ssh_exec(target="prod-web-01", command="ps aux --sort=-%mem | head -40")`
2. 对每个高内存进程（PID 从输出第二列获取）：
   `ssh_exec(target="prod-web-01", command="ls -l /proc/<PID>/cwd 2>/dev/null")`

### 步骤 3：网络侦察
1. `ssh_exec(target="prod-web-01", command="ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null")`

### 步骤 4：应用识别与配置采集
根据步骤 2 中获取的 `cwd`（工作目录），对每个应用根目录：
1. 判断语言类型（根据进程命令）
2. 采集配置文件：
   - **Java**: `cat <app_root>/application.yml`、`cat <app_root>/config/application.yml`
   - **PHP**: `cat <app_root>/.env`、`cat <app_root>/config/database.php`
   - **Python**: `cat <app_root>/settings.py`、`cat <app_root>/.env`
   - **Node**: `cat <app_root>/.env`、`cat <app_root>/config.js`
   - **Go**: `cat <app_root>/conf/app.conf`、`cat <app_root>/config.yaml`

### 步骤 5：数据库配置提取
在读取的配置文件中搜索：`jdbc:`、`mysql`、`database`、`datasource`、`db_host`、`username`、`password`

### 步骤 6：输出报告
在本地生成 Markdown 报告，包含：
- 服务器概览（主机名、OS、运行时）
- 进程与服务列表
- 监听端口
- 应用识别结果（语言、框架、目录）
- 数据库连接信息
- 代码结构说明
- Mermaid 架构图

报告保存到 `./analysis-reports/<target-name>-<date>.md`
```

### 6.3 使用 Skill

在 Claude Code 会话中：

```
/server-asset-analysis 分析 prod-web-01 服务器
```

或让 Claude 自动识别：

```
帮我分析 prod-web-01 这台服务器的架构
```


## 7. 执行分析

### 7.1 单台服务器分析

```bash
# 启动 Claude Code
claude

# 在会话中执行
> /server-asset-analysis prod-web-01
```

### 7.2 批量分析（串行）

```bash
# 逐个分析，避免并发对分析机造成压力
> 依次分析以下服务器：prod-web-01, prod-api-01, prod-php-01
```

Claude 会依次对每台服务器执行分析流程，生成独立报告。

### 7.3 非交互式执行（自动化）

```bash
claude -p "使用 server-asset-analysis skill 分析 prod-web-01，输出报告到 ./reports/"
```


## 8. 安全注意事项

### 8.1 权限控制

- **只读账号**：创建专用的分析账号，仅授予读取权限
- **命令白名单**：可以在 Claude Code 的 hooks 中限制可执行的命令
- **SSH 密钥保护**：分析机上的私钥文件权限设置为 600

### 8.2 已知风险

根据安全研究，MCP 配置存在信任边界问题：
- 项目级 MCP 配置（`.mcp.json`）可能被恶意仓库利用
- 建议只使用用户级或全局 MCP 配置，禁用项目级自动批准

**缓解措施**：
```json
// 在 ~/.claude/settings.json 中禁用项目级 MCP
{
  "enableAllProjectMcpServers": false
}
```

### 8.3 敏感信息处理

- 分析报告中的数据库密码可进行脱敏
- 报告存储目录权限设置为 700
- 分析完成后清理临时文件


## 9. 故障排查

| 问题 | 可能原因 | 解决方案 |
|---|---|---|
| MCP 显示 Failed to connect | SSH MCP Server 未正确安装 | 运行 `claude mcp get ssh` 查看详情 |
| SSH 认证失败 | 密钥未分发或权限错误 | 检查 `~/.ssh/asset_key` 权限，重新执行 `ssh-copy-id` |
| 命令执行超时 | 网络延迟或命令阻塞 | 增加 `timeout` 参数，或使用 PTY 模式 |
| 无法读取 /proc | 权限不足 | 使用有权限的账号，或对目标进程有属主权限 |
| Skill 未被调用 | description 不够明确 | 在用户提示中明确说“使用 server-asset-analysis skill” |


## 10. 与 Spark RAT 方案的对比总结

| 维度 | SSH MCP 方案 | Spark RAT 方案 |
|---|---|---|
| **目标服务器部署** | 零部署 | 需部署 Client |
| **通信方式** | 标准 SSH | 私有 WebSocket |
| **配置复杂度** | 低（一次配置） | 高（需改造代码） |
| **前端交互** | 终端/Claude Code | 可视化 Web UI |
| **批量操作** | Claude 自动编排 | 需手动逐台点击 |
| **安全合规** | 标准 SSH，可审计 | RAT 工具有合规风险 |
| **适用场景** | SSH 可达的服务器 | SSH 不可达、需 NAT 穿透的场景 |

**建议**：如果目标服务器 SSH 可达，优先使用 SSH MCP 方案；如果目标服务器在 NAT 后或 SSH 被管控，再考虑 Spark RAT 方案。