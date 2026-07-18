# Spark 开发部署指南

本文档覆盖：**环境搭建 -> 源码编译 -> 服务端部署 -> Web 生成被控端 -> 被控端上线验证**。

适用路径：`A:\000-work\001-project\158-remote-control\102-rat-spark-crossp`

---

## 1. 环境要求

### 1.1 通用

| 工具 | 版本建议 | 用途 |
|------|----------|------|
| Git | 任意 | 拉代码、注入 Commit 版本号 |
| Go | **1.18+** | 编译服务端/被控端 |
| Node.js | **16+**（推荐 18 LTS） | 编译前端 |
| npm | 随 Node | 安装 web 依赖 |

验证：

```powershell
git --version
go version
node -v
npm -v
```

### 1.2 statik 工具（嵌入前端静态资源）

```powershell
go env -w GOPROXY=https://goproxy.cn,https://mirrors.aliyun.com/goproxy/,https://goproxy.io,direct
go install github.com/rakyll/statik@latest
```

确保 `%USERPROFILE%\go\bin` 在 PATH 中。

---

## 2. 完整编译流程

```
[1] web 前端 build
[2] statik 嵌入 server/embed/web
[3] 交叉编译 client -> built/
[4] 交叉编译 server -> releases/
[5] 部署：server + config.json + built/
```

### 2.1 编译前端

```powershell
cd A:\000-work\001-project\158-remote-control\102-rat-spark-crossp\web
npm install
npm run build-prod
```

### 2.2 嵌入静态资源

```powershell
cd A:\000-work\001-project\158-remote-control\102-rat-spark-crossp
statik -m -src="./web/dist" -f -dest="./server/embed" -p web -ns web
```

或：`cd scripts; .\build.web.bat`

### 2.3 编译被控端模板（built/）

```powershell
cd A:\000-work\001-project\158-remote-control\102-rat-spark-crossp
mkdir built -Force
go mod tidy
go mod download
.\scripts\build.client.bat
```

**单平台快速测试：**

```powershell
$env:GOOS="windows"; $env:GOARCH="amd64"
$commit = git rev-parse HEAD
go build -ldflags "-s -w -X 'Spark/client/config.Commit=$commit'" -o ./built/windows_amd64 Spark/client
```

### 2.4 编译服务端

```powershell
mkdir releases -Force
$commit = git rev-parse HEAD
go build -ldflags "-s -w -X 'Spark/server/config.Commit=$commit'" -tags=jsoniter -o ./releases/server_windows_amd64.exe Spark/server
```

**注意：** `build.server.bat` 中 Linux 目标误写为 `Spark/Server`，需改为 `Spark/server`。

---

## 3. 服务端配置

`config.json`：

```json
{
  "listen": ":8000",
  "salt": "your_random_salt_24",
  "auth": { "admin": "StrongPassword123" },
  "log": { "level": "info", "path": "./logs", "days": 7 }
}
```

| 字段 | 说明 |
|------|------|
| listen | 如 `:8000` |
| salt | 必填，<=24 字符；修改后须重新生成所有客户端 |
| auth | Web 登录凭据 |

---

## 4. 部署服务端

目录结构：

```
deploy/
├── server_windows_amd64.exe
├── config.json
├── built/          # 必须与 exe 同级
│   ├── windows_amd64
│   └── linux_amd64
└── logs/
```

启动：

```powershell
.\server_windows_amd64.exe -config config.json
```

防火墙开放 TCP 8000（或 listen 端口）。

---

## 5. 生成与部署被控端

1. 浏览器访问 `http://<IP>:8000/`，登录 auth 账号
2. Overview -> 生成客户端：填写 Host（被控端可达 IP）、Port、Path、OS/Arch
3. 下载后在目标机运行（Linux: `chmod +x client && ./client`）

**上线成功：** Overview 出现 hostname/OS/Ping；日志 `CLIENT_ONLINE`。

**排查：**

| 现象 | 处理 |
|------|------|
| NO_PREBUILT_FOUND | 编译 built/{os}_{arch} |
| 客户端闪退 | 勿直接运行 built 模板，须 Web 生成 |
| 无法连接 | 检查 Host/Port、防火墙 |
| salt 变更 | 重新生成全部客户端 |

---

## 6. 一键全量构建（Windows）

```powershell
cd A:\000-work\001-project\158-remote-control\102-rat-spark-crossp
cd web; npm install; npm run build-prod; cd ..
go install github.com/rakyll/statik@latest
statik -m -src="./web/dist" -f -dest="./server/embed" -p web -ns web
go mod tidy
mkdir built, releases -Force
.\scripts\build.client.bat
$commit = git rev-parse HEAD
go build -ldflags "-s -w -X 'Spark/server/config.Commit=$commit'" -tags=jsoniter -o ./releases/server_windows_amd64.exe Spark/server
```

---

## 7. 相关文档

- [architecture.md](./architecture.md)
- 项目根目录 `API.ZH.md`、`README.ZH.md`
