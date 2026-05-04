# CF-dns

一个基于 Node.js 的 Cloudflare DNS 管理工具。

## 运行环境

- Node.js 18+（建议）
- npm

## 安装依赖

```bash
npm install
```

## 启动项目

### 方式 1：直接用 Node 运行

```bash
node server.js
```

### 方式 2：用 npm 启动

```bash
npm start
```

## 访问地址

启动后访问：

```text
http://localhost:3600
```

## data 目录说明

`data/` 目录不会上传到 GitHub。

程序首次启动时会自动生成：

- `data/auth.json`
- `data/accounts.json`
- `data/certificates.json`

## 默认登录信息

首次运行默认账号密码：

- 用户名：`admin`
- 密码：`admin123`

登录后建议尽快修改密码。
