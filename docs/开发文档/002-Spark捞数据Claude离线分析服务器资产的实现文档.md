# Spark RAT “分析资产”按钮完整实现文档

## 1. 项目概述

本文档描述如何在 Spark RAT 项目中新增一个“分析资产”按钮，点击后通过 Spark 的远程命令执行通道，采集目标服务器的系统信息、进程、网络连接、应用配置等数据，最终导出为结构化 JSON 数据包，供 Claude Code 离线分析。

**核心原则**：
- **只读操作**：所有采集命令均为只读（`ps`、`ss`、`cat`、`ls` 等），不修改目标服务器任何文件
- **数据采集与分析分离**：Spark 负责“取数据”，Claude Code 负责“分析数据”
- **单设备串行**：一次只分析一台设备，对分析机资源要求低

## 2. 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Spark Server（分析机）                     │
│  ┌─────────────────────┐  ┌──────────────────────────────┐  │
│  │  Spark Web UI        │  │  新增：资产采集模块（Backend） │  │
│  │  (React + AntD)      │  │  - POST /api/asset/collect   │  │
│  │  - 设备管理面板      │  │  - 调用 Spark 命令执行通道    │  │
│  │  - 新增「分析资产」按钮│  │  - 编排采集流程               │  │
│  └─────────────────────┘  └──────────────────────────────┘  │
│                                    │                        │
│                                    ▼                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Spark 原有 WebSocket 命令通道             │  │
│  │         (Client ←→ Server，COMMAND_EXEC 等)           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    目标服务器（Linux）                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Spark Client（已有，不需修改）              │   │
│  │     接收 COMMAND_EXEC、FILES_LIST、FILES_FETCH 等     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 3. 技术栈

- **后端**：Go + Gin 框架（Spark Server 已有）
- **前端**：React + Ant Design（Spark Web 已有）
- **通信通道**：Spark 已有 WebSocket + 命令执行接口

Spark 的命令体系包括 `COMMAND_EXEC`（执行系统命令）、`FILES_LIST`（列目录）、`FILES_FETCH`（读文件）、`PROCESSES_LIST`（列进程）等。本功能复用这些已有能力。

## 4. 后端实现

### 4.1 新增路由

在 Spark Server 的路由注册处（通常在 `server/api/` 或 `server/router/` 目录下）新增：

```go
// 在路由注册函数中添加
apiGroup := r.Group("/api")
apiGroup.POST("/asset/collect/:deviceId", CollectAssetHandler)
```

### 4.2 采集 Handler（核心逻辑）

新建文件 `server/api/asset_collect.go`：

```go
package api

import (
    "encoding/json"
    "fmt"
    "net/http"
    "os"
    "path/filepath"
    "strings"
    "time"

    "github.com/gin-gonic/gin"
)

// AssetPackage 是最终导出的数据包结构
type AssetPackage struct {
    Meta           MetaInfo           `json:"meta"`
    System         SystemInfo         `json:"system"`
    Processes      []ProcessInfo      `json:"processes"`
    ListeningPorts []PortInfo         `json:"listening_ports"`
    Applications   []ApplicationInfo  `json:"applications"`
    RawFiles       map[string]string  `json:"raw_files"`
}

type MetaInfo struct {
    DeviceID      string   `json:"device_id"`
    Hostname      string   `json:"hostname"`
    CollectedAt   string   `json:"collected_at"`
    CommandsRun   []string `json:"commands_executed"`
}

type SystemInfo struct {
    OS            string `json:"os"`
    Kernel        string `json:"kernel"`
    Arch          string `json:"arch"`
    Runtimes      map[string]string `json:"installed_runtimes"`
}

type ProcessInfo struct {
    PID     int    `json:"pid"`
    User    string `json:"user"`
    CPU     string `json:"cpu_pct"`
    Mem     string `json:"mem_pct"`
    Command string `json:"command"`
    Cwd     string `json:"cwd,omitempty"`
}

type PortInfo struct {
    Port    int    `json:"port"`
    Process string `json:"process"`
    PID     int    `json:"pid,omitempty"`
}

type ApplicationInfo struct {
    ID            string   `json:"id"`
    Language      string   `json:"language"`
    AppRoot       string   `json:"app_root"`
    ConfigFiles   []ConfigFile `json:"config_files"`
}

type ConfigFile struct {
    Path    string `json:"path"`
    Content string `json:"content"`
}

// CollectAssetHandler 处理资产采集请求
func CollectAssetHandler(c *gin.Context) {
    deviceId := c.Param("deviceId")
    
    // 1. 获取设备连接会话
    session, err := GetSession(deviceId)
    if err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
        return
    }

    pkg := AssetPackage{
        Meta: MetaInfo{
            DeviceID:    deviceId,
            CollectedAt: time.Now().UTC().Format(time.RFC3339),
            CommandsRun: []string{},
        },
        RawFiles: make(map[string]string),
    }

    // 2. 采集系统信息
    pkg.System = collectSystemInfo(session, &pkg.Meta)
    
    // 3. 采集进程信息（COMMAND_EXEC: ps aux --sort=-%mem）
    pkg.Processes = collectProcesses(session, &pkg.Meta)
    
    // 4. 采集监听端口（COMMAND_EXEC: ss -tlnp）
    pkg.ListeningPorts = collectPorts(session, &pkg.Meta)
    
    // 5. 识别应用并采集配置
    pkg.Applications = collectApplications(session, pkg.Processes, &pkg.Meta, pkg.RawFiles)

    // 6. 导出为 JSON 文件
    outputDir := "./asset-exports"
    os.MkdirAll(outputDir, 0755)
    filename := fmt.Sprintf("%s-%s.json", deviceId, time.Now().Format("20060102-150405"))
    outputPath := filepath.Join(outputDir, filename)
    
    data, _ := json.MarshalIndent(pkg, "", "  ")
    os.WriteFile(outputPath, data, 0644)

    c.JSON(http.StatusOK, gin.H{
        "status":   "success",
        "device":   deviceId,
        "file":     outputPath,
        "summary": gin.H{
            "processes":    len(pkg.Processes),
            "ports":        len(pkg.ListeningPorts),
            "applications": len(pkg.Applications),
        },
    })
}

// collectSystemInfo 采集系统基本信息
func collectSystemInfo(session *Session, meta *MetaInfo) SystemInfo {
    info := SystemInfo{Runtimes: make(map[string]string)}
    
    // 主机名
    if out, err := session.ExecCommand("hostname"); err == nil {
        meta.Hostname = strings.TrimSpace(out)
    }
    
    // OS 信息
    cmd := "cat /etc/os-release | head -2"
    meta.CommandsRun = append(meta.CommandsRun, cmd)
    if out, err := session.ExecCommand(cmd); err == nil {
        info.OS = strings.TrimSpace(out)
    }
    
    // 内核
    cmd = "uname -r"
    meta.CommandsRun = append(meta.CommandsRun, cmd)
    if out, err := session.ExecCommand(cmd); err == nil {
        info.Kernel = strings.TrimSpace(out)
    }
    
    // 架构
    cmd = "uname -m"
    meta.CommandsRun = append(meta.CommandsRun, cmd)
    if out, err := session.ExecCommand(cmd); err == nil {
        info.Arch = strings.TrimSpace(out)
    }
    
    // 运行时版本检测
    runtimes := map[string]string{
        "java":   "java -version 2>&1 | head -1",
        "php":    "php -v 2>/dev/null | head -1",
        "python": "python3 -V 2>/dev/null || python -V 2>/dev/null",
        "node":   "node -v 2>/dev/null",
        "go":     "go version 2>/dev/null",
    }
    for name, cmd := range runtimes {
        meta.CommandsRun = append(meta.CommandsRun, cmd)
        if out, err := session.ExecCommand(cmd); err == nil && strings.TrimSpace(out) != "" {
            info.Runtimes[name] = strings.TrimSpace(out)
        }
    }
    
    return info
}

// collectProcesses 采集进程列表
func collectProcesses(session *Session, meta *MetaInfo) []ProcessInfo {
    var processes []ProcessInfo
    cmd := "ps aux --sort=-%mem | head -40"
    meta.CommandsRun = append(meta.CommandsRun, cmd)
    
    out, err := session.ExecCommand(cmd)
    if err != nil {
        return processes
    }
    
    lines := strings.Split(out, "\n")
    for i, line := range lines {
        if i == 0 || strings.TrimSpace(line) == "" {
            continue // 跳过表头
        }
        fields := strings.Fields(line)
        if len(fields) < 11 {
            continue
        }
        processes = append(processes, ProcessInfo{
            User:    fields[0],
            PID:     parseIntSafe(fields[1]),
            CPU:     fields[2],
            Mem:     fields[3],
            Command: strings.Join(fields[10:], " "),
        })
    }
    
    // 对高内存进程补充 cwd
    for i := range processes {
        if processes[i].PID > 0 {
            cmd := fmt.Sprintf("ls -l /proc/%d/cwd 2>/dev/null", processes[i].PID)
            if out, err := session.ExecCommand(cmd); err == nil {
                // 解析软链接目标
                if parts := strings.Split(out, "->"); len(parts) == 2 {
                    processes[i].Cwd = strings.TrimSpace(parts[1])
                }
            }
        }
    }
    
    return processes
}

// collectPorts 采集监听端口
func collectPorts(session *Session, meta *MetaInfo) []PortInfo {
    var ports []PortInfo
    cmd := "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null"
    meta.CommandsRun = append(meta.CommandsRun, cmd)
    
    out, err := session.ExecCommand(cmd)
    if err != nil {
        return ports
    }
    
    for _, line := range strings.Split(out, "\n") {
        if !strings.Contains(line, "LISTEN") {
            continue
        }
        fields := strings.Fields(line)
        if len(fields) < 4 {
            continue
        }
        // 解析端口号
        addr := fields[3]
        if idx := strings.LastIndex(addr, ":"); idx > 0 {
            port := parseIntSafe(addr[idx+1:])
            if port > 0 {
                p := PortInfo{Port: port}
                // 尝试提取进程名和 PID
                if len(fields) >= 6 {
                    procInfo := fields[5]
                    if start := strings.Index(procInfo, "users:((\""); start >= 0 {
                        // 简化解析
                        p.Process = extractProcessName(procInfo)
                    }
                }
                ports = append(ports, p)
            }
        }
    }
    
    return ports
}

// collectApplications 识别应用并采集配置
func collectApplications(session *Session, processes []ProcessInfo, meta *MetaInfo, rawFiles map[string]string) []ApplicationInfo {
    var apps []ApplicationInfo
    seen := make(map[string]bool)
    
    for _, p := range processes {
        if p.Cwd == "" || seen[p.Cwd] {
            continue
        }
        
        // 判断语言类型
        lang := detectLanguage(p.Command)
        if lang == "" {
            continue
        }
        seen[p.Cwd] = true
        
        app := ApplicationInfo{
            ID:       fmt.Sprintf("app-%d", p.PID),
            Language: lang,
            AppRoot:  p.Cwd,
        }
        
        // 根据语言采集配置文件
        configPaths := getConfigCandidates(lang, p.Cwd)
        for _, path := range configPaths {
            cmd := fmt.Sprintf("cat %s 2>/dev/null | head -200", path)
            if out, err := session.ExecCommand(cmd); err == nil && strings.TrimSpace(out) != "" {
                app.ConfigFiles = append(app.ConfigFiles, ConfigFile{
                    Path:    path,
                    Content: out,
                })
                rawFiles[path] = out
            }
        }
        
        apps = append(apps, app)
    }
    
    return apps
}

// detectLanguage 根据启动命令判断语言
func detectLanguage(cmd string) string {
    cmd = strings.ToLower(cmd)
    switch {
    case strings.Contains(cmd, "java") || strings.Contains(cmd, "-jar"):
        return "java"
    case strings.Contains(cmd, "php"):
        return "php"
    case strings.Contains(cmd, "python") || strings.Contains(cmd, ".py"):
        return "python"
    case strings.Contains(cmd, "node") || strings.Contains(cmd, ".js"):
        return "node"
    case strings.Contains(cmd, "./") && !strings.Contains(cmd, "java"):
        return "go" // 假设未知二进制是 Go 编译的
    default:
        return ""
    }
}

// getConfigCandidates 返回各语言的配置文件候选路径
func getConfigCandidates(lang, appRoot string) []string {
    switch lang {
    case "java":
        return []string{
            appRoot + "/application.yml",
            appRoot + "/application.yaml",
            appRoot + "/application.properties",
            appRoot + "/config/application.yml",
            appRoot + "/config/application.yaml",
            appRoot + "/config/application.properties",
            appRoot + "/bootstrap.yml",
            appRoot + "/config/bootstrap.yml",
        }
    case "php":
        return []string{
            appRoot + "/.env",
            appRoot + "/config.php",
            appRoot + "/config/database.php",
            appRoot + "/config/app.php",
        }
    case "python":
        return []string{
            appRoot + "/settings.py",
            appRoot + "/.env",
            appRoot + "/config.py",
            appRoot + "/config/settings.py",
        }
    case "node":
        return []string{
            appRoot + "/.env",
            appRoot + "/config.js",
            appRoot + "/config/default.json",
            appRoot + "/config/production.json",
        }
    case "go":
        return []string{
            appRoot + "/conf/app.conf",
            appRoot + "/config.yaml",
            appRoot + "/config.json",
            appRoot + "/.env",
        }
    }
    return nil
}

func parseIntSafe(s string) int {
    var n int
    fmt.Sscanf(s, "%d", &n)
    return n
}

func extractProcessName(s string) string {
    // 简化实现：从 users:(("nginx",pid=123,fd=6)) 中提取 nginx
    if start := strings.Index(s, "\""); start >= 0 {
        if end := strings.Index(s[start+1:], "\""); end >= 0 {
            return s[start+1 : start+1+end]
        }
    }
    return ""
}
```

### 4.3 会话接口说明

Spark 的 Go 代码中已有命令执行和文件读取的封装。上述代码中的 `Session` 接口需要根据 Spark 实际代码适配，通常类似：

```go
// 根据 Spark 实际代码适配
type Session struct {
    // Spark 内部字段
}

func (s *Session) ExecCommand(cmd string) (string, error) {
    // 调用 Spark 的 COMMAND_EXEC 通道
    // 返回命令输出
}
```

请参考 Spark 的 `server/` 目录下处理 `COMMAND_EXEC`、`FILES_LIST`、`FILES_FETCH` 的代码，复用其现有方法。

## 5. 前端实现

### 5.1 设备列表添加按钮

在设备列表的操作列中添加“分析资产”按钮。Spark 前端使用 Ant Design，找到设备列表组件（通常在 `web/src/` 下），在操作列中添加：

```jsx
import { Button, message } from 'antd';

const handleCollectAsset = async (deviceId) => {
  try {
    const res = await fetch(`/api/asset/collect/${deviceId}`, {
      method: 'POST',
    });
    const data = await res.json();
    
    if (data.status === 'success') {
      message.success(
        `采集完成：${data.summary.processes} 个进程，${data.summary.ports} 个端口，${data.summary.applications} 个应用。文件：${data.file}`
      );
    } else {
      message.error('采集失败');
    }
  } catch (err) {
    message.error('请求失败：' + err.message);
  }
};

// 在操作列中添加
<Button 
  type="link" 
  onClick={() => handleCollectAsset(record.id)}
>
  分析资产
</Button>
```

### 5.2 采集进度提示（可选）

如果采集耗时较长，可以添加 `loading` 状态和进度条。基础版本可以先不加，采集完成后一次性提示。

## 6. 数据包结构说明

采集完成后，`./asset-exports/` 目录下会生成 JSON 文件，结构如下：

```json
{
  "meta": {
    "device_id": "device-001",
    "hostname": "prod-web-01",
    "collected_at": "2026-09-29T14:30:00Z",
    "commands_executed": ["ps aux --sort=-%mem | head -40", "ss -tlnp", ...]
  },
  "system": {
    "os": "Ubuntu 22.04.3 LTS",
    "kernel": "5.15.0-91-generic",
    "arch": "x86_64",
    "installed_runtimes": {
      "java": "openjdk version \"17.0.9\"",
      "python": "Python 3.10.12"
    }
  },
  "processes": [
    {
      "pid": 12345,
      "user": "app",
      "cpu_pct": "2.3",
      "mem_pct": "15.2",
      "command": "java -jar /opt/app/myapp.jar",
      "cwd": "/opt/app"
    }
  ],
  "listening_ports": [
    {"port": 8080, "process": "java", "pid": 12345}
  ],
  "applications": [
    {
      "id": "app-12345",
      "language": "java",
      "app_root": "/opt/app",
      "config_files": [
        {
          "path": "/opt/app/application.yml",
          "content": "spring:\n  datasource:\n    url: jdbc:mysql://..."
        }
      ]
    }
  ],
  "raw_files": {
    "/opt/app/application.yml": "spring:\n  datasource:\n    url: jdbc:mysql://..."
  }
}
```

## 7. 构建与验证

### 7.1 构建步骤

参考 Spark 官方构建流程：

```bash
# 1. 编译前端
cd ./web
npm install
npm run build-prod

# 2. 嵌入静态资源
cd ..
go install github.com/rakyll/statik
statik -m -src="./web/dist" -f -dest="./server/embed" -p web -ns web

# 3. 编译 Server
mkdir ./releases
./scripts/build.server.sh
```

### 7.2 验证清单

| 检查项 | 预期结果 |
|---|---|
| 点击“分析资产”按钮 | 请求发送到 `/api/asset/collect/:deviceId` |
| 采集完成后 | 分析机 `./asset-exports/` 目录下生成 JSON 文件 |
| JSON 内容 | 包含 processes、listening_ports、applications、raw_files |
| 目标服务器 | 无任何文件被修改（仅执行了只读命令） |
| 耗时 | 单台服务器 10-30 秒（取决于进程数量和配置文件大小） |

## 8. Claude Code 消费方式

采集完成后，在分析机上运行：

```bash
claude -p "读取 ./asset-exports/prod-web-01-20260929-143000.json，分析这台服务器的架构：
1. 运行了哪些应用，各用什么语言
2. 每个应用的配置文件位置和数据库连接信息
3. 代码结构说明（基于 app_root 和配置文件推断）
4. 整体架构图（Mermaid 格式）
输出到 ./reports/prod-web-01.md"
```

## 9. 注意事项

1. **命令兼容性**：`ss` 命令在部分老系统上可能不存在，代码中已做 `netstat` 回退。
2. **文件读取限制**：配置文件内容用 `head -200` 截断，避免超大文件。如需要完整内容，可调整。
3. **权限**：`/proc/<PID>/cwd` 需要进程属主或 root 权限才能读取。Spark Client 通常以较高权限运行，一般可读取。
4. **敏感信息**：导出的 JSON 中包含配置文件原文，可能含密码。建议在分析完成后及时清理，或对密码字段脱敏。
5. **Go 二进制识别**：无法从 `ps` 命令直接判断 Go 应用，代码中做了简单假设（`./` 开头且非 Java 的进程视为 Go）。可在 Claude Code 分析阶段根据 `app_root` 下是否有 `go.mod` 进一步确认。