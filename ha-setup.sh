#!/bin/bash
# =============================================================================
# MQTT Center Web - 主备高可用搭建脚本
# 在两台服务器上分别运行，配置主备关系
# =============================================================================
# 用法:
#   在主服务器上:  bash ha-setup.sh master <本机IP> <备用IP> <虚拟IP>
#   在备用服务器上: bash ha-setup.sh standby <本机IP> <主IP> <虚拟IP>
# =============================================================================
# 示例:
#   主服务器:  bash ha-setup.sh master 192.168.1.100 192.168.1.101 192.168.1.200
#   备用服务器: bash ha-setup.sh standby 192.168.1.101 192.168.1.100 192.168.1.200
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; }

if [ "$(id -u)" -ne 0 ]; then
  error "请使用 root 权限运行"
  exit 1
fi

MODE=$1          # master 或 standby
LOCAL_IP=$2      # 本机 IP
REMOTE_IP=$3     # 对方 IP
VIRTUAL_IP=$4     # 虚拟 IP

if [ -z "$MODE" ] || [ -z "$LOCAL_IP" ] || [ -z "$REMOTE_IP" ] || [ -z "$VIRTUAL_IP" ]; then
  echo "用法: bash ha-setup.sh <master|standby> <本机IP> <对方IP> <虚拟IP>"
  echo "示例:"
  echo "  主服务器:  bash ha-setup.sh master 192.168.1.100 192.168.1.101 192.168.1.200"
  echo "  备用服务器: bash ha-setup.sh standby 192.168.1.101 192.168.1.100 192.168.1.200"
  exit 1
fi

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   MQTT Center HA 高可用搭建          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""
info "角色: $MODE"
info "本机 IP: $LOCAL_IP"
info "对方 IP: $REMOTE_IP"
info "虚拟 IP: $VIRTUAL_IP"

# ── 安装 keepalived ──
install_keepalived() {
  info "安装 keepalived..."
  if command -v apt-get &>/dev/null; then
    apt-get update -qq && apt-get install -y -qq keepalived
  elif command -v yum &>/dev/null; then
    yum install -y -q keepalived
  else
    error "不支持的包管理器，请手动安装 keepalived"
    exit 1
  fi
}

# ── 配置 keepalived ──
configure_keepalived() {
  local PRIORITY
  local STATE

  if [ "$MODE" = "master" ]; then
    PRIORITY=150
    STATE="MASTER"
    # 主服务器配置 rsync 推送
    setup_rsync_push
  else
    PRIORITY=100
    STATE="BACKUP"
    # 备用服务器配置 rsync 拉取
    setup_rsync_pull
  fi

  cat > /etc/keepalived/keepalived.conf <<KEEPCONF
vrrp_instance VI_1 {
    state $STATE
    interface $(ip route get $REMOTE_IP | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | head -1)
    virtual_router_id 55
    priority $PRIORITY
    advert_int 1
    authentication {
        auth_type PASS
        auth_pass mqtt-ha-secret
    }
    virtual_ipaddress {
        $VIRTUAL_IP/24
    }

    track_script {
        chk_mqtt
    }
}
KEEPCONF

  # 健康检查脚本
  cat > /etc/keepalived/chk_mqtt.sh <<'CHKSCRIPT'
#!/bin/bash
# 检查 MQTT Center 是否存活
curl -sf http://127.0.0.1:$(grep -oP 'PORT=\K\d+' /etc/systemd/system/mqtt-center-web.service 2>/dev/null || echo 80)/api/health > /dev/null 2>&1
exit $?
CHKSCRIPT
  chmod +x /etc/keepalived/chk_mqtt.sh

  systemctl enable keepalived
  systemctl restart keepalived
  info "keepalived 已配置并启动"
}

# ── 主服务器: rsync 推送配置 ──
setup_rsync_push() {
  apt-get install -y -qq rsync 2>/dev/null || yum install -y -q rsync 2>/dev/null || true

  # SSH 密钥（免密同步）
  if [ ! -f ~/.ssh/id_rsa ]; then
    ssh-keygen -t rsa -b 2048 -f ~/.ssh/id_rsa -N "" -q
    info "SSH 密钥已生成，请将其添加到备用服务器:"
    echo ""
    cat ~/.ssh/id_rsa.pub
    echo ""
    warn "请在上方复制公钥，然后在备用服务器上执行:"
    warn "  echo '<公钥>' >> ~/.ssh/authorized_keys"
    warn ""
    read -r -p "确认备用服务器已配置公钥后按回车继续..."
  fi

  # 定时同步任务（每 30 秒）
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

  cat > /opt/mqtt-center-web/ha-sync.sh <<SYNCEOF
#!/bin/sh
REMOTE_IP=$REMOTE_IP
while true; do
  rsync -avz --delete /opt/mqtt-center-web/data/clients.json root@\$REMOTE_IP:/opt/mqtt-center-web/data/ > /dev/null 2>&1
  sleep 30
done
SYNCEOF
  chmod +x /opt/mqtt-center-web/ha-sync.sh

  systemctl daemon-reload
  systemctl enable mqtt-sync
  systemctl start mqtt-sync
  info "配置同步服务已启动（每 30 秒同步一次）"
}

# ── 备用服务器: rsync 接收配置 ──
setup_rsync_pull() {
  # 确保 .ssh 目录存在
  mkdir -p ~/.ssh
  chmod 700 ~/.ssh

  # 检查是否已有主服务器的公钥
  if ! grep -q "mqtt" ~/.ssh/authorized_keys 2>/dev/null; then
    warn "请将主服务器的 SSH 公钥添加到以下文件:"
    echo "  ~/.ssh/authorized_keys"
    echo ""
    warn "在主服务器上执行: cat ~/.ssh/id_rsa.pub"
    echo ""
    read -r -p "添加完成后按回车继续..."
  fi
}

# ── 显示结果 ──
show_result() {
  echo ""
  info "高可用配置完成！"
  echo ""
  echo -e "  ${CYAN}角色:${NC}         $MODE"
  echo -e "  ${CYAN}虚拟 IP:${NC}      $VIRTUAL_IP"
  echo -e "  ${CYAN}访问地址:${NC}     http://$VIRTUAL_IP"
  echo ""
  echo -e "  ${YELLOW}测试故障切换:${NC}"
  echo -e "    在主服务器上执行: systemctl stop mqtt-center-web"
  echo -e "    观察虚拟 IP 是否漂移到备用服务器"
  echo ""
}

install_keepalived
configure_keepalived
show_result
