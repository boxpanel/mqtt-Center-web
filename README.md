# MQTT Center Web

基于 Web 的 MQTT 客户端管理与主题转发控制台，适用于 ARM 架构 Linux 服务器（树莓派、香橙派等）。

## 功能

- **独立 MQTT 客户端**：每个客户端拥有独立的 Broker 连接，互不影响
- **增删改查**：通过 Web 界面自由创建、编辑、删除客户端
- **主题转发**：配置订阅主题 → 转发主题的映射规则
- **MQTT 通配符**：支持 `+`（单层）和 `#`（多层）通配符
- **动态主题**：转发主题可使用 `$topic` 引用原始消息主题
- **实时状态**：连接状态、收发统计实时更新
- **启用/禁用**：可随时开关单个客户端，无需删除配置

## 架构

```
┌─────────────┐     HTTP/SSE      ┌──────────────┐
│  Web 前端    │ ◄──────────────► │  Express API  │
│  (React)    │                   │  (Node.js)    │
└─────────────┘                   └──────┬───────┘
                                         │
                              ┌──────────┼──────────┐
                              ▼          ▼          ▼
                         MQTT Client  MQTT Client  ...
                         (独立连接)    (独立连接)
                              │          │
                              ▼          ▼
                           Broker     Broker
```

## 快速开始

### 环境要求

- Node.js >= 18（ARM64/ARM32 均支持）
- 可选：MQTT Broker（如 Mosquitto）

### 开发模式

```bash
# 安装依赖
npm install

# 同时启动后端 (8088) 和前端开发服务器 (5173)
npm run dev
```

浏览器访问 http://localhost:5173

### 生产部署

```bash
# 构建前端
npm run build

# 启动服务（默认端口 8088）
npm start

# 或指定端口
PORT=8080 npm start
```

浏览器访问 http://服务器IP:8088

## ARM Linux 部署

### 方式一：直接部署

```bash
# 1. 安装 Node.js（以 Debian/Ubuntu ARM 为例）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 上传项目到服务器
cd /opt/mqtt-center-web

# 3. 安装并构建
npm install
npm run build

# 4. 启动
npm start
```

### 方式二：systemd 服务

创建 `/etc/systemd/system/mqtt-center.service`：

```ini
[Unit]
Description=MQTT Center Web
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/mqtt-center-web
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=10
Environment=PORT=8088

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable mqtt-center
sudo systemctl start mqtt-center
```

### 方式三：Docker（ARM）

```bash
docker build -t mqtt-center .
docker run -d -p 8088:8088 -v mqtt-data:/app/data --name mqtt-center mqtt-center
```

## 配置说明

客户端配置持久化在 `data/clients.json`。

### 转发规则示例

| 订阅主题 | 转发主题 | 说明 |
|---------|---------|------|
| `sensor/+/temp` | `cloud/sensor/temp` | 固定转发目标 |
| `device/#` | `backup/$topic` | 保留原始主题路径 |
| `home/+/status` | `mirror/home/status` | 通配符匹配后固定转发 |

### 环境变量

| 变量 | 默认值 | 说明 |
|-----|-------|------|
| `PORT` | `8088` | 服务监听端口 |

## API 接口

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/clients` | 获取所有客户端 |
| POST | `/api/clients` | 创建客户端 |
| PUT | `/api/clients/:id` | 更新客户端 |
| DELETE | `/api/clients/:id` | 删除客户端 |
| POST | `/api/clients/:id/toggle` | 启用/禁用 |
| GET | `/api/events` | SSE 实时状态推送 |
| GET | `/api/health` | 健康检查 |

## 许可证

MIT
