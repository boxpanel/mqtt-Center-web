#!/bin/bash
set -e

# ─────────────────────────────────────────────
# MQTT Center Web - 一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/boxpanel/mqtt-Center-web/main/install.sh | bash
# ─────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ── 1. 检查 Node.js ──
if ! command -v node &>/dev/null; then
  error "未检测到 Node.js，请先安装 Node.js >= 18"
  echo "  建议安装方法："
  echo "  - Debian/Ubuntu: curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs"
  echo "  - ARM64 (树莓派): 同上命令即可"
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  error "Node.js 版本过低 ($(node -v))，需要 >= 18"
  exit 1
fi
info "Node.js $(node -v) ✓"

# ── 2. 检测架构，优化 WORKERS 数量 ──
ARCH=$(uname -m)
CPU_CORES=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1)

if echo "$ARCH" | grep -qiE 'aarch64|armv'; then
  # ARM 架构：按核心数的一半配置，最多 2 个
  RECOMMENDED_WORKERS=$(( CPU_CORES > 2 ? 2 : 1 ))
  info "检测到 ARM 架构 ($ARCH)，建议 WORKERS=$RECOMMENDED_WORKERS"
else
  RECOMMENDED_WORKERS=$(( CPU_CORES > 4 ? 4 : CPU_CORES ))
  info "检测到 x86 架构 ($ARCH)，建议 WORKERS=$RECOMMENDED_WORKERS"
fi

# ── 3. 进入项目目录（如果是 curl 管道安装，需要先 clone） ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd 2>/dev/null || pwd)"
if [ "$SCRIPT_DIR" = "/" ] || [ ! -f "$SCRIPT_DIR/package.json" ]; then
  # 通过 curl 管道安装，需要 clone
  if command -v git &>/dev/null; then
    TARGET_DIR="$HOME/mqtt-center-web"
    info "克隆仓库到 $TARGET_DIR"
    git clone --depth=1 https://github.com/boxpanel/mqtt-Center-web.git "$TARGET_DIR"
    cd "$TARGET_DIR"
  else
    error "未检测到 git，请先安装 git 或手动下载代码"
    exit 1
  fi
else
  cd "$SCRIPT_DIR"
  info "使用当前目录: $(pwd)"
fi

# ── 4. 安装依赖 ──
info "安装服务端依赖..."
npm install --production

info "安装前端依赖..."
cd client
npm install --production
cd ..

# ── 5. 构建前端 ──
info "构建前端..."
npm run build

# ── 6. 准备数据目录 ──
mkdir -p data

# ── 7. 完成 ──
info "安装完成！"
echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  启动命令:                                  │"
echo "  │                                             │"
echo "  │    WORKERS=$RECOMMENDED_WORKERS npm start          │"
echo "  │                                             │"
echo "  │  或后台运行:                                │"
echo "  │    WORKERS=$RECOMMENDED_WORKERS nohup npm start &  │"
echo "  │                                             │"
echo "  │  访问地址: http://<本机IP>:8088              │"
echo "  └─────────────────────────────────────────────┘"
echo ""
