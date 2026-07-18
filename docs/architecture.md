# Spark 项目架构与功能分析

## 1. 项目概述

**Spark** 是一款基于 **Go + React** 的跨平台远程管理工具。控制端通过 **浏览器 Web UI** 操作，被控端为单一可执行文件，支持 **Windows / Linux / macOS**。

与本仓库此前使用的 Gh0st/worldgh0st（MFC + Win32 专用）相比，Spark 的核心优势：

- **原生跨平台**：同一套 Go 客户端代码，按 OS/ARCH 交叉编译即可
- **Web 控制面**：无需安装专用控制端程序，服务端自带前端静态资源
- **协议清晰**：JSON 指令包 + WebSocket 长连接 + HTTP Bridge 传大文件
- **配置内嵌**：生成客户端时在二进制中替换 384 字节配置区，部署简单

> 免责声明：本项目及文档仅供授权环境下的安全研究与学习使用。

---

## 2. 总体架构

```
浏览器 (React Web UI)
  |  HTTP REST /api/*  +  Cookie/Basic Auth
  |  WebSocket（终端/桌面等）
  v
服务端 server/ (Go + Gin + Melody)
  - 鉴权、设备表、指令转发、Bridge 中继
  - 嵌入 web 静态资源 (statik)
  - 客户端模板 built/{os}_{arch}
  |
  |  WebSocket /ws (UUID + Key 握手 -> Secret 加密)
  v
被控端 client/ (Go)
  - core: 连接/注册/指令分发
  - service: 文件/进程/终端/桌面/截图/电源管理
```

### 2.1 三端职责

| 组件 | 目录 | 技术栈 | 职责 |
|------|------|--------|------|
| **服务端** | `server/` | Go 1.18, Gin, Melody | HTTP API、WebSocket 枢纽、鉴权、设备管理、嵌入 Web、生成客户端 |
| **被控端** | `client/` | Go, gopsutil, pty, screenshot | 连接服务端、上报设备信息、执行远程指令 |
| **前端** | `web/` | React 17, Ant Design, xterm.js | 设备总览、终端、文件管理、桌面、进程、生成客户端 |

### 2.2 共享模块

| 目录 | 说明 |
|------|------|
| `modules/` | 通用数据结构：`Packet`、`Device` 等 |
| `utils/` | JSON、加解密、UUID、Melody 封装 |
| `scripts/` | 交叉编译脚本 |

---

## 3. 通信与鉴权

### 3.1 Web 管理端

- `config.json` 的 `auth` 字段配置用户名密码
- 首次 Basic Auth，成功后下发 `Authorization` Cookie
- 密码可用 `$sha256$` / `$sha512$` / `$bcrypt$` 哈希

### 3.2 被控端 WS 握手

Header: `UUID`（32 hex 字符）+ `Key`（AES 加密 UUID，密钥为 server salt）。

校验通过后响应 `Secret`，后续 WS 业务包 AES 加密。

### 3.3 数据通道

| 通道 | 用途 |
|------|------|
| WebSocket | 加密 JSON 指令；终端/桌面原始帧 |
| HTTP /api/* | 浏览器 REST |
| Bridge push/pull | 大文件/截图流式中继 |
| HTTP POST /ws | 超大消息备用 |

---

## 4. 核心流程

### 4.1 被控端启动

1. 读取 384 字节 `ConfigBuffer`（占位 0x19）
2. 解密 JSON：`secure, host, port, path, uuid, key`
3. `core.Start()` 重连循环

占位符未替换则静默退出。

### 4.2 上线

- `DEVICE_UP` 上报设备信息（稳定 device.id、hostname、OS、CPU、内存等）
- 同 device.id 踢旧连接（一机一连）
- PING / DEVICE_UPDATE 心跳

### 4.3 生成客户端

读取 `built/{os}_{arch}` -> 写入加密配置 -> 替换 384 字节占位 -> 下载。

改 salt 或 host/port 须重新生成。

---

## 5. 被控端功能 (client/core/handler.go)

| Act | 功能 |
|-----|------|
| PING / OFFLINE | 心跳 / 下线 |
| LOCK, LOGOFF, HIBERNATE, SUSPEND, RESTART, SHUTDOWN | 电源管理 |
| SCREENSHOT | 截图 |
| TERMINAL_* | 远程终端 |
| FILES_* | 文件管理 |
| PROCESSES_LIST, PROCESS_KILL | 进程 |
| DESKTOP_* | 远程桌面 |
| COMMAND_EXEC | 执行命令 |

---

## 6. 主要 API

见 `API.ZH.md`。核心：`/api/device/list`、`/api/device/file/*`、`/api/client/generate`、`/api/bridge/*`。

---

## 7. 关键源码

| 主题 | 文件 |
|------|------|
| 服务端入口 | server/main.go |
| 设备上线 | server/handler/utility/utility.go |
| 客户端主循环 | client/core/core.go |
| 生成客户端 | server/handler/generate/generate.go |
