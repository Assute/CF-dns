#!/bin/bash

# CF-DNS 一键安装脚本
# 使用方式: bash <(curl -fsSL https://raw.githubusercontent.com/Assute/CF-dns/main/install.sh)

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置变量
INSTALL_DIR="/opt/CF-dns"
# 支持 SOURCE 环境变量选择源，默认 gitee
SOURCE="${SOURCE:-gitee}"
PORT="${PORT:-3600}"

# 根据源选择下载 URL
if [[ "$SOURCE" == "github" ]]; then
    DOWNLOAD_URL="https://github.com/Assute/CF-dns/archive/refs/heads/main.zip"
else
    DOWNLOAD_URL="https://gitee.com/Assute/CF-dns/archive/main.zip"
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  CF-DNS 一键安装脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查是否为 root 用户
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ 此脚本必须以 root 用户运行${NC}"
   echo "请使用: sudo bash install.sh"
   exit 1
fi

# 检测 Linux 发行版
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
    echo -e "${YELLOW}📦 安装 Docker...${NC}"
    local distro=$(detect_distro)

    if [[ "$distro" == "ubuntu" || "$distro" == "debian" ]]; then
        apt-get update
        apt-get install -y docker.io docker-compose
        systemctl start docker
        systemctl enable docker
    elif [[ "$distro" == "centos" || "$distro" == "rhel" || "$distro" == "fedora" ]]; then
        yum install -y docker docker-compose
        systemctl start docker
        systemctl enable docker
    elif [[ "$distro" == "alpine" ]]; then
        apk add --no-cache docker docker-compose
        service docker start
    else
        echo -e "${RED}❌ 不支持的 Linux 发行版: $distro${NC}"
        echo "请手动安装 Docker: https://docs.docker.com/install/"
        exit 1
    fi
}

# 安装 unzip
install_unzip() {
    echo -e "${YELLOW}📦 安装 unzip...${NC}"
    local distro=$(detect_distro)

    if [[ "$distro" == "ubuntu" || "$distro" == "debian" ]]; then
        apt-get install -y unzip
    elif [[ "$distro" == "centos" || "$distro" == "rhel" || "$distro" == "fedora" ]]; then
        yum install -y unzip
    elif [[ "$distro" == "alpine" ]]; then
        apk add --no-cache unzip
    fi
}

# 检查并安装 Docker
echo -e "${YELLOW}📦 检查 Docker 安装...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}🔧 Docker 未安装，正在自动安装...${NC}"
    install_docker
    echo -e "${GREEN}✅ Docker 安装完成${NC}"
else
    echo -e "${GREEN}✅ Docker 已安装${NC}"
fi

# 检查并安装 Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}🔧 Docker Compose 未安装，正在自动安装...${NC}"
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}✅ Docker Compose 安装完成${NC}"
else
    echo -e "${GREEN}✅ Docker Compose 已安装${NC}"
fi

# 检查并安装 unzip
echo -e "${YELLOW}📦 检查 unzip 安装...${NC}"
if ! command -v unzip &> /dev/null; then
    echo -e "${YELLOW}🔧 unzip 未安装，正在自动安装...${NC}"
    install_unzip
    echo -e "${GREEN}✅ unzip 安装完成${NC}"
else
    echo -e "${GREEN}✅ unzip 已安装${NC}"
fi

# 检查并安装 curl
echo -e "${YELLOW}📦 检查 curl 安装...${NC}"
if ! command -v curl &> /dev/null; then
    echo -e "${YELLOW}🔧 curl 未安装，正在自动安装...${NC}"
    local distro=$(detect_distro)
    if [[ "$distro" == "ubuntu" || "$distro" == "debian" ]]; then
        apt-get install -y curl
    elif [[ "$distro" == "centos" || "$distro" == "rhel" || "$distro" == "fedora" ]]; then
        yum install -y curl
    elif [[ "$distro" == "alpine" ]]; then
        apk add --no-cache curl
    fi
    echo -e "${GREEN}✅ curl 安装完成${NC}"
else
    echo -e "${GREEN}✅ curl 已安装${NC}"
fi

# 创建临时目录和安装目录
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo -e "${YELLOW}📁 下载项目...${NC}"
cd "$TEMP_DIR"
curl -L "$DOWNLOAD_URL" -o CF-dns.zip
echo -e "${GREEN}✅ 下载完成${NC}"

# 解压
echo -e "${YELLOW}📦 解压文件...${NC}"
unzip -q CF-dns.zip
echo -e "${GREEN}✅ 解压完成${NC}"

# 移动到安装目录
echo -e "${YELLOW}📁 移动文件...${NC}"
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}⚠️  目录已存在，备份旧文件...${NC}"
    rm -rf "$INSTALL_DIR.bak"
    mv "$INSTALL_DIR" "$INSTALL_DIR.bak"
fi
mkdir -p "$INSTALL_DIR"
# 解压后的目录是 CF-dns-main，需要移动里面的文件
mv "$TEMP_DIR"/CF-dns-main/* "$INSTALL_DIR/" 2>/dev/null || true
echo -e "${GREEN}✅ 文件已准备${NC}"

# 创建必要的目录和配置文件
echo -e "${YELLOW}📝 检查配置文件...${NC}"

# 创建 data 目录
mkdir -p "$INSTALL_DIR/data"

# 如果 accounts.json 不存在，创建默认版本
if [ ! -f "$INSTALL_DIR/accounts.json" ]; then
    cat > "$INSTALL_DIR/accounts.json" << 'EOF'
{
  "admin": "admin123"
}
EOF
    echo -e "${GREEN}✅ 已创建 accounts.json${NC}"
fi

# 如果 auth.json 不存在，创建默认版本
if [ ! -f "$INSTALL_DIR/auth.json" ]; then
    cat > "$INSTALL_DIR/auth.json" << 'EOF'
{
  "tokens": []
}
EOF
    echo -e "${GREEN}✅ 已创建 auth.json${NC}"
fi

# 创建 .env 文件（如果需要）
if [ ! -f "$INSTALL_DIR/.env" ]; then
    cat > "$INSTALL_DIR/.env" << EOF
NODE_ENV=production
PORT=$PORT
EOF
    echo -e "${GREEN}✅ 已创建 .env${NC}"
fi

# 启动 Docker 容器
echo -e "${YELLOW}🚀 启动 Docker 容器...${NC}"

# 先停止旧容器（如果存在）
docker-compose -f "$INSTALL_DIR/docker-compose.yml" down 2>/dev/null || true

# 启动新容器
cd "$INSTALL_DIR"
docker-compose -f "$INSTALL_DIR/docker-compose.yml" up -d

# 等待容器启动
sleep 3

# 检查容器状态
if docker ps | grep -q "cf-cdn-manager"; then
    echo -e "${GREEN}✅ 容器已启动${NC}"
else
    echo -e "${RED}❌ 容器启动失败${NC}"
    docker-compose -f "$INSTALL_DIR/docker-compose.yml" logs
    exit 1
fi

# 显示安装完成信息
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✅ 安装完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}📍 安装位置:${NC} $INSTALL_DIR"
echo -e "${BLUE}🌐 访问地址:${NC} http://$(hostname -I | awk '{print $1}'):$PORT"
echo -e "${BLUE}📝 配置文件:${NC} $INSTALL_DIR/accounts.json"
echo ""
echo -e "${YELLOW}常用命令:${NC}"
echo "  查看日志:     docker-compose -f $INSTALL_DIR/docker-compose.yml logs -f"
echo "  停止服务:     docker-compose -f $INSTALL_DIR/docker-compose.yml down"
echo "  重启服务:     docker-compose -f $INSTALL_DIR/docker-compose.yml restart"
echo ""
