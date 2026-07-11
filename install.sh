#!/bin/bash
# =============================================================================
# MQTT Center Web - 一键安装脚本 (像 1Panel 一样，一条命令全自动安装)
# =============================================================================
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/boxpanel/mqtt-Center-web/main/install.sh | bash
#
# 自动完成:
#   1. 安装 Node.js (如未安装)
#   2. 安装 git (如未安装)
#   3. 克隆代码仓库
#   4. 安装项目依赖 + 构建前端
#   5. 注册 systemd 服务（开机自启 + 后台运行）
#   6. 立即启动服务
# =============================================================================

set -e

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; }
section() { echo ""; echo -e "${CYAN}━━━ $1 ━━━${NC}"; }

# ── 检测包管理器 ──
detect_pkg_manager() {
  if   command -v apt-get &>/dev/null; then PKG_MANAGER="apt"
  elif command -v yum &>/dev/null;     then PKG_MANAGER="yum"
  elif command -v dnf &>/dev/null;     then PKG_MANAGER="dnf"
  elif command -v apk &>/dev/null;     then PKG_MANAGER="apk"
  elif command -v pacman &>/dev/null;  then PKG_MANAGER="pacman"
  else
    error "不支持的 Linux 发行版，请手动安装 Node.js >= 18 后重试"
    exit 1
  fi
  info "检测到包管理器: $PKG_MANAGER"
}

# ── 安装系统依赖 ──
install_system_deps() {
  section "安装系统依赖"

  # git
  if ! command -v git &>/dev/null; then
    info "正在安装 git..."
    case $PKG_MANAGER in
      apt)    apt-get update -qq && apt-get install -y -qq git ;;
      yum|dnf) $PKG_MANAGER install -y -q git ;;
      apk)    apk add git ;;
      pacman) pacman -S --noconfirm git ;;
    esac
  else
    info "git $(git --version | head -1) ✓"
  fi
}

# ── 安装 Node.js ──
install_nodejs() {
  section "安装 Node.js"

  if command -v node &>/dev/null; then
    NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
      info "Node.js $(node -v) ✓"
      return
    fi
    warn "当前 Node.js $(node -v)，版本过低，正在升级..."
  fi

  # 使用 NodeSource 官方安装脚本（支持 ARM64 和 x86_64）
  info "正在安装 Node.js 20 LTS..."
  case $PKG_MANAGER in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y -qq nodejs
      ;;
    yum|dnf)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
      $PKG_MANAGER install -y -q nodejs
      ;;
    apk)
      apk add nodejs npm
      ;;
    pacman)
      pacman -S --noconfirm nodejs npm
      ;;
  esac

  if command -v node &>/dev/null; then
    info "Node.js $(node -v) ✓"
  else
    error "Node.js 安装失败，请手动安装: https://nodejs.org"
    exit 1
  fi
}

# ── 检测架构 ──
detect_arch() {
  ARCH=$(uname -m)
  CPU_CORES=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1)

  if echo "$ARCH" | grep -qiE 'aarch64|armv'; then
    RECOMMENDED_WORKERS=$(( CPU_CORES > 2 ? 2 : 1 ))
    info "ARM 架构 ($ARCH) · $CPU_CORES 核 · 推荐 WORKERS=$RECOMMENDED_WORKERS"
  else
    RECOMMENDED_WORKERS=$(( CPU_CORES > 4 ? 4 : CPU_CORES ))
    info "x86 架构 ($ARCH) · $CPU_CORES 核 · 推荐 WORKERS=$RECOMMENDED_WORKERS"
  fi
}

# ── 交互式配置 ──
interactive_config() {
  section "配置服务端口"

  # 默认端口
  DEFAULT_PORT=80
  PORT=""

  # 检查是否非交互模式（通过管道安装时没有终端）
  if [ -t 0 ]; then
    read -r -p "$(echo -e "${CYAN}  请输入服务端口号 [默认: $DEFAULT_PORT]: ${NC}")" PORT
  fi

  # 如果未输入或非法，使用默认值
  if [ -z "$PORT" ] || ! echo "$PORT" | grep -qxE '[0-9]+' || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    PORT=$DEFAULT_PORT
  fi

  info "服务端口: $PORT"
}

# ── 高可用配置（交互） ──
interactive_ha() {
  section "高可用配置"

  HA_ENABLED=""
  if [ -t 0 ]; then
    read -r -p "$(echo -e "${CYAN}  是否配置主备高可用？(y/N): ${NC}")" HA_ENABLED
  fi

  if [ "$HA_ENABLED" != "y" ] && [ "$HA_ENABLED" != "Y" ]; then
    info "跳过高可用配置"
    HA_ENABLED="no"
    return
  fi

  HA_ENABLED="yes"

  # 角色
  echo -e "${CYAN}  角色选择:${NC}"
  echo "    1) 主服务器 (master)"
  echo "    2) 备用服务器 (standby)"
  read -r -p "$(echo -e "${CYAN}  请选择 [1]: ${NC}")" HA_ROLE_SEL
  if [ "$HA_ROLE_SEL" = "2" ]; then
    HA_ROLE="standby"
  else
    HA_ROLE="master"
  fi

  # 本机 IP
  read -r -p "$(echo -e "${CYAN}  请输入本机 IP 地址: ${NC}")" HA_LOCAL_IP

  # 对方 IP
  read -r -p "$(echo -e "${CYAN}  请输入对方（$([ "$HA_ROLE" = "master" ] && echo "备用" || echo "主")）服务器 IP 地址: ${NC}")" HA_REMOTE_IP

  # 虚拟 IP
  read -r -p "$(echo -e "${CYAN}  请输入虚拟 IP 地址: ${NC}")" HA_VIRTUAL_IP

  info "高可用: $HA_ROLE | 本机: $HA_LOCAL_IP | 对方: $HA_REMOTE_IP | 虚拟IP: $HA_VIRTUAL_IP"
}

# ── 高可用安装 ──
setup_ha() {
  if [ "$HA_ENABLED" != "yes" ]; then
    return
  fi

  section "安装高可用组件"

  # 安装 keepalived
  info "安装 keepalived..."
  case $PKG_MANAGER in
    apt) apt-get install -y -qq keepalived ;;
    yum|dnf) $PKG_MANAGER install -y -q keepalived ;;
    apk) apk add keepalived ;;
    pacman) pacman -S --noconfirm keepalived ;;
  esac

  # 健康检查脚本
  mkdir -p /etc/keepalived
  cat > /etc/keepalived/chk_mqtt.sh <<'CHKEOF'
#!/bin/bash
curl -sf http://127.0.0.1:$(grep -oP 'PORT=\K\d+' /etc/systemd/system/mqtt-center-web.service 2>/dev/null || echo 80)/api/health > /dev/null 2>&1
exit $?
CHKEOF
  chmod +x /etc/keepalived/chk_mqtt.sh

  # keepalived 配置
  local PRIORITY=$([ "$HA_ROLE" = "master" ] && echo 150 || echo 100)
  local STATE=$([ "$HA_ROLE" = "master" ] && echo "MASTER" || echo "BACKUP")
  local IFACE=$(ip route get "$HA_REMOTE_IP" | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | head -1)

  cat > /etc/keepalived/keepalived.conf <<KEEPCONF
vrrp_instance VI_1 {
    state $STATE
    interface $IFACE
    virtual_router_id 55
    priority $PRIORITY
    advert_int 1
    authentication {
        auth_type PASS
        auth_pass mqtt-ha-secret
    }
    virtual_ipaddress {
        $HA_VIRTUAL_IP/24
    }
    track_script {
        chk_mqtt
    }
}
KEEPCONF

  systemctl enable keepalived
  systemctl restart keepalived
  info "keepalived 已配置并启动"

  # 配置同步（仅主服务器需要）
  if [ "$HA_ROLE" = "master" ]; then
    if [ ! -f ~/.ssh/id_rsa ]; then
      ssh-keygen -t rsa -b 2048 -f ~/.ssh/id_rsa -N "" -q
      info "SSH 密钥已生成"
    fi

    cat > /etc/systemd/system/mqtt-sync.service <<'SYSEOF'
[Unit]
Description=MQTT Center 配置同步
After=network.target

[Service]
Type=simple
ExecStart=/bin/sh /opt/mqtt-center-web/ha-sync.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SYSEOF

    cat > /opt/mqtt-center-web/ha-sync.sh <<SYNEOF
#!/bin/sh
REMOTE_IP=$HA_REMOTE_IP
while true; do
  rsync -avz --delete /opt/mqtt-center-web/data/clients.json root@\$REMOTE_IP:/opt/mqtt-center-web/data/ > /dev/null 2>&1
  sleep 30
done
SYNEOF
    chmod +x /opt/mqtt-center-web/ha-sync.sh

    systemctl daemon-reload
    systemctl enable mqtt-sync
    systemctl start mqtt-sync

    echo ""
    info "┌─────────────────────────────────────────────┐"
    info "│ 请在备用服务器上添加 SSH 公钥:               │"
    info "│                                             │"
    cat ~/.ssh/id_rsa.pub | sed 's/^/│  /'
    info "│                                             │"
    info "│ 备用服务器执行:                              │"
    info "│  echo '公钥' >> ~/.ssh/authorized_keys       │"
    info "└─────────────────────────────────────────────┘"
    echo ""
  fi
}

# ── 高可用结果显示 ──
show_ha_result() {
  if [ "$HA_ENABLED" != "yes" ]; then
    return
  fi
  echo ""
  echo -e "  ${CYAN}高可用配置:${NC}"
  echo -e "    角色:      $HA_ROLE"
  echo -e "    本机 IP:   $HA_LOCAL_IP"
  echo -e "    对方 IP:   $HA_REMOTE_IP"
  echo -e "    虚拟 IP:   $HA_VIRTUAL_IP"
  echo -e "    访问地址:  http://$HA_VIRTUAL_IP"
  echo ""
}
clone_repo() {
  section "获取代码"
  TARGET_DIR="/opt/mqtt-center-web"

  if [ -d "$TARGET_DIR" ]; then
    info "目录已存在，更新代码..."
    cd "$TARGET_DIR"
    git pull
  else
    info "克隆仓库到 $TARGET_DIR"
    git clone --depth=1 https://github.com/boxpanel/mqtt-Center-web.git "$TARGET_DIR"
    cd "$TARGET_DIR"
  fi
}

# ── 安装项目依赖并构建 ──
build_project() {
  section "安装依赖 & 构建"

  info "安装服务端依赖..."
  npm install 2>&1 | tail -1

  info "安装前端依赖..."
  cd client
  npm install 2>&1 | tail -1
  cd ..

  info "构建前端..."
  npm run build 2>&1 | tail -3

  mkdir -p data
  info "构建完成 ✓"
}

# ── 注册 systemd 服务 ──
setup_service() {
  section "注册系统服务"

  SERVICE_NAME="mqtt-center-web"
  SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"

  # 复制默认的 clients.json（空列表）
  if [ ! -f data/clients.json ]; then
    echo '{"clients":[]}' > data/clients.json
  fi

  # 写入完整的 service 内容
  cat > "$SERVICE_FILE" <<SERVICEEOF
[Unit]
Description=MQTT Center Web
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$TARGET_DIR
ExecStart=/usr/bin/env WORKERS=$RECOMMENDED_WORKERS PORT=$PORT node server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICEEOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" 2>&1 | tail -1
  systemctl restart "$SERVICE_NAME" 2>&1 | tail -1

  # 等待启动
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    info "服务已启动并设为开机自启 ✓"
  else
    warn "服务启动异常，请检查: systemctl status $SERVICE_NAME"
  fi
}

# ── 显示结果 ──
show_result() {
  local_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  [ -z "$local_ip" ] && local_ip="本机IP"

  section "安装完成"
  echo ""
  echo -e "  ${GREEN}MQTT Center Web 已成功安装并运行！${NC}"
  echo ""
  echo -e "  ${CYAN}访问地址:${NC}  http://$local_ip:$PORT"
  echo ""
  echo -e "  ${CYAN}管理命令:${NC}"
  echo -e "    查看状态:  systemctl status mqtt-center-web"
  echo -e "    查看日志:  journalctl -u mqtt-center-web -f"
  echo -e "    重启服务:  systemctl restart mqtt-center-web"
  echo -e "    停止服务:  systemctl stop mqtt-center-web"
  echo ""
  echo -e "  ${CYAN}安装目录:${NC}  $TARGET_DIR"
  echo ""
  echo -e "  ${YELLOW}提示: 如果无法访问，请检查防火墙是否放行了 $PORT 端口${NC}"
  echo ""
}

# ═════════════════════════════════════════════════
# 主流程
# ═════════════════════════════════════════════════

# 要求 root 权限
if [ "$(id -u)" -ne 0 ]; then
  error "请使用 root 权限运行: curl -fsSL ... | sudo bash"
  exit 1
fi

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      MQTT Center Web 一键安装       ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

detect_pkg_manager
install_system_deps
install_nodejs
detect_arch
interactive_config
interactive_ha
clone_repo
build_project
setup_service
setup_ha
show_ha_result
show_result
