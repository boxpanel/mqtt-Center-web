<div align="center">

# MQTT Center Web

**基于 Web 的 MQTT 客户端管理与主题转发控制台**

适用于 ARM（树莓派、香橙派、RK 系列）和 x86 Linux 服务器

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

---

### 一键安装

在 Ubuntu/Debian 服务器上执行以下命令，全自动完成安装和启动：

```bash
curl -fsSL https://raw.githubusercontent.com/boxpanel/mqtt-Center-web/main/install.sh | sudo bash
```

> 脚本自动完成：安装 Node.js → 克隆代码 → 安装依赖 → 构建前端 → 注册 systemd 服务 → 启动服务

安装时需输入服务端口号（默认 `80`），安装完成后通过 `http://<服务器IP>` 直接访问。

---

</div>

## 功能

MQTT Center Web 是一个轻量级的 MQTT 客户端管理工具，通过 Web 界面集中管理多个 MQTT 转发通道。

- **独立 MQTT 客户端** — 每个客户端拥有独立的 Broker 连接，互不影响
- **主题转发** — 配置订阅主题 → 转发主题的映射规则，支持 `+`（单层）和 `#`（多层）通配符
- **动态主题** — 转发主题可使用 `$topic` 引用原始消息主题
- **实时状态** — 连接状态、收发统计实时更新（SSE 推送）
- **启用/禁用** — 可随时开关单个客户端，无需删除配置
- **导入/导出** — Excel 格式批量导入导出客户端配置
- **多进程架构** — 支持 Cluster 模式，充分利用多核 CPU
- **系统监控** — 实时查看服务器 CPU、内存、磁盘使用率
- **UDP 发现** — 自动响应 Hub 广播发现请求，上报本机状态和客户端统计

## 安装方式

### 方式一：一键安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/boxpanel/mqtt-Center-web/main/install.sh | sudo bash
```

安装过程：
1. 自动检测系统架构（ARM/x86）并优化工作进程数
2. 自动安装 Node.js 20 LTS（如果未安装）
3. 克隆代码到 `/opt/mqtt-center-web`
4. 安装依赖并构建前端
5. 注册 systemd 服务并设为开机自启
6. 提示输入端口号（默认 80）
7. 立即启动服务

### 方式二：手动部署

```bash
# 克隆代码
git clone https://github.com/boxpanel/mqtt-Center-web.git
cd mqtt-Center-web

# 安装依赖
npm install

# 构建前端
npm run build

# 启动服务（指定工作进程数）
WORKERS=2 npm start
```

### 方式三：Docker

```bash
docker build -t mqtt-center .
docker run -d -p 8088:8088 -v mqtt-data:/app/data --name mqtt-center mqtt-center
```

## 管理命令（systemd 安装后）

```bash
systemctl status mqtt-center-web    # 查看状态
journalctl -u mqtt-center-web -f    # 查看实时日志
systemctl restart mqtt-center-web   # 重启服务
systemctl stop mqtt-center-web      # 停止服务
```

## 架构

```
┌─────────────┐     HTTP/SSE      ┌──────────────┐      ┌──────────┐
│  Web 前端    │ ◄──────────────► │  主进程       │ ──► │ MQTT 客户端1│
│  (React)    │                   │  MqttManager  │      ├──────────┤
└─────────────┘                   │  IPC 服务器   │ ──► │ MQTT 客户端2│
                                  │  UDP 发现服务  │      ├──────────┤
                                  └──────┬───────┘      │ ...      │
                                         │              └──────────┘
                              ┌──────────┼──────────┐
                              ▼          ▼          ▼
                         Worker 1   Worker 2   Worker N
                        (Express)  (Express)  (Express)
                                  共享端口
```

## 配置说明

客户端配置持久化在 `data/clients.json`。

### 转发规则示例

| 订阅主题 | 转发主题 | 说明 |
|---------|---------|------|
| `sensor/+/temp` | `cloud/sensor/temp` | 固定转发目标 |
| `device/#` | `backup/$topic` | 保留原始主题路径 |
| `home/+/status` | `mirror/home/status` | 通配符匹配 |

### 环境变量

| 变量 | 默认值 | 说明 |
|-----|-------|------|
| `PORT` | `8088` | 服务监听端口 |
| `WORKERS` | CPU 核心数 | 工作进程数量 |
| `LOG_LEVEL` | `info` | 日志级别 |

## API 接口

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/clients` | 获取所有客户端 |
| POST | `/api/clients` | 创建客户端 |
| PUT | `/api/clients/:id` | 更新客户端 |
| DELETE | `/api/clients/:id` | 删除客户端 |
| POST | `/api/clients/batch-delete` | 批量删除 |
| POST | `/api/clients/:id/toggle` | 启用/禁用 |
| GET | `/api/clients/export` | 导出 Excel |
| POST | `/api/clients/import` | 导入 Excel |
| GET | `/api/events` | SSE 实时状态推送 |
| GET | `/api/system` | 系统资源监控 |
| GET | `/api/health` | 健康检查 |

## 许可证

MIT
