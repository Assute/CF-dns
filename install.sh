#!/bin/bash

# CF-DNS 一键安装脚本
# 国内：bash <(curl -fsSL https://gitee.com/Assute/CF-dns/releases/download/latest/install.sh)
# 国外：bash <(curl -fsSL https://github.com/Assute/CF-dns/releases/download/latest/install.sh)

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="/opt/CF-dns"
PORT="${PORT:-3600}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  CF-DNS 一键安装${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查是否为 root 用户
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ 必须以 root 用户运行${NC}"
   exit 1
fi

# 检测系统
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        echo "$ID"
    else
        echo "unknown"
    fi
}

# 安装 Docker
install_docker() {
    local distro=$(detect_distro)
    if [[ "$distro" == "ubuntu" || "$distro" == "debian" ]]; then
        apt-get update && apt-get install -y docker.io docker-compose
    elif [[ "$distro" == "centos" || "$distro" == "rhel" || "$distro" == "fedora" ]]; then
        yum install -y docker docker-compose
    elif [[ "$distro" == "alpine" ]]; then
        apk add --no-cache docker docker-compose
    fi
}

# 检查 Docker
echo -e "${YELLOW}检查 Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}安装 Docker...${NC}"
    install_docker
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}安装 Docker Compose...${NC}"
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

echo -e "${GREEN}✅ Docker 已就绪${NC}"

# 启动 Docker
systemctl start docker 2>/dev/null || service docker start 2>/dev/null || true

# 创建临时目录
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# 下载压缩包
echo -e "${YELLOW}下载项目...${NC}"
# 检测使用的 source（通过脚本来源判断）
SCRIPT_URL="${BASH_SOURCE[0]}"
if [[ "$SCRIPT_URL" == *"gitee"* ]]; then
    DOWNLOAD_URL="https://gitee.com/Assute/CF-dns/releases/download/latest/CF-dns.zip"
else
    DOWNLOAD_URL="https://github.com/Assute/CF-dns/releases/download/latest/CF-dns.zip"
fi

cd "$TEMP_DIR"
curl -L "$DOWNLOAD_URL" -o CF-dns.zip || {
    echo -e "${RED}❌ 下载失败${NC}"
    exit 1
}

# 解压
echo -e "${YELLOW}解压文件...${NC}"
unzip -q CF-dns.zip

# 移动到安装目录
echo -e "${YELLOW}安装到 $INSTALL_DIR...${NC}"
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR.bak"
    mv "$INSTALL_DIR" "$INSTALL_DIR.bak"
fi

mkdir -p "$INSTALL_DIR"
mv CF-dns/* "$INSTALL_DIR/" 2>/dev/null || mv "$TEMP_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true

# 创建必要文件
mkdir -p "$INSTALL_DIR/data"

if [ ! -f "$INSTALL_DIR/accounts.json" ]; then
    cat > "$INSTALL_DIR/accounts.json" << 'EOF'
{"admin": "admin123"}
EOF
fi

if [ ! -f "$INSTALL_DIR/auth.json" ]; then
    cat > "$INSTALL_DIR/auth.json" << 'EOF'
{"tokens": []}
EOF
fi

if [ ! -f "$INSTALL_DIR/.env" ]; then
    cat > "$INSTALL_DIR/.env" << EOF
NODE_ENV=production
PORT=$PORT
EOF
fi

# 启动容器
echo -e "${YELLOW}启动服务...${NC}"
cd "$INSTALL_DIR"
docker-compose down 2>/dev/null || true
docker-compose up -d

sleep 2

# 验证
if docker ps | grep -q "cf-cdn-manager"; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✅ 安装完成！${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "访问地址: http://$(hostname -I | awk '{print $1}'):$PORT"
    echo "用户名: admin"
    echo "密码: admin123"
    echo ""
    echo "常用命令:"
    echo "  查看日志: docker-compose -f $INSTALL_DIR/docker-compose.yml logs -f"
    echo "  重启: docker-compose -f $INSTALL_DIR/docker-compose.yml restart"
    echo "  停止: docker-compose -f $INSTALL_DIR/docker-compose.yml down"
else
    echo -e "${RED}❌ 启动失败${NC}"
    exit 1
fi
