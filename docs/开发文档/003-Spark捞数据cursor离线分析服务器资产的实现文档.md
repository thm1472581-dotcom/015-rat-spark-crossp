# Spark RAT “分析资产”按钮完整实现文档（Cursor 离线分析版）

## 1. 项目概述

本文档描述如何在 Spark RAT 项目中新增一个“分析资产”按钮，点击后通过 Spark 的远程命令执行通道，采集目标服务器的系统信息、进程、网络连接、应用配置等数据，最终导出为结构化 JSON 数据包，供 **Cursor** 离线分析。

**核心原则**：
- **只读操作**：所有采集命令均为只读（`ps`、`ss`、`cat`、`ls` 等），不修改目标服务器任何文件
- **数据采集与分析分离**：Spark 负责“取数据”，Cursor 负责“分析数据”
- **单设备串行**：一次只分析一台设备，对分析机资源要求低
- **线索优先**：采集的不只是“数据”，而是能指向“这是什么应用、怎么跑的”的元数据

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
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    分析机（Cursor IDE）                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  打开 asset-exports/*.json                          │   │
│  │  在 Chat 中 @ 引用该 JSON                            │   │
│  │  下达分析指令，输出架构报告到 reports/*.md            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 3. 技术栈

- **后端**：Go + Gin 框架（Spark Server 已有）
- **前端**：React + Ant Design（Spark Web 已有）
- **通信通道**：Spark 已有 WebSocket + 命令执行接口
- **分析器**：Cursor IDE（本地已有，token 可直接使用）

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
    Connections    []ConnInfo         `json:"established_connections"`
    Services       []ServiceInfo      `json:"services"`
    Containers     []ContainerInfo    `json:"containers"`
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
    Command string `json:"command"`         // 来自 ps aux，可能被截断
    Cmdline string `json:"cmdline,omitempty"` // 来自 /proc/<PID>/cmdline，完整启动参数
    Cwd     string `json:"cwd,omitempty"`
    Environ map[string]string `json:"environ,omitempty"` // 关键环境变量（已过滤）
    SystemdUnit string `json:"systemd_unit,omitempty"`   // 所属 systemd unit
    ContainerID string `json:"container_id,omitempty"`   // 若在容器内
}

type PortInfo struct {
    Port    int    `json:"port"`
    Process string `json:"process"`
    PID     int    `json:"pid,omitempty"`
}

type ConnInfo struct {
    LocalAddr  string `json:"local_addr"`
    RemoteAddr string `json:"remote_addr"`
    State      string `json:"state"`
    PID        int    `json:"pid,omitempty"`
    Process    string `json:"process,omitempty"`
    // 用于推断依赖关系：目标端口常见服务名（3306=mysql, 6379=redis 等）
    RemoteService string `json:"remote_service,omitempty"`
}

type ServiceInfo struct {
    Name        string `json:"name"`
    State       string `json:"state"`
    ExecStart   string `json:"exec_start,omitempty"`
    WorkingDir  string `json:"working_dir,omitempty"`
    Environment string `json:"environment,omitempty"`
    UnitPath    string `json:"unit_path,omitempty"`
}

type ContainerInfo struct {
    ID      string   `json:"id"`
    Image   string   `json:"image"`
    Names   string   `json:"names"`
    Ports   string   `json:"ports"`
    Mounts  []string `json:"mounts,omitempty"`
    Command string   `json:"command,omitempty"`
}

type ApplicationInfo struct {
    ID            string   `json:"id"`
    Language      string   `json:"language"`
    AppRoot       string   `json:"app_root"`
    DeployType    string   `json:"deploy_type,omitempty"` // systemd / docker / bare
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

    // 3. 采集 systemd 服务（部署形态线索）
    pkg.Services = collectServices(session, &pkg.Meta)

    // 4. 采集 Docker 容器（部署形态线索）
    pkg.Containers = collectContainers(session, &pkg.Meta)

    // 5. 采集进程信息（含 cmdline、environ、cwd、systemd/container 归属）
    pkg.Processes = collectProcesses(session, pkg.Services, pkg.Containers, &pkg.Meta)

    // 6. 采集监听端口
    pkg.ListeningPorts = collectPorts(session, &pkg.Meta)

    // 7. 采集已建立连接（应用间依赖关系线索）
    pkg.Connections = collectConnections(session, &pkg.Meta)

    // 8. 识别应用并采集配置
    pkg.Applications = collectApplications(session, pkg.Processes, &pkg.Meta, pkg.RawFiles)

    // 9. 导出为 JSON 文件
    outputDir := "./asset-exports"
    os.MkdirAll(outputDir, 0755)
    filename := fmt.Sprintf("%s-%s.json", deviceId, time.Now().Format("20060102-150405"))
    outputPath := filepath.Join(outputDir, filename)

    data, _ := json.MarshalIndent(pkg, "", "  ")
    os.WriteFile(outputPath, data, 0644)

    c.JSON(http.StatusOK, gin.H{
        "status": "success",
        "device": deviceId,
        "file":   outputPath,
        "summary": gin.H{
            "processes":    len(pkg.Processes),
            "ports":        len(pkg.ListeningPorts),
            "connections":  len(pkg.Connections),
            "services":     len(pkg.Services),
            "containers":   len(pkg.Containers),
            "applications": len(pkg.Applications),
        },
    })
}

// collectSystemInfo 采集系统基本信息
func collectSystemInfo(session *Session, meta *MetaInfo) SystemInfo {
    info := SystemInfo{Runtimes: make(map[string]string)}

    if out, err := session.ExecCommand("hostname"); err == nil {
        meta.Hostname = strings.TrimSpace(out)
    }

    cmd := "cat /etc/os-release | head -2"
    meta.CommandsRun = append(meta.CommandsRun, cmd)
    if out, err := session.ExecCommand(cmd); err == nil {
        info.OS = strings.TrimSpace(out)
    }

    cmd = "uname -r"
    meta.CommandsRun = append(meta.CommandsRun, cmd)
    if out, err := session.ExecCommand(cmd); err == nil {
        info.Kernel = strings.TrimSpace(out)
    }

    cmd = "uname -m"
    meta.CommandsRun = append(meta.CommandsRun, cmd)
    if out, err := session.ExecCommand(cmd); err == nil {
        info.Arch = strings.TrimSpace(out)
    }

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

// collectServices 采集 systemd 服务（部署形态线索）
func collectServices(session *Session, meta *MetaInfo) []ServiceInfo {
    var services []ServiceInfo

    // 只取 running 状态的服务，减少噪音
    cmd := "systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null"
    meta.CommandsRun = append(meta.CommandsRun, cmd)
    out, err := session.ExecCommand(cmd)
    if err != nil {
        return services
    }

    for _, line := range strings.Split(out, "\n") {
        line = strings.TrimSpace(line)
        if line == "" {
            continue
        }
        fields := strings.Fields(line)
        if len(fields) < 1 {
            continue
        }
        unitName := fields[0]
        svc := ServiceInfo{Name: unitName, State: "running"}

        // 读取 unit 文件内容（含 ExecStart / WorkingDirectory / Environment）
        unitPaths := []string{
            "/etc/systemd/system/" + unitName,
            "/usr/lib/systemd/system/" + unitName,
        }
        for _, p := range unitPaths {
            cmd := fmt.Sprintf("cat %s 2>/dev/null", p)
            if content, err := session.ExecCommand(cmd); err == nil && strings.TrimSpace(content) != "" {
                svc.UnitPath = p
                svc.ExecStart = extractUnitField(content, "ExecStart")
                svc.WorkingDir = extractUnitField(content, "WorkingDirectory")
                svc.Environment = extractUnitField(content, "Environment")
                break
            }
        }
        services = append(services, svc)
    }

    return services
}

// extractUnitField 从 systemd unit 文件内容中提取指定字段
func extractUnitField(content, field string) string {
    for _, line := range strings.Split(content, "\n") {
        line = strings.TrimSpace(line)
        if strings.HasPrefix(line, field+"=") {
            return strings.TrimPrefix(line, field+"=")
        }
    }
    return ""
}

// collectContainers 采集 Docker 容器（部署形态线索）
func collectContainers(session *Session, meta *MetaInfo) []ContainerInfo {
    var containers []ContainerInfo

    cmd := "docker ps --no-trunc --format '{{.ID}}|{{.Image}}|{{.Names}}|{{.Ports}}|{{.Command}}' 2>/dev/null"
    meta.CommandsRun = append(meta.CommandsRun, cmd)
    out, err := session.ExecCommand(cmd)
    if err != nil || strings.TrimSpace(out) == "" {
        return containers
    }

    for _, line := range strings.Split(out, "\n") {
        line = strings.TrimSpace(line)
        if line == "" {
            continue
        }
        parts := strings.Split(line, "|")
        if len(parts) < 5 {
            continue
        }
        c := ContainerInfo{
            ID:      parts[0],
            Image:   parts[1],
            Names:   parts[2],
            Ports:   parts[3],
            Command: parts[4],
        }
        // 采集挂载信息（用于推断 app_root 与宿主机的映射）
        cmdMount := fmt.Sprintf("docker inspect -f '{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}' %s 2>/dev/null", parts[0])
        if mounts, err := session.ExecCommand(cmdMount); err == nil {
            for _, m := range strings.Fields(mounts) {
                c.Mounts = append(c.Mounts, m)
            }
        }
        containers = append(containers, c)
    }

    return containers
}

// collectProcesses 采集进程列表（含 cmdline、environ、cwd、归属）
func collectProcesses(session *Session, services []ServiceInfo, containers []ContainerInfo, meta *MetaInfo) []ProcessInfo {
    var processes []ProcessInfo
    cmd := "ps aux --sort=-%mem | head -60"
    meta.CommandsRun = append(meta.CommandsRun, cmd)

    out, err := session.ExecCommand(cmd)
    if err != nil {
        return processes
    }

    lines := strings.Split(out, "\n")
    for i, line := range lines {
        if i == 0 || strings.TrimSpace(line) == "" {
            continue
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

    // 对每个进程补充：cmdline、cwd、environ、systemd/container 归属
    for i := range processes {
        pid := processes[i].PID
        if pid <= 0 {
            continue
        }

        // 完整启动参数（比 ps aux 更全，含未截断的参数）
        cmd := fmt.Sprintf("cat /proc/%d/cmdline 2>/dev/null | tr '\\0' ' '", pid)
        if out, err := session.ExecCommand(cmd); err == nil && strings.TrimSpace(out) != "" {
            processes[i].Cmdline = strings.TrimSpace(out)
        }

        // 工作目录
        cmd = fmt.Sprintf("ls -l /proc/%d/cwd 2>/dev/null", pid)
        if out, err := session.ExecCommand(cmd); err == nil {
            if parts := strings.Split(out, "->"); len(parts) == 2 {
                processes[i].Cwd = strings.TrimSpace(parts[1])
            }
        }

        // 关键环境变量（过滤后只保留能表明“这是什么应用/什么环境”的）
        cmd = fmt.Sprintf("cat /proc/%d/environ 2>/dev/null | tr '\\0' '\\n'", pid)
        if out, err := session.ExecCommand(cmd); err == nil {
            processes[i].Environ = filterEnviron(out)
        }

        // 归属到 systemd unit（通过 cgroup 路径判断）
        cmd = fmt.Sprintf("cat /proc/%d/cgroup 2>/dev/null", pid)
        if out, err := session.ExecCommand(cmd); err == nil {
            if unit := matchSystemdUnit(out, services); unit != "" {
                processes[i].SystemdUnit = unit
            }
            if cid := matchContainer(out, containers); cid != "" {
                processes[i].ContainerID = cid
            }
        }
    }

    return processes
}

// filterEnviron 从 /proc/<PID>/environ 中过滤出关键环境变量
func filterEnviron(raw string) map[string]string {
    result := make(map[string]string)
    // 只保留这些前缀的变量——它们能表明应用类型/运行环境
    keepPrefixes := []string{
        "NODE_ENV", "JAVA_OPTS", "JAVA_HOME", "SPRING_",
        "PYTHON", "VIRTUAL_ENV", "DJANGO_",
        "APP_ENV", "APP_NAME", "ENV", "PROFILE",
        "DB_", "DATABASE_", "REDIS_", "MYSQL_", "PG_",
        "PATH", "PWD", "HOME", "USER",
    }
    for _, line := range strings.Split(raw, "\n") {
        line = strings.TrimSpace(line)
        if line == "" || !strings.Contains(line, "=") {
            continue
        }
        kv := strings.SplitN(line, "=", 2)
        key := kv[0]
        for _, prefix := range keepPrefixes {
            if strings.HasPrefix(key, prefix) {
                val := kv[1]
                if len(val) > 200 {
                    val = val[:200] + "..."
                }
                result[key] = val
                break
            }
        }
    }
    return result
}

// matchSystemdUnit 通过 cgroup 路径判断进程属于哪个 systemd unit
func matchSystemdUnit(cgroup, services []ServiceInfo) string {
    // cgroup 路径通常形如：/system.slice/nginx.service
    for _, svc := range services {
        if strings.Contains(cgroup, svc.Name) {
            return svc.Name
        }
    }
    return ""
}

// matchContainer 通过 cgroup 路径判断进程属于哪个容器
func matchContainer(cgroup string, containers []ContainerInfo) string {
    // Docker cgroup 路径通常包含容器 ID 前缀
    for _, c := range containers {
        if len(c.ID) >= 12 && strings.Contains(cgroup, c.ID[:12]) {
            return c.ID[:12]
        }
    }
    return ""
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
        addr := fields[3]
        if idx := strings.LastIndex(addr, ":"); idx > 0 {
            port := parseIntSafe(addr[idx+1:])
            if port > 0 {
                p := PortInfo{Port: port}
                if len(fields) >= 6 {
                    p.Process = extractProcessName(fields[5])
                    p.PID = extractPID(fields[5])
                }
                ports = append(ports, p)
            }
        }
    }

    return ports
}

// collectConnections 采集已建立的 TCP 连接（应用间依赖关系线索）
func collectConnections(session *Session, meta *MetaInfo) []ConnInfo {
    var conns []ConnInfo
    cmd := "ss -tnp state established 2>/dev/null || netstat -tnp 2>/dev/null | grep ESTABLISHED"
    meta.CommandsRun = append(meta.CommandsRun, cmd)

    out, err := session.ExecCommand(cmd)
    if err != nil {
        return conns
    }

    for _, line := range strings.Split(out, "\n") {
        line = strings.TrimSpace(line)
        if line == "" || !strings.Contains(line, "ESTAB") {
            continue
        }
        fields := strings.Fields(line)
        if len(fields) < 5 {
            continue
        }
        conn := ConnInfo{
            LocalAddr:  fields[3],
            RemoteAddr: fields[4],
            State:      "ESTABLISHED",
        }
        // 提取 PID 和进程名
        for _, f := range fields[5:] {
            if strings.Contains(f, "pid=") {
                conn.PID = extractPID(f)
                conn.Process = extractProcessName(f)
                break
            }
        }
        // 标注远端端口对应的常见服务
        conn.RemoteService = guessRemoteService(conn.RemoteAddr)
        conns = append(conns, conn)
    }

    return conns
}

// guessRemoteService 根据远端端口推断常见服务
func guessRemoteService(remoteAddr string) string {
    idx := strings.LastIndex(remoteAddr, ":")
    if idx < 0 {
        return ""
    }
    port := parseIntSafe(remoteAddr[idx+1:])
    switch port {
    case 3306:
        return "mysql"
    case 5432:
        return "postgresql"
    case 6379:
        return "redis"
    case 27017:
        return "mongodb"
    case 9200:
        return "elasticsearch"
    case 5672:
        return "rabbitmq"
    case 9092:
        return "kafka"
    case 2181:
        return "zookeeper"
    case 80, 8080, 8000:
        return "http"
    case 443, 8443:
        return "https"
    }
    return ""
}

// collectApplications 识别应用并采集配置
func collectApplications(session *Session, processes []ProcessInfo, meta *MetaInfo, rawFiles map[string]string) []ApplicationInfo {
    var apps []ApplicationInfo
    seen := make(map[string]bool)

    for _, p := range processes {
        // 优先用 cmdline，回退到 command
        cmdStr := p.Cmdline
        if cmdStr == "" {
            cmdStr = p.Command
        }
        if p.Cwd == "" || seen[p.Cwd] {
            continue
        }

        lang := detectLanguage(cmdStr)
        if lang == "" {
            continue
        }
        seen[p.Cwd] = true

        app := ApplicationInfo{
            ID:       fmt.Sprintf("app-%d", p.PID),
            Language: lang,
            AppRoot:  p.Cwd,
        }

        // 标注部署形态
        if p.ContainerID != "" {
            app.DeployType = "docker"
        } else if p.SystemdUnit != "" {
            app.DeployType = "systemd"
        } else {
            app.DeployType = "bare"
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
        return "go" // 未知二进制暂按 Go 处理，Cursor 分析阶段可结合 app_root 下是否有 go.mod 进一步确认
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
    // 从 users:(("nginx",pid=123,fd=6)) 或 pid=123,comm="nginx" 中提取进程名
    if start := strings.Index(s, "\""); start >= 0 {
        if end := strings.Index(s[start+1:], "\""); end >= 0 {
            return s[start+1 : start+1+end]
        }
    }
    return ""
}

func extractPID(s string) int {
    // 从 pid=123 或 pid=123, 中提取 PID
    idx := strings.Index(s, "pid=")
    if idx < 0 {
        return 0
    }
    rest := s[idx+4:]
    end := strings.IndexAny(rest, ",)")
    if end < 0 {
        end = len(rest)
    }
    return parseIntSafe(rest[:end])
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
        `采集完成：${data.summary.processes} 个进程，${data.summary.ports} 个端口，` +
        `${data.summary.connections} 条连接，${data.summary.services} 个服务，` +
        `${data.summary.containers} 个容器，${data.summary.applications} 个应用。文件：${data.file}`
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
    "commands_executed": ["ps aux --sort=-%mem | head -60", "ss -tlnp", ...]
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
      "cmdline": "/usr/bin/java -jar /opt/app/myapp.jar --spring.profiles.active=prod",
      "cwd": "/opt/app",
      "environ": {
        "JAVA_OPTS": "-Xmx2g -Xms1g",
        "SPRING_PROFILES_ACTIVE": "prod"
      },
      "systemd_unit": "myapp.service"
    }
  ],
  "listening_ports": [
    {"port": 8080, "process": "java", "pid": 12345}
  ],
  "established_connections": [
    {
      "local_addr": "10.0.0.5:54321",
      "remote_addr": "10.0.0.10:3306",
      "state": "ESTABLISHED",
      "pid": 12345,
      "process": "java",
      "remote_service": "mysql"
    }
  ],
  "services": [
    {
      "name": "myapp.service",
      "state": "running",
      "exec_start": "/usr/bin/java -jar /opt/app/myapp.jar",
      "working_dir": "/opt/app",
      "environment": "SPRING_PROFILES_ACTIVE=prod",
      "unit_path": "/etc/systemd/system/myapp.service"
    }
  ],
  "containers": [
    {
      "id": "abc123def456...",
      "image": "redis:7-alpine",
      "names": "redis-cache",
      "ports": "0.0.0.0:6379->6379/tcp",
      "mounts": ["/data/redis:/data"],
      "command": "redis-server"
    }
  ],
  "applications": [
    {
      "id": "app-12345",
      "language": "java",
      "app_root": "/opt/app",
      "deploy_type": "systemd",
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

## 7. Cursor 离线分析流程

### 7.1 分析前置条件

- Cursor IDE 已安装并能正常使用 AI Chat
- 分析机的 Cursor 工作区根目录就是 Spark Server 运行目录（保证 `./asset-exports/` 相对路径可用）
- 生成好的 JSON 文件位于 `./asset-exports/` 下

### 7.2 操作步骤

1. **采集数据**：在 Spark Web UI 点击“分析资产”，等待成功提示，记下返回的文件路径（如 `./asset-exports/prod-web-01-20260929-143000.json`）。
2. **打开文件**：在 Cursor 中打开该 JSON 文件，确认内容完整（文件较大时可只滚动看头尾）。
3. **引用文件**：在 Cursor 的 Chat 窗口中，用 `@` 引用该 JSON 文件（例如 `@asset-exports/prod-web-01-20260929-143000.json`）。**这一步是必须的**——Cursor 不会自动扫描目录。
4. **下达分析指令**：粘贴 7.3 中的指令，让 Cursor 输出报告。
5. **保存报告**：让 Cursor 把结果写入 `./reports/` 下的 Markdown 文件，或直接复制到新文件中。

### 7.3 推荐的分析指令

不要只给一句“分析这台服务器”。Cursor 需要像一位有经验的工程师一样，收到具体的推理任务。下面是推荐指令（可按需调整）：

```
@asset-exports/prod-web-01-20260929-143000.json

读取这个资产 JSON，按以下要求输出一份服务器架构分析报告：

1. 应用清单
   - 基于 applications 字段和 processes 字段中的 cmdline，列出这台机器上部署了几个独立的业务应用。
   - 每个应用标注：语言、app_root、deploy_type（systemd / docker / bare）。
   - 若 deploy_type 为 systemd，引用 services 字段里的 exec_start 作为佐证。

2. 依赖关系
   - 结合 established_connections 字段和 raw_files 里的配置文件内容，
     推断每个应用连了哪些本地/远端服务（数据库、缓存、消息队列等）。
   - 用 Mermaid 流程图画出应用间的调用与依赖关系。
   - 对每条远端连接，标注 remote_service 字段（mysql/redis/...）。

3. 部署形态
   - 如果 containers 字段非空，单独列出容器化组件，标注镜像、端口、挂载。
   - 对同一应用同时出现在 systemd 和 docker 中的情况，特别说明（可能是容器内进程被误识别为裸机进程）。

4. 配置与风险
   - 从 raw_files 中找出明文数据库连接串、密码、密钥路径，用列表列出（不要复述完整密码，只标位置）。
   - 标出监听在 0.0.0.0 的端口，说明是否应该只监听内网。

5. 输出格式
   - Markdown 格式。
   - 包含一个 Mermaid 架构图。
   - 报告写入 ./reports/prod-web-01.md。
```

### 7.4 为什么这比 Claude Code 更顺手

- **可视化**：JSON 文件在 Cursor 里可以直接展开、折叠、搜索，比命令行里 `cat` 一大坨更直观。
- **可迭代**：第一轮分析完，你可以继续追问“第 3 个应用的配置文件里还有什么”“把架构图改成横向布局”，无需重新喂数据。
- **可引用代码**：Cursor 能同时 `@` 你的采集代码和 JSON，让 AI 对照着采集逻辑来分析数据（排查误报时很有用）。
- **token 复用**：本地已有 Cursor 环境，无需额外配置命令行工具。

## 8. 构建与验证

### 8.1 构建步骤

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

### 8.2 验证清单

| 检查项 | 预期结果 |
|---|---|
| 点击“分析资产”按钮 | 请求发送到 `/api/asset/collect/:deviceId` |
| 采集完成后 | 分析机 `./asset-exports/` 目录下生成 JSON 文件 |
| JSON 内容 | 包含 processes、listening_ports、established_connections、services、containers、applications、raw_files |
| 进程字段 | 每条进程包含 cmdline、cwd、environ（关键变量已过滤）、systemd_unit 或 container_id |
| 目标服务器 | 无任何文件被修改（仅执行了只读命令） |
| 耗时 | 单台服务器 30-60 秒（进程数多、systemd/docker 采集会增加耗时） |
| Cursor 引用 JSON | Chat 能正常读取文件并基于内容回答 |

## 9. 注意事项

1. **命令兼容性**：`ss` 命令在部分老系统上可能不存在，代码中已做 `netstat` 回退。`systemctl` 和 `docker` 在非 systemd 系统或未装 Docker 的机器上会返回空，代码已做容错。
2. **文件读取限制**：配置文件内容用 `head -200` 截断，避免超大文件。如需要完整内容，可调整。
3. **权限**：`/proc/<PID>/cwd`、`/proc/<PID>/environ`、`/proc/<PID>/cgroup` 需要进程属主或 root 权限才能读取。Spark Client 通常以较高权限运行，一般可读取。environ 里可能含敏感变量（如 `DB_PASSWORD`），已通过 `filterEnviron` 过滤掉大部分敏感键，但 `DB_` 前缀保留的变量仍需注意——如担心泄露，可在 `filterEnviron` 里进一步剔除含 `PASSWORD`、`SECRET`、`TOKEN` 的 key。
4. **敏感信息**：导出的 JSON 中包含配置文件原文，可能含密码。建议在 Cursor 分析完成后及时清理，或对密码字段脱敏。
5. **Go 二进制识别**：无法从 `ps` 命令直接判断 Go 应用，代码中做了简单假设（`./` 开头且非 Java 的进程视为 Go）。可在 Cursor 分析阶段结合 `app_root` 下是否有 `go.mod`、`go.sum` 进一步确认。
6. **容器内进程误判**：Docker 容器内的进程在宿主机 `ps` 里也能看到，通过 `matchContainer` 依据 cgroup 路径把它们归类到容器，避免被当作裸机应用。但若容器使用了非标准运行时（如 `containerd` 直接调用），cgroup 路径可能不匹配，需要在 Cursor 分析时结合 `containers` 字段交叉验证。
7. **数据量控制**：`ps aux` 只取前 60 条（按内存排序），避免进程数过多时数据包过大。如果目标服务器上关键应用内存占用低（比如小服务），可能被截断。可在代码里把 `head -60` 调大，或在 Cursor 分析时说明“这是按内存排序的前 60 条，不是全量”。
8. **Cursor 上下文限制**：JSON 文件过大时（比如配置文件内容很多），Cursor Chat 可能因上下文长度限制而截断。建议对超大 JSON 用 `jq` 拆分（如按 `applications`、`connections` 分别生成子文件）后再分析。