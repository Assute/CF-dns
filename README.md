# Cloudflare DNS 管理面板

一个现代化的 Cloudflare DNS 多域名管理面板，专为提高效率而设计。支持批量管理 DNS 记录、一键申请 SSL 证书、手机端完美适配。

## ✨ 核心亮点

### 🚀 批量操作神器
- **批量修改** - 一键修改多个记录的 IP、代理状态(CDN)，支持进度条显示
- **批量删除** - 快速清理无用的 DNS 记录
- **批量 SSL** - **并发申请** Cloudflare Origin 证书，自动合并本地私钥
- **批量撤销** - 支持批量撤销证书，自动跳过无证书域名

### 📱 极致移动体验
- **响应式设计** - 专为手机优化，按钮大小、间距经过反复打磨
- **自适应布局** - PC 端宽屏视野，移动端单手操作
- **触控优化** - 优化的点击区域和交互反馈

### 🔒 安全与便捷
- **SSL 管理** - 查看证书详情，一键下载 PEM/KEY，支持私钥查看（首次）
- **账号管理** - 内置登录系统，支持修改用户名和密码
- **Token 向导** - 内置详细的图文教程，手把手教你获取 API Token

## 🛠️ 功能特性

### 域名管理
- 🌐 **多域名支持** - 同时管理多个 Cloudflare 域名，支持批量添加
- ✏️ **域名编辑** - 查看和更新域名的 API Token
- 🗑️ **域名删除** - 带确认提示的安全删除
- 🔄 **拖拽排序** - 通过拖拽手柄自定义域名显示顺序

### DNS 记录管理
- ➕ **添加记录** - 支持 A、AAAA、CNAME、TXT 等记录类型
- ✏️ **编辑记录** - 修改现有 DNS 记录
- 🔄 **代理状态** - 一键切换 Cloudflare 代理状态

## 🚀 快速开始

### 1. 安装依赖
需要 Node.js 环境（推荐 v18+）
```bash
npm install
```

### 2. 启动服务
```bash
npm start
```
服务默认运行在 `http://localhost:3600`

### 3. Docker 部署
```bash
# 构建镜像
docker-compose build

# 启动容器
docker-compose up -d
```

## 📝 配置说明

### 默认登录
- 用户名：`admin`
- 密码：`admin123`
*(首次登录后请务必在右上角"账号管理"中修改密码)*

### 获取 Cloudflare Token
面板内置了详细的图文教程，点击登录页面的"查看教程"即可查看。
核心权限要求：
- Zone - DNS - Edit
- Zone - SSL and Certificates - Edit

## 🛠️ 技术栈
- **后端**：Node.js + Express
- **前端**：原生 JavaScript + CSS3 (无框架依赖，轻量级)
- **部署**：支持 Docker / Docker Compose

## 📄 许可证
MIT License

---
**Enjoy Cloudflare DNS Manager! 🎉**
