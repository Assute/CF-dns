# Cloudflare DNS 管理面板

一个现代化的 Cloudflare DNS 多域名管理面板，专为提高效率而设计。支持批量管理 DNS 记录、一键申请 SSL 证书、手机端完美适配。

## 更新记录

最新更新说明见 [CHANGELOG.md](CHANGELOG.md)。

## 快速开始

### 一键安装

**国内服务器（Gitee）：**
```bash
bash <(curl -fsSL https://gitee.com/Assute/CF-dns/raw/main/install.sh)
```

**国外服务器（GitHub）：**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Assute/CF-dns/main/install.sh)
```

安装完成后访问：`http://你的服务器IP:3600`

默认登录：
- 用户名：`admin`
- 密码：`admin123`

首次登录后请立即修改密码。

## 功能特性

### 批量操作
- 批量修改 DNS 记录的 IP 和代理状态
- 批量删除无用的 DNS 记录
- 批量申请 Cloudflare Origin 证书
- 批量撤销证书

### 域名管理
- 支持同时管理多个 Cloudflare 域名
- 支持查看和更新域名 API Token
- 支持拖拽排序域名

### DNS 记录管理
- 支持 A、AAAA、CNAME、TXT 等记录类型
- 一键切换 Cloudflare 代理状态
- 支持添加和编辑记录

### SSL 证书管理
- 查看证书详情
- 一键下载 PEM/KEY 文件
- 支持私钥查看

### 移动适配
- 响应式设计，完美支持手机和平板
- 优化的触控交互

## 配置说明

### 获取 Cloudflare Token

面板内置了详细的图文教程，登录后点击"查看教程"即可查看。

核心权限要求：
- Zone - DNS - Edit
- Zone - SSL and Certificates - Edit

## 服务器管理

### 常用命令

```bash
# 查看运行日志
docker-compose -f /opt/CF-dns/docker-compose.yml logs -f

# 停止服务
docker-compose -f /opt/CF-dns/docker-compose.yml down

# 重启服务
docker-compose -f /opt/CF-dns/docker-compose.yml restart

# 查看容器状态
docker ps | grep cf-cdn-manager
```

### 卸载服务

```bash
# 停止并删除容器
docker-compose -f /opt/CF-dns/docker-compose.yml down

# 删除安装目录
sudo rm -rf /opt/CF-dns
```

## 技术栈

- 后端：Node.js + Express
- 前端：原生 JavaScript + CSS3
- 部署：Docker / Docker Compose

## 常见问题

**Q: 安装失败，提示 Docker 未安装？**
A: 脚本会自动安装，请确保网络连接正常。

**Q: 无法访问面板？**
A: 检查防火墙是否开放 3600 端口，或使用 `docker ps` 确认容器正在运行。

**Q: 数据会保留吗？**
A: 会的，配置文件存储在 `/opt/CF-dns/data/` 目录。

**Q: 为什么 Docker 部署后会看到 `accounts.json`、`auth.json` 变成文件夹？**
A: 这是旧版挂载路径使用了单文件绑定导致的现象。新版已统一改为挂载整个 `data/` 目录，数据文件应位于 `/opt/CF-dns/data/` 下。

## 许可证

MIT License
